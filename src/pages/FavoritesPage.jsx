import React, { useState, useEffect, useCallback } from 'react'
import { usePlayer } from '../contexts/PlayerContext'
import { formatDuration } from '../services/format'
import { initialCover, handleCoverError } from '../services/soundcloud'
import { getRemoteTracks, isRemoteTrackId, rememberRemoteTrack } from '../services/remoteTracks'
import { getImportedTracks, localTrackId } from '../services/userData'
import AddToPlaylistModal from '../components/AddToPlaylistModal'

function localToTrack(t) {
  return {
    id: localTrackId(t.path),
    name: t.name,
    artist_name: 'Локальный файл',
    duration: t.duration || 0,
    image: initialCover(t.name),
    audio: null,
    source: 'local',
    path: t.path,
  }
}

export default function FavoritesPage() {
  const { favorites, removeFromFavorites, playTrack, playNext } = usePlayer()
  const [tracks, setTracks] = useState([])
  const [plModalTrack, setPlModalTrack] = useState(null)

  const queueNext = useCallback((track) => {
    if (isRemoteTrackId(track.id)) rememberRemoteTrack(track)
    playNext(track)
  }, [playNext])

  useEffect(() => {
    let active = true
    // Избранное хранит id. Описания внешних треков (SoundCloud и др.) берём
    // из локального кэша, локальные файлы — из списка импортированных.
    const remoteIds = favorites.filter(isRemoteTrackId)
    const loaded = getRemoteTracks(remoteIds)
    const loadedById = new Map(loaded.map(t => [t.id, t]))

    // Восстанавливаем локальные треки (id вида local_*) из импортированных
    const localByPath = new Map(getImportedTracks().map(t => [localTrackId(t.path), t]))

    const ordered = favorites
      .map(id => loadedById.get(id) || (id.startsWith('local_') ? (() => {
        const raw = localByPath.get(id)
        return raw ? localToTrack(raw) : null
      })() : null))
      .filter(Boolean)
    if (active) setTracks(ordered)
    return () => { active = false }
  }, [favorites])

  return (
    <div className="screen favorites-screen">
      <h2 className="screen-title">Избранное</h2>

      {tracks.length === 0 ? (
        <div className="empty-state fav-empty">
          <div className="empty-heart">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
            </svg>
          </div>
          <p>Пока нет избранных треков</p>
          <p className="empty-hint">Отмечайте песни лайком, чтобы они появились здесь</p>
        </div>
      ) : (
        <div className="track-list">
          {tracks.map(track => (
            <div key={track.id} className="track-item" onClick={() => playTrack(track, tracks)}>
              <img className="track-cover" src={track.image} alt="" loading="lazy" onError={(e) => handleCoverError(e, track)} />
              <div className="track-info">
                <div className="track-name">{track.name}</div>
                <div className="track-artist">{track.artist_name}</div>
              </div>
              <div className="track-duration">{formatDuration(track.duration)}</div>
              <button
                className="next-btn"
                onClick={(e) => { e.stopPropagation(); queueNext(track) }}
                title="Играть следующим"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5 4 15 12 5 20 5 4"/>
                  <rect x="17" y="4" width="2" height="16"/>
                </svg>
              </button>
              <button
                className="next-btn pl-btn"
                onClick={(e) => { e.stopPropagation(); setPlModalTrack(track) }}
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
                className="fav-btn active"
                onClick={(e) => { e.stopPropagation(); removeFromFavorites(track.id) }}
                title="Удалить из избранного"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {plModalTrack && <AddToPlaylistModal track={plModalTrack} onClose={() => setPlModalTrack(null)} />}
    </div>
  )
}
