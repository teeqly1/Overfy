import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { refreshDbStatus, getDbStatus } from '../services/supabase'

const DbStatusContext = createContext()

// Статус доступности БД (app_settings.db_enabled). Полл каждые 30 секунд + при старте.
// Когда БД закрыта — приложение показывает причину, но SoundCloud/Deezer/Яндекс
// продолжают работать, а запросы к нашим таблицам приостанавливаются.
export function DbStatusProvider({ children }) {
  const [status, setStatus] = useState(getDbStatus)

  const poll = useCallback(async () => {
    const s = await refreshDbStatus()
    setStatus({ ...s })
  }, [])

  useEffect(() => {
    poll()
    // Перечитываем статус, когда вкладка снова видна
    const onVisible = () => { if (!document.hidden) poll() }
    document.addEventListener('visibilitychange', onVisible)
    const id = setInterval(poll, 30_000)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(id)
    }
  }, [poll])

  const value = {
    dbEnabled: status.enabled,
    dbReason: status.reason,
    marketEnabled: status.marketEnabled,
    roomsEnabled: status.roomsEnabled,
  }

  return <DbStatusContext.Provider value={value}>{children}</DbStatusContext.Provider>
}

export function useDbStatus() {
  const ctx = useContext(DbStatusContext)
  if (!ctx) throw new Error('useDbStatus must be used within DbStatusProvider')
  return ctx
}
