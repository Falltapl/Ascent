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

type RawTerm = { id: number; name: string; start_at: string | null; end_at: string | null }
type RawCourse = { id: number; name: string; course_code?: string; term?: RawTerm }


/** Abbreviations UTA uses in course titles that must stay capitalised. */
const KEEP_UPPER = new Set(['BA', 'IT', 'HR', 'IS', 'CS', 'AI', 'ML', 'US', 'MIS', 'ERP', 'SQL', 'II', 'III', 'IV'])
/** Words that stay lowercase in a title unless they lead it. */
const KEEP_LOWER = new Set(['for', 'and', 'of', 'the', 'in', 'to', 'a', 'an', 'with', 'on', 'at'])

function titleCase(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((word, i) => {
      const bare = word.replace(/[^A-Za-z]/g, '')
      if (KEEP_UPPER.has(bare.toUpperCase())) return word.toUpperCase()
      const lower = word.toLowerCase()
      if (i > 0 && KEEP_LOWER.has(lower)) return lower
      return lower.replace(/^[a-z]/, (c) => c.toUpperCase())
    })
    .join(' ')
}

/**
 * UTA names courses like "2268-INSY-4321-001-MOBILE APP DEVELOPMENT".
 * That's the term code, subject, number, section, then a SHOUTED title.
 * Render it as "INSY 4321 · Mobile App Development" instead.
 */
export function prettyCourseName(raw: string): string {
  const m = raw.match(/^\d{4}-([A-Z]+)-(\w+)-\w+-(.+)$/)
  if (!m) return raw
  const [, subject, number, title] = m
  return `${subject} ${number} · ${titleCase(title)}`
}

/**
 * Canvas keeps every past enrollment "active", so an unfiltered course list
 * returns years of history — 17 courses and 320 assignments in practice, most
 * of it un-submitted work from finished semesters that would read as overdue.
 * Only courses in a term that is currently running count. The "Default Term"
 * (no dates) holds non-academic org shells — advising, compliance, career
 * services — and is excluded too.
 */
export function isCurrentTerm(c: RawCourse, now = Date.now()): boolean {
  const t = c.term
  if (!t?.start_at || !t?.end_at) return false
  return new Date(t.start_at).getTime() <= now && now <= new Date(t.end_at).getTime()
}
type RawAssignment = {
  id: number; name: string; due_at: string | null; points_possible: number | null
  html_url: string; course_id: number
  submission?: { submitted_at: string | null; score: number | null; graded_at?: string | null; workflow_state: string }
}

/**
 * Whether a piece of work is actually finished.
 *
 * `submitted_at` alone is not enough: anything handed in on paper or graded
 * manually has a score and a `graded_at` but no submission timestamp, so
 * keying off `submitted_at` marks completed work as overdue. Canvas's own
 * workflow_state is the reliable signal — only `unsubmitted` means open.
 */
export function isComplete(sub?: RawAssignment['submission']): boolean {
  if (!sub) return false
  if (sub.submitted_at || sub.graded_at) return true
  return ['graded', 'submitted', 'pending_review', 'complete'].includes(sub.workflow_state)
}

export async function syncCanvas() {
  if (canvasMode() !== 'token') throw new Error('Canvas token mode not configured')

  const all = await canvasGet<RawCourse>('/courses', {
    enrollment_state: 'active',
    'include[]': ['term'],
  })
  const courses = all.filter((c) => isCurrentTerm(c))

  const upsert = db.prepare(`
    INSERT INTO assignments (id, source, course_name, course_id, title, due_at, points, html_url, submitted, graded_score, state, synced_at)
    VALUES (?, 'canvas', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      course_name=excluded.course_name, title=excluded.title, due_at=excluded.due_at,
      points=excluded.points, html_url=excluded.html_url, submitted=excluded.submitted,
      graded_score=excluded.graded_score, state=excluded.state, synced_at=excluded.synced_at
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
        `canvas:${a.id}`, prettyCourseName(c.name ?? c.course_code ?? `Course ${c.id}`), String(c.id),
        a.name, a.due_at, a.points_possible, a.html_url,
        isComplete(a.submission) ? 1 : 0,
        a.submission?.score ?? null, a.submission?.workflow_state ?? null, nowISO(),
      )
      count++
    }
  }
  return { courses: courses.length, skipped: all.length - courses.length, assignments: count, term: courses[0]?.term?.name ?? null }
}

type RawEnrollment = {
  course_id: number
  grades?: { current_score: number | null; current_grade: string | null; final_score: number | null; html_url?: string }
}
type RawGroup = {
  name: string
  group_weight: number | null
  assignments?: {
    points_possible: number | null
    omit_from_final_grade?: boolean
    submission?: { score: number | null; excused?: boolean; workflow_state?: string }
  }[]
}

export type GroupScore = { name: string; weight: number; earned: number; possible: number; graded: number; total: number }

/**
 * Per-category standing, from graded work only. Excused and omitted
 * assignments are skipped, matching how Canvas itself totals a group.
 */
export function scoreGroups(groups: RawGroup[]): GroupScore[] {
  return groups.map((g) => {
    let earned = 0, possible = 0, graded = 0, total = 0
    for (const a of g.assignments ?? []) {
      if (a.omit_from_final_grade || a.submission?.excused) continue
      total++
      const pts = a.points_possible ?? 0
      if (a.submission?.score != null && pts > 0) {
        earned += a.submission.score
        possible += pts
        graded++
      }
    }
    return { name: g.name, weight: g.group_weight ?? 0, earned, possible, graded, total }
  })
}

/** Standard US scale, used only when the course has no grading scheme of its own. */
export function letterFor(score: number | null): string | null {
  if (score == null) return null
  if (score >= 90) return 'A'
  if (score >= 80) return 'B'
  if (score >= 70) return 'C'
  if (score >= 60) return 'D'
  return 'F'
}

export async function syncGrades() {
  if (canvasMode() !== 'token') throw new Error('Grades need Canvas token mode')

  const courses = (await canvasGet<RawCourse>('/courses', { enrollment_state: 'active', 'include[]': ['term'] }))
    .filter((c) => isCurrentTerm(c))
  const enrollments = await canvasGet<RawEnrollment>('/users/self/enrollments', {
    'type[]': ['StudentEnrollment'], 'state[]': ['active'],
  })

  const upsert = db.prepare(`
    INSERT INTO course_grades (course_id, course_name, current_score, current_grade, final_score, groups_json, html_url, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(course_id) DO UPDATE SET
      course_name=excluded.course_name, current_score=excluded.current_score, current_grade=excluded.current_grade,
      final_score=excluded.final_score, groups_json=excluded.groups_json, html_url=excluded.html_url, synced_at=excluded.synced_at
  `)

  // Courses from finished terms would otherwise linger forever.
  const keep = courses.map((c) => String(c.id))
  db.prepare(`DELETE FROM course_grades WHERE course_id NOT IN (${keep.map(() => '?').join(',') || "''"})`).run(...keep)

  for (const c of courses) {
    const g = enrollments.find((e) => e.course_id === c.id)?.grades
    let groups: GroupScore[] = []
    try {
      groups = scoreGroups(await canvasGet<RawGroup>(`/courses/${c.id}/assignment_groups`, {
        'include[]': ['assignments', 'submission'],
      }))
    } catch { /* breakdown is optional; the course total still shows */ }

    upsert.run(
      String(c.id), prettyCourseName(c.name ?? `Course ${c.id}`),
      g?.current_score ?? null,
      g?.current_grade ?? letterFor(g?.current_score ?? null),
      g?.final_score ?? null,
      JSON.stringify(groups),
      g?.html_url ?? `${BASE}/courses/${c.id}/grades`,
      nowISO(),
    )
  }
  return { gradedCourses: courses.length }
}

/** Verifies the token without pulling anything. Used by the setup screen. */
export async function canvasWhoAmI() {
  const [me] = await canvasGet<{ id: number; name: string; primary_email?: string }>('/users/self')
  return me
}
