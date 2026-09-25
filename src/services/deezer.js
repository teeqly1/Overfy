// Слой Deezer: публичное API api.deezer.com без ключей, через Rust-бэкенд.
// Воспроизведение — официальный 30-секундный превью-фрагмент трека.

import { tauriInvoke } from './tauriBridge'
import { rememberRemoteTrack } from './remoteTracks'

export function isDzTrackId(id) {
  return typeof id === 'string' && id.startsWith('dz_')
}

export function normalizeDzTrack(t) {
  return {
    id: `dz_${t.id}`,
    name: t.title || 'Без названия',
    artist_name: t.artist || '',
    duration: t.duration_sec || 0,
    image: t.cover_medium || t.cover_big || null,
    _artworkRaw: t.cover_big || t.cover_medium || null,
    audio: t.preview || null,
    album_name: null,
    permalink_url: t.link || null,
    musicinfo: { tags: { genres: [], instruments: [], vartags: [] } },
    source: 'dz',
  }
}

export async function dzSearchTracks(query, limit = 25) {
  if (!query.trim()) return []
  const tracks = await tauriInvoke('deezer_search', { q: query, limit })
  if (!Array.isArray(tracks)) return []
  return tracks.map(normalizeDzTrack).filter(t => t.audio)
}

export async function dzSearchArtists(query, limit = 20) {
  if (!query.trim()) return []
  const users = await tauriInvoke('deezer_search_artists', { q: query, limit })
  if (!Array.isArray(users)) return []
  return users.map(u => ({
    id: u.id,
    username: u.name,
    avatar_url: u.picture_medium || null,
    followers_count: u.nb_fan || 0,
    track_count: u.nb_album || 0,
    verified: false,
    permalink_url: u.link || null,
  }))
}

export async function dzSearchPlaylists(query, limit = 15) {
  if (!query.trim()) return []
  const pls = await tauriInvoke('deezer_search_playlists', { q: query, limit })
  if (!Array.isArray(pls)) return []
  return pls.map(p => ({
    id: p.id,
    title: p.title,
    artwork_url: p.cover_medium || p.cover_big || null,
    _artworkRaw: p.cover_big || p.cover_medium || null,
    username: p.user_name || '',
    track_count: p.nb_tracks || 0,
    permalink_url: p.link || null,
  }))
}

export async function dzArtistTracks(artistId, limit = 20) {
  const tracks = await tauriInvoke('deezer_artist_tracks', { artistId, limit })
  if (!Array.isArray(tracks)) return []
  return tracks.map(normalizeDzTrack).filter(t => t.audio)
}

export async function dzPlaylistTracks(playlistId) {
  const tracks = await tauriInvoke('deezer_playlist_tracks', { playlistId })
  if (!Array.isArray(tracks)) return []
  return tracks.map(normalizeDzTrack).filter(t => t.audio)
}

// Свежая превью-ссылка при ошибке воспроизведения (подписанные URL устаревают)
export async function refreshDzStreamUrl(dzId) {
  if (!isDzTrackId(dzId)) return null
  const id = Number(dzId.slice(3))
  if (!Number.isFinite(id)) return null
  const url = await tauriInvoke('deezer_track_stream', { id })
  if (url) {
    rememberRemoteTrack({ id: dzId, audio: url, source: 'dz' })
  }
  return url || null
}
