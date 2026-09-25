// Чтение текста песни из метаданных локального файла:
//  - MP3: ID3v2 фреймы USLT (текст) и SYLT (синхронизированный текст)
//  - FLAC: Vorbis-комментарии LYRICS / UNSYNCEDLYRICS / SYNCEDLYRICS
// Файл читается через asset-протокол Tauri (convertFileSrc).

import { parseLrc } from './lyrics'

async function readFileBytes(path) {
  const { convertFileSrc } = await import('@tauri-apps/api/core')
  const resp = await fetch(convertFileSrc(path))
  if (!resp.ok) throw new Error(`read failed: ${resp.status}`)
  return new Uint8Array(await resp.arrayBuffer())
}

// --- декодеры строк ---

function decodeText(bytes, encoding) {
  try {
    switch (encoding) {
      case 0: // ISO-8859-1
        return new TextDecoder('windows-1251').decode(bytes) // кириллица чаще в cp1251
      case 1: // UTF-16 с BOM
        return new TextDecoder('utf-16').decode(bytes)
      case 2: // UTF-16BE
        return new TextDecoder('utf-16be').decode(bytes)
      case 3: // UTF-8
      default:
        return new TextDecoder('utf-8').decode(bytes)
    }
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  }
}

// Терминатор строки: для utf16 — 0x00 0x00 (с учётом выравнивания),
// для однобайтовых — одиночный 0x00. Чтение ограничено концом фрейма.
// Возвращает {text, next}
function readTerminated(bytes, start, end, encoding) {
  if (encoding === 1 || encoding === 2) {
    for (let i = start; i + 1 < end; i += 2) {
      if (bytes[i] === 0 && bytes[i + 1] === 0) {
        return {
          text: decodeText(bytes.slice(start, i), encoding),
          next: i + 2,
        }
      }
    }
    return { text: decodeText(bytes.slice(start, end), encoding), next: end }
  }
  for (let i = start; i < end; i++) {
    if (bytes[i] === 0) {
      return { text: decodeText(bytes.slice(start, i), encoding), next: i + 1 }
    }
  }
  return { text: decodeText(bytes.slice(start, end), encoding), next: end }
}

// --- ID3v2 ---

// Возвращает {plain, synced} или null, если текста нет
function parseId3(bytes) {
  if (bytes.length < 10) return null
  if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return null // 'ID3'
  const major = bytes[3]
  const flags = bytes[5]
  // syncsafe размер тега
  const size = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) |
               ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f)
  let pos = 10
  // Extended header (редко, пропускаем)
  if (flags & 0x40) {
    const extSize = major === 4
      ? ((bytes[10] & 0x7f) << 21) | ((bytes[11] & 0x7f) << 14) | ((bytes[12] & 0x7f) << 7) | (bytes[13] & 0x7f)
      : (bytes[10] << 24) | (bytes[11] << 16) | (bytes[12] << 8) | bytes[13]
    pos += extSize
  }
  const tagEnd = Math.min(10 + size, bytes.length)

  let plain = null
  let synced = null

  while (pos + 10 <= tagEnd) {
    const id = String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3])
    if (!/^[A-Z0-9]{4}$/.test(id)) break // padding или мусор
    let frameSize
    if (major === 4) {
      frameSize = ((bytes[pos + 4] & 0x7f) << 21) | ((bytes[pos + 5] & 0x7f) << 14) |
                  ((bytes[pos + 6] & 0x7f) << 7) | (bytes[pos + 7] & 0x7f)
    } else {
      frameSize = (bytes[pos + 4] << 24) | (bytes[pos + 5] << 16) | (bytes[pos + 6] << 8) | bytes[pos + 7]
    }
    const frameStart = pos + 10
    const frameEnd = Math.min(frameStart + frameSize, tagEnd)
    if (frameSize <= 0 || frameStart >= bytes.length) break

    if (id === 'USLT') {
      const enc = bytes[frameStart]
      // пропускаем язык (3 байта), затем дескриптор, затем сам текст
      const desc = readTerminated(bytes, frameStart + 4, frameEnd, enc)
      const { text } = readTerminated(bytes, desc.next, frameEnd, enc)
      if (text && text.trim() && plain == null) plain = text
    } else if (id === 'SYLT') {
      const enc = bytes[frameStart]
      const timeFormat = bytes[frameStart + 4] // 1=mpeg frames, 2=ms
      let p = frameStart + 6
      const desc = readTerminated(bytes, p, frameEnd, enc)
      p = desc.next
      const entries = []
      while (p < frameEnd) {
        const t = readTerminated(bytes, p, frameEnd, enc)
        p = t.next
        if (p + 4 > frameEnd) break
        const ts = (bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3]
        p += 4
        if (t.text) entries.push({ time: timeFormat === 2 ? ts / 1000 : ts, text: t.text })
      }
      if (entries.length && synced == null) synced = entries.sort((a, b) => a.time - b.time)
    }

    pos = frameStart + frameSize
  }

  if (plain == null && synced == null) return null
  // Текст в USLT часто уже в LRC-формате
  const looksLrc = plain && /\[\d{1,2}:\d{2}/.test(plain)
  return {
    plain: looksLrc ? null : plain,
    synced: synced || (looksLrc ? parseLrc(plain) : null),
    source: 'file',
  }
}

// --- FLAC ---

function parseFlac(bytes) {
  if (bytes.length < 8) return null
  if (bytes[0] !== 0x66 || bytes[1] !== 0x4c || bytes[2] !== 0x61 || bytes[3] !== 0x43) return null // 'fLaC'
  let pos = 4
  while (pos + 4 <= bytes.length) {
    const header = bytes[pos]
    const isLast = (header & 0x80) !== 0
    const blockType = header & 0x7f
    const blockSize = (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3]
    const blockStart = pos + 4
    if (blockType === 4) { // VORBIS_COMMENT
      const dv = new DataView(bytes.buffer, bytes.byteOffset + blockStart, blockSize)
      let p = 0
      const vendorLen = dv.getUint32(p, true); p += 4 + vendorLen
      const count = dv.getUint32(p, true); p += 4
      for (let i = 0; i < count && p + 4 <= blockSize; i++) {
        const len = dv.getUint32(p, true); p += 4
        const str = new TextDecoder('utf-8').decode(bytes.slice(blockStart + p, blockStart + p + len))
        p += len
        const eq = str.indexOf('=')
        if (eq < 0) continue
        const key = str.slice(0, eq).toUpperCase()
        const value = str.slice(eq + 1)
        if (key === 'LYRICS' || key === 'UNSYNCEDLYRICS' || key === 'SYNCEDLYRICS') {
          if (value && value.trim()) {
            const looksLrc = /\[\d{1,2}:\d{2}/.test(value)
            return {
              plain: looksLrc ? null : value,
              synced: looksLrc ? parseLrc(value) : null,
              source: 'file',
            }
          }
        }
      }
    }
    if (isLast) break
    pos = blockStart + blockSize
  }
  return null
}

// Публичный API: возвращает {plain, synced, source:'file'} или null
export async function getLyricsFromFile(path) {
  try {
    const bytes = await readFileBytes(path)
    return parseId3(bytes) || parseFlac(bytes)
  } catch (e) {
    console.error('file lyrics:', e?.message || e)
    return null
  }
}
