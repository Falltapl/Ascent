import { useState } from 'react'
import type { Config } from '../api'
import { api } from '../api'
import { Card, Button } from './ui'
import { SectionHead } from './Dashboard'

export function Settings({ cfg, reload }: { cfg: Config | null; reload: () => void }) {
  return (
    <div className="space-y-5">
      <Card className="p-5" hover={false}>
        <SectionHead title="Connections" hint="Credentials live in .env on this machine only — nothing is sent anywhere but the service itself." />
        <div className="space-y-3">
          <Row
            name="Canvas — UT Arlington"
            status={cfg?.canvas.mode === 'token' ? 'ok' : cfg?.canvas.mode === 'ics' ? 'partial' : 'off'}
            detail={
              cfg?.canvas.mode === 'token' ? 'Full REST API — assignments, submissions, and grades.'
              : cfg?.canvas.mode === 'ics' ? 'Calendar-feed mode: due dates only, no grades or submission state.'
              : 'Not connected.'}
            last={cfg?.lastSync.canvas}
            onSync={() => api.syncCanvas()}
            reload={reload}
            help={
              <>
                <p><strong>Preferred:</strong> open <Link href="https://uta.instructure.com/profile/settings">uta.instructure.com/profile/settings</Link>, scroll to <em>Approved Integrations</em>, click <strong>+ New Access Token</strong>, and put the value in <code className="rounded bg-white/10 px-1">CANVAS_TOKEN</code> in <code className="rounded bg-white/10 px-1">.env</code>.</p>
                <p className="mt-1.5"><strong>If that button is missing</strong>, UTA blocks student tokens. Use the fallback: Canvas → <em>Calendar</em> → <em>Calendar Feed</em>, copy the URL into <code className="rounded bg-white/10 px-1">CANVAS_ICS_URL</code>. Due dates still sync; grades do not.</p>
              </>
            } />

          <Row
            name="AWS certifications — via Credly"
            status={cfg?.credly.handle ? 'ok' : 'off'}
            detail={cfg?.credly.handle ? `Watching credly.com/users/${cfg.credly.handle}` : 'Not connected.'}
            last={cfg?.lastSync.credly}
            onSync={() => api.syncCredly()}
            reload={reload}
            help={
              <p>AWS publishes certifications as Credly badges and exposes no API of its own. Set <code className="rounded bg-white/10 px-1">CREDLY_HANDLE</code> to the name in your profile URL. When you pass an exam the badge is detected automatically, along with its three-year expiry.</p>
            } />

          <Row
            name="Apple Calendar"
            status={cfg?.appleCalendar.configured ? 'ok' : 'off'}
            detail={cfg?.appleCalendar.configured ? 'Read-only calendar feed.' : 'Not connected.'}
            last={cfg?.lastSync.calendar}
            onSync={() => api.syncCalendar()}
            reload={reload}
            help={
              <p>In Calendar.app, right-click a calendar → <em>Share Calendar…</em> → tick <em>Public Calendar</em>, copy the <code className="rounded bg-white/10 px-1">webcal://</code> URL into <code className="rounded bg-white/10 px-1">APPLE_CALENDAR_ICS_URL</code>. Read-only by design for v1; two-way sync would need CalDAV and an app-specific password.</p>
            } />
        </div>
      </Card>

      <Card className="p-5" hover={false}>
        <SectionHead title="How XP works" hint="Tuned so the cheapest XP is also the habit worth building" />
        <ul className="grid gap-2 text-sm sm:grid-cols-2">
          {[
            ['1 XP', 'per minute studied (capped at 180/day)'],
            ['+50 XP', 'assignment completed'],
            ['+25 XP', 'exam objective checked off'],
            ['+15 XP', 'goal step completed'],
            ['+200 XP', 'goal completed'],
            ['+40 XP', 'practice exam, plus score ÷ 10'],
          ].map(([xp, what]) => (
            <li key={what} className="flex items-center gap-3 rounded-xl border border-[#272740] bg-black/25 px-3 py-2">
              <span className="w-16 shrink-0 font-[var(--font-mono)] text-sm font-bold text-[#fbbf24]">{xp}</span>
              <span className="text-[#8b8bb0]">{what}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-[#8b8bb0]">
          The daily minute cap exists so one marathon session can't inflate a streak's worth, and levels
          scale superlinearly (100 × level<sup>1.35</sup>) so later levels take real work.
        </p>
      </Card>
    </div>
  )
}

function Link({ href, children }: { href: string; children: React.ReactNode }) {
  return <a href={href} target="_blank" rel="noreferrer" className="text-[#22d3ee] underline underline-offset-2">{children}</a>
}

function Row({ name, status, detail, last, onSync, reload, help }: {
  name: string; status: 'ok' | 'partial' | 'off'; detail: string; last?: string | null
  onSync: () => Promise<any>; reload: () => void; help: React.ReactNode
}) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [showHelp, setShowHelp] = useState(status === 'off')

  const dot = status === 'ok' ? 'bg-[#34d399]' : status === 'partial' ? 'bg-[#fbbf24]' : 'bg-[#555577]'

  const run = async () => {
    setBusy(true); setMsg('')
    try {
      const r = await onSync()
      setMsg(`✓ ${Object.entries(r).filter(([k]) => k !== 'badges').map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') || 'none' : v}`).join(' · ')}`)
      reload()
    } catch (e: any) { setMsg(`✗ ${e.message}`) } finally { setBusy(false) }
  }

  return (
    <div className="rounded-2xl border border-[#272740] bg-black/25 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} style={{ boxShadow: status !== 'off' ? '0 0 8px currentColor' : undefined }} />
        <div className="min-w-[200px] flex-1">
          <div className="font-medium">{name}</div>
          <div className="text-xs text-[#8b8bb0]">{detail}</div>
          {last && <div className="text-[11px] text-[#555577]">last synced {new Date(last).toLocaleString()}</div>}
        </div>
        <Button size="sm" onClick={() => setShowHelp(!showHelp)}>{showHelp ? 'Hide setup' : 'Setup'}</Button>
        <Button size="sm" variant="primary" onClick={run} disabled={busy || status === 'off'}>
          {busy ? 'Syncing…' : '↻ Sync now'}
        </Button>
      </div>
      {showHelp && <div className="mt-3 space-y-1 rounded-xl border border-[#272740] bg-black/40 p-3 text-xs text-[#8b8bb0]">{help}</div>}
      {msg && (
        <div className={`mt-2 rounded-lg px-3 py-2 text-xs ${msg.startsWith('✓') ? 'bg-[#34d399]/12 text-[#34d399]' : 'bg-[#fb7185]/12 text-[#fb7185]'}`}>
          {msg}
        </div>
      )}
    </div>
  )
}
