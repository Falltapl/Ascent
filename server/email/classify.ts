import { db, nowISO } from '../db.ts'
import { PROVIDERS, defaultProvider } from '../assistant/index.ts'

/**
 * Classifies mail in batches rather than one request per message. Same
 * per-email judgement, roughly a tenth of the cost and far fewer round trips.
 */
const BATCH = 25

export type Verdict = {
  id: string
  importance: 'critical' | 'important' | 'routine' | 'noise'
  category: 'class_change' | 'deadline' | 'grades' | 'admin' | 'career' | 'event' | 'other'
  reason: string
  action_by: string | null
}

const SYSTEM = `You triage a university student's inbox. For each email you receive, decide how much it matters to them personally.

Return ONLY a JSON array — no prose, no code fence. One object per email, in the order given:
[{"id":"<id>","importance":"critical|important|routine|noise","category":"class_change|deadline|grades|admin|career|event|other","reason":"<8 words max>","action_by":"YYYY-MM-DD or null"}]

importance:
- critical — the student's day changes if they miss it. Class cancelled or relocated, exam time changed, registration hold, financial-aid or enrollment problem, graduation/commencement deadline, an advisor or professor asking THEM directly for something.
- important — a real deadline or obligation that is not urgent today. Assignment instructions, syllabus changes, scheduled advising, required forms.
- routine — legitimate but not actionable. Grade postings, receipts, confirmations, general announcements.
- noise — newsletters, marketing, club mass-mail, events they did not sign up for, automated digests, anything promotional.

Judge by meaning, not keywords. "We won't be meeting Thursday" is a class cancellation. A mass email from a department with no personal obligation is noise even if it comes from a professor. A real person addressing the student directly outranks anything automated.

action_by: only when the email states or clearly implies a date the student must act by. Otherwise null.`

function fmt(rows: any[]): string {
  return rows.map((r) => [
    `--- id: ${r.id}`,
    `from: ${r.from_name || ''} <${r.from_addr || ''}>`,
    `account: ${r.account}`,
    `date: ${r.received_at ?? 'unknown'}`,
    `subject: ${r.subject ?? '(none)'}`,
    `preview: ${String(r.preview ?? '').slice(0, 400)}`,
  ].join('\n')).join('\n\n')
}

/** Pulls the first JSON array out of a reply, tolerating fences or stray prose. */
export function parseVerdicts(raw: string): Verdict[] {
  let text = raw.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) text = fence[1].trim()
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end === -1 || end < start) throw new Error('classifier returned no JSON array')
  const parsed = JSON.parse(text.slice(start, end + 1))
  if (!Array.isArray(parsed)) throw new Error('classifier did not return an array')

  const ok = new Set(['critical', 'important', 'routine', 'noise'])
  const cats = new Set(['class_change', 'deadline', 'grades', 'admin', 'career', 'event', 'other'])
  return parsed
    .filter((v: any) => v && typeof v.id === 'string')
    .map((v: any) => ({
      id: v.id,
      importance: ok.has(v.importance) ? v.importance : 'routine',
      category: cats.has(v.category) ? v.category : 'other',
      reason: String(v.reason ?? '').slice(0, 120),
      action_by: /^\d{4}-\d{2}-\d{2}$/.test(v.action_by ?? '') ? v.action_by : null,
    }))
}

async function classifyBatch(rows: any[]): Promise<Verdict[]> {
  const id = defaultProvider()
  if (!id) throw new Error('No assistant provider configured — set GEMINI_API_KEY or ANTHROPIC_API_KEY')

  let out = ''
  for await (const chunk of PROVIDERS[id].stream(
    [{ role: 'user', content: `${SYSTEM}\n\nClassify these ${rows.length} emails:\n\n${fmt(rows)}` }],
    false,       // never attach study context to a triage call
    'low',       // classification is a cheap, well-specified task
  )) {
    if (chunk.type === 'text') out += chunk.value
  }
  return parseVerdicts(out)
}

/** Classifies everything not yet judged. Returns counts by importance. */
export async function classifyPending(limit = 200) {
  const pending = db.prepare(
    `SELECT id, account, from_name, from_addr, subject, preview, received_at
     FROM emails WHERE classified_at IS NULL ORDER BY received_at DESC LIMIT ?`,
  ).all(limit) as any[]
  if (!pending.length) return { classified: 0, batches: 0, counts: {} }

  // Fail loudly up front. Without this the per-batch catch below swallows a
  // missing API key and reports "triaged 0" as though it had succeeded.
  if (!defaultProvider()) {
    throw new Error('No assistant provider configured — add a key with: npm run token GEMINI_API_KEY')
  }

  const save = db.prepare(
    `UPDATE emails SET importance=?, category=?, reason=?, action_by=?, classified_at=? WHERE id=?`,
  )

  let done = 0, batches = 0, attempted = 0
  let firstError: string | null = null
  for (let i = 0; i < pending.length; i += BATCH) {
    const slice = pending.slice(i, i + BATCH)
    attempted++
    let verdicts: Verdict[]
    try {
      verdicts = await classifyBatch(slice)
    } catch (e: any) {
      // One bad batch shouldn't strand the rest; leave them unclassified to retry.
      console.error('[ascent] classify batch failed:', e.message)
      firstError ??= e.message
      continue
    }
    batches++
    const byId = new Map(verdicts.map((v) => [v.id, v]))
    for (const row of slice) {
      const v = byId.get(row.id)
      if (!v) continue
      save.run(v.importance, v.category, v.reason, v.action_by, nowISO(), row.id)
      done++
    }
  }

  // Every batch failing is a real failure, not a no-op.
  if (batches === 0 && attempted > 0) throw new Error(firstError ?? 'classification failed')

  const counts = Object.fromEntries(
    (db.prepare(`SELECT importance, COUNT(*) n FROM emails WHERE importance IS NOT NULL GROUP BY importance`).all() as any[])
      .map((r) => [r.importance, r.n]),
  )
  return { classified: done, batches, counts }
}
