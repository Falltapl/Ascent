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
                <p><strong>Preferred:</strong> open <Link href="https://uta.instructure.com/profile/settings">uta.instructure.com/profile/settings</Link>, scroll to <em>Approved Integrations</em>, click <strong>+ New Access Token</strong>, and put the value in <code className="rounded bg-[var(--ink)]/10 px-1">CANVAS_TOKEN</code> in <code className="rounded bg-[var(--ink)]/10 px-1">.env</code>.</p>
                <p className="mt-1.5"><strong>If that button is missing</strong>, UTA blocks student tokens. Use the fallback: Canvas → <em>Calendar</em> → <em>Calendar Feed</em>, copy the URL into <code className="rounded bg-[var(--ink)]/10 px-1">CANVAS_ICS_URL</code>. Due dates still sync; grades do not.</p>
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
              <p>AWS publishes certifications as Credly badges and exposes no API of its own. Set <code className="rounded bg-[var(--ink)]/10 px-1">CREDLY_HANDLE</code> to the name in your profile URL. When you pass an exam the badge is detected automatically, along with its three-year expiry.</p>
            } />

          <GmailRow cfg={cfg} reload={reload} />

          <Row
            name="Apple Calendar"
            status={cfg?.appleCalendar.mode === 'eventkit' ? 'ok' : cfg?.appleCalendar.mode === 'ics' ? 'partial' : 'off'}
            detail={
              cfg?.appleCalendar.mode === 'eventkit' ? 'Reading Calendar.app directly — nothing published, no credentials.'
              : cfg?.appleCalendar.mode === 'ics' ? 'Published calendar feed (publicly readable by anyone with the URL).'
              : 'Not connected.'}
            last={cfg?.lastSync.calendar}
            onSync={() => api.syncCalendar()}
            reload={reload}
            help={
              <>
                <p><strong>Recommended — read Calendar.app locally.</strong> Nothing is uploaded and no credential is involved. Build the helper once:</p>
                <pre className="my-1.5 rounded bg-[var(--ground)]/70 px-2 py-1.5">npm run build:native</pre>
                <p>Then start the app <em>from Terminal</em> with <code className="rounded bg-[var(--ink)]/10 px-1">npm run dev</code> and hit Sync. macOS will ask Terminal for Calendar access — allow it once. If you miss the prompt, enable it under System Settings › Privacy &amp; Security › Calendars.</p>
                <p className="mt-1.5"><strong>Alternative — published feed.</strong> Calendar.app → right-click a calendar → <em>Share Calendar…</em> → tick <em>Public Calendar</em>, and put the <code className="rounded bg-[var(--ink)]/10 px-1">webcal://</code> URL in <code className="rounded bg-[var(--ink)]/10 px-1">APPLE_CALENDAR_ICS_URL</code>. Easier, but it makes that calendar readable by anyone who has the URL.</p>
                <p className="mt-1.5">Both are read-only. Writing study blocks back would need CalDAV and an app-specific password.</p>
              </>
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
            <li key={what} className="flex items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--ground)]/45 px-3 py-2">
              <span className="w-16 shrink-0 font-[var(--font-mono)] text-sm font-bold text-[var(--warn)]">{xp}</span>
              <span className="text-[var(--muted)]">{what}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-[var(--muted)]">
          The daily minute cap exists so one marathon session can't inflate a streak's worth, and levels
          scale superlinearly (100 × level<sup>1.35</sup>) so later levels take real work.
        </p>
      </Card>
    </div>
  )
}

function GmailRow({ cfg, reload }: { cfg: Config | null; reload: () => void }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [help, setHelp] = useState(false)
  const g = cfg?.email?.gmail
  const dot = g?.connected ? 'bg-[var(--ok)]' : g?.configured ? 'bg-[var(--warn)]' : 'bg-[var(--faint)]'

  const sync = async () => {
    setBusy(true); setMsg('')
    try {
      const r = await fetch('/api/email/sync', { method: 'POST' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error)
      setMsg(`✓ fetched ${j.fetched}, triaged ${j.classified} in ${j.batches} batch${j.batches === 1 ? '' : 'es'}`)
      reload()
    } catch (e: any) { setMsg(`✗ ${e.message}`) } finally { setBusy(false) }
  }

  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--ground)]/45 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} />
        <div className="min-w-[200px] flex-1">
          <div className="font-medium">Gmail — personal inbox</div>
          <div className="text-xs text-[var(--muted)]">
            {g?.connected ? 'Connected. Headers and snippets only — bodies are never requested.'
             : g?.configured ? 'Credentials set. Click Connect to authorize.'
             : 'Not configured.'}
          </div>
          {cfg?.email?.lastSync.gmail && (
            <div className="text-[11px] text-[var(--faint)]">last synced {new Date(cfg.email.lastSync.gmail).toLocaleString()}</div>
          )}
        </div>
        <Button size="sm" onClick={() => setHelp(!help)}>{help ? 'Hide setup' : 'Setup'}</Button>
        {g?.configured && (
          <Button size="sm" onClick={() => window.open('/api/email/gmail/auth', '_blank')}>
            {g.connected ? 'Reconnect' : 'Connect'}
          </Button>
        )}
        <Button size="sm" variant="primary" onClick={sync} disabled={busy || !g?.connected}>
          {busy ? 'Syncing…' : '↻ Sync mail'}
        </Button>
      </div>

      {help && (
        <div className="mt-3 space-y-1.5 rounded-xl border border-[var(--line)] bg-[var(--ground)]/55 p-3 text-xs text-[var(--muted)]">
          <p>1. Open <Link href="https://console.cloud.google.com/projectcreate">Google Cloud Console</Link> and create a project.</p>
          <p>2. Enable the <Link href="https://console.cloud.google.com/apis/library/gmail.googleapis.com">Gmail API</Link>.</p>
          <p>3. <strong>OAuth consent screen</strong> → External → add yourself as a test user. Then set <strong>Publishing status → In production</strong>. (Left in “Testing”, Google expires the sign-in every 7 days.) It stays unverified, which is fine for personal use — you’ll click past a warning once.</p>
          <p>4. <strong>Credentials</strong> → Create OAuth client ID → <strong>Web application</strong>. Add this exact authorized redirect URI:</p>
          <pre className="my-1 rounded bg-[var(--ground)]/70 px-2 py-1.5 text-[var(--ink-3)]">http://localhost:8787/api/email/gmail/callback</pre>
          <p>5. Put the client ID and secret in <code className="rounded bg-[var(--ink)]/10 px-1">.env</code>, hidden input:</p>
          <pre className="my-1 rounded bg-[var(--ground)]/70 px-2 py-1.5 text-[var(--ink-3)]">npm run token GMAIL_CLIENT_ID{'\n'}npm run token GMAIL_CLIENT_SECRET</pre>
          <p>6. Restart the server, then click <strong>Connect</strong>.</p>
        </div>
      )}
      {msg && (
        <div className={`mt-2 rounded-lg px-3 py-2 text-xs ${msg.startsWith('✓') ? 'bg-[var(--ok)]/12 text-[var(--ok)]' : 'bg-[var(--bad)]/12 text-[var(--bad)]'}`}>{msg}</div>
      )}
    </div>
  )
}

function Link({ href, children }: { href: string; children: React.ReactNode }) {
  return <a href={href} target="_blank" rel="noreferrer" className="text-[var(--accent-2)] underline underline-offset-2">{children}</a>
}

function Row({ name, status, detail, last, onSync, reload, help }: {
  name: string; status: 'ok' | 'partial' | 'off'; detail: string; last?: string | null
  onSync: () => Promise<any>; reload: () => void; help: React.ReactNode
}) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [showHelp, setShowHelp] = useState(status === 'off')

  const dot = status === 'ok' ? 'bg-[var(--ok)]' : status === 'partial' ? 'bg-[var(--warn)]' : 'bg-[var(--faint)]'

  const run = async () => {
    setBusy(true); setMsg('')
    try {
      const r = await onSync()
      setMsg(`✓ ${Object.entries(r).filter(([k]) => k !== 'badges').map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') || 'none' : v}`).join(' · ')}`)
      reload()
    } catch (e: any) { setMsg(`✗ ${e.message}`) } finally { setBusy(false) }
  }

  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--ground)]/45 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} style={{ boxShadow: status !== 'off' ? '0 0 8px currentColor' : undefined }} />
        <div className="min-w-[200px] flex-1">
          <div className="font-medium">{name}</div>
          <div className="text-xs text-[var(--muted)]">{detail}</div>
          {last && <div className="text-[11px] text-[var(--faint)]">last synced {new Date(last).toLocaleString()}</div>}
        </div>
        <Button size="sm" onClick={() => setShowHelp(!showHelp)}>{showHelp ? 'Hide setup' : 'Setup'}</Button>
        <Button size="sm" variant="primary" onClick={run} disabled={busy || status === 'off'}>
          {busy ? 'Syncing…' : '↻ Sync now'}
        </Button>
      </div>
      {showHelp && <div className="mt-3 space-y-1 rounded-xl border border-[var(--line)] bg-[var(--ground)]/55 p-3 text-xs text-[var(--muted)]">{help}</div>}
      {msg && (
        <div className={`mt-2 rounded-lg px-3 py-2 text-xs ${msg.startsWith('✓') ? 'bg-[var(--ok)]/12 text-[var(--ok)]' : 'bg-[var(--bad)]/12 text-[var(--bad)]'}`}>
          {msg}
        </div>
      )}
    </div>
  )
}
