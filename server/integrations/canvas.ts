import { db, nowISO } from '../db.ts'

const BASE = (process.env.CANVAS_BASE_URL || 'https://uta.instructure.com').replace(/\/$/, '')
const TOKEN = process.env.CANVAS_TOKEN || ''

export const canvasMode = (): 'token' | 'ics' | 'off' =>
  TOKEN ? 'token' : process.env.CANVAS_ICS_URL ? 'ics' : 'off'

/**
 * Canvas paginates with RFC-5988 Link headers, not page counts. Following
 * rel="next" is the only correct way to read a full list.
 * Budget note: UTA's bucket is 700 units and a request costs ~0.016, so a
 * full sync of a dozen courses is a rounding error against the limit.
 */
async function canvasGet<T>(path: string, params: Record<string, string | string[]> = {}): Promise<T[]> {
  if (!TOKEN) throw new Error('CANVAS_TOKEN not set')
  const url = new URL(`${BASE}/api/v1${path}`)
  url.searchParams.set('per_page', '100')
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, x))
    else url.searchParams.set(k, v)
  }

  const out: T[] = []
  let next: string | null = url.toString()
  let hops = 0

  while (next && hops++ < 25) {
    const res: Response = await fetch(next, {
      headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' },
    })
    if (res.status === 401) throw new Error('Canvas rejected the token (401). It may be revoked or expired.')
    if (res.status === 403) throw new Error('Canvas returned 403 — UTA may block student API tokens. Use CANVAS_ICS_URL instead.')
    if (!res.ok) throw new Error(`Canvas ${res.status} on ${path}`)

    const body = (await res.json()) as T[] | T
    out.push(...(Array.isArray(body) ? body : [body]))

    const link = res.headers.get('link') || ''
    const m = link.split(',').find((s) => s.includes('rel="next"'))
    next = m ? (m.match(/<([^>]+)>/)?.[1] ?? null) : null
  }
  return out
}

type RawCourse = { id: number; name: string; course_code?: string }
type RawAssignment = {
  id: number; name: string; due_at: string | null; points_possible: number | null
  html_url: string; course_id: number
  submission?: { submitted_at: string | null; score: number | null; workflow_state: string }
}

export async function syncCanvas() {
  if (canvasMode() !== 'token') throw new Error('Canvas token mode not configured')

  const courses = await canvasGet<RawCourse>('/courses', {
    enrollment_state: 'active',
    'include[]': ['term'],
  })

  const upsert = db.prepare(`
    INSERT INTO assignments (id, source, course_name, course_id, title, due_at, points, html_url, submitted, graded_score, synced_at)
    VALUES (?, 'canvas', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      course_name=excluded.course_name, title=excluded.title, due_at=excluded.due_at,
      points=excluded.points, html_url=excluded.html_url, submitted=excluded.submitted,
      graded_score=excluded.graded_score, synced_at=excluded.synced_at
  `)

  let count = 0
  for (const c of courses) {
    let items: RawAssignment[] = []
    try {
      // include[]=submission gives submitted/graded state in the same call,
      // which avoids an N+1 fan-out across every assignment.
      items = await canvasGet<RawAssignment>(`/courses/${c.id}/assignments`, {
        'include[]': ['submission'],
        order_by: 'due_at',
      })
    } catch {
      continue // a single locked course shouldn't abort the whole sync
    }
    for (const a of items) {
      upsert.run(
        `canvas:${a.id}`, c.name ?? c.course_code ?? `Course ${c.id}`, String(c.id),
        a.name, a.due_at, a.points_possible, a.html_url,
        a.submission?.submitted_at ? 1 : 0,
        a.submission?.score ?? null, nowISO(),
      )
      count++
    }
  }
  return { courses: courses.length, assignments: count }
}

/** Verifies the token without pulling anything. Used by the setup screen. */
export async function canvasWhoAmI() {
  const [me] = await canvasGet<{ id: number; name: string; primary_email?: string }>('/users/self')
  return me
}
