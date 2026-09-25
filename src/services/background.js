// Фон приложения: фото/GIF. Хранится только локально (в localStorage),
// в Supabase НЕ синхронизируется — по решению пользователя.

const BG_KEY = 'overfy_bg'

export const BG_MAX_BYTES = 4 * 1024 * 1024 // 4 МБ — лимит localStorage

export function getBackground() {
  try {
    const raw = localStorage.getItem(BG_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function apply(patch) {
  const next = { ...getBackground(), ...patch }
  try { localStorage.setItem(BG_KEY, JSON.stringify(next)) } catch {
    // переполнение — фон не сохранится до перезапуска
  }
  window.dispatchEvent(new CustomEvent('overfy-bg-changed'))
}

export function setBackgroundImage(dataUrl) {
  apply({ img: dataUrl })
}

export function setBackgroundDim(dim) {
  apply({ dim })
}

export function setBackgroundBlur(blur) {
  apply({ blur })
}

export function clearBackground() {
  try { localStorage.removeItem(BG_KEY) } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent('overfy-bg-changed'))
}
