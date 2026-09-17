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

// "Graduate" alone marks a grad program ("Software Engineering - Intern, Graduate");
// \b keeps it from matching inside "Undergraduate".
const GRAD_IN_TITLE = /\b(ph\.?\s?d|doctoral|post-?doc|master'?s|masters|mba|graduate)\b/i
const UNDERGRAD_IN_TITLE = /\b(undergrad(uate)?|bachelor'?s)\b/i

/**
 * Whether a listing is open to someone working on a bachelor's degree.
 *
 * The degrees list is the main signal. The title is a second check, because a
 * listing can accept "Bachelor's" in its metadata while its title says
 * "- PhD", and when the metadata is empty the title is all there is. A title
 * naming both ("Undergraduate and Master's") stays eligible. Listings with no
 * degrees and no hint in the title are kept: unknown is not the same as
 * excluded, and dropping them would hide real undergrad roles.
 */
export function undergradEligible(l: { degrees: string[]; title: string }): boolean {
  const gradTitle = GRAD_IN_TITLE.test(l.title) && !UNDERGRAD_IN_TITLE.test(l.title)
  if (gradTitle) return false
  if (!l.degrees.length) return true
  return l.degrees.some((d) => /^(bachelor|associate)/i.test(d))
}

/** "PhD only", "Master's & PhD", etc. — for explaining why a role is excluded. */
export function gradOnlyLabel(degrees: string[]): string {
  const grad = degrees.filter((d) => !/^(bachelor|associate)/i.test(d))
  if (!grad.length) return 'Grad students only'
  return `${grad.join(' & ')} only`
}

/** "just now", "12m ago", "3h ago", then falls back to relativeDay. */
export function relativeTime(iso: string | null, now = new Date()): string {
  if (!iso) return ''
  const mins = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (mins < 24 * 60) return `${Math.floor(mins / 60)}h ago`
  return relativeDay(iso, now)
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
