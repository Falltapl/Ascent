import { useEffect, useRef, useState } from 'react'
import { ACCENTS, apply, load, type AccentId, type Motion, type Theme } from '../theme'

export function ThemeMenu() {
  const [theme, setTheme] = useState<Theme>('dark')
  const [accent, setAccent] = useState<AccentId>('violet')
  const [motion, setMotion] = useState<Motion>('on')
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  // Hydrate from whatever the pre-paint bootstrap already applied.
  useEffect(() => {
    const s = load()
    setTheme(s.theme); setAccent(s.accent); setMotion(s.motion)
    apply(s)
  }, [])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey) }
  }, [open])

  const set = (next: Partial<{ theme: Theme; accent: AccentId; motion: Motion }>) => {
    const s = { theme, accent, motion, ...next }
    setTheme(s.theme); setAccent(s.accent); setMotion(s.motion)
    apply(s)
  }

  const btn = 'grid h-9 w-9 place-content-center rounded-xl border border-[var(--line)] bg-[var(--ink)]/5 text-[var(--muted)] transition hover:border-[var(--line-2)] hover:text-[var(--ink)] active:scale-95'

  return (
    <div className="relative flex items-center gap-1.5" ref={box}>
      <button
        className={btn}
        onClick={() => set({ theme: theme === 'dark' ? 'light' : 'dark' })}
        title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
        aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
        {theme === 'dark' ? <Moon /> : <Sun />}
      </button>

      <button
        className={btn}
        onClick={() => setOpen(!open)}
        title="Appearance"
        aria-label="Appearance settings"
        aria-expanded={open}>
        <Gear />
      </button>

      {open && (
        <div className="card animate-rise absolute right-0 top-11 z-50 w-64 p-4" role="dialog" aria-label="Appearance">
          <div className="mb-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">Accent</div>
            <div className="grid grid-cols-3 gap-2">
              {ACCENTS.map((a) => (
                <button
                  key={a.id}
                  onClick={() => set({ accent: a.id })}
                  title={a.label}
                  aria-label={a.label}
                  aria-pressed={accent === a.id}
                  className={`flex flex-col items-center gap-1.5 rounded-xl border p-2 transition ${
                    accent === a.id
                      ? 'border-[var(--accent)] bg-[var(--accent)]/12'
                      : 'border-[var(--line)] hover:border-[var(--line-2)]'}`}>
                  <span
                    className="h-5 w-5 rounded-full ring-1 ring-black/20"
                    style={{ background: `linear-gradient(135deg, ${a.a1}, ${a.a2})` }} />
                  <span className="text-[10px] text-[var(--muted)]">{a.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-[var(--line)] pt-3">
            <div>
              <div className="text-xs font-medium">Animated background</div>
              <div className="text-[10px] text-[var(--muted)]">Drifting ambient glow</div>
            </div>
            <button
              role="switch"
              aria-checked={motion === 'on'}
              aria-label="Animated background"
              onClick={() => set({ motion: motion === 'on' ? 'off' : 'on' })}
              className={`relative h-5 w-9 shrink-0 rounded-full transition ${
                motion === 'on' ? 'bg-[var(--accent)]' : 'bg-[var(--line-2)]'}`}>
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
                motion === 'on' ? 'left-[1.125rem]' : 'left-0.5'}`} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

const ico = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
const Sun = () => (
  <svg {...ico}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
)
const Moon = () => (
  <svg {...ico}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
)
const Gear = () => (
  <svg {...ico}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
)
