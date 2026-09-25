import React from 'react'

// Бейджи профиля: верификация, поддержка, разработчик.
// Показываются рядом с никнеймом везде, где есть profile.
export default function UserBadges({ profile, size = 16 }) {
  if (!profile) return null
  const badges = []
  if (profile.is_developer) {
    badges.push(
      <span key="dev" className="user-badge badge-developer" data-tooltip="Разработчик">
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        </svg>
      </span>
    )
  }
  if (profile.is_verified) {
    badges.push(
      <span key="vrf" className="user-badge badge-verified" data-tooltip="Верифицированный аккаунт">
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      </span>
    )
  }
  if (profile.is_supporter) {
    badges.push(
      <span key="sup" className="user-badge badge-supporter" data-tooltip="Поддержал проект">
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <path d="M8 14s1.5 2 4 2 4-2 4-2"/>
          <line x1="9" y1="9" x2="9.01" y2="9"/>
          <line x1="15" y1="9" x2="15.01" y2="9"/>
        </svg>
      </span>
    )
  }
  if (badges.length === 0) return null
  return <span className="user-badges">{badges}</span>
}
