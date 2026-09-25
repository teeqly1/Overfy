import React, { useState, useEffect, useCallback, useRef } from 'react'
import { usePlayer, extractTrackTags } from '../contexts/PlayerContext'
import {
  scSearchTracks,
  scSearchArtists,
  scArtistTracks,
  scSearchPlaylists,
  scPlaylistTracks,
} from '../services/soundcloud'
import {
  dzSearchTracks,
  dzSearchArtists,
  dzArtistTracks,
  dzSearchPlaylists,
  dzPlaylistTracks,
} from '../services/deezer'
import {
  ymSearchTracks,
  ymSearchArtists,
  ymArtistTracks,
  ymSearchPlaylists,
  ymPlaylistTracks,
  getYmToken,
  YM_OAUTH_URL,
} from '../services/yandex'
import { IconClose } from '../components/Icons'
import { formatDuration } from '../services/format'
import { initialCover, handleCoverError } from '../services/soundcloud'
import { rememberRemoteTrack, isRemoteTrackId } from '../services/remoteTracks'
import { CHART_GENRE_OPTIONS } from '../services/settings'
import AddToPlaylistModal from '../components/AddToPlaylistModal'

const TABS = [
  { id: 'tracks', label: 'Треки' },
  { id: 'artists', label: 'Артисты' },
  { id: 'playlists', label: 'Плейлисты' },
]

// Источники музыки. SoundCloud — без ключей; Deezer — публичное API;
// Яндекс — по OAuth-токену пользователя (Настройки -> Источники).
const SOURCES = [
  { id: 'sc', label: 'SoundCloud' },
  { id: 'dz', label: 'Deezer' },
  { id: 'ym', label: 'Яндекс' },
]

const SOURCE_KEY = 'overfy_search_source'

const SEARCH_FNS = {
  sc: { tracks: scSearchTracks, artists: scSearchArtists, playlists: scSearchPlaylists },
  dz: { tracks: dzSearchTracks, artists: dzSearchArtists, playlists: dzSearchPlaylists },
  ym: { tracks: ymSearchTracks, artists: ymSearchArtists, playlists: ymSearchPlaylists },
}

function TrackItem({ track, onPlay, onPlayNext, onAddToPlaylist, isFavorite, onToggleFav }) {
  return (
    <div className="track-item" onClick={() => onPlay(track)}>
      <img className="track-cover" src={track.image || '/default-cover.svg'} alt="" loading="lazy" onError={(e) => handleCoverError(e, track)} />
      <div className="track-info">
        <div className="track-name">{track.name}</div>
        <div className="track-artist">{track.artist_name}</div>
      </div>
      <div className="track-duration">{formatDuration(track.duration)}</div>
      <div className="track-tags">
        {extractTrackTags(track).slice(0, 2).map((tag, i) => (
          <span key={i} className="tag">{tag}</span>
        ))}
      </div>
      <button
        className="next-btn"
        onClick={(e) => { e.stopPropagation(); onPlayNext(track) }}
        title="Играть следующим"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <polygon points="5 4 15 12 5 20 5 4"/>
          <rect x="17" y="4" width="2" height="16"/>
        </svg>
      </button>
      <button
        className="next-btn pl-btn"
        onClick={(e) => { e.stopPropagation(); onAddToPlaylist(track) }}
        title="Добавить в плейлист"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="3" y1="6" x2="13" y2="6"/>
          <line x1="3" y1="12" x2="13" y2="12"/>
          <line x1="3" y1="18" x2="9" y2="18"/>
          <line x1="18" y1="13" x2="18" y2="21"/>
          <line x1="14" y1="17" x2="22" y2="17"/>
        </svg>
      </button>
      <button
        className={`fav-btn ${isFavorite ? 'active' : ''}`}
        onClick={(e) => { e.stopPropagation(); onToggleFav(track.id) }}
        title={isFavorite ? 'Убрать из избранного' : 'Добавить в избранное'}
      >
        {isFavorite ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
          </svg>
        )}
      </button>
    </div>
  )
}

function formatCount(n) {
  if (!Number.isFinite(n)) return ''
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

export default function SearchPage() {
  const { playTrack, playTrackAt, addToFavorites, removeFromFavorites, isFavorite, playNext } = usePlayer()
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState('tracks')
  const [source, setSource] = useState(() => {
    try {
      const s = localStorage.getItem(SOURCE_KEY)
      return SOURCES.some(x => x.id === s) ? s : 'sc'
    } catch { return 'sc' }
  })
  const [sourceError, setSourceError] = useState(null)

  const [tracks, setTracks] = useState([])
  const [artists, setArtists] = useState([])
  const [playlists, setPlaylists] = useState([])
  const [artistTracks, setArtistTracks] = useState(null) // { artist, tracks } | null
  const [playlistLoading, setPlaylistLoading] = useState(null) // id открытого плейлиста
  const [loading, setLoading] = useState(false)
  const [artistLoading, setArtistLoading] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const [plModalTrack, setPlModalTrack] = useState(null)

  const searchRef = useRef('')
  const inputRef = useRef(null)
  // Счётчик поколений: защищает от гонок (устаревший ответ не перезаписывает новый)
  const seqRef = useRef(0)

  // Ctrl+K из App: фокус в поле поиска
  useEffect(() => {
    const focus = () => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
    window.addEventListener('overfy:focus-search', focus)
    return () => window.removeEventListener('overfy:focus-search', focus)
  }, [])

  const queueNext = useCallback((track) => {
    if (isRemoteTrackId(track.id)) rememberRemoteTrack(track)
    playNext(track)
  }, [playNext])

  const changeSource = (id) => {
    setSource(id)
    try { localStorage.setItem(SOURCE_KEY, id) } catch { /* ignore */ }
  }

  const doSearch = useCallback(async (query) => {
    const q = query.trim()
    if (!q) return
    const seq = ++seqRef.current
    searchRef.current = q
    setLoading(true)
    setHasSearched(true)
    setArtistTracks(null)
    setArtistLoading(false)
    setSourceError(null)
    // Яндекс без токена: сразу понятная подсказка вместо пустого результата
    if (source === 'ym' && !getYmToken().trim()) {
      setTracks([]); setArtists([]); setPlaylists([])
      setSourceError('ym-token')
      setLoading(false)
      return
    }
    const fns = SEARCH_FNS[source]
    const current = () => seq === seqRef.current
    const withErr = (p) => p.catch((e) => {
      if (current()) setSourceError(String(e?.message || e))
      return []
    })
    try {
      if (tab === 'tracks') {
        const r = await withErr(fns.tracks(q, 25))
        if (current()) setTracks(r)
      } else if (tab === 'artists') {
        const r = await withErr(fns.artists(q, 20))
        if (current()) setArtists(r)
      } else {
        const r = await withErr(fns.playlists(q, 15))
        if (current()) setPlaylists(r)
      }
    } finally {
      if (current()) setLoading(false)
    }
  }, [tab, source])

  // Смена таба или источника с уже введённым запросом — ищем заново
  useEffect(() => {
    if (hasSearched && searchRef.current) doSearch(searchRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, source])

  const handleSubmit = (e) => {
    e.preventDefault()
    doSearch(search)
  }

  const handleArtistClick = async (artist) => {
    const seq = ++seqRef.current
    setLoading(false)
    setArtistLoading(true)
    try {
      let tracks = []
      if (source === 'sc') tracks = await scArtistTracks(artist.id, 20)
      else if (source === 'dz') tracks = await dzArtistTracks(artist.id, 20)
      else tracks = await ymArtistTracks(artist.id, 20)
      if (seq === seqRef.current) setArtistTracks({ artist, tracks })
    } catch {
      if (seq === seqRef.current) setArtistTracks({ artist, tracks: [] })
    } finally {
      if (seq === seqRef.current) setArtistLoading(false)
    }
  }

  const handlePlaylistClick = async (playlist) => {
    ++seqRef.current
    setLoading(false)
    setPlaylistLoading(playlist.id)
    try {
      let tracks = []
      if (source === 'sc') tracks = await scPlaylistTracks(playlist.id)
      else if (source === 'dz') tracks = await dzPlaylistTracks(playlist.id)
      else tracks = await ymPlaylistTracks(playlist.owner_uid, playlist.id)
      if (tracks.length) playTrackAt(tracks, 0)
    } catch {
      // плейлист недоступен — ничего не делаем
    } finally {
      setPlaylistLoading(null)
    }
  }

  const renderTrackList = (list) =>
    list.map(track => (
      <TrackItem
        key={track.id}
        track={track}
        onPlay={(t) => playTrack(t, list)}
        onPlayNext={queueNext}
        onAddToPlaylist={(t) => {
          if (isRemoteTrackId(t.id)) rememberRemoteTrack(t)
          setPlModalTrack(t)
        }}
        isFavorite={isFavorite(track.id)}
        onToggleFav={(id) => {
          if (isRemoteTrackId(id)) rememberRemoteTrack(track)
          isFavorite(id) ? removeFromFavorites(id) : addToFavorites(id)
        }}
      />
    ))

  const emptyState = (text) => (
    <div className="empty-state">
      <p>{text}</p>
      <p className="empty-hint">Попробуйте изменить запрос или вкладку</p>
    </div>
  )

  const renderResults = () => {
    if (!hasSearched) {
      return (
        <div className="empty-state">
          <p className="empty-hint">Начните вводить запрос — треки, артисты и плейлисты выбранного источника</p>
        </div>
      )
    }

    if (sourceError) return null // ошибка уже показана отдельным блоком

    if (tab === 'tracks') {
      return tracks.length
        ? <div className="track-list"><div className="list-heading">Треки по запросу «{searchRef.current}»</div>{renderTrackList(tracks)}</div>
        : emptyState(`Треки не найдены по запросу «${searchRef.current}»`)
    }

    if (tab === 'artists') {
      // Открытый артист: показываем его треки
      if (artistTracks) {
        return (
          <div className="track-list">
            <div className="artist-open-header">
              <button className="btn btn-outline btn-sm" onClick={() => setArtistTracks(null)}>← Все артисты</button>
              <span className="artist-open-name">{artistTracks.artist.username}</span>
            </div>
            {artistLoading ? (
              <div className="search-loading">
                <div className="btn-spinner"></div>
                <span>Загружаем треки...</span>
              </div>
            ) : artistTracks.tracks.length ? (
              renderTrackList(artistTracks.tracks)
            ) : (
              <p className="empty-hint">У артиста нет доступных треков</p>
            )}
          </div>
        )
      }
      return artists.length ? (
        <div className="artist-grid">
          {artists.map(a => (
            <button key={a.id} className="artist-card" onClick={() => handleArtistClick(a)}>
              <img className="artist-avatar" src={a.avatar_url || initialCover(a.username)} alt="" loading="lazy" onError={(e) => handleCoverError(e, { _avatarRaw: a.avatar_url, name: a.username })} />
              <span className="artist-name">
                {a.username}
                {a.verified && (
                  <svg className="artist-verified" width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2l2.4 2.4 3.4-.5 1 3.3 3 1.7-1.3 3.1 1.3 3.1-3 1.7-1 3.3-3.4-.5L12 22l-2.4-2.4-3.4.5-1-3.3-3-1.7 1.3-3.1L2.2 9l3-1.7 1-3.3 3.4.5z"/>
                    <path d="M9.5 12.5l1.8 1.8 3.4-3.9" stroke="#000" strokeWidth="2" fill="none" strokeLinecap="round"/>
                  </svg>
                )}
              </span>
              <span className="artist-meta">{formatCount(a.followers_count)} подписчиков · {a.track_count} треков</span>
            </button>
          ))}
        </div>
      ) : emptyState(`Артисты не найдены по запросу «${searchRef.current}»`)
    }

    // playlists
    return playlists.length ? (
      <div className="playlist-grid">
        {playlists.map(p => (
          <button key={p.id} className="playlist-card" onClick={() => handlePlaylistClick(p)} disabled={playlistLoading === p.id}>
            <img className="playlist-cover" src={p.artwork_url} alt="" loading="lazy"
                 onError={(e) => handleCoverError(e, { _artworkRaw: p._artworkRaw, name: p.title })} />
            <span className="playlist-name">{p.title}</span>
            <span className="playlist-meta">
              {p.username} · {p.track_count} треков
            </span>
            {playlistLoading === p.id
              ? <span className="playlist-loading"><span className="btn-spinner"></span></span>
              : (
                <span className="playlist-play">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21 6 3"/></svg>
                </span>
              )}
          </button>
        ))}
      </div>
    ) : emptyState(`Плейлисты не найдены по запросу «${searchRef.current}»`)
  }

  return (
    <div className="screen search-screen">
      <div className="search-header">
        <h2 className="screen-title">Поиск</h2>
      </div>

      <form onSubmit={handleSubmit} className="search-bar">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8"/>
          <line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Треки, артисты, плейлисты... (Ctrl+K)"
        />
        {search && (
          <button type="button" className="search-clear" onClick={() => { setSearch(''); setHasSearched(false); setArtistTracks(null); }} title="Очистить">
            <IconClose size={13} />
          </button>
        )}
      </form>

      <div className="search-tabs">
        {SOURCES.map(s => (
          <button
            key={s.id}
            className={`search-tab source-tab ${source === s.id ? 'active' : ''}`}
            onClick={() => changeSource(s.id)}
          >{s.label}</button>
        ))}
        <span className="source-divider" />
        {TABS.map(t => (
          <button
            key={t.id}
            className={`search-tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >{t.label}</button>
        ))}
      </div>

      <div className="search-genre-chips" style={{ display: 'flex', gap: '8px', overflowX: 'auto', padding: '6px 0 12px', scrollbarWidth: 'none' }}>
        {CHART_GENRE_OPTIONS.filter(g => g.id !== 'all-music').map(g => (
          <button
            key={g.id}
            type="button"
            className={`genre-chip ${search === g.label ? 'active' : ''}`}
            onClick={() => {
              setSearch(g.label)
              setTab('tracks')
              doSearch(g.label)
            }}
          >
            {g.label}
          </button>
        ))}
      </div>

      {source === 'dz' && (
        <p className="empty-hint dz-note">Deezer: воспроизводится официальный 30-секундный фрагмент трека</p>
      )}

      {sourceError === 'ym-token' && (
        <div className="empty-state">
          <p>Для поиска в Яндекс Музыке нужен ваш OAuth-токен</p>
          <p className="empty-hint">
            Откройте ссылку авторизации, войдите в Яндекс и скопируйте значение
            <code> access_token</code> из адреса страницы после входа.
          </p>
          <p className="empty-hint">Затем вставьте его в Настройки → Источники → Яндекс Музыка.</p>
          <button
            className="btn btn-outline btn-sm"
            onClick={() => navigator.clipboard?.writeText(YM_OAUTH_URL).catch(() => {})}
          >
            Скопировать ссылку авторизации
          </button>
        </div>
      )}

      {sourceError && sourceError !== 'ym-token' && (
        <div className="empty-state">
          <p>Ошибка источника</p>
          <p className="empty-hint">{sourceError}</p>
        </div>
      )}

      {loading && (
        <div className="search-loading">
          <div className="btn-spinner"></div>
          <span>Поиск...</span>
        </div>
      )}

      {!loading && renderResults()}

      {plModalTrack && <AddToPlaylistModal track={plModalTrack} onClose={() => setPlModalTrack(null)} />}
    </div>
  )
}
