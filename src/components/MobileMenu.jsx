import React, { useEffect } from 'react'
import { usePlayer } from '../contexts/PlayerContext'
import navItems, { profileNavItem } from './navItems'

// Бургер-меню для мобильной (APK) сборки: кнопка-гамбургер сверху слева,
// при нажатии слева выезжает шторка меню со всем функционалом.
export default function MobileMenu({ view, onNavigate, marketEnabled = true, roomsEnabled = true }) {
  const { favorites, history } = usePlayer()
  const [open, setOpen] = React.useState(false)

  const getBadge = (id) => {
    if (id === 'favorites' && favorites.length > 0) return favorites.length
    if (id === 'home' && history.length >= 5) return 1
    return null
  }

  const go = (id) => {
    setOpen(false)
    onNavigate(id)
  }

  const visibleItems = navItems.filter(item => {
    if (item.id === 'market' && !marketEnabled) return false
    if (item.id === 'rooms' && !roomsEnabled) return false
    return true
  })

  useEffect(() => {
    if (!open) return
    let popped = false
    function close() { popped = true; setOpen(false) }
    const h = (e) => { if (e.key === 'Escape') close() }
    // Android: системная кнопка «назад» закрывает шторку (через popstate)
    window.history.pushState({ overfyBurger: true }, '')
    window.addEventListener('keydown', h)
    window.addEventListener('popstate', close)
    return () => {
      window.removeEventListener('keydown', h)
      window.removeEventListener('popstate', close)
      if (!popped) window.history.back()
    }
  }, [open])

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  return (
    <>
      <header className="burger-bar">
        <button
          className="burger-btn"
          onClick={() => setOpen(true)}
          aria-label="Открыть меню"
          aria-expanded={open}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <line x1="3" y1="6" x2="21" y2="6"/>
            <line x1="3" y1="12" x2="21" y2="12"/>
            <line x1="3" y1="18" x2="21" y2="18"/>
          </svg>
        </button>
        <span className="burger-brand" onClick={() => go('home')}>Overfy</span>
      </header>

      <div className={`burger-drawer-overlay ${open ? 'open' : ''}`} onClick={() => setOpen(false)} />

      <aside className={`burger-drawer ${open ? 'open' : ''}`} aria-hidden={!open}>
        <div className="burger-drawer-head">
          <button
            className="burger-drawer-close"
            onClick={() => setOpen(false)}
            aria-label="Закрыть меню"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className="burger-drawer-scroll">
          {visibleItems.map(item => {
            const active = view === item.id
            const badge = getBadge(item.id)
            return (
              <button
                key={item.id}
                className={`burger-item ${active ? 'active' : ''}`}
                onClick={() => go(item.id)}
              >
                <span className="burger-icon-wrap">
                  {item.icon}
                  {badge != null && <span className="nav-badge">{badge}</span>}
                </span>
                <span className="burger-label">{item.label}</span>
              </button>
            )
          })}

          <div className="burger-divider" />

          <button
            className={`burger-item ${view === 'profile' ? 'active' : ''}`}
            onClick={() => go('profile')}
          >
            <span className="burger-icon-wrap">{profileNavItem.icon}</span>
            <span className="burger-label">Профиль</span>
          </button>
        </div>
      </aside>
    </>
  )
}
