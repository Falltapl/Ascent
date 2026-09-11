import { useEffect, useRef, useState, type ReactNode } from 'react'

export const ACCENT = {
  violet: { text: 'text-[#a855f7]', ring: '#a855f7', bg: 'bg-[#a855f7]', soft: 'bg-[#a855f7]/12', border: 'border-[#a855f7]/35' },
  cyan:   { text: 'text-[#22d3ee]', ring: '#22d3ee', bg: 'bg-[#22d3ee]', soft: 'bg-[#22d3ee]/12', border: 'border-[#22d3ee]/35' },
  amber:  { text: 'text-[#fbbf24]', ring: '#fbbf24', bg: 'bg-[#fbbf24]', soft: 'bg-[#fbbf24]/12', border: 'border-[#fbbf24]/35' },
  emerald:{ text: 'text-[#34d399]', ring: '#34d399', bg: 'bg-[#34d399]', soft: 'bg-[#34d399]/12', border: 'border-[#34d399]/35' },
  rose:   { text: 'text-[#fb7185]', ring: '#fb7185', bg: 'bg-[#fb7185]', soft: 'bg-[#fb7185]/12', border: 'border-[#fb7185]/35' },
} as const
export type Accent = keyof typeof ACCENT

export function Card({ children, className = '', hover = true, style }: {
  children: ReactNode; className?: string; hover?: boolean; style?: React.CSSProperties
}) {
  return <div className={`card ${hover ? 'card-hover' : ''} ${className}`} style={style}>{children}</div>
}

export function Button({
  children, onClick, variant = 'ghost', size = 'md', disabled, className = '', type = 'button',
}: {
  children: ReactNode; onClick?: () => void; variant?: 'primary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'; disabled?: boolean; className?: string; type?: 'button' | 'submit'
}) {
  const base = 'inline-flex items-center justify-center gap-1.5 rounded-xl font-medium transition-all active:scale-[.96] disabled:opacity-40 disabled:pointer-events-none'
  const sizes = { sm: 'px-2.5 py-1.5 text-xs', md: 'px-4 py-2 text-sm' }
  const variants = {
    primary: 'bg-gradient-to-r from-[#a855f7] to-[#22d3ee] text-[#0a0a14] font-semibold hover:brightness-110 shadow-lg shadow-[#a855f7]/20',
    ghost: 'bg-white/5 border border-[#272740] text-[#f0f0ff] hover:bg-white/10 hover:border-[#3d3d66]',
    danger: 'bg-[#fb7185]/10 border border-[#fb7185]/30 text-[#fb7185] hover:bg-[#fb7185]/20',
  }
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}>
      {children}
    </button>
  )
}

/** Radial progress. Used for cert readiness where the number is exam-weighted. */
export function Ring({ value, size = 112, stroke = 9, accent = 'violet', label, sub }: {
  value: number; size?: number; stroke?: number; accent?: Accent; label?: string; sub?: string
}) {
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const [shown, setShown] = useState(0)
  useEffect(() => {
    const t = setTimeout(() => setShown(value), 60)
    return () => clearTimeout(t)
  }, [value])

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#272740" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={ACCENT[accent].ring} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={circ - (shown / 100) * circ}
          style={{ transition: 'stroke-dashoffset 1s cubic-bezier(.2,.9,.3,1)', filter: `drop-shadow(0 0 6px ${ACCENT[accent].ring}66)` }}
        />
      </svg>
      <div className="absolute inset-0 grid place-content-center text-center leading-none">
        <div className="font-[var(--font-mono)] text-2xl font-bold tabular-nums">{label ?? `${value}%`}</div>
        {sub && <div className="mt-1 text-[10px] uppercase tracking-wider text-[#8b8bb0]">{sub}</div>}
      </div>
    </div>
  )
}

export function Bar({ value, accent = 'violet', height = 8, striped = false }: {
  value: number; accent?: Accent; height?: number; striped?: boolean
}) {
  return (
    <div className="w-full overflow-hidden rounded-full bg-[#272740]" style={{ height }}>
      <div
        className={`h-full rounded-full ${striped ? 'animate-shimmer' : ''}`}
        style={{
          width: `${Math.min(100, Math.max(0, value))}%`,
          background: striped
            ? `linear-gradient(100deg, ${ACCENT[accent].ring}, #ffffff55, ${ACCENT[accent].ring})`
            : ACCENT[accent].ring,
          transition: 'width .7s cubic-bezier(.2,.9,.3,1)',
          boxShadow: `0 0 10px ${ACCENT[accent].ring}55`,
        }}
      />
    </div>
  )
}

export function Modal({ open, onClose, title, children }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    if (open) window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="card w-full max-w-lg animate-rise p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-[var(--font-display)] text-lg font-bold">{title}</h3>
          <button onClick={onClose} className="rounded-lg px-2 text-xl text-[#8b8bb0] hover:bg-white/5 hover:text-white">×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[#8b8bb0]">{label}</span>
      {children}
    </label>
  )
}

export const inputCls =
  'w-full rounded-xl border border-[#272740] bg-[#0a0a14]/70 px-3 py-2 text-sm text-[#f0f0ff] outline-none transition placeholder:text-[#555577] focus:border-[#a855f7] focus:ring-2 focus:ring-[#a855f7]/25'

/** Celebration burst. Fires on goal completion and cert milestones. */
export function Confetti({ fire }: { fire: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!fire) return
    const cv = ref.current!
    const ctx = cv.getContext('2d')!
    cv.width = window.innerWidth
    cv.height = window.innerHeight
    const colors = ['#a855f7', '#22d3ee', '#fbbf24', '#34d399', '#fb7185']
    const bits = Array.from({ length: 140 }, () => ({
      x: cv.width / 2 + (Math.random() - 0.5) * 260,
      y: cv.height * 0.36,
      vx: (Math.random() - 0.5) * 13,
      vy: Math.random() * -13 - 4,
      r: Math.random() * 6 + 3,
      c: colors[(Math.random() * colors.length) | 0],
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
    }))
    let raf = 0
    let frames = 0
    const tick = () => {
      ctx.clearRect(0, 0, cv.width, cv.height)
      for (const b of bits) {
        b.vy += 0.32
        b.x += b.vx
        b.y += b.vy
        b.rot += b.vr
        ctx.save()
        ctx.translate(b.x, b.y)
        ctx.rotate(b.rot)
        ctx.fillStyle = b.c
        ctx.globalAlpha = Math.max(0, 1 - frames / 130)
        ctx.fillRect(-b.r / 2, -b.r / 2, b.r, b.r * 1.7)
        ctx.restore()
      }
      if (++frames < 130) raf = requestAnimationFrame(tick)
      else ctx.clearRect(0, 0, cv.width, cv.height)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [fire])
  return <canvas ref={ref} className="pointer-events-none fixed inset-0 z-[60]" />
}

/** Relative deadline language, with overdue and urgency states. */
export function dueMeta(iso: string | null) {
  if (!iso) return { text: 'No due date', tone: 'muted' as const, days: Infinity }
  const ms = new Date(iso).getTime() - Date.now()
  const days = Math.ceil(ms / 86400000)
  if (ms < 0) return { text: days === 0 ? 'Due today' : `${Math.abs(days)}d overdue`, tone: 'rose' as const, days }
  if (days === 0) return { text: 'Due today', tone: 'rose' as const, days }
  if (days === 1) return { text: 'Due tomorrow', tone: 'amber' as const, days }
  if (days <= 7) return { text: `${days} days left`, tone: 'amber' as const, days }
  return { text: new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), tone: 'muted' as const, days }
}
