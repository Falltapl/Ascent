import { db, meta, nowISO } from '../db.ts'

/**
 * Open internships from SimplifyJobs' community list (github.com/SimplifyJobs),
 * maintained daily by Simplify and Pitt CSC. The repo publishes every listing as
 * one JSON file (~13 MB, ~17k rows across all terms); this downloads it, keeps
 * the matching slice, and stores only that. The repo carries no license, so the
 * data is read at runtime for personal use and never committed or republished.
 */
export const FEED_URL = process.env.INTERNSHIP_FEED_URL
  || 'https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/dev/.github/scripts/listings.json'
export const TERM = process.env.INTERNSHIP_TERM || 'Summer 2027'

/** Simplify's category names changed over time; both spellings are live in the file. */
const TECH = new Set(['Software', 'Software Engineering', 'AI/ML/Data', 'Data Science, AI & Machine Learning'])

const DFW = new Set(['dallas', 'fort worth', 'plano', 'irving', 'richardson', 'frisco', 'arlington', 'addison',
  'carrollton', 'grand prairie', 'mckinney', 'allen', 'lewisville', 'denton', 'southlake', 'westlake', 'coppell',
  'garland', 'the colony', 'farmers branch', 'grapevine', 'flower mound', 'north richland hills', 'mansfield',
  'euless', 'bedford', 'hurst', 'keller', 'rockwall', 'mesquite', 'cedar hill', 'las colinas'])
const AUSTIN = new Set(['austin', 'round rock', 'cedar park', 'georgetown', 'pflugerville', 'san marcos', 'kyle',
  'leander', 'bastrop', 'taylor', 'hutto', 'buda', 'lakeway', 'bee cave'])

export type Region = 'DFW' | 'Austin' | 'Remote'

/**
 * Which tracked regions a listing's locations fall in. Matches city AND state:
 * a bare substring match counts "Austin, MN" as Austin and "Arlington, VA" as
 * DFW, both of which appear in the real data.
 */
export function regionsFor(locations: string[] | null | undefined): Region[] {
  const out = new Set<Region>()
  for (const raw of locations ?? []) {
    const l = raw.trim()
    if (/^remote(,?\s*(in\s+)?(the\s+)?(us|usa|united states))?$/i.test(l)) { out.add('Remote'); continue }
    const m = l.match(/^(.+?),\s*(TX|Texas)$/i)
    if (!m) continue
    const city = m[1].trim().toLowerCase()
    if (DFW.has(city)) out.add('DFW')
    if (AUSTIN.has(city)) out.add('Austin')
  }
  return (['DFW', 'Austin', 'Remote'] as const).filter((r) => out.has(r))
}

type Raw = {
  id: string; company_name: string; title: string; url: string; company_url?: string
  locations?: string[]; category?: string; degrees?: string[]; terms?: string[]
  active?: boolean; is_visible?: boolean; date_posted?: number; date_updated?: number
}

export type Kept = {
  id: string; company: string; title: string; url: string; company_url: string | null
  locations: string[]; regions: Region[]; category: string | null; degrees: string[]
  posted_at: string | null; updated_at: string | null
}

const iso = (sec?: number) => (typeof sec === 'number' && sec > 0 ? new Date(sec * 1000).toISOString() : null)

/** The filter, separated from I/O so it can be tested against fixtures. */
export function selectListings(rows: Raw[], term = TERM): Kept[] {
  const kept: Kept[] = []
  for (const x of rows) {
    if (!x?.id || !x.url || !x.company_name || !x.title) continue
    if (x.active !== true || x.is_visible === false) continue
    if (!(x.terms ?? []).includes(term)) continue
    if (!TECH.has(x.category ?? '')) continue
    const regions = regionsFor(x.locations)
    if (!regions.length) continue
    kept.push({
      id: String(x.id), company: x.company_name.trim(), title: x.title.trim(), url: x.url,
      company_url: x.company_url ?? null, locations: x.locations ?? [], regions,
      category: x.category ?? null, degrees: x.degrees ?? [],
      posted_at: iso(x.date_posted), updated_at: iso(x.date_updated),
    })
  }
  return kept
}

export async function syncInternships(fetchImpl: typeof fetch = fetch) {
  const headers: Record<string, string> = {}
  const etag = meta.get('jobs:etag')
  // Only send a validator if the table actually holds what it describes.
  const have = (db.prepare(`SELECT COUNT(*) n FROM jobs_feed`).get() as { n: number }).n
  if (etag && have > 0) headers['If-None-Match'] = etag

  const res = await fetchImpl(FEED_URL, { headers, signal: AbortSignal.timeout(60_000) })
  if (res.status === 304) {
    meta.set('sync:jobs', nowISO())
    return { unchanged: true, kept: have }
  }
  if (!res.ok) throw new Error(`Internship feed returned HTTP ${res.status}`)

  const rows = (await res.json()) as Raw[]
  if (!Array.isArray(rows)) throw new Error('Internship feed was not a list — the upstream format may have changed')
  const kept = selectListings(rows)

  const upsert = db.prepare(`
    INSERT INTO jobs_feed (id, company, title, url, company_url, locations, regions, category, degrees, posted_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET company=excluded.company, title=excluded.title, url=excluded.url,
      company_url=excluded.company_url, locations=excluded.locations, regions=excluded.regions,
      category=excluded.category, degrees=excluded.degrees, posted_at=excluded.posted_at, updated_at=excluded.updated_at
  `)

  db.exec('BEGIN')
  try {
    db.exec(`CREATE TEMP TABLE IF NOT EXISTS _keep (id TEXT PRIMARY KEY)`)
    db.exec(`DELETE FROM _keep`)
    const keep = db.prepare(`INSERT OR IGNORE INTO _keep (id) VALUES (?)`)
    for (const k of kept) {
      keep.run(k.id)
      upsert.run(k.id, k.company, k.title, k.url, k.company_url, JSON.stringify(k.locations),
        JSON.stringify(k.regions), k.category, JSON.stringify(k.degrees), k.posted_at, k.updated_at)
    }
    const removed = db.prepare(`DELETE FROM jobs_feed WHERE id NOT IN (SELECT id FROM _keep)`).run().changes
    // A tracked listing that dropped out of the active set has been taken down
    // (or moved out of scope). Flag it rather than deleting the user's row.
    db.prepare(`UPDATE applications SET posting_closed = CASE WHEN feed_id IN (SELECT id FROM _keep) THEN 0 ELSE 1 END
                WHERE feed_id IS NOT NULL`).run()
    db.exec('COMMIT')
    const newTag = res.headers.get('etag')
    if (newTag) meta.set('jobs:etag', newTag)
    meta.set('sync:jobs', nowISO())
    return { unchanged: false, scanned: rows.length, kept: kept.length, removed: Number(removed) }
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}
