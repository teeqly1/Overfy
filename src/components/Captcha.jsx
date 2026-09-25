import React, { useState, useEffect, useRef, useCallback } from 'react'

// Простая локальная капча: 5 символов на canvas с шумом.
// Проверка — на стороне формы (сравнение без учёта регистра).
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // без 0/O/1/I
const LENGTH = 5

function randomCode() {
  let s = ''
  for (let i = 0; i < LENGTH; i++) {
    s += CHARS[Math.floor(Math.random() * CHARS.length)]
  }
  return s
}

// value/onChange: форма хранит ввод пользователя;
// onCode(code): сообщает форме актуальный код для сверки.
export default function Captcha({ onCode }) {
  const canvasRef = useRef(null)
  const [code, setCode] = useState(randomCode)

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const w = canvas.width
    const h = canvas.height

    // Фон
    ctx.fillStyle = '#101014'
    ctx.fillRect(0, 0, w, h)

    // Шумовые линии
    for (let i = 0; i < 5; i++) {
      ctx.strokeStyle = `rgba(255,255,255,${0.06 + Math.random() * 0.1})`
      ctx.beginPath()
      ctx.moveTo(Math.random() * w, Math.random() * h)
      ctx.bezierCurveTo(
        Math.random() * w, Math.random() * h,
        Math.random() * w, Math.random() * h,
        Math.random() * w, Math.random() * h
      )
      ctx.stroke()
    }

    // Точки
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.05 + Math.random() * 0.15})`
      ctx.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5)
    }

    // Символы с наклоном
    const slot = (w - 20) / LENGTH
    for (let i = 0; i < code.length; i++) {
      ctx.save()
      const x = 14 + slot * i + slot / 2
      const y = h / 2
      ctx.translate(x, y)
      ctx.rotate((Math.random() - 0.5) * 0.55)
      const size = 24 + Math.random() * 6
      ctx.font = `bold ${size}px Arial, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const light = 180 + Math.floor(Math.random() * 60)
      ctx.fillStyle = `rgb(${light},${light},${light})`
      ctx.fillText(code[i], 0, 0)
      ctx.restore()
    }
  }, [code])

  useEffect(() => {
    draw()
    onCode?.(code)
  }, [draw, onCode])

  const refresh = () => {
    setCode(randomCode())
  }

  return (
    <div className="captcha-row">
      <canvas
        ref={canvasRef}
        width="160"
        height="48"
        className="captcha-canvas"
        onClick={refresh}
        title="Нажмите, чтобы обновить"
      />
      <button type="button" className="captcha-refresh" onClick={refresh} title="Обновить картинку">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="23 4 23 10 17 10"/>
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
        </svg>
      </button>
    </div>
  )
}
