import React, { useState } from 'react'
import { createPortal } from 'react-dom'
import { usePlayer } from '../contexts/PlayerContext'
import { formatDuration } from '../services/format'
import { initialCover, handleCoverError } from '../services/soundcloud'
import { rememberRemoteTrack, isRemoteTrackId } from '../services/remoteTracks'
import NowPlaying from './NowPlaying'
import { IconClose, IconDownload, IconCheck } from './Icons'

export default function PlayerBar() {
  const {
    currentTrack, isPlaying, togglePlay, next, prev,
    progress, duration, seek, volume, setVolumeLevel, isMuted, toggleMute,
    isFavorite, addToFavorites, removeFromFavorites,
    shuffle, repeat, toggleShuffle, cycleRepeat,
    queue, currentIndex, playTrackAt, removeFromQueue,
    sleepRemaining, downloadTrack
  } = usePlayer()
  const [queueOpen, setQueueOpen] = useState(false)
  const [npOpen, setNpOpen] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [downloadNotice, setDownloadNotice] = useState('')

  const handleDownload = async () => {
    if (!currentTrack || downloading) return
    setDownloading(true)
    setDownloadNotice('Загрузка...')
    const res = await downloadTrack(currentTrack)
    setDownloading(false)
    if (res.success) {
      setDownloadNotice('Сохранено')
    } else {
      setDownloadNotice('Ошибка')
    }
    setTimeout(() => setDownloadNotice(''), 2500)
  }

  if (!currentTrack) return (
    <div className="player-bar player-bar--empty">
      <div className="player-info">
        <div className="player-meta">
          <div className="player-track-name">Волна загружается...</div>
        </div>
      </div>
      <div className="player-controls">
        <div className="controls-row">
          <button className="ctrl-btn ctrl-play" disabled>
            <div className="btn-spinner" />
          </button>
        </div>
      </div>
    </div>
  )

  const progressPercent = duration > 0 ? (progress / duration) * 100 : 0
  const handleCoverErrorLocal = (e) => handleCoverError(e, currentTrack)

  return (
    <div className="player-bar">
      <div className="player-info">
        <img className="player-cover np-open" src={currentTrack.image} alt="" onError={handleCoverErrorLocal}
             onClick={() => setNpOpen(true)} title="Обложка и текст трека" />
        <div className="player-meta np-open" onClick={() => setNpOpen(true)}>
          <div className="player-track-name">{currentTrack.name}</div>
          <div className="player-artist">{currentTrack.artist_name}</div>
        </div>
        <button
          className={`player-fav ${isFavorite(currentTrack.id) ? 'active' : ''}`}
          onClick={() => {
            if (isRemoteTrackId(currentTrack.id)) rememberRemoteTrack(currentTrack)
            isFavorite(currentTrack.id)
              ? removeFromFavorites(currentTrack.id)
              : addToFavorites(currentTrack.id)
          }}
        >
          {isFavorite(currentTrack.id) ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
            </svg>
          )}
        </button>
      </div>

      <div className="player-controls">
        <div className="controls-row">
          <button
            className={`ctrl-btn ctrl-toggle ${shuffle ? 'active' : ''}`}
            onClick={toggleShuffle}
            title={shuffle ? 'Перемешивание включено' : 'Перемешивание выключено'}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="16 3 21 3 21 8"/>
              <line x1="4" y1="20" x2="21" y2="3"/>
              <polyline points="21 16 21 21 16 21"/>
              <line x1="15" y1="15" x2="21" y2="21"/>
              <line x1="4" y1="4" x2="9" y2="9"/>
            </svg>
          </button>
          <button className="ctrl-btn" onClick={prev} title="Предыдущий трек">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="19 20 9 12 19 4 19 20"/>
              <rect x="5" y="4" width="2" height="16"/>
            </svg>
          </button>
          <button className="ctrl-btn ctrl-play" onClick={togglePlay} title={isPlaying ? 'Пауза' : 'Воспроизвести'}>
            {isPlaying ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" rx="1"/>
                <rect x="14" y="4" width="4" height="16" rx="1"/>
              </svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="6 3 20 12 6 21 6 3"/>
              </svg>
            )}
          </button>
          <button className="ctrl-btn" onClick={next} title="Следующий трек">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 4 15 12 5 20 5 4"/>
              <rect x="17" y="4" width="2" height="16"/>
            </svg>
          </button>
          <button
            className={`ctrl-btn ctrl-toggle ${repeat !== 'off' ? 'active' : ''}`}
            onClick={cycleRepeat}
            title={repeat === 'off' ? 'Повтор выключен' : repeat === 'all' ? 'Повтор очереди' : 'Повтор трека'}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="17 1 21 5 17 9"/>
              <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
              <polyline points="7 23 3 19 7 15"/>
              <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
            </svg>
            {repeat === 'one' && <span className="repeat-one">1</span>}
          </button>
        </div>

        <div className="time-row">
          <span className="time">{formatDuration(progress)}</span>
          <input
            type="range"
            className="progress-range"
            min="0"
            max={duration || 0}
            step="0.1"
            value={progress}
            onChange={(e) => seek(parseFloat(e.target.value))}
            style={{ '--fill': `${progressPercent}%` }}
          />
          <span className="time">{formatDuration(duration)}</span>
        </div>
      </div>

      <div className="player-volume">
        {sleepRemaining != null && (
          <span className="sleep-chip" title="Таймер сна активен">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
            </svg>
            {Math.floor(sleepRemaining / 60)}:{String(sleepRemaining % 60).padStart(2, '0')}
          </span>
        )}
        {queue.length > 1 && (
          <button
            className={`ctrl-btn ${queueOpen ? 'active' : ''}`}
            onClick={() => setQueueOpen(o => !o)}
            title="Очередь воспроизведения"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="3" y1="6" x2="15" y2="6"/>
              <line x1="3" y1="12" x2="15" y2="12"/>
              <line x1="3" y1="18" x2="9" y2="18"/>
              <polygon points="19 4 19 14 16 14 20 18 21 16 21 4"/>
            </svg>
          </button>
        )}
        <button
          className={`ctrl-btn ${downloading ? 'busy' : ''}`}
          onClick={handleDownload}
          disabled={downloading}
          title={downloadNotice || "Скачать трек"}
        >
          {downloadNotice === 'Сохранено' ? <IconCheck size={18} /> : <IconDownload size={18} />}
        </button>
        <button className="ctrl-btn" onClick={toggleMute} title={isMuted ? 'Включить звук' : 'Выключить звук'}>
          {isMuted || volume === 0 ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
              <line x1="23" y1="9" x2="17" y2="15"/>
              <line x1="17" y1="9" x2="23" y2="15"/>
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
            </svg>
          )}
        </button>
        <input
          type="range"
          className="volume-range"
          min="0"
          max="1"
          step="0.01"
          value={isMuted ? 0 : volume}
          onChange={(e) => setVolumeLevel(parseFloat(e.target.value))}
          style={{ '--fill': `${(isMuted ? 0 : volume) * 100}%` }}
        />
      </div>

      {queueOpen && queue.length > 1 && (
        <div className="queue-panel">
          <div className="queue-header">
            <span>Очередь · {queue.length}</span>
            <button className="queue-close" onClick={() => setQueueOpen(false)} title="Закрыть">
              <IconClose size={14} />
            </button>
          </div>
          <div className="queue-list">
            {queue.map((t, i) => (
              <div
                key={`${t.id}_${i}`}
                className={`queue-item ${i === currentIndex ? 'current' : ''}`}
                onClick={() => playTrackAt(queue, i)}
              >
                <span className="queue-index">
                  {i === currentIndex ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                      <polygon points="6 3 20 12 6 21 6 3"/>
                    </svg>
                  ) : (
                    i + 1
                  )}
                </span>
                <img className="queue-cover" src={t.image} alt="" loading="lazy" onError={(e) => handleCoverError(e, t)} />
                <span className="queue-meta">
                  <span className="queue-name">{t.name}</span>
                  <span className="queue-artist">{t.artist_name}</span>
                </span>
                <span className="queue-duration">{formatDuration(t.duration)}</span>
                {i !== currentIndex && (
                  <button
                    className="queue-remove"
                    onClick={(e) => { e.stopPropagation(); removeFromQueue(i) }}
                    title="Убрать из очереди"
                  >
                    <IconClose size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Портал в body: у .player-bar есть backdrop-filter, из-за него
          position:fixed внутри панели якорится к панели, а не к окну */}
      {npOpen && createPortal(<NowPlaying onClose={() => setNpOpen(false)} />, document.body)}
    </div>
  )
}
