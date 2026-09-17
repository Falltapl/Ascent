import { degreesFromText, fetchJson, isInternTitle, looksSummer2027, pool, regionsFor, roleType, type Listing } from './common.ts'

/** A posting's detail as last fetched. Kept for rejected postings too. */
export type CachedDetail = { title: string; locations: string[]; degrees: string[]; posted_at: string | null; url: string }
export type DetailCache = { get(id: string): CachedDetail | undefined; set(id: string, d: CachedDetail): void }

/**
 * Company career sites hosted on Workday. Every Workday site serves its
 * listings from the same JSON endpoint its own page calls, so one adapter
 * covers all of them. Site names were taken from real posting URLs rather
 * than guessed, and each was probed live before being added.
 */
export type WorkdaySite = { company: string; host: string; site: string }

// Employers with Dallas-Fort Worth or Austin offices and cloud, infrastructure,
// security or software internships. Dell is absent: its Workday site rejects
// these requests (HTTP 422).
export const WORKDAY_SITES: WorkdaySite[] = [
  { company: 'Capital One', host: 'capitalone.wd12', site: 'Capital_One' },
  { company: 'CrowdStrike', host: 'crowdstrike.wd5', site: 'crowdstrikecareers' },
  { company: 'Salesforce', host: 'salesforce.wd12', site: 'Futureforce_Internships' },
  { company: 'Visa', host: 'visa.wd5', site: 'Visa' },
  { company: 'Cisco', host: 'cisco.wd5', site: 'cisco_careers' },
  { company: 'Hewlett Packard Enterprise', host: 'hpe.wd5', site: 'Jobsathpe' },
  { company: 'Palo Alto Networks', host: 'paloaltonetworks.wd5', site: 'panwexternalcareers' },
  { company: 'SailPoint', host: 'sailpoint.wd1', site: 'SailPoint' },
  { company: 'Q2', host: 'q2ebanking.wd5', site: 'Q2' },
  { company: 'NVIDIA', host: 'nvidia.wd5', site: 'NVIDIAExternalCareerSite' },
  { company: 'Intel', host: 'intel.wd1', site: 'External' },
  { company: 'Samsung', host: 'sec.wd3', site: 'Samsung_Careers' },
  { company: 'AT&T', host: 'att.wd1', site: 'ATTCollege' },
  { company: 'Verizon', host: 'verizon.wd12', site: 'verizon-careers' },
  { company: 'T-Mobile', host: 'tmobile.wd1', site: 'External' },
  { company: 'USAA', host: 'usaa.wd1', site: 'USAAJOBSWD' },
  { company: 'Fidelity Investments', host: 'fmr.wd1', site: 'fidelitycareers' },
  { company: 'Bank of America', host: 'ghr.wd1', site: 'us-emplsv' },
  { company: 'Citi', host: 'citi.wd5', site: '2' },
  { company: 'McKesson', host: 'mckesson.wd3', site: 'External_Careers' },
  { company: 'Southwest Airlines', host: 'swa.wd1', site: 'external' },
  { company: 'Vistra', host: 'vst.wd5', site: 'vistra_careers' },
  { company: 'Expedia Group', host: 'expedia.wd108', site: 'search' },
  { company: 'Accenture', host: 'accenture.wd103', site: 'AccentureCareers' },
  { company: 'PwC', host: 'pwc.wd3', site: 'US_Entry_Level_Careers' },
  { company: 'General Motors', host: 'generalmotors.wd5', site: 'Careers_GM' },
  { company: 'ERCOT', host: 'ercot.wd1', site: 'ercot_careers' },
  { company: 'Red Hat', host: 'redhat.wd5', site: 'jobs' },
]

type Facet = { facetParameter?: string; descriptor?: string; id?: string; count?: number; values?: Facet[] }
type ListResponse = { total?: number; jobPostings?: { title?: string; externalPath?: string; locationsText?: string }[]; facets?: Facet[] }
type Detail = { jobPostingInfo?: { title?: string; jobDescription?: string; location?: string; additionalLocations?: string[]; startDate?: string; externalUrl?: string } }

const PAGE = 20
const MAX_FACETED = 200
const MAX_SEARCHED = 100
const MAX_DETAILS = 40

const FACET_PARAMS = new Set(['workerSubType', 'jobFamilyGroup', 'jobFamily', 'Job_Family', 'timeType', 'workerType'])
const INTERN_FACET = /\b(intern(?:ship)?s?|co-?op|student|apprentice\w*)\b/i
const NOT_INTERN_FACET = /\b(internal|international|audit)\b/i

/**
 * The site's own "Intern" filter, when it has one. Only job-type facets are
 * considered: an earlier version matched location facets such as "College
 * Station" and job families such as "Internal Audit".
 */
export function findInternFacet(facets: Facet[] | undefined): { param: string; id: string } | null {
  const hits: { param: string; id: string; count: number; subType: boolean }[] = []
  const walk = (fs: Facet[] | undefined, param?: string) => {
    for (const f of fs ?? []) {
      const p = f.facetParameter ?? param
      if (f.values) walk(f.values, p)
      if (!p || !FACET_PARAMS.has(p) || !f.id || !f.descriptor) continue
      if (INTERN_FACET.test(f.descriptor) && !NOT_INTERN_FACET.test(f.descriptor)) {
        hits.push({ param: p, id: f.id, count: f.count ?? 0, subType: p === 'workerSubType' })
      }
    }
  }
  walk(facets)
  hits.sort((a, b) => Number(b.subType) - Number(a.subType) || b.count - a.count)
  return hits[0] ? { param: hits[0].param, id: hits[0].id } : null
}

const base = (s: WorkdaySite) => {
  const tenant = s.host.split('.')[0]
  return { origin: `https://${s.host}.myworkdayjobs.com`, api: `https://${s.host}.myworkdayjobs.com/wday/cxs/${tenant}/${s.site}`, tenant }
}

async function list(s: WorkdaySite, body: object) {
  return fetchJson<ListResponse>(`${base(s).api}/jobs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ limit: PAGE, offset: 0, searchText: '', appliedFacets: {}, ...body }),
  })
}

/**
 * @param cache detail pages already fetched, including ones that were rejected.
 *   A posting seen before with the same title is not re-fetched, so a steady-
 *   state refresh is mostly just the list pages.
 */
export async function fetchWorkdaySite(s: WorkdaySite, cache: DetailCache): Promise<{ listings: Listing[]; requests: number }> {
  const { origin, api, tenant } = base(s)
  let requests = 0
  const first = await list(s, {})
  requests++
  const facet = findInternFacet(first.facets)

  const postings: NonNullable<ListResponse['jobPostings']> = []
  const cap = facet ? MAX_FACETED : MAX_SEARCHED
  for (let offset = 0; offset < cap; offset += PAGE) {
    const page = await list(s, facet
      ? { offset, appliedFacets: { [facet.param]: [facet.id] } }
      : { offset, searchText: 'intern' })
    requests++
    const got = page.jobPostings ?? []
    postings.push(...got)
    if (got.length < PAGE) break
  }

  const candidates = postings.filter((p) =>
    p.externalPath && p.title && isInternTitle(p.title) && looksSummer2027(p.title) && roleType(p.title))
    .slice(0, MAX_DETAILS)

  const listings = await pool(candidates, 4, async (p): Promise<Listing | null> => {
    const id = `wd:${tenant}:${p.externalPath}`
    const title = p.title!.trim()
    const role = roleType(title)!
    const prior = cache.get(id)
    let locations: string[], degrees: string[], posted: string | null, url: string
    if (prior && prior.title === title) {
      ({ locations, degrees, url } = prior); posted = prior.posted_at
    } else {
      const d = await fetchJson<Detail>(`${api}${p.externalPath}`)
      requests++
      const info = d.jobPostingInfo ?? {}
      locations = [info.location, ...(info.additionalLocations ?? [])].filter((x): x is string => !!x)
      if (!locations.length && p.locationsText) locations = [p.locationsText]
      degrees = degreesFromText(info.jobDescription)
      posted = info.startDate ? new Date(`${info.startDate}T12:00:00Z`).toISOString() : null
      url = info.externalUrl ?? `${origin}/${s.site}${p.externalPath}`
      cache.set(id, { title, locations, degrees, posted_at: posted, url })
    }
    const regions = regionsFor(locations)
    if (!regions.length) return null
    return {
      id, source: `workday:${tenant}`, company: s.company, title, url, company_url: `${origin}/${s.site}`,
      locations, regions, category: null, role_type: role, degrees, posted_at: posted, updated_at: null,
    }
  })
  return { listings: listings.filter((x): x is Listing => x !== null), requests }
}
