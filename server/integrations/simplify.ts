import { regionsFor, roleType, type Listing, type RoleType } from './jobsources/common.ts'
export { regionsFor } from './jobsources/common.ts'

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
const fromCategory = (c: string | undefined): RoleType | null =>
  !c ? null : /software/i.test(c) ? 'software' : /data|ai/i.test(c) ? 'data' : null

type Raw = {
  id: string; company_name: string; title: string; url: string; company_url?: string
  locations?: string[]; category?: string; degrees?: string[]; terms?: string[]
  active?: boolean; is_visible?: boolean; date_posted?: number; date_updated?: number
}

const iso = (sec?: number) => (typeof sec === 'number' && sec > 0 ? new Date(sec * 1000).toISOString() : null)

/**
 * The filter, separated from I/O so it can be tested against fixtures. Keeps
 * software and AI/data categories as before, and now also cloud and security
 * roles Simplify filed elsewhere — its categories have no "cloud" bucket, so a
 * cloud role can land under Hardware or Product.
 */
export function selectListings(rows: Raw[], term = TERM): Listing[] {
  const kept: Listing[] = []
  for (const x of rows) {
    if (!x?.id || !x.url || !x.company_name || !x.title) continue
    if (x.active !== true || x.is_visible === false) continue
    if (!(x.terms ?? []).includes(term)) continue
    const byTitle = roleType(x.title)
    const tech = TECH.has(x.category ?? '')
    if (!tech && byTitle !== 'cloud' && byTitle !== 'security') continue
    const role = byTitle ?? fromCategory(x.category)
    if (!role) continue
    const regions = regionsFor(x.locations)
    if (!regions.length) continue
    kept.push({
      id: String(x.id), source: 'simplify', company: x.company_name.trim(), title: x.title.trim(), url: x.url,
      company_url: x.company_url ?? null, locations: x.locations ?? [], regions,
      category: x.category ?? null, role_type: role, degrees: x.degrees ?? [],
      posted_at: iso(x.date_posted), updated_at: iso(x.date_updated),
    })
  }
  return kept
}

export type SimplifyResult =
  | { unchanged: true }
  | { unchanged: false; listings: Listing[]; scanned: number; etag: string | null }

/** @param etag send only when the stored rows are complete for this version. */
export async function fetchSimplify(etag: string | null, fetchImpl: typeof fetch = fetch): Promise<SimplifyResult> {
  const res = await fetchImpl(FEED_URL, {
    headers: etag ? { 'If-None-Match': etag } : {},
    signal: AbortSignal.timeout(60_000),
  })
  if (res.status === 304) return { unchanged: true }
  if (!res.ok) throw new Error(`Internship feed returned HTTP ${res.status}`)
  const rows = (await res.json()) as Raw[]
  if (!Array.isArray(rows)) throw new Error('Internship feed was not a list — the upstream format may have changed')
  return { unchanged: false, listings: selectListings(rows), scanned: rows.length, etag: res.headers.get('etag') }
}
