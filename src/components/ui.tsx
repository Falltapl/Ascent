import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export const ACCENT = {
  violet: { text: 'text-[var(--accent)]', ring: 'var(--accent)', bg: 'bg-[var(--accent)]', soft: 'bg-[var(--accent)]/12', border: 'border-[var(--accent)]/35' },
  cyan:   { text: 'text-[var(--accent-2)]', ring: 'var(--accent-2)', bg: 'bg-[var(--accent-2)]', soft: 'bg-[var(--accent-2)]/12', border: 'border-[var(--accent-2)]/35' },
  amber:  { text: 'text-[var(--warn)]', ring: 'var(--warn)', bg: 'bg-[var(--warn)]', soft: 'bg-[var(--warn)]/12', border: 'border-[var(--warn)]/35' },
  emerald:{ text: 'text-[var(--ok)]', ring: 'var(--ok)', bg: 'bg-[var(--ok)]', soft: 'bg-[var(--ok)]/12', border: 'border-[var(--ok)]/35' },
  rose:   { text: 'text-[var(--bad)]', ring: 'var(--bad)', bg: 'bg-[var(--bad)]', soft: 'bg-[var(--bad)]/12', border: 'border-[var(--bad)]/35' },
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
    primary: 'bg-gradient-to-r from-[var(--accent)] to-[var(--accent-2)] text-[var(--ground)] font-semibold hover:brightness-110 shadow-lg shadow-[var(--accent)]/20',
    ghost: 'bg-[var(--ink)]/5 border border-[var(--line)] text-[var(--ink)] hover:bg-[var(--ink)]/10 hover:border-[var(--line-2)]',
    danger: 'bg-[var(--bad)]/10 border border-[var(--bad)]/30 text-[var(--bad)] hover:bg-[var(--bad)]/20',
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
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={ACCENT[accent].ring} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={circ - (shown / 100) * circ}
          style={{ transition: 'stroke-dashoffset 1s cubic-bezier(.2,.9,.3,1)', filter: `drop-shadow(0 0 6px ${ACCENT[accent].ring}66)` }}
        />
      </svg>
      <div className="absolute inset-0 grid place-content-center text-center leading-none">
        <div className="font-[var(--font-mono)] text-2xl font-bold tabular-nums">{label ?? `${value}%`}</div>
        {sub && <div className="mt-1 text-[10px] uppercase tracking-wider text-[var(--muted)]">{sub}</div>}
      </div>
    </div>
  )
}

export function Bar({ value, accent = 'violet', height = 8, striped = false }: {
  value: number; accent?: Accent; height?: number; striped?: boolean
}) {
  return (
    <div className="w-full overflow-hidden rounded-full bg-[var(--line)]" style={{ height }}>
      <div
        className={`h-full rounded-full ${striped ? 'animate-shimmer' : ''}`}
        style={{
          width: `${Math.min(100, Math.max(0, value))}%`,
          background: striped
            ? `linear-gradient(100deg, ${ACCENT[accent].ring}, color-mix(in oklab, var(--ink) 40%, transparent), ${ACCENT[accent].ring})`
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
  // Portalled to <body>. A fixed-position overlay rendered inside any ancestor
  // with backdrop-filter or transform — every .card has backdrop-filter — is
  // positioned and stacked relative to that ancestor instead of the viewport,
  // so later page sections paint over it and cover its buttons.
  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}
         role="dialog" aria-modal="true" aria-label={title}>
      <div className="card w-full max-w-lg animate-rise p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-[var(--font-display)] text-lg font-bold">{title}</h3>
          <button onClick={onClose} className="rounded-lg px-2 text-xl text-[var(--muted)] hover:bg-[var(--ink)]/5 hover:text-[var(--ink)]" aria-label="Close">×</button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[var(--muted)]">{label}</span>
      {children}
    </label>
  )
}

export const inputCls =
  'w-full rounded-xl border border-[var(--line)] bg-[var(--ground)]/70 px-3 py-2 text-sm text-[var(--ink)] outline-none transition placeholder:text-[var(--faint)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/25'

/** Celebration burst. Fires on goal completion and cert milestones. */
export function Confetti({ fire }: { fire: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!fire) return
    const cv = ref.current!
    const ctx = cv.getContext('2d')!
    cv.width = window.innerWidth
    cv.height = window.innerHeight
    const colors = ['var(--accent)', 'var(--accent-2)', 'var(--warn)', 'var(--ok)', 'var(--bad)']
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
