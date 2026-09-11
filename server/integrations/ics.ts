import ical from 'node-ical'
import { db } from '../db.ts'

/**
 * Shared ICS reader, used for two things:
 *   1. Apple Calendar (read-only v1) via a published calendar URL.
 *   2. Canvas's per-user calendar feed, the fallback when UTA blocks tokens.
 * Both are plain iCalendar over HTTPS, so one parser covers them.
 */
export function normalizeIcsUrl(raw: string) {
  return raw.trim().replace(/^webcal:\/\//i, 'https://')
}

export async function fetchIcs(rawUrl: string) {
  const url = normalizeIcsUrl(rawUrl)
  const res = await fetch(url, { headers: { Accept: 'text/calendar' } })
  if (!res.ok) throw new Error(`Calendar feed returned ${res.status}`)
  const text = await res.text()
  if (!text.includes('BEGIN:VCALENDAR')) throw new Error('That URL did not return an iCalendar feed')
  return Object.values(ical.parseICS(text)).filter((e: any) => e.type === 'VEVENT') as any[]
}

export async function syncAppleCalendar(url: string) {
  const events = await fetchIcs(url)
  const stmt = db.prepare(`
    INSERT INTO cal_events (id, source, title, start_at, end_at, all_day, location)
    VALUES (?, 'apple', ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title=excluded.title, start_at=excluded.start_at,
      end_at=excluded.end_at, all_day=excluded.all_day, location=excluded.location
  `)
  const horizon = Date.now() + 1000 * 60 * 60 * 24 * 60
  let n = 0
  for (const e of events) {
    if (!e.start) continue
    const t = new Date(e.start).getTime()
    if (t > horizon || t < Date.now() - 1000 * 60 * 60 * 24 * 7) continue
    stmt.run(
      `apple:${e.uid}`, e.summary ?? '(untitled)',
      new Date(e.start).toISOString(),
      e.end ? new Date(e.end).toISOString() : null,
      e.datetype === 'date' ? 1 : 0, e.location ?? null,
    )
    n++
  }
  return { events: n }
}

/**
 * Canvas ICS mode. Assignment events carry a UID containing the assignment id
 * and the description holds the course; it's less rich than the REST API
 * (no grades, no submission state) but needs no token at all.
 */
export async function syncCanvasIcs(url: string) {
  const events = await fetchIcs(url)
  const stmt = db.prepare(`
    INSERT INTO assignments (id, source, course_name, title, due_at, html_url, synced_at)
    VALUES (?, 'ics', ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      title=excluded.title, due_at=excluded.due_at, course_name=excluded.course_name
  `)
  let n = 0
  for (const e of events) {
    if (!e.start) continue
    const course = (e.description ?? '').match(/Calendar:\s*(.+)/)?.[1]?.trim() ?? null
    stmt.run(
      `ics:${e.uid}`, course, e.summary ?? '(untitled)',
      new Date(e.start).toISOString(), e.url ?? null,
    )
    n++
  }
  return { assignments: n }
}
