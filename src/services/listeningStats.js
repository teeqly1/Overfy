// Анализ статистики прослушиваний: художники, треки, длительность
// за периоды: неделя, месяц, год

import { supabase, isDbEnabled } from './supabase'
import { getRemoteTracks, isRemoteTrackId } from './remoteTracks'

// Получить данные прослушивания с облака для указанного периода
async function getListeningDataForPeriod(userId, days) {
  if (!isDbEnabled()) return []
  
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - days)
  
  const { data, error } = await supabase
    .from('play_history')
    .select('track_id, listened_at')
    .eq('user_id', userId)
    .gte('listened_at', startDate.toISOString())
    .order('listened_at', { ascending: false })
  
  if (error) {
    console.error('Error fetching listening data:', error)
    return []
  }
  
  return data || []
}

// Получить информацию о треке (из кэша удалённых треков)
function getTrackInfo(trackId) {
  const remote = getRemoteTracks([trackId])
  return remote[0] || { id: trackId, name: 'Неизвестный трек', artist_name: 'Неизвестный артист', duration: 0 }
}

// Анализ: агрегирование по художникам
export async function analyzeListeningStats(userId, days = 7) {
  const data = await getListeningDataForPeriod(userId, days)
  
  if (!data.length) {
    return { artists: [], totalTracks: 0, totalHours: 0 }
  }
  
  const artistMap = new Map()
  let totalSeconds = 0
  
  for (const item of data) {
    const track = getTrackInfo(item.track_id)
    const artistName = track.artist_name || 'Неизвестный артист'
    
    if (!artistMap.has(artistName)) {
      artistMap.set(artistName, {
        name: artistName,
        trackCount: 0,
        seconds: 0,
        tracks: []
      })
    }
    
    const artist = artistMap.get(artistName)
    artist.trackCount++
    artist.seconds += track.duration || 0
    totalSeconds += track.duration || 0
    
    // Сохраняем информацию о треке (для показа в UI)
    if (!artist.tracks.find(t => t.id === track.id)) {
      artist.tracks.push({
        id: track.id,
        name: track.name,
        duration: track.duration || 0,
        image: track.image || null
      })
    }
  }
  
  // Сортируем художников по количеству треков (убывание)
  const artists = Array.from(artistMap.values())
    .sort((a, b) => b.trackCount - a.trackCount)
    .map(a => ({
      ...a,
      hours: Math.round(a.seconds / 3600 * 10) / 10, // Округляем до 0.1 часа
      minutes: Math.round(a.seconds / 60)
    }))
  
  return {
    artists,
    totalTracks: data.length,
    totalSeconds,
    totalHours: Math.round(totalSeconds / 3600 * 10) / 10,
    totalMinutes: Math.round(totalSeconds / 60)
  }
}

// Форматирование времени для отображения
export function formatListeningTime(seconds) {
  if (seconds < 60) return `${seconds}с`
  if (seconds < 3600) return `${Math.round(seconds / 60)}м`
  const hours = Math.round(seconds / 3600 * 10) / 10
  return `${hours}ч`
}
