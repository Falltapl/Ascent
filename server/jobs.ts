/**
 * Application tracker: status vocabulary, validation, and CSV export.
 * Pure functions only, so they can be tested without a database.
 */

export type StatusGroup = 'saved' | 'applied' | 'active' | 'offer' | 'closed'
export const STATUSES: { id: string; label: string; group: StatusGroup }[] = [
  { id: 'saved', label: 'Saved', group: 'saved' },
  { id: 'applied', label: 'Applied', group: 'applied' },
  { id: 'oa', label: 'Online assessment', group: 'active' },
  { id: 'interviewing', label: 'Interviewing', group: 'active' },
  { id: 'offer', label: 'Offer', group: 'offer' },
  { id: 'accepted', label: 'Accepted', group: 'offer' },
  { id: 'rejected', label: 'Rejected', group: 'closed' },
  { id: 'withdrawn', label: 'Withdrawn', group: 'closed' },
  { id: 'ghosted', label: 'Ghosted', group: 'closed' },
]
export const isStatus = (s: unknown): s is string => STATUSES.some((x) => x.id === s)

/** A real calendar date in YYYY-MM-DD, or null to clear. Anything else is rejected. */
export function parseDay(v: unknown): string | null | undefined {
  if (v === null || v === '') return null
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : undefined
}

/** Today in the machine's local timezone — the dates a person types are local. */
export const localToday = (now = new Date()) =>
  new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)

/**
 * One CSV cell. Quotes when needed, and neutralises spreadsheet formulas: a
 * cell starting with = + - @ tab or CR is executed by Excel and Sheets, so a
 * scraped job title like "=HYPERLINK(...)" would otherwise run on open.
 */
export function csvCell(v: unknown): string {
  let s = v == null ? '' : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(rows: Record<string, unknown>[]): string {
  const cols: [string, string][] = [
    ['Company', 'company'], ['Role', 'role'], ['Location', 'location'], ['Status', 'status_label'],
    ['Applied', 'applied_on'], ['Next step', 'next_step'], ['Next step date', 'next_step_on'],
    ['Referral', 'referral'], ['Notes', 'notes'], ['Link', 'url'], ['Posting closed', 'posting_closed_label'],
    ['Added', 'added'],
  ]
  const lines = [cols.map(([h]) => csvCell(h)).join(',')]
  for (const r of rows) {
    const full = {
      ...r,
      status_label: STATUSES.find((s) => s.id === r.status)?.label ?? r.status,
      posting_closed_label: r.posting_closed ? 'yes' : '',
      added: String(r.created_at ?? '').slice(0, 10),
    } as Record<string, unknown>
    lines.push(cols.map(([, k]) => csvCell(full[k])).join(','))
  }
  // BOM so Excel reads UTF-8 (company names with accents) correctly.
  return '﻿' + lines.join('\r\n') + '\r\n'
}
