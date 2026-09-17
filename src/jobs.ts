import type { Application, StatusDef } from './api'

/** Days are compared as local calendar dates, never as UTC timestamps. */
export const localDay = (d = new Date()) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)

const dayNum = (ymd: string) => Math.round(Date.parse(`${ymd}T00:00:00Z`) / 86_400_000)

/** Whole local days from `ymd` to today (positive = in the past). */
export const daysSince = (ymd: string, today = localDay()) => dayNum(today) - dayNum(ymd)

export const HEARD_BACK = new Set(['oa', 'interviewing', 'offer', 'accepted', 'rejected'])

/** Weeks of silence after applying before an application reads as stale. */
export const STALE_AFTER_DAYS = 21

/**
 * An application still sitting at "applied" with no reply. Uses applied_on —
 * the date the user says it went out — so backfilled entries age correctly,
 * falling back to when the status last changed.
 */
export function staleDays(a: Pick<Application, 'status' | 'applied_on' | 'status_changed_at'>, today = localDay()): number | null {
  if (a.status !== 'applied') return null
  const since = a.applied_on ?? localDay(new Date(a.status_changed_at))
  const d = daysSince(since, today)
  return d >= STALE_AFTER_DAYS ? d : null
}

export type Due = 'overdue' | 'soon' | 'later' | null
export function dueTone(ymd: string | null, today = localDay()): Due {
  if (!ymd) return null
  const d = -daysSince(ymd, today) // days until
  return d < 0 ? 'overdue' : d <= 3 ? 'soon' : 'later'
}

/** Share of sent applications that got any response, including rejections. */
export function heardBackRate(apps: Pick<Application, 'status'>[]): number | null {
  const sent = apps.filter((a) => a.status !== 'saved')
  if (!sent.length) return null
  return Math.round((sent.filter((a) => HEARD_BACK.has(a.status)).length / sent.length) * 100)
}

export function relativeDay(iso: string | null, now = new Date()): string {
  if (!iso) return ''
  const d = daysSince(localDay(new Date(iso)), localDay(now))
  if (d <= 0) return 'today'
  if (d === 1) return 'yesterday'
  if (d < 14) return `${d}d ago`
  if (d < 60) return `${Math.floor(d / 7)}w ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export const groupOf = (statuses: StatusDef[], id: string) => statuses.find((s) => s.id === id)?.group ?? 'saved'

/** Colour follows meaning, not the accent — same rule as grades and deadlines. */
export function statusTone(statuses: StatusDef[], id: string): string {
  if (id === 'rejected') return 'text-[var(--bad)] bg-[var(--bad)]/12 border-[var(--bad)]/30'
  switch (groupOf(statuses, id)) {
    case 'applied': return 'text-[var(--accent-2)] bg-[var(--accent-2)]/12 border-[var(--accent-2)]/30'
    case 'active': return 'text-[var(--warn)] bg-[var(--warn)]/12 border-[var(--warn)]/30'
    case 'offer': return 'text-[var(--ok)] bg-[var(--ok)]/12 border-[var(--ok)]/30'
    case 'closed': return 'text-[var(--muted)] bg-[var(--ink)]/5 border-[var(--line)]'
    default: return 'text-[var(--ink-2)] bg-[var(--ink)]/5 border-[var(--line)]'
  }
}

const GROUP_RANK: Record<string, number> = { active: 0, offer: 1, applied: 2, saved: 3, closed: 4 }

/**
 * Default ordering: whatever needs you soonest. Rows with a next-step date
 * come first, earliest (including overdue) at the top; then by pipeline stage
 * so live interviews sit above saved listings; closed rows sink.
 */
export function byAttention(statuses: StatusDef[]) {
  return (a: Application, b: Application) => {
    const ca = groupOf(statuses, a.status) === 'closed', cb = groupOf(statuses, b.status) === 'closed'
    if (ca !== cb) return ca ? 1 : -1
    if (a.next_step_on && b.next_step_on && a.next_step_on !== b.next_step_on) return a.next_step_on < b.next_step_on ? -1 : 1
    if (!!a.next_step_on !== !!b.next_step_on) return a.next_step_on ? -1 : 1
    const g = GROUP_RANK[groupOf(statuses, a.status)] - GROUP_RANK[groupOf(statuses, b.status)]
    if (g) return g
    return a.updated_at < b.updated_at ? 1 : -1
  }
}
