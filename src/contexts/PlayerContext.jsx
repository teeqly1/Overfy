import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useAuth } from './AuthContext'
import { useDbStatus } from './DbStatusContext'
import { supabase, isDbEnabled } from '../services/supabase'
import { isRemoteTrackId, getRemoteTracks } from '../services/remoteTracks'
import { refreshScStreamUrl, scCharts } from '../services/soundcloud'
import { refreshDzStreamUrl } from '../services/deezer'
import { ymStreamUrl } from '../services/yandex'
import { loadSettings, mapRawGenreToChartId } from '../services/settings'
import { addListeningSeconds, flushListeningSeconds, resetListeningSync } from '../services/userData'
import { discordConfigured, discordConnect, discordSetActivity, discordDisconnect } from '../services/discordRpc'
import { autoImportForUser } from '../services/autoImport'
import { downloadTrackFile } from '../services/tauriBridge'

const PlayerContext = createContext()

// Ключи для localStorage (гостевой режим)
const GUEST_FAVORITES_KEY = 'overfy_guest_favorites'

// Треки разных источников содержат теги в musicinfo.tags — у SoundCloud
// это нормализованные в normalize() жанры и vartags.
export function extractTrackTags(track) {
  const raw = track?.musicinfo?.tags
  if (!raw) return []
  if (Array.isArray(raw)) return raw.filter(Boolean)
  return [...(raw.genres || []), ...(raw.instruments || []), ...(raw.vartags || [])].filter(Boolean)
}

const GUEST_HISTORY_KEY = 'overfy_guest_history'
const PLAYER_SETTINGS_KEY = 'overfy_player_settings'

// Клавиша синхронизации анализатора на звук.
// Эмулятор «под звук» без CORS: полный Web Audio (createMediaElementSource)
// глушит кросс-доменное аудио. Поэтому используем гибрид:
//  * где CORS позволяет — настоящий FFT-спектр;
//  * где нет — реакция на воспроизведение (пульс по таймингу/громкости).
const ANALYSER_MIN_FREQ = 60
const ANALYSER_MAX_FREQ = 12000

// repeat: 'off' | 'all' | 'one'
export function PlayerProvider({ children }) {
  const { user, isGuest } = useAuth()
  const { dbEnabled } = useDbStatus()

  const [queue, setQueue] = useState([])
  const [currentTrack, setCurrentTrack] = useState(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentIndex, setCurrentIndex] = useState(-1)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(() => {
    let saved = {}
    try {
      saved = JSON.parse(localStorage.getItem(PLAYER_SETTINGS_KEY) || '{}')
    } catch {
      saved = {}
    }
    return typeof saved.volume === 'number' ? saved.volume : 0.8
  })
  const [isMuted, setIsMuted] = useState(false)
  const [shuffle, setShuffle] = useState(false)
  const [repeat, setRepeat] = useState('off')
  const [favorites, setFavorites] = useState([])
  const [history, setHistory] = useState([])
  const [isWavePlaying, setIsWavePlaying] = useState(false)
  // Таймер сна: timestamp остановки (мс) и остаток для UI (сек)
  const [sleepEndsAt, setSleepEndsAt] = useState(null)
  const [sleepRemaining, setSleepRemaining] = useState(null)

  const audioRef = useRef(null)
  const isWavePlayingRef = useRef(false)
  const guestFavLoaded = useRef(false)
  // Облачные данные (избранное/история) успешно загружены для ТЕКУЩЕГО пользователя.
  // Отдельно от guestFavLoaded: при переходе гость→пользователь гостевой флаг уже
  // установлен, но синхронизация не должна идти, пока избранное не загружено из БД
  // (иначе пустой список удалит все облачные избранные при перезагрузке).
  const cloudDataLoaded = useRef(false)
  const autoImportDoneRef = useRef(false)
  const prevHistoryRef = useRef('')
  const audioRetriedRef = useRef(false)
  // Свежая ссылка на аудио для Яндекса (прямые ссылки живут ~1 минуту,
  // поэтому резолвим в момент воспроизведения, а не при поиске)
  const [resolvedSrc, setResolvedSrc] = useState(null)

  // --- Эквалайзер/анализатор ---
  // analyserData: реальный FFT-спектр (bars), reactiveBars: fallback-пульс по звуку.
  // ВАЖНО: Web Audio НЕ подключается к основному <audio> (элементу воспроизведения):
  // createMediaElementSource навсегда ведёт звук элемента через AudioContext, а
  // crossOrigin='anonymous' ломает загрузку источников без CORS. Поэтому FFT берём
  // с отдельного БЕЗЗВУЧНОГО клона (analysisElRef) — основной элемент никогда не
  // трогается, звук не может пропасть. Если клон не может загрузить источник
  // (нет CORS) — автоматически падаем на beat-режим, воспроизведение не страдает.
  const [analyzerData, setAnalyzerData] = useState([])
  const [reactiveBars, setReactiveBars] = useState([])
  const audioCtxRef = useRef(null)
  const analyserRef = useRef(null)
  const sourceRef = useRef(null)
  const analyserRaf = useRef(null)
  const analyserRunning = useRef(false)
  const analyserAttached = useRef(false)
  const analyserMode = useRef('off') // 'off' | 'fft' | 'beat'
  const lastBeatTick = useRef(0)
  const analysisElRef = useRef(null)

  const ensureAnalysisEl = useCallback(() => {
    if (analysisElRef.current) return analysisElRef.current
    const el = document.createElement('audio')
    el.crossOrigin = 'anonymous'
    el.volume = 0
    el.preload = 'auto'
    el.style.display = 'none'
    el.addEventListener('error', () => {
      // Источник не отдаёт CORS — анализатор этого трека не видит.
      // Воспроизведение на основном элемента не затрагивается.
      analyserMode.current = 'beat'
    })
    document.body.appendChild(el)
    analysisElRef.current = el
    return el
  }, [])

  // Учёт времени прослушивания: +1 секунда каждую секунду воспроизведения
  useEffect(() => {
    if (!isPlaying) return
    const id = setInterval(() => addListeningSeconds(1), 1000)
    return () => clearInterval(id)
  }, [isPlaying])

  // Досинхронизация часов прослушивания при закрытии приложения
  useEffect(() => {
    const flush = () => flushListeningSeconds()
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [])

  // Загрузка избранного и истории.
  // ВАЖНО: guestFavLoaded устанавливается в true ТОЛЬКО после успешной
  // загрузки избранного. Иначе на первом рендере favorites = [] и эффект
  // синхронизации удалит все избранное из БД (баг «сбрасываются избранные»).
  // Если первая загрузка упала, повторяем в фоне с бэкоффом — пока не
  // получится. Так синхронизация не заблокируется навсегда и не удалит
  // облачные избранные из-за пустого локального списка.
  const loadFromSupabase = useCallback(async () => {
    try {
      const { data: favs, error: favError } = await supabase
        .from('favorites')
        .select('track_id, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      if (favError) throw favError
      setFavorites(favs ? favs.map(f => f.track_id) : [])

      const { data: hist, error: histError } = await supabase
        .from('play_history')
        .select('track_id, listened_at')
        .eq('user_id', user.id)
        .order('listened_at', { ascending: false })
        .limit(50)

      if (histError) throw histError
      setHistory(hist ? hist.map(h => h.track_id) : [])
      return true
    } catch (e) {
      console.error('Ошибка загрузки данных:', e)
      return false
    }
  }, [user])

  useEffect(() => {
    let cancelled = false
    // Каждая смена пользователя/режима начинается с «облако не загружено» —
    // синхронизация не запустится, пока не прочитаем данные из БД.
    cloudDataLoaded.current = false
    // Часы прослушивания синхронизируются раз в минуту (модульный гейт) —
    // сбрасываем его, чтобы новый аккаунт получил свой первый синк сразу.
    resetListeningSync()

    // Повторная попытка загрузки с растущей паузой (максимум ~15 сек).
    // После первой успешной загрузки переносим локальные данные (гостевые
    // избранные + импортированные файлы) на аккаунт, затем перечитываем список.
    const loadWithRetry = async () => {
      let delay = 2000
      while (!cancelled && !cloudDataLoaded.current) {
        const ok = await loadFromSupabase()
        if (cancelled) return
        if (ok) {
          cloudDataLoaded.current = true
          guestFavLoaded.current = true
          // Автоимпорт: гостевые избранные и локальные файлы → аккаунт.
          // Включён по настройке; фактически выполняется один раз для аккаунта
          // (после переноса гостевой список очищается и сохраняется метка).
          const autoImport = loadSettings().autoImportFavorites
          if (autoImport && !autoImportDoneRef.current && localStorage.getItem('overfy_autoimport_done') !== user.id) {
            try {
              const res = await autoImportForUser(user.id)
              // Метка «импортировано» ставим только при успехе (без ошибок):
              // при сбое гостевой список остаётся, и на следующем запуске повторим.
              if (!res.banner) {
                try { localStorage.setItem('overfy_autoimport_done', user.id) } catch { /* ignore */ }
              }
              await loadFromSupabase()
            } catch { /* не критично для работы плеера */ }
          }
          autoImportDoneRef.current = true
          return
        }
        await new Promise(r => setTimeout(r, delay))
        delay = Math.min(15_000, delay * 1.6)
      }
    }

    if (isGuest) {
      let fav = [], hist = []
      try {
        fav = JSON.parse(localStorage.getItem(GUEST_FAVORITES_KEY) || '[]')
        hist = JSON.parse(localStorage.getItem(GUEST_HISTORY_KEY) || '[]')
      } catch {
        // Повреждённые данные гостя — начинаем с чистого списка
      }
      setFavorites(Array.isArray(fav) ? fav : [])
      setHistory(Array.isArray(hist) ? hist : [])
      guestFavLoaded.current = true
      return
    }

    if (user && isDbEnabled()) {
      loadWithRetry()
    } else if (!user && !isGuest) {
      // Пользователь вышел: очищаем приватные данные и останавливаем плеер
      setFavorites([])
      setHistory([])
      setQueue([])
      setCurrentTrack(null)
      setIsPlaying(false)
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current.src = ''
      }
      cloudDataLoaded.current = false
      guestFavLoaded.current = true
    } else {
      guestFavLoaded.current = true
    }

    return () => { cancelled = true }
  }, [user, isGuest, dbEnabled, loadFromSupabase])

  // Сохранение истории при изменении.
  // Синхронизируем ПОЛНЫЙ локальный список: строки, которых больше нет локально,
  // удаляются из облака, иначе «старая» история возвращается после входа.
  useEffect(() => {
    if (isGuest) {
      localStorage.setItem(GUEST_HISTORY_KEY, JSON.stringify(history))
      return
    }
    if (!user || !isDbEnabled() || !cloudDataLoaded.current) return

    const currentVersion = history.join(',')
    if (currentVersion === prevHistoryRef.current) return
    prevHistoryRef.current = currentVersion

    let cancelled = false
    async function syncHistory() {
      try {
        const { data: existing } = await supabase
          .from('play_history')
          .select('track_id')
          .eq('user_id', user.id)
        if (cancelled) return
        const existingIds = (existing || []).map(r => r.track_id)
        const localSet = new Set(history)
        const toDelete = existingIds.filter(id => !localSet.has(id))
        for (let i = 0; i < toDelete.length; i += 900) {
          await supabase
            .from('play_history')
            .delete()
            .eq('user_id', user.id)
            .in('track_id', toDelete.slice(i, i + 900))
        }
        const existingSet = new Set(existingIds)
        const toInsert = history.filter(id => !existingSet.has(id))
        if (toInsert.length) {
          // Разносим таймстампы: история отсортирована «новые сверху», первой
          // записи — самый свежий момент, остальным — с шагом 1с, чтобы
          // «Недавно прослушанные» сохранили порядок.
          const base = Date.now()
          await supabase
            .from('play_history')
            .upsert(toInsert.map((trackId, i) => ({
              user_id: user.id,
              track_id: trackId,
              listened_at: new Date(base - (toInsert.length - 1 - i) * 1000).toISOString()
            })), { onConflict: 'user_id,track_id' })
        }
      } catch (e) {
        console.warn('[Player] sync history', e)
      }
    }
    syncHistory()
    return () => { cancelled = true }
  }, [history, user, isGuest])

  // Сохранение избранного
  useEffect(() => {
    if (isGuest) {
      localStorage.setItem(GUEST_FAVORITES_KEY, JSON.stringify(favorites))
      return
    }
    if (!user || !isDbEnabled() || !cloudDataLoaded.current) return

    let cancelled = false
    const syncFavorites = async () => {
      const { data: existing } = await supabase
        .from('favorites')
        .select('track_id')
        .eq('user_id', user.id)

      if (cancelled) return
      const existingIds = existing ? existing.map(e => e.track_id) : []

      const toDelete = existingIds.filter(id => !favorites.includes(id))
      const toAdd = favorites.filter(id => !existingIds.includes(id))

      if (toDelete.length) {
        // URL limit Supabase: .in() с >1000 значениями падает — удаляем частями
        for (let i = 0; i < toDelete.length; i += 900) {
          const chunk = toDelete.slice(i, i + 900)
          const { error } = await supabase
            .from('favorites')
            .delete()
            .eq('user_id', user.id)
            .in('track_id', chunk)
          if (error) { console.warn('[Player] delete favorites chunk', error); return }
          if (cancelled) return
        }
      }

      if (toAdd.length) {
        // Большие списки бьём чанками: insert >1000 строк падает на лимите URL
        const base = Date.now()
        for (let i = 0; i < toAdd.length; i += 900) {
          const chunk = toAdd.slice(i, i + 900).map((trackId, j) => ({
            user_id: user.id,
            track_id: trackId,
            created_at: new Date(base - (toAdd.length - 1 - (i + j)) * 1000).toISOString()
          }))
          const { error } = await supabase.from('favorites').insert(chunk)
          if (error) { console.warn('[Player] insert favorites chunk', error); return }
          if (cancelled) return
        }
      }
    }

    syncFavorites().catch(e => console.warn('[Player] sync favorites failed', e))
    return () => { cancelled = true }
  }, [favorites, user, isGuest])

  // Персистентность настроек плеера (громкость, shuffle, repeat)
  useEffect(() => {
    localStorage.setItem(PLAYER_SETTINGS_KEY, JSON.stringify({ volume, shuffle, repeat }))
  }, [volume, shuffle, repeat])

  // --- Эквалайзер: режим из настроек + привязка к FFT/пульсу ---
  // equalizerMode: 'off' | 'beat' | 'hybrid'.
  // hybrid = пробуем настоящий FFT (если CORS позволяет), иначе пульс «по звуку».
  // Число полос берём из настроек волны (24 | 40 | 64).
  const eqSettings = loadSettings()
  const equalizerMode = eqSettings.omd ? 'off' : (eqSettings.equalizerMode || 'off')
  const barsCount = eqSettings.waveBars || 40

  // Основной цикл рисования полос. В fft-режиме читаем настоящий спектр,
  // в beat — пульсируем по воспроизведению (работает для любых источников).
  // В режиме off/не активного эквалайзера цикл вообще не планируется.
  const runAnalyzerLoop = useCallback(() => {
    // Не накапливаем параллельные RAF-петли при повторных вызовах эффекта
    if (analyserRunning.current) cancelAnimationFrame(analyserRaf.current)
    analyserRunning.current = true
    const draw = () => {
      if (analyserMode.current === 'off') {
        analyserRunning.current = false
        return
      }
      analyserRaf.current = requestAnimationFrame(draw)
      if (analyserMode.current === 'fft' && analyserRef.current) {
        const data = new Uint8Array(analyserRef.current.frequencyBinCount)
        analyserRef.current.getByteFrequencyData(data)
        const out = []
        const binCount = data.length
        for (let i = 0; i < barsCount; i++) {
          const low = Math.floor((i / barsCount) * ANALYSER_MIN_FREQ * binCount / 22050)
          const high = Math.floor(((i + 1) / barsCount) * ANALYSER_MAX_FREQ * binCount / 22050)
          let sum = 0, n = 0
          for (let b = Math.max(0, low); b < Math.min(binCount, Math.max(high, low + 1)); b++) {
            sum += data[b]
            n++
          }
          out.push(n ? sum / n / 255 : 0)
        }
        setAnalyzerData(out)
        return
      }
      if (analyserMode.current === 'beat') {
        // Пульсирующий эквалайзер «по звуку»: реагирует на факт воспроизведения,
        // громкость и время трека. Работает без Web Audio → без риска заглушить звук.
        const el = audioRef.current
        const now = performance.now()
        const playing = !!el && !el.paused && !el.ended
        const vol = el?.volume ?? 1
        const t = el?.currentTime || 0
        // Басовый такт: «дыхание» на частотах ритма (~ х2/х4 от скорости)
        const beatA = playing ? Math.max(0, Math.sin(t * Math.PI * 2 * 1)) : 0
        const beatB = playing ? Math.max(0, Math.sin(t * Math.PI * 2 * 2)) : 0
        const out = []
        for (let i = 0; i < barsCount; i++) {
          const x = i / barsCount
          const wave = 0.5 + 0.5 * Math.sin(now / 160 + x * 3.1)
          const bassBoost = 1 - x
          const drive = playing ? 0.25 + 0.75 * (0.4 * beatA + 0.3 * beatB + 0.3 * wave) * vol : 0.05
          out.push(Math.max(0.02, Math.min(1, drive * (0.35 + 0.65 * bassBoost))))
        }
        setReactiveBars(out)
        void lastBeatTick.current
        return
      }
    }
    draw()
  }, [barsCount])

  // Проверка CORS-доступности потока. fetch в mode:'cors' успешен ⇔ сервер
  // отдаёт заголовки Access-Control-Allow-Origin. Тело запроса сразу отменяем —
  // грузить трек заново не нужно.
  const probeCors = useCallback(async (url) => {
    if (!url) return false
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 4000)
    try {
      const res = await fetch(url, { mode: 'cors', method: 'GET', signal: controller.signal })
      res.body?.cancel?.().catch(() => {})
      return true
    } catch {
      return false
    } finally {
      clearTimeout(timer)
    }
  }, [])

  // Подключение FFT к ОТДЕЛЬНОМУ беззвучному <audio>-клону источника. Основной
  // элемент воспроизведения никогда не трогаем (нет crossOrigin/reload-заглушек),
  // поэтому звук не может пропасть ни для какого источника. AudioContext создаём
  // один раз; клон молчит (volume=0 и не подключён к выходу), но отдаёт анализеру
  // настоящий спектр.
  const attachAnalyser = useCallback(async () => {
    if (analyserAttached.current) return 'beat'
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return 'beat'
    const el = ensureAnalysisEl()
    try {
      analyserAttached.current = true
      const ctx = new Ctx()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 2048
      analyser.smoothingTimeConstant = 0.75
      const source = ctx.createMediaElementSource(el)
      source.connect(analyser)
      if (ctx.state === 'suspended') await ctx.resume().catch(() => {})
      audioCtxRef.current = ctx
      analyserRef.current = analyser
      sourceRef.current = source
      analyserMode.current = 'fft'
      runAnalyzerLoop()
      return 'fft'
    } catch {
      analyserAttached.current = false
      return 'beat'
    }
  }, [runAnalyzerLoop, ensureAnalysisEl])

  // Подаём текущий источник в анализ-клон (только для http(s); локальные файлы —
  // чистый beat, их и слушаем напрямую).
  const feedAnalysisEl = useCallback(() => {
    const el = analysisElRef.current
    if (!el) return
    const url = resolvedSrc || currentTrack?.audio
    if (!url || !/^https?:/i.test(url)) {
      if (el.getAttribute('src')) { el.pause(); el.removeAttribute('src'); el.load() }
      return
    }
    if (el.getAttribute('src') !== url) {
      el.removeAttribute('src')
      el.src = url
    }
    if (audioRef.current && !audioRef.current.paused) el.play().catch(() => {})
  }, [resolvedSrc, currentTrack])

  // Зеркалим play/pause избранного между основным элементом и клоном-анализатором
  useEffect(() => {
    const el = analysisElRef.current
    if (!el || analyserMode.current !== 'fft') return
    if (isPlaying) {
      el.play().catch(() => {})
    } else {
      el.pause()
    }
  }, [isPlaying])

  // Действие при смене трека: решаем режим анализатора для нового источника.
  const resolveAnalyserMode = useCallback(async () => {
    if (equalizerMode === 'off') {
      analyserMode.current = 'off'
      setAnalyzerData([])
      setReactiveBars([])
      const el = analysisElRef.current
      if (el && el.getAttribute('src')) { el.pause(); el.removeAttribute('src'); el.load() }
      return
    }
    if (equalizerMode === 'beat') {
      analyserMode.current = 'beat'
      runAnalyzerLoop()
      const el = analysisElRef.current
      if (el) el.pause()
      return
    }
    // hybrid: пробуем настоящий FFT через клон (CORS-friendly), иначе пульс
    if (analyserMode.current !== 'fft' && !sourceRef.current) {
      const url = resolvedSrc || currentTrack?.audio
      const ok = await probeCors(url)
      analyserMode.current = ok ? await attachAnalyser() : 'beat'
    }
    if (analyserMode.current === 'fft') {
      feedAnalysisEl()
    } else if (analyserMode.current === 'beat') {
      runAnalyzerLoop()
    }
  }, [equalizerMode, resolvedSrc, currentTrack, probeCors, attachAnalyser, runAnalyzerLoop, feedAnalysisEl])

  // Запуск режима при монтировании/смене настроек
  useEffect(() => {
    resolveAnalyserMode()
  }, [equalizerMode, currentTrack, resolvedSrc, isPlaying, resolveAnalyserMode])

  // Остановка RAF при размонтировании
  useEffect(() => {
    return () => {
      if (analyserRaf.current) cancelAnimationFrame(analyserRaf.current)
    }
  }, [])

  // Повторный запуск с начала. Клик по уже загруженному треку (тот же src)
  // браузер сам не перезагружает — React не меняет атрибут и звук продолжает
  // играть со старой позиции либо молчит на проигранном треке.
  const refreshPlaybackStart = useCallback((track) => {
    const el = audioRef.current
    if (!el) return
    const sameTrack = currentTrack && track && track.id === currentTrack.id
    if (sameTrack) el.currentTime = 0
    const targetUrl = track?.audio || resolvedSrc
    if (targetUrl && el.getAttribute('src') === targetUrl) {
      el.play().catch(() => {})
    }
  }, [currentTrack, resolvedSrc])

  const playTrack = useCallback(async (track, tracksQueue) => {
    const list = tracksQueue || [track]
    setQueue(list)
    const idx = list.findIndex(t => t.id === track.id)
    setCurrentIndex(idx >= 0 ? idx : 0)
    setCurrentTrack(track)
    // Обычный трек (не волна): кнопка «Волна» должна снова запускать волну
    setIsWavePlaying(false)
    isWavePlayingRef.current = false
    setProgress(0)
    audioRetriedRef.current = false
    refreshPlaybackStart(track)

    // Обновить историю
    setHistory(prev => {
      return [track.id, ...prev.filter(id => id !== track.id)].slice(0, 100)
    })
  }, [refreshPlaybackStart])

  // playTrackAt(list, index, { wave }) — играет трек из списка.
  // wave=true означает «это волна» (кнопка-переключатель волны привязана к isWavePlaying);
  // по умолчанию false — обычный трек.
  const playTrackAt = useCallback((list, index, { wave = false } = {}) => {
    const track = list[index]
    setQueue(list)
    setCurrentIndex(index)
    setCurrentTrack(track)
    setIsWavePlaying(wave)
    isWavePlayingRef.current = wave
    setProgress(0)
    audioRetriedRef.current = false
    refreshPlaybackStart(track)
    if (track) {
      setHistory(prev => [track.id, ...prev.filter(id => id !== track.id)].slice(0, 100))
    }
  }, [refreshPlaybackStart])

  const togglePlay = useCallback(() => {
    if (!audioRef.current) return
    if (audioRef.current.paused) {
      audioRef.current.play().catch(() => {})
    } else {
      audioRef.current.pause()
    }
  }, [])

  const pickNextIndex = useCallback((dir) => {
    if (queue.length <= 1) return currentIndex
    if (shuffle) {
      if (queue.length === 2) return (currentIndex + 1) % queue.length
      let idx = currentIndex
      while (idx === currentIndex) {
        idx = Math.floor(Math.random() * queue.length)
      }
      return idx
    }
    return (currentIndex + dir + queue.length) % queue.length
  }, [queue, currentIndex, shuffle])

  const next = useCallback(() => {
    if (queue.length === 0) return
    playTrackAt(queue, pickNextIndex(1), { wave: isWavePlayingRef.current })
  }, [queue, pickNextIndex, playTrackAt])

  const prev = useCallback(() => {
    if (queue.length === 0) return
    // Стандартное поведение: если трек играет дольше 3 секунд — перемотка в начало
    if (audioRef.current && audioRef.current.currentTime > 3) {
      audioRef.current.currentTime = 0
      setProgress(0)
      return
    }
    playTrackAt(queue, pickNextIndex(-1), { wave: isWavePlayingRef.current })
  }, [queue, pickNextIndex, playTrackAt])

  const seek = useCallback((value) => {
    const main = audioRef.current
    if (main) {
      main.currentTime = value
      setProgress(value)
    }
    const el = analysisElRef.current
    if (el && analyserMode.current === 'fft') {
      try { el.currentTime = value } catch { /* клон может быть ещё не готов */ }
    }
  }, [])

  const setVolumeLevel = useCallback((value) => {
    setVolume(value)
    if (audioRef.current) {
      audioRef.current.volume = value
      audioRef.current.muted = false
      setIsMuted(false)
    }
  }, [])

  const toggleMute = useCallback(() => {
    if (!audioRef.current) return
    const newMuted = !isMuted
    setIsMuted(newMuted)
    audioRef.current.muted = newMuted
  }, [isMuted])

  const toggleShuffle = useCallback(() => setShuffle(s => !s), [])

  const cycleRepeat = useCallback(() => {
    setRepeat(r => (r === 'off' ? 'all' : r === 'all' ? 'one' : 'off'))
  }, [])

  const addToFavorites = useCallback((trackId) => {
    setFavorites(prev => {
      if (prev.includes(trackId)) return prev
      return [trackId, ...prev]
    })
  }, [])

  const removeFromFavorites = useCallback((trackId) => {
    setFavorites(prev => prev.filter(id => id !== trackId))
  }, [])

  const isFavorite = useCallback((trackId) => {
    return favorites.includes(trackId)
  }, [favorites])

  // Обработчики событий аудио
  const handleTimeUpdate = useCallback(() => {
    if (audioRef.current) {
      setProgress(audioRef.current.currentTime)
    }
  }, [])

  const handleLoadedMetadata = useCallback(() => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration || 0)
    }
  }, [])

  const handlePlay = useCallback(() => {
    setIsPlaying(true)
  }, [])

  const handlePause = useCallback(() => {
    setIsPlaying(false)
  }, [])

  const handleEnded = useCallback(() => {
    if (repeat === 'one' && audioRef.current) {
      audioRef.current.currentTime = 0
      audioRef.current.play().catch(() => {})
      return
    }
    const isLast = currentIndex === queue.length - 1
    if (repeat === 'off' && isLast) {
      setIsPlaying(false)
      // Очередь волны закончилась — возвращаем кнопку в состояние «запустить волну»
      if (isWavePlayingRef.current) {
        setIsWavePlaying(false)
        isWavePlayingRef.current = false
      }
      return
    }
    next()
  }, [repeat, currentIndex, queue.length, next])

  // Fallback аудио: для SoundCloud и Deezer один раз обновляем истёкшую
  // подписанную ссылку через Rust-бэкенд; для Яндекса — резолвим заново.
  const handleAudioError = useCallback(() => {
    if (!currentTrack?.id || audioRetriedRef.current) return
    audioRetriedRef.current = true
    const el = audioRef.current
    if (!el) return
    if (currentTrack.source === 'sc') {
      refreshScStreamUrl(currentTrack.id)
        .then((url) => {
          if (url) {
            el.src = url
            el.play().catch(() => {})
          }
        })
        .catch(() => {})
    } else if (currentTrack.source === 'dz') {
      refreshDzStreamUrl(currentTrack.id)
        .then((url) => {
          if (url) {
            el.src = url
            el.play().catch(() => {})
          }
        })
        .catch(() => {})
    } else if (currentTrack.source === 'ym') {
      ymStreamUrl(currentTrack.id)
        .then((url) => {
          if (url) {
            setResolvedSrc(url)
            el.src = url
            el.play().catch(() => {})
          }
        })
        .catch(() => {})
    }
  }, [currentTrack])

  // Яндекс: прямая ссылка живёт ~1 минуту, поэтому каждый запуск трека
  // получает свежую ссылку через Rust-бэкенд перед воспроизведением.
  // Треки из чужого профиля (избранное друга) приходят без ссылки вообще —
  // для SoundCloud/Deezer резолвим её по id трека.
  useEffect(() => {
    if (!currentTrack) {
      setResolvedSrc(null)
      return
    }
    if (currentTrack.source === 'ym' || !currentTrack.audio) {
      let cancelled = false
      const resolve =
        currentTrack.source === 'ym'
          ? ymStreamUrl(currentTrack.id)
          : currentTrack.source === 'dz'
            ? refreshDzStreamUrl(currentTrack.id)
            : currentTrack.source === 'sc'
              ? refreshScStreamUrl(currentTrack.id)
              : null
      if (!resolve) {
        setResolvedSrc(null)
        return
      }
      resolve
        .then((url) => {
          if (!cancelled) setResolvedSrc(url)
        })
        .catch(() => {})
      return () => {
        cancelled = true
      }
    }
    setResolvedSrc(null)
  }, [currentTrack])

  // Синхронизация громкости/мьюта с аудио-элементом
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume
      audioRef.current.muted = isMuted
    }
  }, [volume, isMuted, currentTrack])

  // Скорость воспроизведения из настроек (на каждый трек)
  useEffect(() => {
    const s = loadSettings()
    const speed = typeof s.playbackSpeed === 'number' && s.playbackSpeed > 0 ? s.playbackSpeed : 1
    if (audioRef.current) audioRef.current.playbackRate = speed
  }, [currentTrack])

  // Автозапуск при смене трека: React обновляет src после коммита,
  // поэтому play() вызываем здесь — иначе трек меняется, но молчит.
  // resolvedSrc в зависимостях: у Яндекса ссылка появляется асинхронно.
  useEffect(() => {
    const el = audioRef.current
    if (!el || !currentTrack || !el.getAttribute('src')) return
    el.play().catch(() => {})
  }, [currentTrack, resolvedSrc])

  // Media Session: системные медиа-клавиши и метаданные в ОС
  useEffect(() => {
    if (!('mediaSession' in navigator) || !currentTrack) return
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentTrack.name || '',
        artist: currentTrack.artist_name || '',
        album: currentTrack.album_name || 'Overfy',
        artwork: currentTrack.image
          ? [{ src: currentTrack.image, sizes: '300x300', type: 'image/jpeg' }]
          : [],
      })
      navigator.mediaSession.setActionHandler('play', () => audioRef.current?.play().catch(() => {}))
      navigator.mediaSession.setActionHandler('pause', () => audioRef.current?.pause())
      navigator.mediaSession.setActionHandler('nexttrack', () => next())
      navigator.mediaSession.setActionHandler('previoustrack', () => prev())
    } catch {
      // Media Session не поддерживается — не критично
    }
  }, [currentTrack, next, prev])

  useEffect(() => {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused'
    }
  }, [isPlaying])

  // Discord Rich Presence: показывает трек/статус в Discord,
  // если включено в настройках и настроен Client ID.
  const discordOn = loadSettings().discordEnabled && discordConfigured()
  useEffect(() => {
    if (discordOn && currentTrack && isPlaying) {
      discordConnect().then(() => discordSetActivity(currentTrack, isPlaying))
    } else if (discordOn && currentTrack && !isPlaying) {
      discordSetActivity(currentTrack, false)
    } else if (!discordOn) {
      discordDisconnect()
    }
    return () => {
      if (!discordOn) discordDisconnect()
    }
  }, [currentTrack, isPlaying, discordOn])

  // Волна треков: при выборе конкретных жанров в интерфейсе — строго играет их;
  // при режиме «Все жанры» — анализирует историю и избранное (теги vartags + genres),
  // составляя персональный микс рекомендаций.
  const playWave = useCallback(async () => {
    const s = loadSettings()
    const chosenGenres = (s.waveGenres || []).filter(g => g !== 'all-music')

    let genresToFetch = []
    if (chosenGenres.length > 0) {
      // 1. Пользователь прямо выбрал жанры (чипы на главной или в настройках)
      genresToFetch = chosenGenres
    } else {
      // 2. Режим «Все жанры»: анализируем вкусы пользователя по избранному и истории
      const userTrackIds = [...new Set([...favorites, ...history])]
      const remoteTracks = getRemoteTracks(userTrackIds)

      const genreCounts = new Map()
      for (const t of remoteTracks) {
        const tags = [
          ...(t?.musicinfo?.tags?.genres || []),
          ...(t?.musicinfo?.tags?.vartags || []),
          ...(Array.isArray(t?.musicinfo?.tags) ? t.musicinfo.tags : [])
        ]
        if (typeof t?.genre === 'string') tags.push(t.genre)

        for (const raw of tags) {
          const chartId = mapRawGenreToChartId(raw)
          if (chartId) {
            genreCounts.set(chartId, (genreCounts.get(chartId) || 0) + 1)
          }
        }
      }

      const topTasteGenres = [...genreCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([id]) => id)

      if (topTasteGenres.length > 0) {
        genresToFetch = topTasteGenres
      } else {
        // Базовый разнообразный набор треков
        genresToFetch = ['all-music', 'electronic', 'rock', 'hiphop-rap', 'pop']
      }
    }

    // 3. Загружаем подборки по каждому жанру
    const lists = await Promise.all(
      genresToFetch.map(g => scCharts(g, 18).catch(() => []))
    )

    // 4. Собираем пул методом Round-Robin для гармоничного чередования жанров
    const favSet = new Set(favorites)
    const seen = new Set()
    let pool = []
    const maxLen = Math.max(...lists.map(l => l.length), 0)

    for (let i = 0; i < maxLen; i++) {
      for (const list of lists) {
        if (i < list.length) {
          const t = list[i]
          if (!seen.has(t.id)) {
            seen.add(t.id)
            pool.push(t)
          }
        }
      }
    }

    // Если новых треков достаточно — отдаём предпочтение тем, которых нет в избранном
    const freshPool = pool.filter(t => !favSet.has(t.id))
    const finalPool = freshPool.length >= 6 ? freshPool : pool

    if (!finalPool.length) return { success: false, count: 0 }

    setIsWavePlaying(true)
    isWavePlayingRef.current = true
    playTrackAt(finalPool, 0, { wave: true })
    return { success: true, count: finalPool.length }
  }, [playTrackAt, favorites, history])

  const clearHistory = useCallback(() => {
    setHistory([])
  }, [])

  // Управление очередью: удаление трека по индексу.
  // Текущий играющий трек удалить нельзя.
  const removeFromQueue = useCallback((index) => {
    if (index < 0 || index >= queue.length || index === currentIndex) return
    setQueue(prev => prev.filter((_, i) => i !== index))
    if (index < currentIndex) setCurrentIndex(currentIndex - 1)
  }, [queue.length, currentIndex])

  // «Играть следующим»: вставка трека сразу после текущего
  const playNext = useCallback((track) => {
    if (!track) return
    if (currentIndex < 0 || queue.length === 0) {
      playTrack(track, [track])
      return
    }
    setQueue(prev => {
      const q = [...prev]
      q.splice(currentIndex + 1, 0, track)
      return q
    })
  }, [currentIndex, queue.length, playTrack])

  // Таймер сна: пауза по истечении N минут
  const setSleepTimer = useCallback((minutes) => {
    if (!minutes || minutes <= 0) {
      setSleepEndsAt(null)
      setSleepRemaining(null)
      return
    }
    setSleepEndsAt(Date.now() + minutes * 60_000)
  }, [])

  const cancelSleepTimer = useCallback(() => {
    setSleepEndsAt(null)
    setSleepRemaining(null)
  }, [])

  useEffect(() => {
    if (!sleepEndsAt) return
    const tick = () => {
      const left = Math.max(0, Math.round((sleepEndsAt - Date.now()) / 1000))
      setSleepRemaining(left)
      if (left <= 0) {
        setSleepEndsAt(null)
        setSleepRemaining(null)
        if (audioRef.current) audioRef.current.pause()
        setIsPlaying(false)
      }
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [sleepEndsAt])

  // Горячие клавиши плеера (когда фокус не в поле ввода):
  // Space — пауза/плей, Ctrl+←/→ — пред/след, ←/→ — ±5с,
  // ↑/↓ — громкость, M — звук, S — перемешивание, R — повтор.
  useEffect(() => {
    const handler = (e) => {
      const el = e.target
      const tag = el?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return
      if (!currentTrack) return
      switch (e.code) {
        case 'Space':
          e.preventDefault()
          togglePlay()
          break
        case 'ArrowRight':
          e.preventDefault()
          if (e.ctrlKey || e.metaKey) next()
          else if (audioRef.current) seek(Math.min(audioRef.current.currentTime + 5, duration || audioRef.current.currentTime + 5))
          break
        case 'ArrowLeft':
          e.preventDefault()
          if (e.ctrlKey || e.metaKey) prev()
          else if (audioRef.current) seek(Math.max(audioRef.current.currentTime - 5, 0))
          break
        case 'ArrowUp':
          e.preventDefault()
          setVolumeLevel(Math.min(1, Math.round((volume + 0.05) * 100) / 100))
          break
        case 'ArrowDown':
          e.preventDefault()
          setVolumeLevel(Math.max(0, Math.round((volume - 0.05) * 100) / 100))
          break
        case 'KeyM':
          toggleMute()
          break
        case 'KeyS':
          toggleShuffle()
          break
        case 'KeyR':
          cycleRepeat()
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [currentTrack, togglePlay, next, prev, seek, duration, volume,
      setVolumeLevel, toggleMute, toggleShuffle, cycleRepeat])

  // Скачивание трека (десктоп: папка Загрузки/Overfy; браузер: скачивание файла)
  const downloadTrack = useCallback(async (trackToDownload) => {
    const track = trackToDownload || currentTrack
    if (!track) return { success: false, error: 'Трек не выбран' }

    try {
      let streamUrl = track.audio
      if (!streamUrl && track.source === 'ym') {
        streamUrl = await ymStreamUrl(track.id)
      } else if (!streamUrl && track.source === 'dz') {
        streamUrl = await refreshDzStreamUrl(track.id)
      } else if (!streamUrl && track.source === 'sc') {
        streamUrl = await refreshScStreamUrl(track.id)
      }
      if (!streamUrl && track.id === currentTrack?.id) {
        streamUrl = resolvedSrc
      }

      if (!streamUrl) {
        throw new Error('Не удалось получить ссылку на аудиопоток')
      }

      const filename = `${track.artist_name || track.artist || 'Artist'} - ${track.name || track.title || 'Track'}`

      const savedPath = await downloadTrackFile(streamUrl, filename)
      if (savedPath) {
        return { success: true, path: savedPath, filename }
      }

      const a = document.createElement('a')
      a.href = streamUrl
      a.download = `${filename}.mp3`
      a.target = '_blank'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      return { success: true, path: filename, filename }
    } catch (err) {
      console.error('Ошибка скачивания трека:', err)
      return { success: false, error: err?.message || String(err) }
    }
  }, [currentTrack, resolvedSrc])

  const value = useMemo(() => ({
    queue,
    currentTrack,
    currentIndex,
    isPlaying,
    isWavePlaying,
    progress,
    duration,
    volume,
    isMuted,
    shuffle,
    repeat,
    analyzerData,
    reactiveBars,
    favorites,
    history,
    playTrack,
    playTrackAt,
    togglePlay,
    next,
    prev,
    seek,
    setVolumeLevel,
    toggleMute,
    toggleShuffle,
    cycleRepeat,
    addToFavorites,
    removeFromFavorites,
    isFavorite,
    playWave,
    clearHistory,
    removeFromQueue,
    playNext,
    sleepRemaining,
    setSleepTimer,
    cancelSleepTimer,
    downloadTrack,
    audioRef
  }), [queue, currentTrack, currentIndex, isPlaying, isWavePlaying, progress, duration,
    volume, isMuted, shuffle, repeat, analyzerData, reactiveBars, favorites, history, playTrack, playTrackAt,
    togglePlay, next, prev, seek, setVolumeLevel, toggleMute, toggleShuffle, cycleRepeat,
    addToFavorites, removeFromFavorites, isFavorite, playWave, clearHistory, removeFromQueue,
    playNext, sleepRemaining, setSleepTimer, cancelSleepTimer, downloadTrack])

  return (
    <PlayerContext.Provider value={value}>
      {children}
      <audio
        ref={audioRef}
        src={resolvedSrc || currentTrack?.audio || undefined}
        autoPlay={false}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onPlay={handlePlay}
        onPause={handlePause}
        onEnded={handleEnded}
        onError={handleAudioError}
        preload="metadata"
      />
    </PlayerContext.Provider>
  )
}

export function usePlayer() {
  const context = useContext(PlayerContext)
  if (!context) throw new Error('usePlayer must be used within PlayerProvider')
  return context
}
