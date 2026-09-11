import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { db, nowISO, uid, meta } from './db.ts'
import { CERTS, readiness, predictedScore } from './certs.ts'
import { computeXp, computeStreak, levelFor, heatmap } from './gamify.ts'
import { syncCanvas, canvasWhoAmI, canvasMode } from './integrations/canvas.ts'
import { syncCredly } from './integrations/credly.ts'
import { lookupCourse } from './integrations/coursera.ts'
import { syncAppleCalendar, syncCanvasIcs } from './integrations/ics.ts'
import { syncEventKit, checkEventKit, eventKitBuilt } from './integrations/eventkit.ts'
import { streamChat, providerStatus, defaultProvider, readableError, type ChatTurn, type ProviderId, type Effort } from './assistant/index.ts'
import { classifyPending } from './email/classify.ts'
import * as graph from './email/sources/graph.ts'
import * as gmail from './email/sources/gmail.ts'

const app = express()
app.use(cors({ origin: 'http://localhost:5173' }))
app.use(express.json())

const wrap = (fn: express.RequestHandler): express.RequestHandler =>
  (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

/* ── config / status ────────────────────────────────────────────────── */
app.get('/api/config', (_req, res) => {
  res.json({
    canvas: { mode: canvasMode(), baseUrl: process.env.CANVAS_BASE_URL ?? null },
    credly: { handle: process.env.CREDLY_HANDLE || null },
    assistant: { providers: providerStatus(), active: defaultProvider() },
    email: {
      graph: { configured: graph.configured(), connected: graph.connected() },
      gmail: { configured: gmail.configured(), connected: gmail.connected() },
      lastSync: { graph: meta.get('sync:email:graph'), gmail: meta.get('sync:email:gmail') },
    },
    appleCalendar: {
      // EventKit is preferred: local, private, no published feed.
      mode: eventKitBuilt() ? 'eventkit' : process.env.APPLE_CALENDAR_ICS_URL ? 'ics' : 'off',
      configured: eventKitBuilt() || Boolean(process.env.APPLE_CALENDAR_ICS_URL),
    },
    lastSync: {
      canvas: meta.get('sync:canvas'),
      credly: meta.get('sync:credly'),
      calendar: meta.get('sync:calendar'),
    },
  })
})

/* ── the whole dashboard in one request ─────────────────────────────── */
app.get('/api/state', (_req, res) => {
  const goals = db.prepare(`SELECT * FROM goals ORDER BY status='done', COALESCE(target_date,'9999') ASC`).all() as any[]
  const steps = db.prepare(`SELECT * FROM goal_steps ORDER BY position`).all() as any[]
  for (const g of goals) g.steps = steps.filter((s) => s.goal_id === g.id)

  const conf = db.prepare(`SELECT * FROM cert_confidence`).all() as any[]
  const tasks = db.prepare(`SELECT * FROM cert_tasks WHERE done=1`).all() as any[]
  const exams = db.prepare(`SELECT * FROM cert_exams`).all() as any[]

  const certs = CERTS.map((c) => {
    const map: Record<string, number> = {}
    for (const r of conf.filter((x) => x.cert_code === c.code)) map[r.domain_id] = r.confidence
    const exam = exams.find((e) => e.cert_code === c.code) ?? null
    return {
      ...c,
      confidence: map,
      doneTasks: tasks.filter((t) => t.cert_code === c.code).map((t) => t.task_key),
      readiness: readiness(c, map),
      predictedScore: predictedScore(c, map),
      exam,
    }
  })

  const xp = computeXp()
  res.json({
    goals,
    certs,
    assignments: db.prepare(`SELECT * FROM assignments ORDER BY COALESCE(due_at,'9999')`).all(),
    courses: db.prepare(`SELECT * FROM courses ORDER BY added_at DESC`).all(),
    events: db.prepare(`SELECT * FROM cal_events WHERE start_at >= datetime('now','-1 day') ORDER BY start_at LIMIT 60`).all(),
    sessions: db.prepare(`SELECT * FROM study_sessions ORDER BY day DESC, created_at DESC LIMIT 40`).all(),
    stats: { xp, ...levelFor(xp), streak: computeStreak(), heatmap: heatmap() },
  })
})

/* ── goals ──────────────────────────────────────────────────────────── */
app.post('/api/goals', (req, res) => {
  const { title, detail = '', category = 'personal', target_date = null, steps = [] } = req.body
  if (!title?.trim()) return res.status(400).json({ error: 'title is required' })
  const id = uid()
  db.prepare(`INSERT INTO goals (id,title,detail,category,target_date,created_at) VALUES (?,?,?,?,?,?)`)
    .run(id, title.trim(), detail, category, target_date, nowISO())
  const st = db.prepare(`INSERT INTO goal_steps (id,goal_id,label,position) VALUES (?,?,?,?)`)
  steps.filter((s: string) => s.trim()).forEach((s: string, i: number) => st.run(uid(), id, s.trim(), i))
  res.json({ id })
})

app.patch('/api/goals/:id', (req, res) => {
  const { status, title, detail, target_date, category } = req.body
  const g = db.prepare(`SELECT * FROM goals WHERE id=?`).get(req.params.id) as any
  if (!g) return res.status(404).json({ error: 'not found' })
  db.prepare(`UPDATE goals SET title=?, detail=?, category=?, target_date=?, status=?, completed_at=? WHERE id=?`).run(
    title ?? g.title, detail ?? g.detail, category ?? g.category,
    target_date !== undefined ? target_date : g.target_date,
    status ?? g.status,
    (status ?? g.status) === 'done' ? (g.completed_at ?? nowISO()) : null,
    req.params.id,
  )
  res.json({ ok: true })
})

app.delete('/api/goals/:id', (req, res) => {
  db.prepare(`DELETE FROM goals WHERE id=?`).run(req.params.id)
  res.json({ ok: true })
})

app.post('/api/goals/:id/steps', (req, res) => {
  const id = uid()
  const n = db.prepare(`SELECT COUNT(*) c FROM goal_steps WHERE goal_id=?`).get(req.params.id) as any
  db.prepare(`INSERT INTO goal_steps (id,goal_id,label,position) VALUES (?,?,?,?)`)
    .run(id, req.params.id, String(req.body.label ?? '').trim(), n.c)
  res.json({ id })
})

app.patch('/api/steps/:id', (req, res) => {
  db.prepare(`UPDATE goal_steps SET done=? WHERE id=?`).run(req.body.done ? 1 : 0, req.params.id)
  res.json({ ok: true })
})
app.delete('/api/steps/:id', (req, res) => {
  db.prepare(`DELETE FROM goal_steps WHERE id=?`).run(req.params.id)
  res.json({ ok: true })
})

/* ── certifications ─────────────────────────────────────────────────── */
app.put('/api/certs/:code/confidence', (req, res) => {
  const { domainId, confidence } = req.body
  db.prepare(`
    INSERT INTO cert_confidence (cert_code,domain_id,confidence,updated_at) VALUES (?,?,?,?)
    ON CONFLICT(cert_code,domain_id) DO UPDATE SET confidence=excluded.confidence, updated_at=excluded.updated_at
  `).run(req.params.code, domainId, Math.max(0, Math.min(100, Number(confidence) || 0)), nowISO())
  res.json({ ok: true })
})

app.put('/api/certs/:code/task', (req, res) => {
  const { taskKey, done } = req.body
  db.prepare(`
    INSERT INTO cert_tasks (cert_code,task_key,done) VALUES (?,?,?)
    ON CONFLICT(cert_code,task_key) DO UPDATE SET done=excluded.done
  `).run(req.params.code, taskKey, done ? 1 : 0)
  res.json({ ok: true })
})

app.put('/api/certs/:code/exam', (req, res) => {
  const { scheduledFor } = req.body
  db.prepare(`
    INSERT INTO cert_exams (cert_code,scheduled_for) VALUES (?,?)
    ON CONFLICT(cert_code) DO UPDATE SET scheduled_for=excluded.scheduled_for
  `).run(req.params.code, scheduledFor || null)
  res.json({ ok: true })
})

/* ── study sessions ─────────────────────────────────────────────────── */
app.post('/api/sessions', (req, res) => {
  const { minutes, subject, kind = 'study', note = '', score = null, day } = req.body
  if (!minutes || minutes <= 0) return res.status(400).json({ error: 'minutes must be > 0' })
  const localDay = day || new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
  db.prepare(`INSERT INTO study_sessions (id,day,minutes,subject,kind,note,score,created_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run(uid(), localDay, Math.round(minutes), subject || 'general', kind, note, score, nowISO())
  res.json({ ok: true })
})
app.delete('/api/sessions/:id', (req, res) => {
  db.prepare(`DELETE FROM study_sessions WHERE id=?`).run(req.params.id)
  res.json({ ok: true })
})

/* ── assignments ────────────────────────────────────────────────────── */
app.patch('/api/assignments/:id', (req, res) => {
  db.prepare(`UPDATE assignments SET done_manual=? WHERE id=?`).run(req.body.done ? 1 : 0, req.params.id)
  res.json({ ok: true })
})

/* ── courses (Coursera catalog autofill) ────────────────────────────── */
app.post('/api/courses', wrap(async (req, res) => {
  const { input, totalModules = 0 } = req.body
  const meta = await lookupCourse(String(input ?? ''))
  const id = uid()
  db.prepare(`INSERT INTO courses (id,provider,slug,name,url,description,workload,total_modules,added_at) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(id, 'coursera', meta.slug, meta.name, `https://www.coursera.org/learn/${meta.slug}`,
         meta.description ?? '', meta.workload ?? '', totalModules, nowISO())
  res.json({ id, ...meta })
}))

app.patch('/api/courses/:id', (req, res) => {
  const c = db.prepare(`SELECT * FROM courses WHERE id=?`).get(req.params.id) as any
  if (!c) return res.status(404).json({ error: 'not found' })
  const { done_modules, total_modules, status } = req.body
  db.prepare(`UPDATE courses SET done_modules=?, total_modules=?, status=? WHERE id=?`).run(
    done_modules ?? c.done_modules, total_modules ?? c.total_modules, status ?? c.status, req.params.id)
  res.json({ ok: true })
})
app.delete('/api/courses/:id', (req, res) => {
  db.prepare(`DELETE FROM courses WHERE id=?`).run(req.params.id)
  res.json({ ok: true })
})

/* ── syncs ──────────────────────────────────────────────────────────── */
app.post('/api/sync/canvas', wrap(async (_req, res) => {
  const mode = canvasMode()
  if (mode === 'off') return res.status(400).json({ error: 'Set CANVAS_TOKEN or CANVAS_ICS_URL in .env' })
  const out = mode === 'token' ? await syncCanvas() : await syncCanvasIcs(process.env.CANVAS_ICS_URL!)
  meta.set('sync:canvas', nowISO())
  res.json({ mode, ...out })
}))

app.get('/api/canvas/whoami', wrap(async (_req, res) => res.json(await canvasWhoAmI())))

app.post('/api/sync/credly', wrap(async (req, res) => {
  const handle = req.body?.handle || process.env.CREDLY_HANDLE
  if (!handle) return res.status(400).json({ error: 'Set CREDLY_HANDLE in .env or pass a handle' })
  const out = await syncCredly(handle)
  meta.set('sync:credly', nowISO())
  res.json(out)
}))

app.post('/api/sync/calendar', wrap(async (_req, res) => {
  // Prefer reading Calendar.app locally; fall back to a published ICS feed.
  if (eventKitBuilt()) {
    const out = await syncEventKit()
    meta.set('sync:calendar', nowISO())
    return res.json({ mode: 'eventkit', ...out })
  }
  const url = process.env.APPLE_CALENDAR_ICS_URL
  if (!url) return res.status(400).json({ error: 'Build the native helper (npm run build:native) or set APPLE_CALENDAR_ICS_URL in .env' })
  const out = await syncAppleCalendar(url)
  meta.set('sync:calendar', nowISO())
  res.json({ mode: 'ics', ...out })
}))

/** Reports whether macOS has granted Calendar access, without syncing. */
app.get('/api/calendar/check', wrap(async (_req, res) => res.json(await checkEventKit())))

/* ── assistant ──────────────────────────────────────────────────────── */
app.post('/api/chat', wrap(async (req, res) => {
  const { messages, includeContext = true, effort = 'medium', provider = null } = req.body ?? {}
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages[] is required' })
  }
  // Trim to the last 20 turns; the whole history is resent every request.
  const history: ChatTurn[] = messages.slice(-20).map((m: any) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content ?? ''),
  }))

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()

  const send = (type: string, value: string) => res.write(`data: ${JSON.stringify({ type, value })}\n\n`)

  // If the browser navigates away mid-answer, stop burning tokens.
  //
  // This must listen on `res`, not `req`: on a POST, `req` emits 'close' as
  // soon as the request BODY has been consumed, which happens before streaming
  // even begins — so `req.on('close')` marks every request as aborted and the
  // reply comes back empty. `res` emits 'close' when the response finishes or
  // the socket drops, and `writableEnded` separates those two cases.
  let aborted = false
  res.on('close', () => { if (!res.writableEnded) aborted = true })

  try {
    for await (const chunk of streamChat(provider as ProviderId | null, history, Boolean(includeContext), effort as Effort)) {
      if (aborted) break
      send(chunk.type, chunk.value)
    }
  } catch (e: any) {
    console.error('[ascent] chat:', e.message)
    send('error', readableError(e))
  } finally {
    if (!aborted) res.end()
  }
}))

/* ── email ──────────────────────────────────────────────────────────── */
app.get('/api/email', (req, res) => {
  const min = String(req.query.importance ?? 'important')
  const rank: Record<string, number> = { critical: 3, important: 2, routine: 1, noise: 0 }
  const floor = rank[min] ?? 2
  const rows = (db.prepare(
    `SELECT * FROM emails WHERE dismissed=0 ORDER BY received_at DESC LIMIT 300`,
  ).all() as any[]).filter((r) => (rank[r.importance] ?? -1) >= floor || r.importance === null)

  res.json({
    emails: rows,
    counts: Object.fromEntries(
      (db.prepare(`SELECT importance, COUNT(*) n FROM emails WHERE dismissed=0 GROUP BY importance`).all() as any[])
        .map((r) => [r.importance ?? 'unclassified', r.n]),
    ),
  })
})

app.patch('/api/email/:id', (req, res) => {
  db.prepare(`UPDATE emails SET dismissed=? WHERE id=?`).run(req.body?.dismissed ? 1 : 0, req.params.id)
  res.json({ ok: true })
})

app.post('/api/email/sync', wrap(async (_req, res) => {
  // Sync whichever mailboxes are connected; one failing shouldn't block the other.
  const sources: [string, () => Promise<{ fetched: number }>][] = []
  if (graph.connected()) sources.push(['graph', () => graph.fetchMail()])
  if (gmail.connected()) sources.push(['gmail', () => gmail.fetchMail()])
  if (!sources.length) {
    return res.status(400).json({ error: 'No mailbox connected — connect Gmail in Settings' })
  }

  let fetched = 0
  const errors: string[] = []
  for (const [name, run] of sources) {
    try { fetched += (await run()).fetched } catch (e: any) { errors.push(`${name}: ${e.message}`) }
  }
  if (!fetched && errors.length) return res.status(502).json({ error: errors.join(' · ') })

  const triaged = await classifyPending()
  res.json({ fetched, ...triaged, ...(errors.length ? { warnings: errors } : {}) })
}))

/* Gmail OAuth — loopback redirect, so nothing needs hosting. */
app.get('/api/email/gmail/auth', (_req, res) => {
  try { res.redirect(gmail.authUrl()) }
  catch (e: any) { res.status(400).send(`<pre>${e.message}</pre>`) }
})

app.get('/api/email/gmail/callback', wrap(async (req, res) => {
  const page = (title: string, body: string, ok: boolean) => `<!doctype html>
<meta charset="utf-8"><title>${title}</title>
<body style="font:15px/1.5 -apple-system,system-ui,sans-serif;background:#0a0a14;color:#f0f0ff;display:grid;place-content:center;height:100vh;margin:0;text-align:center">
<div><div style="font-size:42px">${ok ? '\u2713' : '\u2715'}</div>
<h1 style="font-size:19px;margin:.4em 0;color:${ok ? '#34d399' : '#fb7185'}">${title}</h1>
<p style="color:#8b8bb0;max-width:34em">${body}</p></div>`

  if (req.query.error) {
    return res.status(400).send(page('Authorization declined', String(req.query.error), false))
  }
  const code = String(req.query.code ?? '')
  if (!code) return res.status(400).send(page('No authorization code', 'Google did not send a code back.', false))

  try {
    await gmail.handleCallback(code)
    res.send(page('Gmail connected', 'You can close this tab and return to Ascent, then hit Sync mail.', true))
  } catch (e: any) {
    res.status(400).send(page('Connection failed', e.message, false))
  }
}))

/** Classify whatever is pending, without fetching — used for the sample data too. */
app.post('/api/email/classify', wrap(async (_req, res) => res.json(await classifyPending())))

app.post('/api/email/connect/start', wrap(async (_req, res) => res.json(await graph.startDeviceLogin())))
app.post('/api/email/connect/poll', wrap(async (_req, res) => res.json(await graph.pollDeviceLogin())))
app.get('/api/email/whoami', wrap(async (_req, res) => res.json(await graph.whoAmI())))

/* ── errors ─────────────────────────────────────────────────────────── */
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[ascent]', err.message)
  res.status(500).json({ error: err.message })
})

const port = Number(process.env.PORT || 8787)
app.listen(port, () => console.log(`ascent api  →  http://localhost:${port}`))
