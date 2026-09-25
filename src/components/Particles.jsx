import React, { useRef, useEffect, useCallback } from 'react'

export default function Particles({ enabled }) {
  const canvasRef = useRef(null)
  const animRef = useRef(null)
  const particlesRef = useRef([])

  const createParticle = useCallback((w, h) => ({
    x: Math.random() * w,
    y: Math.random() * h,
    vx: (Math.random() - 0.5) * 0.3,
    vy: (Math.random() - 0.5) * 0.3,
    r: Math.random() * 2 + 0.5,
    a: Math.random() * 0.4 + 0.1,
  }), [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !enabled) {
      if (animRef.current) cancelAnimationFrame(animRef.current)
      return
    }
    const ctx = canvas.getContext('2d')
    let w, h

    const resize = () => {
      w = window.innerWidth
      h = window.innerHeight
      canvas.width = w
      canvas.height = h
    }
    resize()
    window.addEventListener('resize', resize)

    const count = Math.min(80, Math.floor((w * h) / 18000))
    particlesRef.current = Array.from({ length: count }, () => createParticle(w, h))

    const draw = () => {
      ctx.clearRect(0, 0, w, h)
      const ps = particlesRef.current
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i]
        p.x += p.vx
        p.y += p.vy
        if (p.x < 0) p.x = w
        if (p.x > w) p.x = 0
        if (p.y < 0) p.y = h
        if (p.y > h) p.y = 0

        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(255,255,255,${p.a})`
        ctx.fill()

        for (let j = i + 1; j < ps.length; j++) {
          const q = ps[j]
          const dx = p.x - q.x
          const dy = p.y - q.y
          const dist = dx * dx + dy * dy
          if (dist < 12000) {
            ctx.beginPath()
            ctx.moveTo(p.x, p.y)
            ctx.lineTo(q.x, q.y)
            ctx.strokeStyle = `rgba(255,255,255,${0.06 * (1 - dist / 12000)})`
            ctx.lineWidth = 0.5
            ctx.stroke()
          }
        }
      }
      animRef.current = requestAnimationFrame(draw)
    }
    draw()

    return () => {
      window.removeEventListener('resize', resize)
      if (animRef.current) cancelAnimationFrame(animRef.current)
    }
  }, [enabled, createParticle])

  if (!enabled) return null
  return <canvas ref={canvasRef} className="particles-canvas" />
}
