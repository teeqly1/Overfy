import React from 'react'
import { usePlayer } from '../contexts/PlayerContext'
import navItems, { profileNavItem } from './navItems'

// Навигация: на десктопе — колонка слева, на узких экранах (<=900px)
// заменяется бургер-меню (MobileMenu).
export default function SideNav({ view, onNavigate, marketEnabled = true, roomsEnabled = true }) {
  const { favorites, history } = usePlayer()

  const getBadge = (id) => {
    if (id === 'favorites' && favorites.length > 0) return favorites.length
    if (id === 'home' && history.length >= 5) return 1
    return null
  }

  const visibleItems = navItems.filter(item => {
    if (item.id === 'market' && !marketEnabled) return false
    if (item.id === 'rooms' && !roomsEnabled) return false
    return true
  })

  return (
    <nav className="side-nav">
      <button className="side-logo" onClick={() => onNavigate('home')} title="На главную">
        Overfy
      </button>
      <div className="side-nav-items">
        {visibleItems.map(item => {
          const active = view === item.id
          return (
            <button
              key={item.id}
              className={`nav-item ${active ? 'active' : ''}`}
              onClick={() => onNavigate(item.id)}
            >
              <span className="nav-icon-wrap">
                {item.icon}
                {getBadge(item.id) && <span className="nav-badge">{getBadge(item.id)}</span>}
              </span>
              <span className="nav-label">{item.label}</span>
            </button>
          )
        })}
      </div>
      {/* Кнопка профиля: в десктопе — внизу колонки, на мобильных — в нижней панели */}
      <button
        className={`nav-item nav-item-profile ${view === 'profile' ? 'active' : ''}`}
        onClick={() => onNavigate('profile')}
        title="Профиль"
      >
        <span className="nav-icon-wrap">
          {profileNavItem.icon}
        </span>
        <span className="nav-label">Профиль</span>
      </button>
    </nav>
  )
}
