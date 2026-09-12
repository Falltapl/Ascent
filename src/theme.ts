/**
 * Theme state lives on <html> as data attributes, so a change is one
 * attribute write and CSS does the rest — no React re-render, no prop
 * drilling, and no flash of the wrong theme if it's applied before paint
 * (see the inline bootstrap in index.html).
 */
export type Theme = 'dark' | 'light'
export type Motion = 'on' | 'off'
export type AccentId = 'violet' | 'ocean' | 'forest' | 'sunset' | 'rose' | 'mono'

/** Swatch colours mirror the CSS presets — kept here only for the picker UI. */
export const ACCENTS: { id: AccentId; label: string; a1: string; a2: string }[] = [
  { id: 'violet', label: 'Violet', a1: '#a855f7', a2: '#22d3ee' },
  { id: 'ocean',  label: 'Ocean',  a1: '#3b82f6', a2: '#06b6d4' },
  { id: 'forest', label: 'Forest', a1: '#10b981', a2: '#84cc16' },
  { id: 'sunset', label: 'Sunset', a1: '#f59e0b', a2: '#fb7185' },
  { id: 'rose',   label: 'Rose',   a1: '#f43f5e', a2: '#c084fc' },
  { id: 'mono',   label: 'Mono',   a1: '#94a3b8', a2: '#64748b' },
]

const KEY = 'ascent.theme.v1'
type Saved = { theme: Theme; accent: AccentId; motion: Motion }

const DEFAULTS: Saved = { theme: 'dark', accent: 'violet', motion: 'on' }

export function load(): Saved {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) {
      // No stored choice: follow the OS on first run.
      const prefersLight = window.matchMedia?.('(prefers-color-scheme: light)').matches
      return { ...DEFAULTS, theme: prefersLight ? 'light' : 'dark' }
    }
    return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    return DEFAULTS
  }
}

export function apply(s: Saved) {
  const r = document.documentElement
  r.dataset.theme = s.theme
  r.dataset.accent = s.accent
  r.dataset.motion = s.motion
  try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* private mode */ }
}
