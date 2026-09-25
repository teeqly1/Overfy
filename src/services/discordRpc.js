// Discord Rich Presence: статус «слушает» в Discord.
// Для работы нужен Client ID вашего приложения на discord.com/developers.
// Пока ID не вписан — фича безопасно отключена.

import { tauriInvoke, isDesktop } from './tauriBridge'

// TODO: впишите сюда Client ID вашего Discord-приложения
// (Applications → New Application → General Information → Application ID).
const DISCORD_CLIENT_ID = 'YOUR_CLIENT_ID'

let connected = false

export function discordClientId() {
  return DISCORD_CLIENT_ID
}

export function discordConfigured() {
  return isDesktop() && DISCORD_CLIENT_ID && !DISCORD_CLIENT_ID.includes('YOUR_CLIENT_ID')
}

// Подключение к Discord IPC (требуется запущенный клиент Discord).
export async function discordConnect() {
  try {
    connected = await tauriInvoke('discord_rpc_connect', { clientId: DISCORD_CLIENT_ID })
    return connected === true
  } catch {
    connected = false
    return false
  }
}

// Обновление активности. track: { name?, artist_name? }, playing: bool.
// При паузе останавливаем таймер, но держим трек в статусе.
export async function discordSetActivity(track, playing) {
  if (!discordConfigured()) return false
  const name = track?.name || ''
  const artist = track?.artist_name || ''
  if (!name && !artist) return disconnect()
  try {
    const ok = await tauriInvoke('discord_rpc_set_activity', {
      payload: {
        details: name,
        state: artist ? `${artist} ${playing ? '— играет' : '— на паузе'}` : playing ? 'Играет' : 'На паузе',
        largeText: 'Overfy',
        smallText: playing ? 'Воспроизведение' : 'Пауза',
        playing,
        startedAtMs: playing ? Date.now() : null,
      },
    })
    if (ok === false && !connected) {
      // Клиент ещё не подключён или Discord перезапущен — пробуем переподключиться один раз.
      await discordConnect()
      if (connected) await discordSetActivity(track, playing)
    }
    return ok === true
  } catch {
    connected = false
    return false
  }
}

// Отключение: очищает активность в Discord.
export async function discordDisconnect() {
  try {
    await tauriInvoke('discord_rpc_disconnect')
  } catch { /* не критично */ }
  connected = false
}