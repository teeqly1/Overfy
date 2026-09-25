import React, { useState, useCallback } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import Captcha from '../components/Captcha'

export default function AuthPage() {
  const { user, loading: authLoading, signUp, signIn, signInAsGuest, error, setError } = useAuth()
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [formError, setFormError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [captchaValue, setCaptchaValue] = useState('')
  const [captchaCode, setCaptchaCode] = useState(null)
  const [captchaKey, setCaptchaKey] = useState(0) // смена key перерисовывает капчу
  const [registeredEmail, setRegisteredEmail] = useState(null)

  // Уже вошли — на страницу входа не возвращаем (раньше после входа при любом
  // перезаходе URL /auth снова показывал форму входа)
  if (user && !authLoading) {
    return <Navigate to="/" replace />
  }

  const handleCaptchaCode = useCallback((code) => {
    setCaptchaCode(code)
    setCaptchaValue('')
  }, [])

  const refreshCaptcha = () => setCaptchaKey(k => k + 1)

  const checkCaptcha = () => {
    if (!captchaCode || captchaValue.trim().toUpperCase() !== captchaCode) {
      setFormError('Введите символы с картинки (5 символов)')
      refreshCaptcha()
      return false
    }
    return true
  }

  const validatePassword = (pass) => {
    if (pass.length < 6) return 'Пароль должен быть не короче 6 символов'
    if (!/[a-zA-Zа-яА-Я]/.test(pass) || !/\d/.test(pass)) return 'Пароль должен содержать буквы и цифры'
    return null
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setFormError(null)
    setError(null)

    if (!checkCaptcha()) return

    if (mode === 'register') {
      const passError = validatePassword(password)
      if (passError) {
        setFormError(passError)
        return
      }
      if (password !== confirmPassword) {
        setFormError('Пароли не совпадают')
        return
      }
      if (!email || !email.includes('@')) {
        setFormError('Введите корректный email')
        return
      }
      setLoading(true)
      try {
        const res = await signUp(email, password)
        if (res && res.emailConfirm) {
          // Email-подтверждение включено → показываем экран «Проверьте почту»
          setRegisteredEmail(email)
        }
      } catch (err) {
        setFormError(err.message === 'Failed to fetch'
          ? 'Нет связи с сервером авторизации. Проверьте интернет и перезапустите приложение'
          : (err.message || 'Ошибка регистрации'))
        refreshCaptcha()
      } finally {
        setLoading(false)
      }
    } else {
      if (!email || !password) {
        setFormError('Введите email и пароль')
        return
      }
      setLoading(true)
      try {
        await signIn(email, password)
      } catch (err) {
        setFormError(err.message === 'Failed to fetch'
          ? 'Нет связи с сервером авторизации. Проверьте интернет и перезапустите приложение'
          : (err.message || 'Ошибка входа'))
        refreshCaptcha()
      } finally {
        setLoading(false)
      }
    }
  }

  const switchMode = () => {
    setMode(mode === 'login' ? 'register' : 'login')
    setFormError(null)
    setError(null)
    setRegisteredEmail(null)
    refreshCaptcha()
  }

  // --- Экран после регистрации: сообщаем «проверьте почту» ---
  if (registeredEmail) {
    return (
      <div className="screen auth-screen">
        <div className="auth-orb"></div>
        <div className="auth-orb orb2"></div>
        <div className="auth-card">
          <div className="auth-logo">
            <svg width="52" height="52" viewBox="0 0 100 100" fill="none">
              <circle cx="50" cy="50" r="47" stroke="white" strokeWidth="2"/>
              <path d="M30 62 Q40 30 50 52 Q60 74 70 42" stroke="white" strokeWidth="3" strokeLinecap="round" fill="none"/>
              <path d="M30 50 Q45 18 55 46 Q65 68 74 36" stroke="white" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.4"/>
            </svg>
            <span>Overfy</span>
          </div>

          <h1 className="auth-title">Почти готово</h1>
          <p className="auth-subtitle">
            На <strong>{registeredEmail}</strong> отправлено письмо с подтверждением.
            Откройте ссылку из письма, затем войдите в аккаунт.
          </p>

          <div className="auth-email-note">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4Z"/>
            </svg>
            <span>Если письма нет — проверьте папку «Спам»</span>
          </div>

          <button className="btn btn-primary" onClick={switchMode}>
            Войти
          </button>
          <button className="btn btn-ghost" onClick={signInAsGuest}>
            Войти как гость
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="screen auth-screen">
      <div className="auth-orb"></div>
      <div className="auth-orb orb2"></div>

      <div className="auth-card">
        <div className="auth-logo">
          <svg width="52" height="52" viewBox="0 0 100 100" fill="none">
            <circle cx="50" cy="50" r="47" stroke="white" strokeWidth="2"/>
            <path d="M30 62 Q40 30 50 52 Q60 74 70 42" stroke="white" strokeWidth="3" strokeLinecap="round" fill="none"/>
            <path d="M30 50 Q45 18 55 46 Q65 68 74 36" stroke="white" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.4"/>
          </svg>
          <span>Overfy</span>
        </div>

        <h1 className="auth-title">
          {mode === 'login' ? 'С возвращением' : 'Создайте аккаунт'}
        </h1>
        <p className="auth-subtitle">
          {mode === 'login'
            ? 'Войдите, чтобы продолжить слушать музыку'
            : 'Зарегистрируйтесь, чтобы получить доступ ко всей музыке'}
        </p>

        {(formError || error) && (
          <div className="form-error">{formError || error}</div>
        )}

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="form-group">
            <label>Почта</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </div>

          <div className="form-group">
            <label>Пароль</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
            {mode === 'register' && (
              <small className="form-hint">Минимум 6 символов, буквы и цифры</small>
            )}
          </div>

          {mode === 'register' && (
            <div className="form-group">
              <label>Подтверждение пароля</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
              />
            </div>
          )}

          <div className="form-group">
            <label>Проверка: введите 5 символов с картинки</label>
            <Captcha key={captchaKey} onCode={handleCaptchaCode} />
            <input
              type="text"
              value={captchaValue}
              onChange={(e) => setCaptchaValue(e.target.value)}
              placeholder="A1B2C"
              maxLength={5}
              autoComplete="off"
              className="captcha-input"
            />
          </div>

          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading
              ? 'Пожалуйста, подождите...'
              : mode === 'login' ? 'Войти' : 'Зарегистрироваться'}
          </button>
        </form>

        <button className="btn btn-ghost" onClick={signInAsGuest}>
          Войти как гость
        </button>

        <p className="auth-switch">
          {mode === 'login' ? 'Нет аккаунта?' : 'Уже есть аккаунт?'}{' '}
          <span onClick={switchMode} className="auth-switch-link">
            {mode === 'login' ? 'Зарегистрироваться' : 'Войти'}
          </span>
        </p>
      </div>
    </div>
  )
}
