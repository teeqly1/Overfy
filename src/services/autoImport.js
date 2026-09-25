// Автоимпорт локальных данных на аккаунт при входе:
//  1) гостевые избранные (overfy_guest_favorites) → таблица favorites;
//  2) импортированные локальные файлы (overfy_imported) → id local_* в favorites.
// Операция идемпотентна: уже импортированное не добавляется повторно.
// После успешного переноса гостевой список очищается.

import { supabase, isDbEnabled } from './supabase'
import { getImportedTracks, localTrackId } from './userData'

const GUEST_FAVORITES_KEY = 'overfy_guest_favorites'

export function getGuestFavorites() {
  try {
    return JSON.parse(localStorage.getItem(GUEST_FAVORITES_KEY) || '[]')
  } catch {
    return []
  }
}

export function clearGuestFavorites() {
  try {
    localStorage.removeItem(GUEST_FAVORITES_KEY)
  } catch {
    // localStorage недоступен — кэш останется, повторный импорт безопасен
  }
}

// Переносит локальные данные на аккаунт. Возвращает { imported, banner }.
// importFiles=false — только гостевые избранные (без локальных файлов).
export async function autoImportForUser(userId, { importFiles = true } = {}) {
  if (!isDbEnabled() || !userId) return { imported: 0, banner: '' }

  const guest = getGuestFavorites()
  const importedIds = importFiles
    ? getImportedTracks().map(t => localTrackId(t.path))
    : []
  const candidateIds = [...guest, ...importedIds]

  if (!candidateIds.length) {
    clearGuestFavorites()
    return { imported: 0, banner: '' }
  }

  // Убираем дубли и уже существующие в БД
  const unique = [...new Set(candidateIds)]
  const { data: existing, error: existingError } = await supabase
    .from('favorites')
    .select('track_id')
    .eq('user_id', userId)

  if (existingError) {
    console.error('autoImport: не удалось получить избранное:', existingError.message)
    return { imported: 0, banner: 'Не удалось синхронизировать локальное избранное' }
  }

  const known = new Set((existing || []).map(e => e.track_id))
  const toAdd = unique.filter(id => !known.has(id))

  let imported = 0
  if (toAdd.length) {
    for (let i = 0; i < toAdd.length; i += 500) {
      const rows = toAdd.slice(i, i + 500).map(trackId => ({
        user_id: userId,
        track_id: trackId,
        created_at: new Date().toISOString(),
      }))
      const { error } = await supabase
        .from('favorites')
        .upsert(rows, { onConflict: 'user_id,track_id' })
      if (error) {
        console.error('autoImport:', error.message)
        if (!imported) return { imported: 0, banner: 'Ошибка при импорте избранного' }
        break
      }
      imported += rows.length
    }
  }

  clearGuestFavorites()
  return { imported, banner: '' }
}