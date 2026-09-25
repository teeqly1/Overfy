import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { supabase, isSupabaseConfigured } from '../services/supabase'
import { ensureProfileForUser } from '../services/profile'

const AuthContext = createContext()

const GUEST_USER_KEY = 'overfy_guest_user'

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [isGuest, setIsGuest] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Метка «вход уже произошёл»: ограждает свежую сессию от запаздывающего
  // getSession()/событий auth с пустой сессией (иначе вход «откатывался»).
  const authEstablishedRef = useRef(false)

  useEffect(() => {
    // Гость — fallback, когда Supabase не настроен или недоступен
    const applyGuestFallback = () => {
      try {
        const guestData = localStorage.getItem(GUEST_USER_KEY)
        if (guestData) {
          setUser(JSON.parse(guestData))
          setIsGuest(true)
        }
      } catch {
        localStorage.removeItem(GUEST_USER_KEY)
      }
    }

    if (!isSupabaseConfigured()) {
      applyGuestFallback()
      setLoading(false)
      return
    }

    let cancelled = false

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (cancelled || authEstablishedRef.current) return
        if (data.session) {
          authEstablishedRef.current = true
          setUser(data.session.user)
          setIsGuest(false)
        } else {
          applyGuestFallback()
        }
        setLoading(false)
      })
      .catch(() => {
        // Сеть/сервис недоступен — не вешаем приложение, пускаем как гостя
        if (cancelled || authEstablishedRef.current) return
        applyGuestFallback()
        setLoading(false)
      })

    let listener = null
    try {
      listener = supabase.auth.onAuthStateChange((event, session) => {
        if (session) {
          authEstablishedRef.current = true
          setUser(session.user)
          setIsGuest(false)
        } else {
          // Пустое событие не должно сбрасывать уже выполненный вход/восстановление
          if (authEstablishedRef.current) return
          if (localStorage.getItem(GUEST_USER_KEY)) {
            try {
              setUser(JSON.parse(localStorage.getItem(GUEST_USER_KEY)))
              setIsGuest(true)
            } catch {
              setUser(null)
              setIsGuest(false)
            }
          } else {
            setUser(null)
            setIsGuest(false)
          }
        }
      })
    } catch {
      // Подписка недоступна — обойдёмся текущей сессией
    }

    // Watchdog: даже при зависшем запросе приложение не останется на спиннере
    const watchdog = setTimeout(() => {
      if (!cancelled) setLoading(false)
    }, 8000)

    return () => {
      cancelled = true
      clearTimeout(watchdog)
      listener?.subscription.unsubscribe()
    }
  }, [])

  const signUp = useCallback(async (email, password) => {
    setError(null)
    if (!isSupabaseConfigured()) {
      setError('Supabase не настроен. Добавьте ключи в .env файл.')
      throw new Error('Supabase not configured')
    }
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) throw error
    // По умолчанию в Supabase включено подтверждение почты: в ответе нет
    // ни user, ни session. Возвращаем флаг — AuthPage покажет «проверьте почту».
    const emailConfirm = !data.session
    if (data.session) {
      authEstablishedRef.current = true
      setUser(data.session.user)
      setIsGuest(false)
      localStorage.removeItem(GUEST_USER_KEY)
    }
    if (data.user && isSupabaseConfigured()) {
      // Создаём профиль сразу при регистрации, чтобы ни FK, ни NOT NULL в
      // таблице profiles не падали (иначе профиль появлялся только при
      // первом заходе в «Профиль»).
      try {
        await ensureProfileForUser(data.user.id, data.user.email)
      } catch (e) {
        console.error('Не удалось создать профиль:', e)
      }
    }
    return { user: data.user || null, emailConfirm }
  }, [])

  const signIn = useCallback(async (email, password) => {
    setError(null)
    if (!isSupabaseConfigured()) {
      setError('Supabase не настроен. Добавьте ключи в .env файл.')
      throw new Error('Supabase not configured')
    }
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    authEstablishedRef.current = true
    setUser(data.user)
    setIsGuest(false)
    localStorage.removeItem(GUEST_USER_KEY)
    return data.user
  }, [])

  const signInAsGuest = useCallback(() => {
    setError(null)
    authEstablishedRef.current = true
    const guest = {
      id: 'guest-' + Math.random().toString(36).substr(2, 9),
      email: 'guest@overfy.app',
      user_metadata: { full_name: 'Гость' }
    }
    localStorage.setItem(GUEST_USER_KEY, JSON.stringify(guest))
    setUser(guest)
    setIsGuest(true)
  }, [])

  const signOut = useCallback(async () => {
    localStorage.removeItem(GUEST_USER_KEY)
    authEstablishedRef.current = false
    if (isSupabaseConfigured()) {
      await supabase.auth.signOut()
    }
    setUser(null)
    setIsGuest(false)
  }, [])

  const value = {
    user,
    isGuest,
    loading,
    error,
    setError,
    signUp,
    signIn,
    signInAsGuest,
    signOut
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
