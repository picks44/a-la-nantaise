import { useEffect, useRef, useState } from 'react'

const BRAND_CONFETTI_COLORS = ['#FECA03', '#055D46', '#033528'] as const

export function ConfettiBurst({
  reducedMotion,
  particleCount = 20,
  durationMs = 1200,
  colors = BRAND_CONFETTI_COLORS,
  onDone,
}: {
  reducedMotion: boolean
  particleCount?: number
  durationMs?: number
  colors?: readonly string[]
  onDone?: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rafIdRef = useRef<number | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (reducedMotion) return
    if (!canvasRef.current) return

    const canvas = canvasRef.current
    const parent = canvas.parentElement
    if (!parent) return

    const dpr = Math.max(1, window.devicePixelRatio || 1)
    const width = Math.max(1, parent.clientWidth)
    const height = Math.max(1, parent.clientHeight)

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const ctx2 = ctx

    canvas.width = Math.floor(width * dpr)
    canvas.height = Math.floor(height * dpr)
    ctx2.setTransform(dpr, 0, 0, dpr, 0, 0)

    type Particle = {
      x: number
      y: number
      vx: number
      vy: number
      size: number
      length: number
      rot: number
      rotSpeed: number
      color: string
      spin: number
    }

    const spawnCenterX = width * 0.5
    const spawnCenterY = height * 0.18

    const particles: Particle[] = Array.from({ length: particleCount }).map(() => {
      const x = spawnCenterX + (Math.random() - 0.5) * width * 0.18
      const y = spawnCenterY + (Math.random() - 0.5) * height * 0.06
      const vx = (Math.random() - 0.5) * width * 0.12
      const vy = -height * (0.22 + Math.random() * 0.12)

      const size = 2 + Math.random() * 2.2
      const length = 6 + Math.random() * 7

      const rot = Math.random() * Math.PI * 2
      const rotSpeed = (Math.random() - 0.5) * 10

      const color = colors[Math.floor(Math.random() * colors.length)] ?? colors[0]!

      return {
        x,
        y,
        vx,
        vy,
        size,
        length,
        rot,
        rotSpeed,
        color,
        spin: 0,
      }
    })

    let start = performance.now()
    let last = start
    const gravity = 2500 // pixels/s^2 (ish)

    function frame(now: number) {
      const elapsed = now - start
      const dt = Math.max(0, now - last) / 1000
      last = now

      ctx2.clearRect(0, 0, width, height)

      const t = Math.min(1, elapsed / durationMs)
      const alpha = 1 - t

      for (const p of particles) {
        p.x += p.vx * dt
        p.vy += gravity * dt
        p.y += p.vy * dt
        p.rot += p.rotSpeed * dt

        const w = p.size
        const h = p.length

        ctx2.save()
        ctx2.globalAlpha = alpha
        ctx2.translate(p.x, p.y)
        ctx2.rotate(p.rot)
        ctx2.fillStyle = p.color
        // A small rectangle confetti (flat, sober).
        ctx2.fillRect(-w / 2, -h / 2, w, h)
        ctx2.restore()
      }

      if (elapsed < durationMs) {
        rafIdRef.current = window.requestAnimationFrame(frame)
        return
      }

      ctx2.clearRect(0, 0, width, height)
      rafIdRef.current = null
      onDone?.()
    }

    setReady(true)
    rafIdRef.current = window.requestAnimationFrame(frame)

    return () => {
      if (rafIdRef.current) window.cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = null
      ctx2.clearRect(0, 0, width, height)
    }
  }, [reducedMotion, durationMs, particleCount, colors, onDone])

  if (reducedMotion) return null

  return (
    <div className="pointer-events-none fixed inset-0" aria-hidden="true">
      <canvas
        ref={canvasRef}
        className="h-full w-full"
        // Avoid flashing on first paint.
        style={{ opacity: ready ? 1 : 0 }}
      />
    </div>
  )
}

