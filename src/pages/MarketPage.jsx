import React, { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { usePlayer } from '../contexts/PlayerContext'
import { formatDuration } from '../services/format'
import { handleCoverError } from '../services/soundcloud'
import { getRemoteTracks, isRemoteTrackId } from '../services/remoteTracks'
import { supabase, isDbEnabled } from '../services/supabase'
import { BANNER_PRESETS, getCustomBanners, getSelectedBannerId, setSelectedBannerId } from '../services/banners'

const BANNER_MAX_BYTES = 2 * 1024 * 1024

export default function MarketPage({ onNavigate }) {
  const { user, isGuest } = useAuth()
  const { favorites, playTrack } = usePlayer()
  const [banners, setBanners] = useState([])
  const [selectedBanner, setSelectedBanner] = useState(() => getSelectedBannerId())
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)

  const flash = (msg) => { setNotice(msg); setTimeout(() => setNotice(''), 2500) }

  useEffect(() => {
    loadBanners()
  }, [user, isGuest])

  const loadBanners = async () => {
    setLoading(true)
    // Локальные кастомные баннеры хранятся на устройстве отдельно от базы —
    // их нужно показывать всегда, даже если облачный запрос упал.
    let savedCustom = getCustomBanners()

    let remote = []
    if (!isGuest && user && isDbEnabled()) {
      try {
        const { data, error } = await supabase
          .from('market_items')
          .select('*')
          .eq('type', 'banner')
          .order('created_at', { ascending: false })
        if (!error) remote = data || []
      } catch {
        remote = []
      }
    }

    // Дубли по id (облачный и локальный баннер с одним id) не добавляем
    const seen = new Set()
    setBanners([...remote, ...savedCustom].filter(b => {
      if (seen.has(b.id)) return false
      seen.add(b.id)
      return true
    }))
    setLoading(false)
  }

  const selectBanner = (item) => {
    setSelectedBanner(item.id)
    setSelectedBannerId(item.id)
    flash('Баннер «' + item.name + '» выбран!')
  }

  const handleBuyBanner = (item) => {
    if (isGuest) {
      flash('Войдите, чтобы выбирать баннеры')
      return
    }
    selectBanner(item)
  }

  const handleCustomBanner = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > BANNER_MAX_BYTES) {
      flash('Файл больше 2 МБ')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const saved = getCustomBanners()
        const custom = {
          id: 'custom_' + Date.now(),
          name: file.name.replace(/\.[^.]+$/, ''),
          type: 'banner',
          image: reader.result,
          custom: true,
        }
        saved.push(custom)
        localStorage.setItem('overfy_market_banners', JSON.stringify(saved))
        setBanners(prev => [...prev, custom])
        flash('Баннер добавлен')
      } catch {
        flash('Ошибка сохранения')
      }
    }
    reader.readAsDataURL(file)
  }

  return (
    <div className="screen market-screen">
      <div className="market-head">
        <h2 className="screen-title">Маркет</h2>
      </div>
      <p className="empty-hint" style={{ marginBottom: 20 }}>
        Баннеры для оформления вашего профиля и плеера
      </p>

      {notice && <div className="pl-notice">{notice}</div>}

      <section className="market-section">
        <h3 className="settings-group-title">Готовые баннеры</h3>
        <div className="market-grid">
          {BANNER_PRESETS.map(banner => (
            <div
              key={banner.id}
              className={`market-card ${selectedBanner === banner.id ? 'active' : ''}`}
              onClick={() => handleBuyBanner(banner)}
            >
              <div
                className="market-card-banner"
                style={{ background: banner.color }}
              >
                <span className="market-card-preview">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5">
                    <rect x="3" y="3" width="18" height="18" rx="2"/>
                    <circle cx="8.5" cy="8.5" r="1.5"/>
                    <polyline points="21 15 16 10 5 21"/>
                  </svg>
                </span>
              </div>
              <span className="market-card-name">{banner.label}</span>
              <span className="market-card-price">Бесплатно</span>
            </div>
          ))}
        </div>
      </section>

      <section className="market-section">
        <h3 className="settings-group-title">Загрузить свой баннер</h3>
        <div className="market-upload-row">
          <label className="btn btn-sm btn-outline">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            Загрузить файл
            <input type="file" accept="image/*" hidden onChange={handleCustomBanner} />
          </label>
          <span className="empty-hint">JPG, PNG, GIF — до 2 МБ</span>
        </div>
      </section>

      <section className="market-section">
        <h3 className="settings-group-title">Мои баннеры</h3>
        {banners.length === 0 ? (
          <p className="empty-hint">Пока нет баннеров. Купите или загрузите свой выше.</p>
        ) : (
          <div className="market-grid">
            {banners.map(banner => (
              <div
                key={banner.id}
                className={`market-card ${selectedBanner === banner.id ? 'active' : ''}`}
                onClick={() => handleBuyBanner(banner)}
              >
                <div className="market-card-banner">
                  {banner.image ? (
                    <img src={banner.image} alt="" className="market-card-img" />
                  ) : (
                    <span className="market-card-preview">
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5">
                        <rect x="3" y="3" width="18" height="18" rx="2"/>
                      </svg>
                    </span>
                  )}
                </div>
                <span className="market-card-name">{banner.name}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
