import { degreesFromText, fetchJson, isInternTitle, looksSummer2027, regionsFor, roleType, type Listing } from './common.ts'

/**
 * Amazon and AWS internships from amazon.jobs — the JSON endpoint its own
 * search page calls. AWS's Dallas and Austin teams post here (Solutions
 * Architect, SDE, cloud hardware), and many of these never reach the
 * community lists.
 *
 * The search is fuzzy — "intern" matches ~1,000 full-time roles — and the
 * is_intern field is always empty in practice, so titles are the filter.
 */
type AmazonJob = {
  id_icims: string; title: string; job_path: string; company_name?: string
  locations?: string[]; normalized_location?: string; posted_date?: string
  basic_qualifications?: string; preferred_qualifications?: string; job_category?: string
}

const QUERIES = ['intern', 'internship', 'co-op']
const PAGE = 100
const MAX_OFFSET = 1200

export function amazonLocations(j: AmazonJob): string[] {
  const out: string[] = []
  for (const raw of j.locations ?? []) {
    try {
      const l = JSON.parse(raw) as { city?: string; normalizedStateName?: string; normalizedCountryCode?: string }
      if (l.city) out.push([l.city, l.normalizedStateName, l.normalizedCountryCode].filter(Boolean).join(', '))
    } catch { /* malformed entry: ignore */ }
  }
  return out.length ? out : j.normalized_location ? [j.normalized_location] : []
}

export function mapAmazon(j: AmazonJob): Listing | null {
  if (!j?.id_icims || !j.title || !j.job_path) return null
  if (!isInternTitle(j.title) || !looksSummer2027(j.title)) return null
  const role = roleType(j.title)
  if (!role) return null
  const locations = amazonLocations(j)
  const regions = regionsFor(locations)
  if (!regions.length) return null
  const posted = j.posted_date ? new Date(j.posted_date.replace(/\s+/g, ' ')) : null
  return {
    id: `amazon:${j.id_icims}`, source: 'amazon',
    company: /web services/i.test(j.company_name ?? '') ? 'Amazon Web Services' : 'Amazon',
    title: j.title.trim(), url: `https://www.amazon.jobs${j.job_path}`, company_url: 'https://www.amazon.jobs',
    locations, regions, category: j.job_category ?? null, role_type: role,
    degrees: degreesFromText(`${j.basic_qualifications ?? ''} ${j.preferred_qualifications ?? ''}`),
    posted_at: posted && !Number.isNaN(posted.getTime()) ? posted.toISOString() : null, updated_at: null,
  }
}

export async function fetchAmazon(): Promise<{ listings: Listing[]; requests: number }> {
  const seen = new Map<string, AmazonJob>()
  let requests = 0
  for (const q of QUERIES) {
    for (let offset = 0; offset < MAX_OFFSET; offset += PAGE) {
      const url = `https://www.amazon.jobs/en/search.json?${new URLSearchParams({
        base_query: q, country: 'USA', result_limit: String(PAGE), offset: String(offset), sort: 'recent',
      })}`
      const d = await fetchJson<{ jobs?: AmazonJob[] }>(url)
      requests++
      const jobs = d.jobs ?? []
      for (const j of jobs) seen.set(j.id_icims, j)
      if (jobs.length < PAGE) break
    }
  }
  const listings = [...seen.values()].map(mapAmazon).filter((x): x is Listing => x !== null)
  return { listings, requests }
}
