import React, { useState, useEffect, useRef } from 'react'
import { useSettings } from '../contexts/SettingsContext'
import { usePlayer } from '../contexts/PlayerContext'
import { getListeningSeconds, formatListening } from '../services/userData'
import {
  getBackground, setBackgroundImage, setBackgroundDim, setBackgroundBlur,
  clearBackground, BG_MAX_BYTES,
} from '../services/background'
import {
  WAVE_INTENSITY_OPTIONS,
  WAVE_SPEED_OPTIONS,
  WAVE_BARS_OPTIONS,
  WAVE_GENRE_OPTIONS,
  toggleWaveGenre,
  CHART_GENRE_OPTIONS,
  PLAYBACK_SPEED_OPTIONS,
  ACCENT_COLOR_OPTIONS,
  LYRICS_FONT_OPTIONS,
  UI_MODE_OPTIONS,
  THEME_OPTIONS,
  EQUALIZER_MODE_OPTIONS,
  DEFAULT_SETTINGS,
} from '../services/settings'
import { getYmToken, setYmToken, YM_OAUTH_URL } from '../services/yandex'
import { getCurrentVersion } from '../services/updates'

const SLEEP_TIMER_OPTIONS = [0, 15, 30, 45, 60] // минуты, 0 = выкл

const CATEGORIES = [
  { id: 'home', label: 'Главная', icon: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' },
  { id: 'player', label: 'Плеер', icon: 'M5 3l14 9-14 9V3z' },
  { id: 'interface', label: 'Интерфейс', icon: 'M4 4h16v12H4zM8 20h8' },
  { id: 'lyrics', label: 'Текст песни', icon: 'M4 6h16M4 12h10M4 18h14' },
  { id: 'sources', label: 'Источники', icon: 'M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zm12-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0z' },
  { id: 'data', label: 'Данные', icon: 'M12 3a9 9 0 1 0 9 9h-9V3z' },
  { id: 'about', label: 'О приложении', icon: 'M12 8h.01M11 12h1v5h1M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18z' },
]

export default function SettingsPage() {
  const { settings, update, reset } = useSettings()
  const { clearHistory, history, sleepRemaining, setSleepTimer, cancelSleepTimer, audioRef, favorites } = usePlayer()
  const [notice, setNotice] = useState('')
  const [cat, setCat] = useState('home')
  const [listening, setListening] = useState(getListeningSeconds)
  const [bg, setBg] = useState(getBackground)
  const [ymTokenInput, setYmTokenInput] = useState(getYmToken)
  const [audioDevices, setAudioDevices] = useState([])
  const flashTimerRef = useRef(null)

  // Часы прослушивания обновляются каждые 5 секунд, пока открыты настройки
  useEffect(() => {
    const id = setInterval(() => setListening(getListeningSeconds()), 5000)
    return () => clearInterval(id)
  }, [])

  // Очистка таймера уведомления при размонтировании (без утечки памяти)
  useEffect(() => {
    return () => { if (flashTimerRef.current) clearTimeout(flashTimerRef.current) }
  }, [])

  // Устройства вывода звука
  useEffect(() => {
    async function loadDevices() {
      try {
        if (navigator.mediaDevices?.enumerateDevices) {
          const devices = await navigator.mediaDevices.enumerateDevices()
          setAudioDevices(devices.filter(d => d.kind === 'audiooutput'))
        }
      } catch {}
    }
    loadDevices()
  }, [])

  const handleAudioDevice = async (deviceId) => {
    update({ audioDevice: deviceId })
    if (audioRef?.current) {
      try {
        if (audioRef.current.setSinkId) {
          await audioRef.current.setSinkId(deviceId === 'default' ? '' : deviceId)
        }
      } catch {}
    }
    flash('Устройство вывода изменено')
  }

  const handleBgFile = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > BG_MAX_BYTES) {
      flash('Файл больше 4 МБ — выберите файл поменьше')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      setBackgroundImage(reader.result)
      setBg(getBackground())
      flash('Фон установлен')
    }
    reader.onerror = () => {
      flash('Не удалось прочитать файл — попробуйте другой')
    }
    reader.readAsDataURL(file)
  }

  const currentSleepMin = sleepRemaining != null ? Math.ceil(sleepRemaining / 60) : 0

  const flash = (msg) => {
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    setNotice(msg)
    flashTimerRef.current = setTimeout(() => { setNotice(''); flashTimerRef.current = null }, 2200)
  }

  const handleClearCache = () => {
    try { localStorage.removeItem('overfy_remote_tracks') } catch { /* ignore */ }
    flash('Кэш треков очищен')
  }

  const handleClearHistory = () => {
    clearHistory()
    flash('История прослушиваний очищена')
  }

  const handleReset = () => {
    reset()
    flash('Настройки сброшены')
  }

  const handleSleep = (min) => {
    if (!min) {
      cancelSleepTimer()
      flash('Таймер сна выключен')
    } else {
      setSleepTimer(min)
      flash(`Музыка остановится через ${min} мин`)
    }
  }


  const segBtn = (value, option, patch) => (
    <button
      key={option.id}
      className={`segment-btn ${value === option.id ? 'active' : ''}`}
      onClick={() => update({ [patch]: option.id })}
    >{option.label}</button>
  )

  return (
    <div className="screen settings-screen">
      <div className="settings-header">
        <h2 className="settings-title">Настройки</h2>
        {notice && <span className="settings-notice">{notice}</span>}
      </div>

      <div className="settings-layout">
        <aside className="settings-cats">
          {CATEGORIES.map(c => (
            <button
              key={c.id}
              className={`settings-cat ${cat === c.id ? 'active' : ''}`}
              onClick={() => setCat(c.id)}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d={c.icon} />
              </svg>
              {c.label}
            </button>
          ))}
        </aside>

        <div className="settings-body">
          {cat === 'home' && (
            <>
              <section className="settings-group">
                <h3 className="settings-group-title">Волна на главной</h3>

                <div className="settings-row settings-row-column">
                  <span className="settings-row-label">Жанры волны (микс чартов)</span>
                  <div className="wave-genre-chips settings-chips">
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
                </div>

                <label className="settings-row">
                  <span className="settings-row-label">Интенсивность</span>
                  <div className="settings-segment">
                    {WAVE_INTENSITY_OPTIONS.map(o => segBtn(settings.waveIntensity, o, 'waveIntensity'))}
                  </div>
                </label>

                <label className="settings-row">
                  <span className="settings-row-label">Скорость</span>
                  <div className="settings-segment">
                    {WAVE_SPEED_OPTIONS.map(o => segBtn(settings.waveSpeed, o, 'waveSpeed'))}
                  </div>
                </label>

                <label className="settings-row">
                  <span className="settings-row-label">Полос</span>
                  <div className="settings-segment">
                    {WAVE_BARS_OPTIONS.map(o => (
                      <button
                        key={o.id}
                        className={`segment-btn ${settings.waveBars === o.id ? 'active' : ''}`}
                        onClick={() => update({ waveBars: o.id })}
                      >{o.id}</button>
                    ))}
                  </div>
                </label>

                <div className="settings-row settings-row-column">
                  <span className="settings-row-label">Реакция на звук (эквалайзер)</span>
                  <div className="theme-cards eq-modes">
                    {EQUALIZER_MODE_OPTIONS.map(o => (
                      <button
                        key={o.id}
                        className={`theme-card ${settings.equalizerMode === o.id ? 'active' : ''}`}
                        onClick={() => update({ equalizerMode: o.id })}
                      >
                        <span className="theme-name">{o.label}</span>
                        <span className="theme-hint">{o.hint}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </section>

              <section className="settings-group">
                <h3 className="settings-group-title">Топ треков</h3>
                <label className="settings-row">
                  <span className="settings-row-label">Жанр чарта</span>
                  <select
                    className="settings-select"
                    value={settings.chartGenre}
                    onChange={e => update({ chartGenre: e.target.value })}
                  >
                    {CHART_GENRE_OPTIONS.map(o => (
                      <option key={o.id} value={o.id}>{o.label}</option>
                    ))}
                  </select>
                </label>
                <div className="settings-row">
                  <span className="settings-row-label">Блок «Недавно прослушанные»</span>
                  <button
                    className={`settings-switch ${settings.showRecent ? 'on' : ''}`}
                    onClick={() => update({ showRecent: !settings.showRecent })}
                    aria-pressed={settings.showRecent}
                  >
                    <span className="switch-knob" />
                  </button>
                </div>
              </section>
            </>
          )}

          {cat === 'player' && (
            <section className="settings-group">
              <h3 className="settings-group-title">Плеер</h3>
              <label className="settings-row">
                <span className="settings-row-label">Скорость воспроизведения</span>
                <div className="settings-segment">
                  {PLAYBACK_SPEED_OPTIONS.map(o => (
                    <button
                      key={o.id}
                      className={`segment-btn ${settings.playbackSpeed === o.id ? 'active' : ''}`}
                      onClick={() => update({ playbackSpeed: o.id })}
                    >{o.label}</button>
                  ))}
                </div>
              </label>
              <div className="settings-row">
                <span className="settings-row-label">Вывод звука</span>
                <select
                  className="settings-select"
                  value={settings.audioDevice || 'default'}
                  onChange={(e) => handleAudioDevice(e.target.value)}
                >
                  <option value="default">Система по умолчанию</option>
                  {audioDevices.map(d => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Аудиоустройство ${d.deviceId.slice(0, 8)}`}
                    </option>
                  ))}
                </select>
              </div>
              <div className="settings-row">
                <span className="settings-row-label">
                  Таймер сна {currentSleepMin > 0 && <em>(осталось {currentSleepMin} мин)</em>}
                </span>
                <div className="settings-segment">
                  {SLEEP_TIMER_OPTIONS.map(min => (
                    <button
                      key={min}
                      className={`segment-btn ${
                        (min === 0 && currentSleepMin === 0) || (min > 0 && Math.abs(currentSleepMin - min) < 1)
                          ? 'active' : ''
                      }`}
                      onClick={() => handleSleep(min)}
                    >{min === 0 ? 'Выкл' : `${min}м`}</button>
                  ))}
                </div>
              </div>
              <div className="settings-row">
                <span className="settings-row-label">Автовоспроизведение следующего трека</span>
                <button
                  className={`settings-switch ${settings.autoplayNext ? 'on' : ''}`}
                  onClick={() => update({ autoplayNext: !settings.autoplayNext })}
                  aria-pressed={settings.autoplayNext}
                >
                  <span className="switch-knob" />
                </button>
              </div>
            </section>
          )}

          {cat === 'interface' && (
            <>
              <section className="settings-group">
                <h3 className="settings-group-title">Режим интерфейса</h3>
                <div className="ui-mode-cards">
                  {UI_MODE_OPTIONS.map(o => (
                    <button
                      key={o.id}
                      className={`ui-mode-card ${settings.uiMode === o.id ? 'active' : ''}`}
                      onClick={() => update({ uiMode: o.id })}
                    >
                      <span className="ui-mode-name">{o.label}</span>
                      <span className="ui-mode-hint">{o.hint}</span>
                      <span className={`ui-mode-preview ui-mode-preview--${o.id}`}>
                        <i /><i /><i />
                      </span>
                    </button>
                  ))}
                </div>
                <div className="settings-row">
                  <span className="settings-row-label">
                    Overfy Minimal Design (OMD) — CPU &lt; 7%
                  </span>
                  <button
                    className={`settings-switch ${settings.omd ? 'on' : ''}`}
                    onClick={() => update({ omd: !settings.omd })}
                    aria-pressed={settings.omd}
                  >
                    <span className="switch-knob" />
                  </button>
                </div>
              </section>

              <section className="settings-group">
                <h3 className="settings-group-title">Ник в комнатах</h3>
                <div className="settings-row">
                  <span className="settings-row-label">Переливающийся ник в комнатах</span>
                  <button
                    className={`settings-switch ${settings.nickShimmer ? 'on' : ''}`}
                    onClick={() => update({ nickShimmer: !settings.nickShimmer })}
                    aria-pressed={settings.nickShimmer}
                  >
                    <span className="switch-knob" />
                  </button>
                </div>
                <p className="empty-hint">
                  Имя участников в комнатах отображается с анимированным градиентом.
                </p>
              </section>

              <section className="settings-group">
                <h3 className="settings-group-title">Интеграции</h3>
                <div className="settings-row">
                  <span className="settings-row-label">
                    Discord Rich Presence <em>(статус «слушает»)</em>
                  </span>
                  <button
                    className={`settings-switch ${settings.discordEnabled ? 'on' : ''}`}
                    onClick={() => update({ discordEnabled: !settings.discordEnabled })}
                    aria-pressed={settings.discordEnabled}
                  >
                    <span className="switch-knob" />
                  </button>
                </div>
                <p className="empty-hint">
                  Показывает прослушиваемый трек и статус воспроизведения в вашем Discord-профиле.
                </p>
              </section>

              <section className="settings-group">
                <h3 className="settings-group-title">Синхронизация избранного</h3>
                <div className="settings-row">
                  <span className="settings-row-label">
                    Автоматически переносить избранные с устройства на аккаунт
                  </span>
                  <button
                    className={`settings-switch ${settings.autoImportFavorites ? 'on' : ''}`}
                    onClick={() => update({ autoImportFavorites: !settings.autoImportFavorites })}
                    aria-pressed={settings.autoImportFavorites}
                  >
                    <span className="switch-knob" />
                  </button>
                </div>
                <p className="empty-hint">
                  Гостевые избранные и импортированные треки с этого устройства синхронизируются в
                  ваш список при входе в аккаунт.
                </p>
              </section>

              <section className="settings-group">
                <h3 className="settings-group-title">Тема оформления</h3>
                <div className="theme-cards">
                  {THEME_OPTIONS.map(o => (
                    <button
                      key={o.id}
                      className={`theme-card ${settings.theme === o.id ? 'active' : ''}`}
                      onClick={() => update({ theme: o.id })}
                    >
                      <span className={`theme-swatch theme-swatch--${o.id}`} />
                      <span className="theme-name">{o.label}</span>
                      <span className="theme-hint">{o.hint}</span>
                    </button>
                  ))}
                </div>
              </section>

              <section className="settings-group">
                <h3 className="settings-group-title">Оформление</h3>
                <div className="settings-row settings-row-column">
                  <span className="settings-row-label">Акцентный цвет</span>
                  <div className="accent-row">
                    {ACCENT_COLOR_OPTIONS.map(o => (
                      <button
                        key={o.id}
                        className={`accent-dot ${settings.accentColor === o.id ? 'active' : ''}`}
                        style={{ '--dot': o.color }}
                        onClick={() => update({ accentColor: o.id })}
                        title={o.label}
                      />
                    ))}
                  </div>
                </div>
                <div className="settings-row">
                  <span className="settings-row-label">Частицы на фоне</span>
                  <button
                    className={`settings-switch ${settings.particles ? 'on' : ''}`}
                    onClick={() => update({ particles: !settings.particles })}
                    aria-pressed={settings.particles}
                  >
                    <span className="switch-knob" />
                  </button>
                </div>
                <div className="settings-row">
                  <span className="settings-row-label">Меньше движения</span>
                  <button
                    className={`settings-switch ${settings.reduceMotion ? 'on' : ''}`}
                    onClick={() => update({ reduceMotion: !settings.reduceMotion })}
                    aria-pressed={settings.reduceMotion}
                  >
                    <span className="switch-knob" />
                  </button>
                </div>
              </section>

              <section className="settings-group">
                <h3 className="settings-group-title">Кастомизация фона</h3>
                <div className="settings-row settings-row-column">
                  <span className="settings-row-label">Своё фото или GIF (до 4 МБ)</span>
                  <div className="bg-controls">
                    <label className="btn btn-sm bg-upload">
                      Выбрать файл
                      <input type="file" accept="image/*" onChange={handleBgFile} hidden />
                    </label>
                    {bg?.img && (
                      <button
                        className="btn btn-outline btn-sm"
                        onClick={() => { clearBackground(); setBg(null); flash('Фон сброшен') }}
                      >Убрать фон</button>
                    )}
                  </div>
                </div>
                {bg?.img && (
                  <>
                    <div className="settings-row">
                      <span className="settings-row-label">Затемнение: {Math.round((bg.dim ?? 0.55) * 100)}%</span>
                      <input
                        type="range" min="0" max="0.9" step="0.05"
                        value={bg.dim ?? 0.55}
                        onChange={(e) => { setBackgroundDim(parseFloat(e.target.value)); setBg(getBackground()) }}
                        className="bg-range"
                      />
                    </div>
                    <div className="settings-row">
                      <span className="settings-row-label">Размытие: {bg.blur ?? 0}px</span>
                      <input
                        type="range" min="0" max="30" step="1"
                        value={bg.blur ?? 0}
                        onChange={(e) => { setBackgroundBlur(parseInt(e.target.value, 10)); setBg(getBackground()) }}
                        className="bg-range"
                      />
                    </div>
                    <div className="bg-preview" style={{ backgroundImage: `url("${bg.img}")` }} />
                    <p className="empty-hint">Фон хранится только на этом устройстве и не синхронизируется</p>
                  </>
                )}
              </section>
            </>
          )}

          {cat === 'lyrics' && (
            <section className="settings-group">
              <h3 className="settings-group-title">Текст песни</h3>
              <label className="settings-row">
                <span className="settings-row-label">Размер шрифта</span>
                <div className="settings-segment">
                  {LYRICS_FONT_OPTIONS.map(o => segBtn(settings.lyricsFontSize, o, 'lyricsFontSize'))}
                </div>
              </label>
              <div className="settings-row">
                <span className="settings-row-label">
                  Автопрокрутка <em>(для синхронизированного текста)</em>
                </span>
                <button
                  className={`settings-switch ${settings.lyricsAutoscroll ? 'on' : ''}`}
                  onClick={() => update({ lyricsAutoscroll: !settings.lyricsAutoscroll })}
                  aria-pressed={settings.lyricsAutoscroll}
                >
                  <span className="switch-knob" />
                </button>
              </div>
            </section>
          )}

          {cat === 'sources' && (
            <>
              <section className="settings-group">
                <h3 className="settings-group-title">Яндекс Музыка</h3>
                <p className="empty-hint">
                  Для поиска и воспроизведения нужен ваш OAuth-токен. Откройте ссылку авторизации,
                  войдите в Яндекс — в адресе страницы после входа будет <code>access_token=...</code>.
                  Скопируйте его значение в поле ниже.
                </p>
                <div className="settings-row settings-row-column">
                  <span className="settings-row-label">OAuth-токен</span>
                  <div className="bg-controls">
                    <input
                      type="password"
                      className="settings-token-input"
                      placeholder="y0_AgAAAA..."
                      value={ymTokenInput}
                      onChange={(e) => setYmTokenInput(e.target.value)}
                      autoComplete="off"
                    />
                    <button
                      className="btn btn-sm"
                      onClick={() => { setYmToken(ymTokenInput); flash(ymTokenInput.trim() ? 'Токен сохранён' : 'Токен очищен') }}
                    >Сохранить</button>
                    {ymTokenInput && (
                      <button
                        className="btn btn-outline btn-sm"
                        onClick={() => { setYmTokenInput(''); setYmToken(''); flash('Токен удалён') }}
                      >Удалить</button>
                    )}
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={() => navigator.clipboard?.writeText(YM_OAUTH_URL).then(() => flash('Ссылка скопирована')).catch(() => {})}
                    >Скопировать ссылку авторизации</button>
                  </div>
                </div>
                <p className="empty-hint">Токен хранится только на этом устройстве и никуда не отправляется, кроме API Яндекс Музыки.</p>
              </section>

              <section className="settings-group">
                <h3 className="settings-group-title">Deezer</h3>
                <p className="empty-hint">Работает без ключей: поиск треков, артистов и плейлистов. Воспроизводится официальный 30-секундный фрагмент каждого трека.</p>
              </section>

              <section className="settings-group">
                <h3 className="settings-group-title">SoundCloud</h3>
                <p className="empty-hint">Работает без ключей: полный поиск треков, артистов и плейлистов с полным воспроизведением.</p>
              </section>
            </>
          )}

          {cat === 'data' && (
            <section className="settings-group">
              <h3 className="settings-group-title">Данные</h3>
              <div className="settings-row">
                <span className="settings-row-label">Всего прослушано</span>
                <span className="listening-value">{formatListening(listening)}</span>
              </div>
              <div className="settings-row">
                <span className="settings-row-label">
                  История прослушиваний {history.length > 0 && <em>({history.length})</em>}
                </span>
                <button className="btn btn-outline btn-sm" onClick={handleClearHistory} disabled={!history.length}>
                  Очистить
                </button>
              </div>
              <div className="settings-row">
                <span className="settings-row-label">Кэш треков внешних источников</span>
                <button className="btn btn-outline btn-sm" onClick={handleClearCache}>
                  Очистить
                </button>
              </div>
            </section>
          )}


          {cat === 'about' && (
            <section className="settings-group">
              <h3 className="settings-group-title">О приложении</h3>
              <div className="settings-about">
                <span>Overfy {getCurrentVersion()}</span>
                <span className="about-muted">Музыка: SoundCloud · Deezer · Яндекс Музыка · Текст: LRCLIB</span>
                <button className="btn btn-outline btn-sm settings-reset-btn" onClick={handleReset}>
                  Сбросить настройки
                </button>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
