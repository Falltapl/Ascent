import { useCallback, useEffect, useState } from 'react'
import { api, type State, type Config } from './api'
import { Confetti } from './components/ui'
import { Dashboard } from './components/Dashboard'
import { Certs } from './components/Certs'
import { Goals } from './components/Goals'
import { Coursework } from './components/Coursework'
import { Settings } from './components/Settings'
import { Assistant } from './components/Assistant'
import { ThemeMenu } from './components/ThemeMenu'
import { LogoMark } from './components/Logo'
import { Internships } from './components/Internships'
import { Inbox } from './components/Inbox'

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: '◈' },
  { id: 'certs', label: 'Certifications', icon: '☁' },
  { id: 'goals', label: 'Goals', icon: '◎' },
  { id: 'coursework', label: 'Coursework', icon: '✎' },
  { id: 'internships', label: 'Internships', icon: '▤' },
  { id: 'inbox', label: 'Inbox', icon: '✉' },
  { id: 'ask', label: 'Ask', icon: '✦' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
] as const
type Tab = (typeof TABS)[number]['id']

export default function App() {
  const [tab, setTab] = useState<Tab>('dashboard')
  const [state, setState] = useState<State | null>(null)
  const [cfg, setCfg] = useState<Config | null>(null)
  const [err, setErr] = useState('')
  const [fire, setFire] = useState(0)

  const reload = useCallback(() => {
    api.state().then(setState).catch((e) => setErr(e.message))
    api.config().then(setCfg).catch(() => {})
  }, [])

  useEffect(reload, [reload])
  const celebrate = useCallback(() => setFire((n) => n + 1), [])

  if (err) return <Fatal msg={err} />
  if (!state) return <Booting />

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <Confetti fire={fire} />

      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-content-center rounded-2xl bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] text-[var(--ground)] shadow-lg shadow-[var(--accent)]/25">
            <LogoMark className="h-11 w-11" />
          </div>
          <div>
            <h1 className="font-[var(--font-display)] text-xl font-bold leading-none">Ascent</h1>
            <p className="mt-1 text-xs text-[var(--muted)]">Goals · certifications · coursework</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
        <ThemeMenu />
        <div className="rounded-xl border border-[var(--line)] bg-[var(--ground)]/40 px-3 py-1.5 text-right">
          <div className="font-[var(--font-mono)] text-sm font-bold text-[var(--warn)]">
            LVL {state.stats.level} · {state.stats.xp.toLocaleString()} XP
          </div>
          <div className="text-[10px] text-[var(--muted)]">
            {state.stats.streak.current}-day streak
          </div>
        </div>
        </div>
      </header>

      <nav className="mb-6 flex gap-1.5 overflow-x-auto rounded-2xl border border-[var(--line)] bg-[var(--ground)]/40 p-1.5">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex-1 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium transition-all ${
              tab === t.id
                ? 'bg-gradient-to-r from-[var(--accent)] to-[var(--accent-2)] text-[var(--ground)] shadow-lg shadow-[var(--accent)]/20'
                : 'text-[var(--muted)] hover:bg-[var(--ink)]/5 hover:text-[var(--ink)]'}`}>
            <span className="mr-1.5">{t.icon}</span>{t.label}
          </button>
        ))}
      </nav>

      <main key={tab} className="animate-rise">
        {tab === 'dashboard' && <Dashboard s={state} cfg={cfg} reload={reload} celebrate={celebrate} />}
        {tab === 'certs' && <Certs s={state} reload={reload} celebrate={celebrate} />}
        {tab === 'goals' && <Goals s={state} reload={reload} celebrate={celebrate} />}
        {tab === 'coursework' && <Coursework s={state} cfg={cfg} reload={reload} celebrate={celebrate} />}
        {tab === 'internships' && <Internships />}
        {tab === 'inbox' && <Inbox cfg={cfg} />}
        {tab === 'ask' && <Assistant cfg={cfg} />}
        {tab === 'settings' && <Settings cfg={cfg} reload={reload} />}
      </main>

      <footer className="mt-10 border-t border-[var(--line)] pt-4 text-center text-xs text-[var(--faint)]">
        Built for Hunter Nguyen · data stays local in SQLite
      </footer>
    </div>
  )
}

function Booting() {
  return (
    <div className="grid min-h-screen place-content-center text-center">
      <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-3 border-[var(--line)] border-t-[var(--accent)]" />
      <p className="text-sm text-[var(--muted)]">Loading Ascent…</p>
    </div>
  )
}

function Fatal({ msg }: { msg: string }) {
  return (
    <div className="grid min-h-screen place-content-center px-6 text-center">
      <h1 className="mb-2 font-[var(--font-display)] text-xl font-bold text-[var(--bad)]">Can't reach the API</h1>
      <p className="mb-4 max-w-md text-sm text-[var(--muted)]">{msg}</p>
      <p className="text-xs text-[var(--faint)]">Is the server running? Start both with <code className="rounded bg-[var(--ink)]/10 px-1.5 py-0.5">npm run dev</code></p>
    </div>
  )
}
