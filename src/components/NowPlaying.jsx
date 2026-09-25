import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { usePlayer } from '../contexts/PlayerContext'
import { useSettings } from '../contexts/SettingsContext'
import { getLyricsForTrack } from '../services/lyrics'
import { formatDuration } from '../services/format'
import { handleCoverError } from '../services/soundcloud'
import { PLAYBACK_SPEED_OPTIONS } from '../services/settings'
import { IconDownload, IconCheck } from './Icons'

// Полноэкранный экран «Сейчас играет»: большая обложка, управление
// и текст песни (синхронизированный с подсветкой строки либо обычный).
export default function NowPlaying({ onClose }) {
  const {
    currentTrack, isPlaying, togglePlay, next, prev,
    progress, duration, seek, shuffle, repeat, cycleRepeat, toggleShuffle,
    isFavorite, addToFavorites, removeFromFavorites,
    downloadTrack,
  } = usePlayer()
  const { settings, update } = useSettings()
  const [mode, setMode] = useState('cover') // cover | lyrics
  const [lyrics, setLyrics] = useState(null) // { plain, synced, source }
  const [lyricsLoading, setLyricsLoading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [downloadNotice, setDownloadNotice] = useState('')
  const lyricsBoxRef = useRef(null)
  const activeLineRef = useRef(null)

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

  const track = currentTrack
  const isFav = track ? isFavorite(track.id) : false

  // Закрытие по Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // Загрузка текста при смене трека (всегда предзагружаем)
  useEffect(() => {
    if (!track) return
    let active = true
    setLyricsLoading(true)
    setLyrics(null)
    getLyricsForTrack(track)
      .then(l => { if (active) setLyrics(l) })
      .catch(() => { if (active) setLyrics({ plain: null, synced: null, source: 'none' }) })
      .finally(() => { if (active) setLyricsLoading(false) })
    return () => { active = false }
  }, [track?.id])

  // Активная строка синхронного текста
  const activeLine = useMemo(() => {
    if (!lyrics?.synced?.length) return -1
    let idx = -1
    for (let i = 0; i < lyrics.synced.length; i++) {
      if (lyrics.synced[i].time <= progress + 0.2) idx = i
      else break
    }
    return idx
  }, [lyrics, progress])

  // Автопрокрутка к активной строке
  useEffect(() => {
    if (mode !== 'lyrics' || !settings.lyricsAutoscroll) return
    if (activeLine < 0 || !activeLineRef.current || !lyricsBoxRef.current) return
    const box = lyricsBoxRef.current
    const el = activeLineRef.current
    const target = el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2
    box.scrollTo({ top: Math.max(0, target), behavior: settings.reduceMotion ? 'auto' : 'smooth' })
  }, [activeLine, mode, settings.lyricsAutoscroll, settings.reduceMotion])

  const handleCoverErrorLocal = useCallback((e) => {
    handleCoverError(e, track)
  }, [track])

  if (!track) return null

  const progressPercent = duration > 0 ? (progress / duration) * 100 : 0

  return (
    <div className="np-overlay" role="dialog" aria-label="Сейчас играет">
      <button className="np-close" onClick={onClose} title="Закрыть (Esc)">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      <div className="np-tabs">
        <button
          className={`np-tab ${mode === 'cover' ? 'active' : ''}`}
          onClick={() => setMode('cover')}
        >Обложка</button>
        <button
          className={`np-tab ${mode === 'lyrics' ? 'active' : ''}`}
          onClick={() => setMode('lyrics')}
        >Текст</button>
      </div>

      {mode === 'cover' ? (
        <div className="np-cover-view">
          <img className="np-cover" src={track.image} alt="" onError={handleCoverErrorLocal} />
          <div className="np-meta">
            <span className="np-title" title={track.name}>{track.name}</span>
            <span className="np-artist">{track.artist_name}</span>
          </div>

          <div className="np-progress-row">
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

          <div className="np-controls-row">
            <button
              className={`ctrl-btn ctrl-toggle ${shuffle ? 'active' : ''}`}
              onClick={toggleShuffle}
              title="Перемешивание"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16 3 21 3 21 8"/>
                <line x1="4" y1="20" x2="21" y2="3"/>
                <polyline points="21 16 21 21 16 21"/>
                <line x1="15" y1="15" x2="21" y2="21"/>
                <line x1="4" y1="4" x2="9" y2="9"/>
              </svg>
            </button>
            <button className="ctrl-btn" onClick={prev} title="Предыдущий">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="19 20 9 12 19 4 19 20"/>
                <rect x="5" y="4" width="2" height="16"/>
              </svg>
            </button>
            <button className="np-play" onClick={togglePlay} title={isPlaying ? 'Пауза' : 'Воспроизвести'}>
              {isPlaying ? (
                <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="4" width="4" height="16" rx="1"/>
                  <rect x="14" y="4" width="4" height="16" rx="1"/>
                </svg>
              ) : (
                <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="6 3 20 12 6 21 6 3"/>
                </svg>
              )}
            </button>
            <button className="ctrl-btn" onClick={next} title="Следующий">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 4 15 12 5 20 5 4"/>
                <rect x="17" y="4" width="2" height="16"/>
              </svg>
            </button>
            <button
              className={`ctrl-btn ctrl-toggle ${repeat !== 'off' ? 'active' : ''}`}
              onClick={cycleRepeat}
              title={repeat === 'off' ? 'Повтор выключен' : repeat === 'all' ? 'Повтор очереди' : 'Повтор трека'}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="17 1 21 5 17 9"/>
                <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
                <polyline points="7 23 3 19 7 15"/>
                <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
              </svg>
              {repeat === 'one' && <span className="repeat-one">1</span>}
            </button>
            <button
              className={`ctrl-btn ${downloading ? 'busy' : ''}`}
              onClick={handleDownload}
              disabled={downloading}
              title={downloadNotice || "Скачать трек"}
            >
              {downloadNotice === 'Сохранено' ? <IconCheck size={18} /> : <IconDownload size={18} />}
            </button>
          </div>

          <div className="np-speed-row">
            <span className="np-speed-label">Скорость</span>
            {PLAYBACK_SPEED_OPTIONS.map(o => (
              <button
                key={o.id}
                className={`np-speed-btn ${settings.playbackSpeed === o.id ? 'active' : ''}`}
                onClick={() => update({ playbackSpeed: o.id })}
              >{o.label}</button>
            ))}
          </div>
        </div>
      ) : (
        <div className="np-lyrics-view">
          <div className="np-lyrics-toolbar">
            <button
              className={`np-lyrics-opt ${settings.lyricsAutoscroll ? 'active' : ''}`}
              onClick={() => update({ lyricsAutoscroll: !settings.lyricsAutoscroll })}
              title="Автопрокрутка текста"
            >Автопрокрутка</button>
            <button
              className="np-lyrics-opt"
              onClick={() => update({ lyricsFontSize: 'small' })}
            >A−</button>
            <button
              className="np-lyrics-opt"
              onClick={() => update({ lyricsFontSize: 'medium' })}
            >A</button>
            <button
              className="np-lyrics-opt"
              onClick={() => update({ lyricsFontSize: 'large' })}
            >A+</button>
          </div>

          <div ref={lyricsBoxRef} className={`np-lyrics np-lyrics--${settings.lyricsFontSize}`}>
            {lyricsLoading && (
              <div className="np-lyrics-status"><span className="btn-spinner"></span> Ищем текст...</div>
            )}
            {!lyricsLoading && lyrics?.synced?.length > 0 && lyrics.synced.map((line, i) => (
              <p
                key={i}
                ref={i === activeLine ? activeLineRef : null}
                className={`np-line ${i === activeLine ? 'active' : ''} ${line.text ? '' : 'np-line-empty'}`}
                onClick={() => line.text && seek(line.time)}
              >{line.text || '···'}</p>
            ))}
            {!lyricsLoading && !lyrics?.synced?.length && lyrics?.plain && lyrics.plain.split('\n').map((line, i) => (
              <p key={i} className="np-line np-line-plain">{line || '\u00A0'}</p>
            ))}
            {!lyricsLoading && lyrics && !lyrics.plain && !lyrics.synced?.length && (
              <div className="np-lyrics-status">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{opacity:0.4}}>
                  <path d="M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zm12-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0z"/>
                </svg>
                Текст не найден
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
