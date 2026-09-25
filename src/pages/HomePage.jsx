import React, { useState, useEffect } from 'react'
import { usePlayer } from '../contexts/PlayerContext'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { scCharts, initialCover, handleCoverError } from '../services/soundcloud'
import { CHART_GENRE_OPTIONS, WAVE_GENRE_OPTIONS, toggleWaveGenre } from '../services/settings'
import { formatDuration } from '../services/format'
import { rememberRemoteTrack, getRemoteTracks, isRemoteTrackId } from '../services/remoteTracks'
import NewsModal from '../components/NewsModal'
import { useDbStatus } from '../contexts/DbStatusContext'
import { getSelectedBannerId, resolveBanner } from '../services/banners'

export default function HomePage({ onNavigate }) {
  const { currentTrack, isWavePlaying, isPlaying, playWave, togglePlay, playTrack, history, favorites, addToFavorites, removeFromFavorites, isFavorite, analyzerData, reactiveBars } = usePlayer()
  const { user, isGuest, signOut } = useAuth()
  const { settings, update } = useSettings()
  const { dbEnabled, dbReason } = useDbStatus()
  const [newsOpen, setNewsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [oopsBanner, setOopsBanner] = useState(false)
  const [banner, setBanner] = useState(() => resolveBanner(getSelectedBannerId()))

  // Баннер перечитывается при выборе на «Маркете» (без перезагрузки страницы)
  useEffect(() => {
    const handler = () => setBanner(resolveBanner(getSelectedBannerId()))
    window.addEventListener('overfy-banner-changed', handler)
    return () => window.removeEventListener('overfy-banner-changed', handler)
  }, [])

  // Топ треков SoundCloud (чарт trending по выбранному жанру)
  const [topTracks, setTopTracks] = useState([])
  const [topLoading, setTopLoading] = useState(false)
  const [topError, setTopError] = useState(false)

  useEffect(() => {
    let active = true
    setTopLoading(true)
    setTopError(false)
    scCharts(settings.chartGenre, 14)
      .then(t => { if (active) setTopTracks(t) })
      .catch(() => { if (active) { setTopTracks([]); setTopError(true) } })
      .finally(() => { if (active) setTopLoading(false) })
    return () => { active = false }
  }, [settings.chartGenre])

  // Недавно прослушанные: описания внешних треков берём из локального кэша
  const [recentTracks, setRecentTracks] = useState([])
  useEffect(() => {
    setRecentTracks(getRemoteTracks(history.filter(isRemoteTrackId)).slice(0, 10))
  }, [history])

  const handlePlayWave = async () => {
    if (isWavePlaying && isPlaying) {
      togglePlay()
      return
    }
    if (isWavePlaying && !isPlaying) {
      togglePlay()
      return
    }

    // Если у пользователя < 5 треков в истории и нет избранного, и не выбраны конкретные жанры —
    // показываем аккуратное уведомление «Упс...» с предложением выбрать жанры
    const isSpecificGenre = settings.waveGenres?.some(g => g !== 'all-music')
    if (history.length < 5 && favorites.length === 0 && !isSpecificGenre) {
      setOopsBanner(true)
      return
    }

    setOopsBanner(false)
    setLoading(true)
    try {
      await playWave()
    } catch (e) {
      // чарты недоступны — кнопка просто вернётся в исходное состояние
    } finally {
      setLoading(false)
    }
  }

  const displayName = user?.user_metadata?.full_name || (user?.email ? user.email.split('@')[0] : 'Гость')

  // --- Расширенная волна: многослойная анимация с настройками ---
  const barsCount = settings.waveBars
  const equalizerOn = settings.equalizerMode !== 'off'
  // OMD и «меньше движения» отключают JS-анимацию волны (основной расход CPU)
  const reduced = settings.reduceMotion || settings.omd
  const [barHeights, setBarHeights] = useState(() => Array.from({ length: barsCount }, () => 0.15))

  useEffect(() => {
    setBarHeights(Array.from({ length: barsCount }, (_, i) => 0.15 + 0.25 * Math.abs(Math.sin(i * 0.4))))
  }, [barsCount])

  // При включённом эквалайзере живость берём из плеера (FFT или пульс «по звуку»),
  // поэтому CSS-анимацию отключаем, чтобы не тратить CPU впустую.
  useEffect(() => {
    if (reduced || equalizerOn) return
    const intensity = { calm: 0.35, normal: 0.6, vivid: 0.9 }[settings.waveIntensity] ?? 0.6
    const speed = { slow: 900, normal: 430, fast: 200 }[settings.waveSpeed] ?? 430
    // На паузе волна «дышит» тише, при игре — полноценно
    const level = isPlaying ? 1 : 0.4
    const timer = setInterval(() => {
      const now = Date.now()
      setBarHeights(prev => prev.map((_, i) => {
        const wave = 0.5 + 0.5 * Math.sin(now / 900 + i * 0.55)
        const pulse = 0.5 + 0.5 * Math.sin(now / 300 + i * 1.7)
        const h = (0.12 + intensity * level * (0.45 * wave + 0.55 * pulse * Math.random()))
        return Math.max(0.06, Math.min(1, h))
      }))
    }, speed)
    return () => clearInterval(timer)
  }, [settings.waveIntensity, settings.waveSpeed, settings.waveBars, reduced, isPlaying, equalizerOn])

  const transitionMs = reduced ? 0 : ({ slow: 700, normal: 320, fast: 160 }[settings.waveSpeed] ?? 320)

  const genreLabel = CHART_GENRE_OPTIONS.find(g => g.id === settings.chartGenre)?.label || 'Все жанры'

  // Живые данные эквалайзера (FFT) или пульс «по звуку» (beat) — приоритет над CSS-волной.
  const liveBars = equalizerOn && (analyzerData.length > 0 || reactiveBars.length > 0)
    ? (analyzerData.length > 0 ? analyzerData : reactiveBars)
    : null
  // Число полос менять на лету не нужно — значения уже соответствуют waveBars.
  const displayHeights = liveBars && liveBars.length ? liveBars : barHeights

  return (
    <div className="screen home-screen">
      <div className="home-progress-ring"></div>

      <div className="home-header">
        <div className="home-greeting">
          <span className="greeting-label">Добро пожаловать</span>
          <span className="greeting-name">{displayName}</span>
        </div>
        <div className="home-header-actions">
          <button className="icon-btn" onClick={() => setNewsOpen(true)} title="Новости">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
              <polyline points="10 9 9 9 8 9"/>
            </svg>
          </button>
          <button className="icon-btn" onClick={() => onNavigate('settings')} title="Настройки">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>
          <button className="icon-btn" onClick={() => { signOut(); onNavigate('home') }} title="Выйти">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          </button>
        </div>
      </div>

      <div className="wave-container" style={banner ? { '--wave-banner-img': banner.image ? `url("${banner.image}")` : 'none', '--wave-banner-color': banner.color || 'transparent' } : undefined}>
        <div className={`wave-visual wave--${settings.waveIntensity} wave--${settings.waveSpeed} ${reduced ? 'wave--reduced' : ''}`}>
          {displayHeights.map((val, i) => (
            <div
              key={i}
              className={`wave-bar ${isPlaying ? 'wave-anim' : ''}`}
              style={{
                height: `${8 + val * 92}%`,
                transition: reduced ? 'none' : `height ${transitionMs}ms cubic-bezier(.22,.61,.36,1)`,
                animationDelay: `${(i % 12) * 80}ms`,
              }}
            />
          ))}
        </div>

        {oopsBanner && (
          <div className="wave-overlay-content wave-oops-content">
            <h2 className="wave-title" style={{ color: '#fff' }}>Упс...</h2>
            <p className="wave-desc" style={{ maxWidth: '480px', margin: '0 auto 14px' }}>
              К сожалению вы еще не слушали ни одной песни, чтобы воспроизвести волну послушайте песни и мы подберем все по вашему вкусу!
            </p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => setOopsBanner(false)}
              >
                Выбрать жанры
              </button>
              <button
                className="btn btn-outline btn-sm"
                onClick={() => { setOopsBanner(false); playWave(); }}
              >
                Всё равно воспроизвести
              </button>
            </div>
          </div>
        )}

        {!oopsBanner && !currentTrack && (
          <div className="wave-overlay-content">
            <h2 className="wave-title">Ваша волна по жанрам</h2>
            <p className="wave-desc">Похожие треки в жанрах ваших избранных песен</p>
          </div>
        )}

        {currentTrack && isWavePlaying && (
          <div className="wave-overlay-content now-playing">
            <h2 className="wave-title">{currentTrack.name}</h2>
            <p className="wave-artist">{currentTrack.artist_name}</p>
          </div>
        )}
        {!currentTrack && isWavePlaying && (
          <div className="wave-overlay-content now-playing">
            <h2 className="wave-title">Загрузка трека...</h2>
          </div>
        )}
      </div>

      <div className="wave-genre-chips">
        {WAVE_GENRE_OPTIONS.map(g => {
          const active = settings.waveGenres?.includes(g.id)
          return (
            <button
              key={g.id}
              className={`genre-chip ${active ? 'active' : ''}`}
              onClick={() => update(toggleWaveGenre(settings, g.id))}
            >{g.label}</button>
          )
        })}
      </div>

      <button
        className={`wave-play-btn ${isWavePlaying ? (isPlaying ? 'playing' : 'paused') : ''}`}
        onClick={handlePlayWave}
        disabled={loading}
      >
        {loading ? (
          <div className="btn-spinner"></div>
        ) : isWavePlaying && isPlaying ? (
          <svg width="42" height="42" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" rx="1"/>
            <rect x="14" y="4" width="4" height="16" rx="1"/>
          </svg>
        ) : (
          <svg width="42" height="42" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="6 3 20 12 6 21 6 3"/>
          </svg>
        )}
        <span className="wave-play-label">
          {loading
            ? 'Подбираем музыку...'
            : isWavePlaying && isPlaying ? 'Пауза'
              : isWavePlaying ? 'Продолжить волну'
                : 'Воспроизвести мою волну'}
        </span>
      </button>

      {history.length > 0 && (
        <div className="home-stats">
          <span>Прослушано треков: <strong>{history.length}</strong></span>
          <span className="stats-sep">•</span>
          <span>Жанров в волне: <strong>{settings.waveGenres?.length || 1}</strong></span>
        </div>
      )}

      {settings.showRecent && recentTracks.length > 0 && (
        <div className="recent-section">
          <div className="section-header">
            <h3 className="section-title">Недавно прослушанные</h3>
            <span className="section-genre">{recentTracks.length} треков</span>
          </div>
          <div className="track-list recent-list">
            {recentTracks.map((track, i) => (
              <div
                key={`${track.id}_${i}`}
                className={`track-item ${currentTrack?.id === track.id ? 'playing' : ''}`}
                onClick={() => playTrack(track, recentTracks)}
              >
                <img className="track-cover" src={track.image} alt="" loading="lazy" onError={(e) => handleCoverError(e, track)} />
                <div className="track-info">
                  <div className="track-name">{track.name}</div>
                  <div className="track-artist">{track.artist_name}</div>
                </div>
                <div className="track-duration">{formatDuration(track.duration)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="top-section">
        <div className="section-header">
          <h3 className="section-title">Топ треков</h3>
          <span className="section-genre">{genreLabel} · SoundCloud</span>
        </div>

        {topLoading && (
          <div className="top-skeleton-row">
            {Array.from({ length: 4 }, (_, i) => <div key={i} className="top-skeleton" />)}
          </div>
        )}

        {!topLoading && topTracks.length > 0 && (
          <div className="top-scroll">
            {topTracks.map((track, idx) => (
              <div key={track.id} className="top-card">
                <button className="top-card-cover" onClick={() => playTrack(track, topTracks)} title={`Играть: ${track.name}`}>
                  <img src={track.image} alt="" loading="lazy" onError={(e) => handleCoverError(e, track)} />
                  <span className="top-card-rank">#{idx + 1}</span>
                  <span className="top-card-play">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                      <polygon points="6 3 20 12 6 21 6 3"/>
                    </svg>
                  </span>
                </button>
                <span className="top-card-name" title={track.name}>{track.name}</span>
                <span className="top-card-artist" title={track.artist_name}>{track.artist_name}</span>
                <div className="top-card-meta">
                  <span className="top-card-duration">{formatDuration(track.duration)}</span>
                  <button
                    className={`top-card-fav ${isFavorite(track.id) ? 'active' : ''}`}
                    onClick={() => {
                      isFavorite(track.id)
                        ? removeFromFavorites(track.id)
                        : (rememberRemoteTrack(track), addToFavorites(track.id))
                    }}
                    title={isFavorite(track.id) ? 'Убрать из избранного' : 'В избранное'}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill={isFavorite(track.id) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {!topLoading && topError && (
          <div className="top-error-row">
            <span>Не удалось загрузить топ треков</span>
            <button className="btn btn-outline btn-sm" onClick={() => {
              setTopError(false)
              setTopLoading(true)
              scCharts(settings.chartGenre, 14)
                .then(t => setTopTracks(t))
                .catch(() => setTopError(true))
                .finally(() => setTopLoading(false))
            }}>Повторить</button>
          </div>
        )}
      </div>

      {newsOpen && <NewsModal onClose={() => setNewsOpen(false)} />}
    </div>
  )
}
