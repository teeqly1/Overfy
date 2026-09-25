// Текст песни через открытый API lrclib.net (без ключей).
// Отдаёт обычный текст и синхронизированный (LRC). CORS открыт,
// работает напрямую из WebView. Результаты кэшируются в localStorage.

const CACHE_KEY = 'overfy_lyrics'
const CACHE_MAX = 60

function readCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}')
  } catch {
    return {}
  }
}

function writeCache(cache) {
  try {
    // Простая ротация: лишние самые старые записи выкидываем
    const keys = Object.keys(cache)
    if (keys.length > CACHE_MAX) {
      keys.slice(0, keys.length - CACHE_MAX).forEach(k => delete cache[k])
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  } catch {
    // localStorage недоступен — текст просто не кэшируется
  }
}

function cacheKey(artist, title, duration) {
  return `${(artist || '').toLowerCase()}|${(title || '').toLowerCase()}|${Math.round(duration || 0)}`
}

// SoundCloud-заголовки замусорены: «Name (Official Video)», «Name [Free DL]»,
// «Name (feat. X)» — чистим для поиска текста
function cleanTitle(title) {
  return (title || '')
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

// LRC-строка вида `[mm:ss.xx] текст` (несколько таймкодов в строке — тоже ок)
export function parseLrc(lrc) {
  if (!lrc) return []
  const lines = []
  const re = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g
  for (const raw of lrc.split('\n')) {
    const text = raw.replace(re, '').trim()
    let m
    re.lastIndex = 0
    while ((m = re.exec(raw))) {
      const min = parseInt(m[1], 10)
      const sec = parseInt(m[2], 10)
      const fracRaw = m[3] || '0'
      const frac = parseInt(fracRaw, 10) / Math.pow(10, fracRaw.length)
      lines.push({ time: min * 60 + sec + frac, text })
    }
  }
  return lines.sort((a, b) => a.time - b.time)
}

async function apiGet(url) {
  const resp = await fetch(url, {
    headers: { 'Lrclib-Client': 'Overfy 0.1 (github.com/teeqly1/overfy)' },
  })
  if (!resp.ok) return null
  return resp.json()
}

// Возвращает { plain: string|null, synced: Array<{time,text}>|null, source }
export async function getLyrics(artist, title, durationSec = 0) {
  const key = cacheKey(artist, title, durationSec)
  const cache = readCache()
  if (cache[key]) return cache[key]

  const clean = cleanTitle(title) || title || ''
  // Самостоятельный поиск текста: режем «мусор» из заголовка SoundCloud
  // и пробуем варианты запроса от точного к широкому.
  const artistParts = (artist || '').split(/[\s,&/]+/).filter(Boolean)
  const titleVariants = [
    clean,
    clean.replace(/\b(feat|ft|prod|remix|version|edit|official)\b.*$/i, '').trim(),
    clean.split(/[-–—|]/)[0].trim(),
  ].filter((v, i, arr) => v && v.length >= 2 && arr.indexOf(v) === i)

  let found = null
  const tryGet = async (a, t) => {
    const params = new URLSearchParams({ artist_name: a || '', track_name: t })
    if (durationSec > 0) params.set('duration', String(Math.round(durationSec)))
    const d = await apiGet(`https://lrclib.net/api/get?${params}`).catch(() => null)
    return d && (d.plainLyrics || d.syncedLyrics) ? d : null
  }
  const trySearch = async (a, t) => {
    const params = new URLSearchParams({ track_name: t })
    if (a) params.set('artist_name', a)
    const results = await apiGet(`https://lrclib.net/api/search?${params}`).catch(() => null)
    if (!Array.isArray(results)) return null
    const withText = results.filter(r => r.plainLyrics || r.syncedLyrics)
    if (!withText.length) return null
    return durationSec > 0
      ? withText.slice().sort((x, y) =>
          Math.abs((x.duration || 0) - durationSec) - Math.abs((y.duration || 0) - durationSec))[0]
      : withText[0]
  }

  outer:
  for (const t of titleVariants) {
    // 1. Точное совпадение
    found = await tryGet(artist, t)
    if (found) break
    // 2. Поиск по названию + артисту
    found = await trySearch(artist, t)
    if (found) break
    // 3. Только по названию (артист мог быть записан иначе)
    found = await trySearch('', t)
    if (found) break
    // 4. По частям имени артиста («Sia Furler» → «Sia»)
    for (const part of artistParts.slice(0, 2)) {
      found = await trySearch(part, t)
      if (found) break outer
    }
  }

  if (!found) {
    const empty = { plain: null, synced: null, source: 'none' }
    cache[key] = empty
    writeCache(cache)
    return empty
  }

  const result = {
    plain: found.plainLyrics || null,
    synced: found.syncedLyrics ? parseLrc(found.syncedLyrics) : null,
    source: 'lrclib',
  }
  cache[key] = result
  writeCache(cache)
  return result
}

import { getLyricsFromFile } from './fileLyrics'

// Единая точка входа для плеера: сначала текст из самого файла
// (ID3/FLAC-метаданные локального трека), затем lrclib.
export async function getLyricsForTrack(track) {
  if (!track) return { plain: null, synced: null, source: 'none' }

  if (track.source === 'local' && track.path) {
    const fromFile = await getLyricsFromFile(track.path)
    if (fromFile && (fromFile.plain || fromFile.synced?.length)) return fromFile
    // В файле текста нет — ищем в сети по имени файла
    return getLyrics('', track.name, 0)
  }

  return getLyrics(track.artist_name, track.name, track.duration)
}
