import React, { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { loadSettings, saveSettings, DEFAULT_SETTINGS, ACCENT_COLOR_OPTIONS } from '../services/settings'

const SettingsContext = createContext(null)

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(loadSettings)

  const update = useCallback((patch) => {
    setSettings(prev => {
      const next = { ...prev, ...patch }
      saveSettings(next)
      return next
    })
  }, [])

  const reset = useCallback(() => {
    const next = { ...DEFAULT_SETTINGS }
    setSettings(next)
    saveSettings(next)
  }, [])

  // Акцентный цвет темы через CSS-переменную --accent
  useEffect(() => {
    const accent = ACCENT_COLOR_OPTIONS.find(a => a.id === settings.accentColor)
    document.documentElement.style.setProperty('--accent', accent?.color || '#ffffff')
  }, [settings.accentColor])

  // Режим интерфейса: data-атрибут на <html>, по нему CSS включает/выключает эффекты
  useEffect(() => {
    document.documentElement.dataset.uiMode = settings.uiMode || 'normal'
  }, [settings.uiMode])

  // Тема оформления: data-атрибут на <html>, CSS переопределяет переменные цветов
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme || 'dark'
  }, [settings.theme])

  // OMD (Overfy Minimal Design): data-атрибут для упрощённого дизайна
  useEffect(() => {
    document.documentElement.dataset.omd = settings.omd ? 'on' : 'off'
  }, [settings.omd])

  // Меньше движения: data-атрибут, по нему CSS гасит анимации (в т.ч. переливающийся ник)
  useEffect(() => {
    document.documentElement.dataset.reduceMotion = settings.reduceMotion ? 'on' : 'off'
  }, [settings.reduceMotion])

  return (
    <SettingsContext.Provider value={{ settings, update, reset }}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings() {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider')
  return ctx
}
