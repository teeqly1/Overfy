// Баннеры оформления: выбор на «Маркете», применение к профилю и плееру.
// Готовые баннеры — статичные пресеты с цветом; кастомные — data URL из localStorage.

export const BANNER_PRESETS = [
  { id: 'default', label: 'Стандартный', color: '#1a1a1a' },
  { id: 'ocean', label: 'Океан', color: '#0a2540' },
  { id: 'sunset', label: 'Закат', color: '#3d1a00' },
  { id: 'forest', label: 'Лес', color: '#0a2a10' },
  { id: 'neon', label: 'Неон', color: '#1a0a30' },
  { id: 'rose', label: 'Роза', color: '#2a0a1a' },
]

const SELECTED_KEY = 'overfy_selected_banner'
const CUSTOM_KEY = 'overfy_market_banners'

export function getSelectedBannerId() {
  try {
    return localStorage.getItem(SELECTED_KEY) || null
  } catch {
    return null
  }
}

export function setSelectedBannerId(id) {
  try {
    localStorage.setItem(SELECTED_KEY, id)
  } catch {
    // localStorage недоступен — запомним только в памяти
  }
  window.dispatchEvent(new CustomEvent('overfy-banner-changed'))
}

export function getCustomBanners() {
  try {
    return JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]')
  } catch {
    return []
  }
}

// Возвращает параметры отрисовки выбранного баннера { color, image }.
// null — «Стандартный» (баннер не показываем).
export function resolveBanner(id) {
  if (!id || id === 'default') return null
  const preset = BANNER_PRESETS.find(p => p.id === id)
  if (preset) return { color: preset.color, image: null }
  const custom = getCustomBanners().find(b => b.id === id)
  if (custom?.image) return { color: null, image: custom.image }
  return null
}