import { db, meta, nowISO } from '../../db.ts'
import { fetchSimplify } from '../simplify.ts'
import { fetchAmazon } from './amazon.ts'
import { fetchWorkdaySite, WORKDAY_SITES, type CachedDetail, type DetailCache } from './workday.ts'
import { dedupeKey, pool, RULES_VERSION, type Listing } from './common.ts'

/**
 * Keeps jobs_feed current from every source:
 *
 *   1. SimplifyJobs (one file, conditional GET, cheap to check often)
 *   2. Company career sites — AWS and ~28 Workday employers (many requests,
 *      so throttled per source)
 *
 * Each source owns its rows: a source that fails keeps its last good listings
 * rather than having them wiped, and a source can only delete its own rows.
 * A role reported by both SimplifyJobs and a company site is kept once, from
 * Simplify, because Simplify carries structured degree data.
 */

export type SourceStatus = {
  id: string; name: string; ok: boolean; count: number
  error?: string; checked_at: string | null; skipped?: boolean
}

type CompanySource = { id: string; name: string; run: (cache: DetailCache) => Promise<{ listings: Listing[]; requests: number }> }

const COMPANY_SOURCES: CompanySource[] = [
  { id: 'amazon', name: 'Amazon / AWS', run: () => fetchAmazon() },
  ...WORKDAY_SITES.map((s): CompanySource => ({
    id: `workday:${s.host.split('.')[0]}`, name: s.company, run: (cache) => fetchWorkdaySite(s, cache),
  })),
]

const loadStatuses = (): Record<string, SourceStatus> => {
  try { return JSON.parse(meta.get('jobs:sources') ?? '{}') } catch { return {} }
}

const detailCache: DetailCache = {
  get(id) {
    const r = db.prepare('SELECT * FROM job_detail_cache WHERE id = ?').get(id) as any
    return r ? { title: r.title, locations: JSON.parse(r.locations), degrees: JSON.parse(r.degrees), posted_at: r.posted_at, url: r.url } : undefined
  },
  set(id, d: CachedDetail) {
    db.prepare(`INSERT INTO job_detail_cache (id, title, locations, degrees, posted_at, url, seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET title=excluded.title, locations=excluded.locations, degrees=excluded.degrees,
                posted_at=excluded.posted_at, url=excluded.url, seen_at=excluded.seen_at`)
      .run(id, d.title, JSON.stringify(d.locations), JSON.stringify(d.degrees), d.posted_at, d.url, nowISO())
  },
}

/** Replace one source's rows atomically. Other sources are untouched. */
export function persistSource(source: string, listings: Listing[]): { kept: number; removed: number } {
  const upsert = db.prepare(`
    INSERT INTO jobs_feed (id, source, company, title, url, company_url, locations, regions, category, role_type, degrees, posted_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET source=excluded.source, company=excluded.company, title=excluded.title, url=excluded.url,
      company_url=excluded.company_url, locations=excluded.locations, regions=excluded.regions, category=excluded.category,
      role_type=excluded.role_type, degrees=excluded.degrees, posted_at=excluded.posted_at, updated_at=excluded.updated_at
  `)
  db.exec('BEGIN')
  try {
    db.exec('CREATE TEMP TABLE IF NOT EXISTS _keep (id TEXT PRIMARY KEY)')
    db.exec('DELETE FROM _keep')
    const keep = db.prepare('INSERT OR IGNORE INTO _keep (id) VALUES (?)')
    for (const l of listings) {
      keep.run(l.id)
      upsert.run(l.id, source, l.company, l.title, l.url, l.company_url, JSON.stringify(l.locations), JSON.stringify(l.regions),
        l.category, l.role_type, JSON.stringify(l.degrees), l.posted_at, l.updated_at)
    }
    const removed = db.prepare('DELETE FROM jobs_feed WHERE source = ? AND id NOT IN (SELECT id FROM _keep)').run(source).changes
    db.exec('COMMIT')
    return { kept: listings.length, removed: Number(removed) }
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

/** A tracked listing no longer in any source has been taken down. */
function markClosedPostings() {
  db.prepare(`UPDATE applications SET posting_closed = CASE WHEN feed_id IN (SELECT id FROM jobs_feed) THEN 0 ELSE 1 END
              WHERE feed_id IS NOT NULL`).run()
}

export type RefreshOptions = { companyMinIntervalMs: number; simplifyFetch?: typeof fetch; sources?: CompanySource[] }
export type RefreshSummary = { statuses: SourceStatus[]; total: number; durationMs: number }

let running: Promise<RefreshSummary> | null = null
export const isRefreshing = () => running !== null

/** Concurrent callers share one in-flight refresh instead of starting another. */
export function refreshJobs(opts: RefreshOptions): Promise<RefreshSummary> {
  running ??= doRefresh(opts).finally(() => { running = null })
  return running
}

async function doRefresh({ companyMinIntervalMs, simplifyFetch, sources = COMPANY_SOURCES }: RefreshOptions): Promise<RefreshSummary> {
  const t0 = Date.now()
  const rulesChanged = meta.get('jobs:rules') !== String(RULES_VERSION)
  // New rules invalidate every stored classification: skip the throttle and
  // the conditional GET so all sources are re-read under the current rules.
  const prev = rulesChanged ? {} : loadStatuses()
  const statuses: Record<string, SourceStatus> = {}
  const now = () => nowISO()

  // 1. SimplifyJobs
  try {
    const have = db.prepare(`SELECT COUNT(*) n, SUM(role_type IS NULL) missing FROM jobs_feed WHERE source='simplify'`).get() as { n: number; missing: number | null }
    // Only use the validator when stored rows are complete for that version —
    // rows written before role types existed must be re-derived.
    const etag = have.n > 0 && !have.missing && !rulesChanged ? meta.get('jobs:etag') : null
    const r = await fetchSimplify(etag, simplifyFetch)
    let count = have.n
    if (!r.unchanged) {
      count = persistSource('simplify', r.listings).kept
      if (r.etag) meta.set('jobs:etag', r.etag)
    }
    statuses.simplify = { id: 'simplify', name: 'SimplifyJobs', ok: true, count, checked_at: now() }
  } catch (e: any) {
    statuses.simplify = { ...(prev.simplify ?? { id: 'simplify', name: 'SimplifyJobs', count: 0, checked_at: null }), ok: false, error: e.message }
  }

  // 2. Company career sites
  const simplifyKeys = new Set((db.prepare(`SELECT company, title FROM jobs_feed WHERE source='simplify'`).all() as { company: string; title: string }[])
    .map((r) => dedupeKey(r.company, r.title)))

  await pool(sources, 4, async (src) => {
    const last = prev[src.id]
    const fresh = last?.ok && last.checked_at && Date.now() - new Date(last.checked_at).getTime() < companyMinIntervalMs
    if (fresh) { statuses[src.id] = { ...last, skipped: true }; return }
    try {
      const { listings } = await src.run(detailCache)
      const unique = listings.filter((l) => !simplifyKeys.has(dedupeKey(l.company, l.title)))
      const { kept } = persistSource(src.id, unique)
      statuses[src.id] = { id: src.id, name: src.name, ok: true, count: kept, checked_at: now() }
    } catch (e: any) {
      statuses[src.id] = { ...(last ?? { id: src.id, name: src.name, count: 0, checked_at: null }), ok: false, error: String(e.message ?? e).slice(0, 200) }
    }
  })

  markClosedPostings()
  if (Object.values(statuses).every((s) => s.ok)) meta.set('jobs:rules', String(RULES_VERSION))
  db.prepare(`DELETE FROM job_detail_cache WHERE seen_at < ?`).run(new Date(Date.now() - 45 * 86_400_000).toISOString())
  meta.set('jobs:sources', JSON.stringify(statuses))
  meta.set('sync:jobs', now())

  const list = [statuses.simplify, ...sources.map((s) => statuses[s.id])].filter(Boolean)
  const total = (db.prepare('SELECT COUNT(*) n FROM jobs_feed').get() as { n: number }).n
  return { statuses: list, total, durationMs: Date.now() - t0 }
}

export const sourceStatuses = (): SourceStatus[] => {
  const s = loadStatuses()
  return [s.simplify, ...COMPANY_SOURCES.map((c) => s[c.id])].filter(Boolean)
}

const HOUR = 3_600_000
/**
 * Background refresh while the server runs. Checks every 30 minutes rather than
 * sleeping 3 hours, so a laptop waking from sleep catches up promptly instead of
 * waiting out a timer that was paused. SimplifyJobs is re-checked every 3 hours;
 * company sites at most every 6, since they cost ~30x more requests.
 */
export function startJobsScheduler(log: (m: string) => void = console.log) {
  const tick = async () => {
    const last = meta.get('sync:jobs')
    if (last && Date.now() - new Date(last).getTime() < 3 * HOUR) return
    try {
      const r = await refreshJobs({ companyMinIntervalMs: 6 * HOUR })
      const failed = r.statuses.filter((s) => !s.ok).map((s) => s.name)
      log(`[jobs] background refresh: ${r.total} listings in ${(r.durationMs / 1000).toFixed(0)}s${failed.length ? ` — failed: ${failed.join(', ')}` : ''}`)
    } catch (e: any) {
      log(`[jobs] background refresh failed: ${e.message}`)
    }
  }
  setTimeout(tick, 15_000).unref()
  setInterval(tick, 30 * 60_000).unref()
}
