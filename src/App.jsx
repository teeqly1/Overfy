import React, { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { PlayerProvider, usePlayer } from './contexts/PlayerContext'
import { SettingsProvider, useSettings } from './contexts/SettingsContext'
import { DbStatusProvider, useDbStatus } from './contexts/DbStatusContext'
import AuthPage from './pages/AuthPage'
import HomePage from './pages/HomePage'
import SearchPage from './pages/SearchPage'
import FavoritesPage from './pages/FavoritesPage'
import PlaylistsPage from './pages/PlaylistsPage'
import SettingsPage from './pages/SettingsPage'
import ProfilePage from './pages/ProfilePage'
import UsersPage from './pages/UsersPage'
import MarketPage from './pages/MarketPage'
import RoomsPage from './pages/RoomsPage'
import SideNav from './components/SideNav'
import MobileMenu from './components/MobileMenu'
import PlayerBar from './components/PlayerBar'
import ErrorBoundary from './components/ErrorBoundary'
import Particles from './components/Particles'
import UpdateModal from './components/UpdateModal'
import { getBackground } from './services/background'
import { checkForUpdate } from './services/updates'
import { isMobile } from './services/tauriBridge'

function AppBackground() {
  const [bg, setBg] = useState(getBackground)
  useEffect(() => {
    const handler = () => setBg(getBackground())
    window.addEventListener('overfy-bg-changed', handler)
    return () => window.removeEventListener('overfy-bg-changed', handler)
  }, [])
  if (!bg?.img) return null
  return (
    <div
      className="app-bg"
      style={{
        '--bg-image': `url("${bg.img}")`,
        '--bg-dim': String(bg.dim ?? 0.55),
        '--bg-blur': `${bg.blur ?? 0}px`,
      }}
    />
  )
}

function ProtectedRoutes() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="screen loading-screen">
        <div className="loading-logo">Overfy</div>
        <div className="loading-spinner"></div>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/auth" replace />
  }

  return <AppShell />
}

function DbBanner() {
  const { dbEnabled, dbReason } = useDbStatus()
  if (dbEnabled) return null
  return (
    <div className="db-banner" role="alert">
      <span>База данных закрыта</span>
      {dbReason && <span className="db-banner-reason">— {dbReason}</span>}
      <span className="db-banner-hint">SoundCloud и другие источники работают</span>
    </div>
  )
}

function UpdateChecker() {
  const [update, setUpdate] = useState(null)
  const [dismissed, setDismissed] = useState(false)
  const dismissedRef = React.useRef(false)

  useEffect(() => {
    checkForUpdate().then(u => {
      if (u && !dismissedRef.current) setUpdate(u)
    }).catch(() => {})
  }, [])

  if (!update || dismissed) return null
  return (
    <UpdateModal
      update={update}
      onClose={() => setUpdate(null)}
      onSkip={() => { dismissedRef.current = true; setDismissed(true); setUpdate(null) }}
    />
  )
}

function AppShell() {
  const [view, setView] = useState('home')
  const { currentTrack } = usePlayer()
  const { settings } = useSettings()
  const { marketEnabled, roomsEnabled } = useDbStatus()
  const mobile = isMobile()

  // Помечаем корневой элемент как APK-сборку — по нему CSS включает бургер-меню
  useEffect(() => {
    document.documentElement.dataset.apk = mobile ? 'true' : 'false'
  }, [mobile])

  // Если текущий view скрыт через SQL — переключаем на home
  useEffect(() => {
    if (view === 'market' && !marketEnabled) setView('home')
    if (view === 'rooms' && !roomsEnabled) setView('home')
  }, [view, marketEnabled, roomsEnabled])

  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyK') {
        e.preventDefault()
        setView('search')
        setTimeout(() => window.dispatchEvent(new CustomEvent('overfy:focus-search')), 50)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <div className="app">
      <Particles enabled={settings.particles && !settings.omd} />
      <DbBanner />
      <UpdateChecker />
      <div className="app-content">
        {view === 'home' && <HomePage onNavigate={setView} />}
        {view === 'search' && <SearchPage />}
        {view === 'favorites' && <FavoritesPage />}
        {view === 'playlists' && <PlaylistsPage />}
        {view === 'rooms' && roomsEnabled && <RoomsPage />}
        {view === 'market' && marketEnabled && <MarketPage onNavigate={setView} />}
        {view === 'users' && <UsersPage />}
        {view === 'profile' && <ProfilePage />}
        {view === 'settings' && <SettingsPage />}
      </div>
      {currentTrack && <PlayerBar />}
      {mobile
        ? <MobileMenu view={view} onNavigate={setView} marketEnabled={marketEnabled} roomsEnabled={roomsEnabled} />
        : <SideNav view={view} onNavigate={setView} marketEnabled={marketEnabled} roomsEnabled={roomsEnabled} />}
    </div>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppBackground />
      <SettingsProvider>
        <AuthProvider>
          <DbStatusProvider>
            <PlayerProvider>
              <BrowserRouter>
                <Routes>
                  <Route path="/auth" element={<AuthPage />} />
                  <Route path="*" element={<ProtectedRoutes />} />
                </Routes>
              </BrowserRouter>
            </PlayerProvider>
          </DbStatusProvider>
        </AuthProvider>
      </SettingsProvider>
    </ErrorBoundary>
  )
}
