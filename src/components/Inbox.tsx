import { useCallback, useEffect, useState } from 'react'
import type { Config } from '../api'
import { Card, Button, ACCENT } from './ui'
import { SectionHead, Empty } from './Dashboard'

type Mail = {
  id: string; source: string; account: string
  from_name: string | null; from_addr: string | null
  subject: string | null; preview: string | null; received_at: string | null
  is_read: number; web_link: string | null
  importance: 'critical' | 'important' | 'routine' | 'noise' | null
  category: string | null; reason: string | null; action_by: string | null
}

const LEVELS = [
  { id: 'critical',  label: 'Critical',  accent: 'rose'    as const, blurb: 'Your day changes if you miss it' },
  { id: 'important', label: 'Important', accent: 'amber'   as const, blurb: 'Real obligation, not urgent today' },
  { id: 'routine',   label: 'Routine',   accent: 'cyan'    as const, blurb: 'Legitimate but nothing to do' },
  { id: 'noise',     label: 'Noise',     accent: 'violet'  as const, blurb: 'Filtered out' },
]

const CATEGORY_LABEL: Record<string, string> = {
  class_change: 'Class change', deadline: 'Deadline', grades: 'Grades',
  admin: 'Admin', career: 'Career', event: 'Event', other: 'Other',
}

const ago = (iso: string | null) => {
  if (!iso) return ''
  const h = Math.round((Date.now() - new Date(iso).getTime()) / 3600000)
  if (h < 1) return 'just now'
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

export function Inbox({ cfg }: { cfg: Config | null }) {
  const [mail, setMail] = useState<Mail[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [floor, setFloor] = useState('important')
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    const r = await fetch(`/api/email?importance=${floor}`).then((r) => r.json())
    setMail(r.emails ?? []); setCounts(r.counts ?? {})
  }, [floor])
  useEffect(() => { load() }, [load])

  const run = async (path: string, label: string) => {
    setBusy(label); setMsg('')
    try {
      const r = await fetch(path, { method: 'POST' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? 'failed')
      setMsg(`✓ ${j.fetched != null ? `fetched ${j.fetched}, ` : ''}triaged ${j.classified ?? 0} in ${j.batches ?? 0} batch${j.batches === 1 ? '' : 'es'}`)
      load()
    } catch (e: any) { setMsg(`✗ ${e.message}`) } finally { setBusy('') }
  }

  const unclassified = counts['unclassified'] ?? 0
  const connected = Boolean(cfg?.email?.gmail.connected || cfg?.email?.graph.connected)

  return (
    <div className="space-y-5">
      <Card className="p-5" hover={false}>
        <SectionHead
          title="Inbox triage"
          hint={connected ? `${[cfg?.email?.gmail.connected && 'Gmail', cfg?.email?.graph.connected && 'Microsoft 365'].filter(Boolean).join(' + ')} · classified by the assistant` : 'No mailbox connected yet'}
          action={
            <div className="flex gap-2">
              {unclassified > 0 && (
                <Button size="sm" onClick={() => run('/api/email/classify', 'classify')} disabled={!!busy}>
                  {busy === 'classify' ? 'Triaging…' : `Triage ${unclassified}`}
                </Button>
              )}
              <Button size="sm" variant="primary" onClick={() => run('/api/email/sync', 'sync')} disabled={!!busy || !connected}>
                {busy === 'sync' ? 'Syncing…' : '↻ Sync mail'}
              </Button>
            </div>
          } />

        <div className="flex flex-wrap gap-2">
          {LEVELS.map((l) => {
            const n = counts[l.id] ?? 0
            const active = floor === l.id
            return (
              <button key={l.id} onClick={() => setFloor(l.id)} title={l.blurb}
                className={`rounded-xl border px-3 py-1.5 text-xs transition ${
                  active ? 'border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--ink)]' : 'border-[var(--line)] text-[var(--muted)] hover:border-[var(--line-2)]'}`}>
                <span style={{ color: ACCENT[l.accent].ring }}>●</span> {l.label}
                <span className="ml-1.5 text-[var(--muted)]">{n}</span>
              </button>
            )
          })}
        </div>

        {msg && (
          <div className={`mt-3 rounded-lg px-3 py-2 text-xs ${msg.startsWith('✓') ? 'bg-[var(--ok)]/12 text-[var(--ok)]' : 'bg-[var(--bad)]/12 text-[var(--bad)]'}`}>{msg}</div>
        )}
      </Card>

      {mail.length === 0 ? (
        <Card className="p-5" hover={false}>
          <Empty text={connected
            ? 'Nothing at this level. Try a lower filter, or sync again.'
            : 'Connect Gmail in Settings, then sync. Sample mail is already loaded — hit Triage to see how it works.'} />
        </Card>
      ) : (
        <Card className="p-5" hover={false}>
          <ul className="space-y-2">
            {mail.map((m, i) => {
              const lvl = LEVELS.find((l) => l.id === m.importance)
              const ring = lvl ? ACCENT[lvl.accent].ring : 'var(--faint)'
              return (
                <li key={m.id} className="animate-rise rounded-xl border border-[var(--line)] bg-[var(--ground)]/45 p-3"
                    style={{ animationDelay: `${i * 30}ms`, borderLeft: `3px solid ${ring}` }}>
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-medium">{m.from_name || m.from_addr}</span>
                    <span className="text-[11px] text-[var(--faint)]">{m.from_addr}</span>
                    <span className="ml-auto shrink-0 text-[11px] text-[var(--muted)]">{ago(m.received_at)}</span>
                  </div>
                  <div className={`mt-0.5 text-sm ${m.is_read ? 'text-[var(--ink-2)]' : 'font-semibold'}`}>{m.subject}</div>
                  <div className="mt-1 line-clamp-2 text-xs text-[var(--muted)]">{m.preview}</div>

                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                    {m.importance && (
                      <span className="rounded-md px-1.5 py-0.5" style={{ background: `${ring}22`, color: ring }}>
                        {lvl?.label}
                      </span>
                    )}
                    {m.category && <span className="rounded-md bg-[var(--ink)]/5 px-1.5 py-0.5 text-[var(--muted)]">{CATEGORY_LABEL[m.category] ?? m.category}</span>}
                    {m.reason && <span className="italic text-[var(--muted)]">{m.reason}</span>}
                    {m.action_by && <span className="rounded-md bg-[var(--warn)]/15 px-1.5 py-0.5 text-[var(--warn)]">by {m.action_by}</span>}
                    <span className="ml-auto flex gap-2">
                      {m.web_link && <a href={m.web_link} target="_blank" rel="noreferrer" className="text-[var(--accent-2)] hover:underline">open ↗</a>}
                      <button className="text-[var(--faint)] hover:text-[var(--bad)]"
                        onClick={async () => { await fetch(`/api/email/${encodeURIComponent(m.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dismissed: true }) }); load() }}>
                        dismiss
                      </button>
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        </Card>
      )}
    </div>
  )
}
