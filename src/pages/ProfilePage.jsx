import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { usePlayer } from '../contexts/PlayerContext'
import { formatDuration } from '../services/format'
import { initialCover, handleCoverError } from '../services/soundcloud'
import { getRemoteTracks, isRemoteTrackId, rememberRemoteTrack } from '../services/remoteTracks'
import { getListeningSeconds, formatListening, getPlaylists } from '../services/userData'
import { analyzeListeningStats, formatListeningTime } from '../services/listeningStats'
import UserBadges from '../components/UserBadges'
import {
  ensureProfile, updateProfile, fileToAvatarDataUrl,
  MAX_FAV_TRACKS, profileTrackMeta,
} from '../services/profile'
import { getSelectedBannerId, resolveBanner } from '../services/banners'
import { IconClose, IconMusic } from '../components/Icons'

// Профиль пользователя: ник, аватар и до 3 любимых песен, видимых друзьям.
// Требуется аккаунт Supabase (в гостевом режиме недоступен).
export default function ProfilePage() {
  const { user, isGuest } = useAuth()
  const { favorites, playTrack, playNext } = usePlayer()
  const [profile, setProfile] = useState(null)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState('')
  const [nicknameDraft, setNicknameDraft] = useState('')
  const [editingNick, setEditingNick] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [listening, setListening] = useState(getListeningSeconds)
  const [publicPlaylists, setPublicPlaylists] = useState([])
  const [listeningStats, setListeningStats] = useState(null)
  const [statsLoading, setStatsLoading] = useState(false)
  const [selectedPeriod, setSelectedPeriod] = useState(7)
  const [statsOpen, setStatsOpen] = useState(false)
  const avatarInputRef = useRef(null)
  const [banner, setBanner] = useState(() => resolveBanner(getSelectedBannerId()))

  // Баннер перечитывается при выборе на «Маркете» (без перезагрузки страницы)
  useEffect(() => {
    const handler = () => setBanner(resolveBanner(getSelectedBannerId()))
    window.addEventListener('overfy-banner-changed', handler)
    return () => window.removeEventListener('overfy-banner-changed', handler)
  }, [])

  const flash = (msg) => {
    setNotice(msg)
    setTimeout(() => setNotice(''), 2500)
  }

  // Создаём профиль при первом открытии (ник по умолчанию — из email)
  useEffect(() => {
    if (isGuest || !user) return
    let active = true
    ensureProfile()
      .then((p) => {
        if (!active) return
        setProfile(p)
        setNicknameDraft(p.nickname || '')
      })
      .catch((e) => active && setError(e.message))
    return () => { active = false }
  }, [user, isGuest])

  // Часы прослушивания обновляются, пока открыт профиль
  useEffect(() => {
    const id = setInterval(() => setListening(getListeningSeconds()), 5000)
    return () => clearInterval(id)
  }, [])

  // Публичные плейлисты пользователя
  useEffect(() => {
    if (isGuest || !user) return
    const pls = getPlaylists().filter(p => p.visibility === 'public')
    setPublicPlaylists(pls)
  }, [user, isGuest])

  // Загрузка статистики прослушиваний (только когда модалка открыта)
  useEffect(() => {
    if (isGuest || !user || !statsOpen) return
    let active = true
    setStatsLoading(true)
    analyzeListeningStats(user.id, selectedPeriod)
      .then(stats => { if (active) setListeningStats(stats) })
      .catch(err => console.error('Stats error:', err))
      .finally(() => { if (active) setStatsLoading(false) })
    return () => { active = false }
  }, [user, isGuest, selectedPeriod, statsOpen])

  const saveProfile = useCallback(async (patch, okMsg) => {
    setSaving(true)
    try {
      const updated = await updateProfile(patch)
      setProfile(updated)
      if (okMsg) flash(okMsg)
    } catch (e) {
      flash(e.message)
    } finally {
      setSaving(false)
    }
  }, [])

  const handleSaveNickname = async () => {
    const nick = nicknameDraft.trim()
    if (!nick || nick === profile?.nickname) {
      setEditingNick(false)
      return
    }
    await saveProfile({ nickname: nick }, 'Ник обновлён')
    setEditingNick(false)
  }

  const handleAvatarFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const dataUrl = await fileToAvatarDataUrl(file)
      await saveProfile({ avatar: dataUrl }, 'Аватар обновлён')
    } catch (err) {
      flash(err.message)
    }
  }

  const handleRemoveAvatar = async () => {
    await saveProfile({ avatar: null }, 'Аватар удалён')
  }

  // Кандидаты для «любимых песен» — избранные треки с известными метаданными
  const favoriteCandidates = useCallback(() => {
    const remoteIds = favorites.filter(isRemoteTrackId)
    const loaded = getRemoteTracks(remoteIds)
    return favorites.map(id => loaded.find(t => t.id === id)).filter(Boolean)
  }, [favorites])

  const currentFav = profile?.favorite_tracks || []

  const addFavoriteTrack = async (track) => {
    if (currentFav.length >= MAX_FAV_TRACKS) {
      flash(`Максимум ${MAX_FAV_TRACKS} песни`)
      return
    }
    if (currentFav.some(t => t.id === track.id)) {
      flash('Уже в профиле')
      return
    }
    rememberRemoteTrack(track)
    await saveProfile({
      favorite_tracks: [...currentFav, profileTrackMeta(track)],
    }, 'Песня добавлена в профиль')
  }

  const removeFavoriteTrack = async (trackId) => {
    await saveProfile({
      favorite_tracks: currentFav.filter(t => t.id !== trackId),
    }, 'Песня убрана из профиля')
  }

  if (isGuest || !user) {
    return (
      <div className="screen profile-screen">
        <h2 className="screen-title">Профиль</h2>
        <div className="empty-state">
          <p>Профиль доступен только с аккаунтом</p>
          <p className="empty-hint">Выйдите из гостевого режима и войдите или зарегистрируйтесь</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="screen profile-screen">
        <h2 className="screen-title">Профиль</h2>
        <div className="empty-state">
          <p>Не удалось загрузить профиль</p>
          <p className="empty-hint">{error}</p>
        </div>
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="screen profile-screen">
        <h2 className="screen-title">Профиль</h2>
        <div className="profile-loading"><span className="btn-spinner"></span></div>
      </div>
    )
  }

  return (
    <div className="screen profile-screen">
      <h2 className="screen-title">Профиль</h2>

      <div className="profile-card">
        {banner && (
          <div
            className={`profile-banner ${banner.image ? 'profile-banner--image' : ''}`}
            style={banner.image ? { backgroundImage: `url("${banner.image}")` } : banner.color ? { background: banner.color } : undefined}
          />
        )}
        <div className="profile-top">
          <button
            className="profile-avatar-wrap"
            onClick={() => avatarInputRef.current?.click()}
            title="Сменить аватар"
          >
            <img
              className="profile-avatar"
              src={profile.avatar || initialCover(profile.nickname)}
              alt=""
              onError={(e) => handleCoverError(e, { name: profile.nickname })}
            />
            <span className="profile-avatar-edit">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M17 3a2.83 2.83 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>
              </svg>
            </span>
          </button>
          <input ref={avatarInputRef} type="file" accept="image/*" hidden onChange={handleAvatarFile} />

          <div className="profile-identity">
            {editingNick ? (
              <div className="profile-nick-edit">
                <input
                  type="text"
                  className="profile-nick-input"
                  value={nicknameDraft}
                  maxLength={24}
                  autoFocus
                  onChange={(e) => setNicknameDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSaveNickname() }}
                />
                <button className="btn btn-sm" onClick={handleSaveNickname} disabled={saving}>OK</button>
                <button className="btn btn-outline btn-sm" onClick={() => { setEditingNick(false); setNicknameDraft(profile.nickname) }}>Отмена</button>
              </div>
            ) : (
              <div className="profile-nick-row">
                <span className="profile-nickname">{profile.nickname} <UserBadges profile={profile} size={15} /></span>
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => { setNicknameDraft(profile.nickname); setEditingNick(true) }}
                >Изменить ник</button>
                {profile.avatar && (
                  <button className="btn btn-outline btn-sm" onClick={handleRemoveAvatar} disabled={saving}>
                    Убрать аватар
                  </button>
                )}
              </div>
            )}
            <span className="profile-email">{user.email}</span>
            <span className="profile-listening">Всего прослушано: <b>{formatListening(listening)}</b></span>
          </div>
        </div>

        <section className="profile-favs">
          <h3 className="profile-favs-title">Любимые песни ({currentFav.length}/{MAX_FAV_TRACKS})</h3>
          <p className="empty-hint">Их увидят те, кто зайдёт в ваш профиль</p>
          <div className="profile-fav-list">
            {currentFav.map(track => (
              <div key={track.id} className="track-item" onClick={() => playTrack(track, currentFav)}>
                <img className="track-cover" src={track.image || initialCover(track.name)} alt="" loading="lazy"
                     onError={(e) => handleCoverError(e, track)} />
                <div className="track-info">
                  <div className="track-name">{track.name}</div>
                  <div className="track-artist">{track.artist_name}</div>
                </div>
                <div className="track-duration">{formatDuration(track.duration)}</div>
                <button
                  className="next-btn"
                  onClick={(e) => { e.stopPropagation(); rememberRemoteTrack(track); playNext(track) }}
                  title="Играть следующим"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5 4 15 12 5 20 5 4"/>
                    <rect x="17" y="4" width="2" height="16"/>
                  </svg>
                </button>
                <button
                  className="next-btn"
                  onClick={(e) => { e.stopPropagation(); removeFavoriteTrack(track.id) }}
                  title="Убрать из профиля"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
            ))}
            {currentFav.length < MAX_FAV_TRACKS && (
              <button className="profile-fav-add" onClick={() => setPickerOpen(true)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19"/>
                  <line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                Добавить из избранного
              </button>
            )}
            {currentFav.length === 0 && favorites.length === 0 && (
              <p className="empty-hint">Сначала добавьте песни в «Избранное» — оттуда их можно выбрать</p>
            )}
          </div>
        </section>

        <section className="profile-public-playlists">
          <h3 className="profile-favs-title">Публичные плейлисты</h3>
          <p className="empty-hint">Эти плейлисты видны в вашем профиле другим пользователям</p>
          {publicPlaylists.length > 0 ? (
            <div className="profile-pl-list">
              {publicPlaylists.map(pl => (
                <div key={pl.id} className="profile-pl-card">
                  <span className="profile-pl-cover">
                    {pl.tracks[0]?.image
                      ? <img src={pl.tracks[0].image} alt="" onError={(e) => handleCoverError(e, pl.tracks[0])} />
                      : <span className="pl-card-empty"><IconMusic size={16} /></span>}
                  </span>
                  <div className="profile-pl-info">
                    <span className="profile-pl-name">{pl.name}</span>
                    <span className="profile-pl-meta">{pl.tracks.length} треков</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="empty-hint">Пока нет публичных плейлистов. Создайте плейлист и переключите его на «Публичный» в разделе «Плейлисты»</p>
          )}
        </section>
      </div>

      <button className="stats-open-btn" onClick={() => setStatsOpen(true)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/>
        </svg>
        Итоги прослушиваний
      </button>

    {notice && <div className="profile-notice">{notice}</div>}

    {pickerOpen && (
      <FavPickerModal
        tracks={favoriteCandidates()}
        onPick={addFavoriteTrack}
        onClose={() => setPickerOpen(false)}
      />
    )}

    {statsOpen && (
      <StatsModal
        stats={listeningStats}
        loading={statsLoading}
        period={selectedPeriod}
        onPeriodChange={setSelectedPeriod}
        onClose={() => setStatsOpen(false)}
      />
    )}
  </div>
  )
}

// Модалка выбора любимой песни из избранного
function FavPickerModal({ tracks, onPick, onClose }) {
  const [q, setQ] = useState('')
  const filtered = q.trim()
    ? tracks.filter(t => (t.name + ' ' + t.artist_name).toLowerCase().includes(q.trim().toLowerCase()))
    : tracks
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box profile-picker" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title-row">
          <span className="modal-title">Выберите песню</span>
          <button className="profile-picker-close" onClick={onClose} title="Закрыть">
            <IconClose size={16} />
          </button>
        </div>
        <input
          type="text"
          className="profile-nick-input profile-picker-search"
          placeholder="Поиск в избранном..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {tracks.length === 0 ? (
          <p className="modal-empty">Избранное пусто — добавьте песни лайком в поиске</p>
        ) : filtered.length === 0 ? (
          <p className="modal-empty">Ничего не найдено</p>
        ) : (
          <div className="modal-list">
            {filtered.map(track => (
              <div key={track.id} className="track-item" onClick={() => { onPick(track); onClose() }}>
                <img className="track-cover" src={track.image || initialCover(track.name)} alt="" loading="lazy"
                     onError={(e) => handleCoverError(e, track)} />
                <div className="track-info">
                  <div className="track-name">{track.name}</div>
                  <div className="track-artist">{track.artist_name}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function StatsModal({ stats, loading, period, onPeriodChange, onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box stats-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title-row">
          <span className="modal-title">Итоги прослушиваний</span>
          <button className="modal-close-btn" onClick={onClose} title="Закрыть">
            <IconClose size={16} />
          </button>
        </div>

        <div className="stats-period-selector">
          {[7, 30, 365].map(p => (
            <button
              key={p}
              className={`stats-period-btn ${period === p ? 'active' : ''}`}
              onClick={() => onPeriodChange(p)}
            >
              {p === 7 ? 'Неделя' : p === 30 ? 'Месяц' : 'Год'}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="stats-loading"><span className="btn-spinner"></span></div>
        ) : stats && stats.artists.length > 0 ? (
          <div className="stats-body">
            <div className="stats-summary">
              <div className="stats-card">
                <span className="stats-card-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
                </span>
                <span className="stats-card-value">{stats.totalTracks}</span>
                <span className="stats-card-label">треков</span>
              </div>
              <div className="stats-card">
                <span className="stats-card-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                </span>
                <span className="stats-card-value">{stats.totalHours}ч</span>
                <span className="stats-card-label">времени</span>
              </div>
              <div className="stats-card">
                <span className="stats-card-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                </span>
                <span className="stats-card-value">{stats.artists.length}</span>
                <span className="stats-card-label">артистов</span>
              </div>
            </div>

            <h4 className="stats-modal-subtitle">Топ артистов</h4>
            <div className="stats-artists-list">
              {stats.artists.slice(0, 10).map((artist, idx) => (
                <div key={idx} className="stats-artist-row">
                  <span className="stats-artist-rank">#{idx + 1}</span>
                  <div className="stats-artist-info">
                    <span className="stats-artist-name">{artist.name}</span>
                    <span className="stats-artist-meta">{artist.trackCount} треков · {formatListeningTime(artist.seconds)}</span>
                  </div>
                  <div className="stats-artist-bar-wrap">
                    <div className="stats-artist-bar" style={{ width: `${Math.max(8, (artist.seconds / (stats.artists[0]?.seconds || 1)) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="modal-empty">Нет данных прослушивания за этот период</p>
        )}
      </div>
    </div>
  )
}
