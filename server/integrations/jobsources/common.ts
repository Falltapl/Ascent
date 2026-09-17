/**
 * Shared vocabulary for every internship source: where a role is, what kind of
 * role it is, whether it's a Summer 2027 internship, and which degrees it asks
 * for. Each source adapter maps its own format onto these, so a listing from
 * AWS's careers site and one from SimplifyJobs are filtered by identical rules.
 */

/**
 * Bump whenever the rules below change what gets kept or how it's labelled.
 * Stored listings were classified by whatever rules existed at the time, and
 * an unchanged upstream file would otherwise never be re-read, so a version
 * change forces every source to be fetched and classified again.
 */
export const RULES_VERSION = 2

export type Region = 'DFW' | 'Austin' | 'Remote'
export type RoleType = 'cloud' | 'security' | 'software' | 'data'

export type Listing = {
  id: string; source: string; company: string; title: string; url: string; company_url: string | null
  locations: string[]; regions: Region[]; category: string | null; role_type: RoleType
  degrees: string[]; posted_at: string | null; updated_at: string | null
}

const DFW = ['dallas', 'fort worth', 'plano', 'irving', 'richardson', 'frisco', 'arlington', 'addison',
  'carrollton', 'grand prairie', 'mckinney', 'allen', 'lewisville', 'denton', 'southlake', 'westlake', 'coppell',
  'garland', 'the colony', 'farmers branch', 'grapevine', 'flower mound', 'north richland hills', 'mansfield',
  'euless', 'bedford', 'hurst', 'keller', 'rockwall', 'mesquite', 'cedar hill', 'las colinas']
const AUSTIN = ['austin', 'round rock', 'cedar park', 'georgetown', 'pflugerville', 'san marcos', 'kyle',
  'leander', 'bastrop', 'taylor', 'hutto', 'buda', 'lakeway', 'bee cave']

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/**
 * A city only counts when it's attached to Texas in the same string, in any
 * of the orders the sources use: "Austin, TX", "Austin, Texas, USA",
 * "USA - Austin, TX", "TX-Dallas", "United States, Texas, Austin". A bare
 * substring match wrongly counts "Austin, MN" and "Arlington, VA", both of
 * which appear in real listings, and a street named "Allen Blvd" in Houston.
 */
const cityPattern = (cities: string[]) => {
  const alt = cities.map(esc).join('|')
  return new RegExp(`(?:\\b(?:${alt})\\s*,\\s*(?:tx|texas)\\b)|(?:\\b(?:tx|texas)\\s*[-–,]\\s*(?:${alt})\\b)`, 'i')
}
const DFW_RE = cityPattern(DFW)
const AUSTIN_RE = cityPattern(AUSTIN)
const US_RE = /\b(us|usa|u\.s\.a?\.?|united states(?: of america)?)\b/i

export function regionsFor(locations: string[] | null | undefined): Region[] {
  const out = new Set<Region>()
  for (const raw of locations ?? []) {
    const l = raw.trim()
    if (/\bremote\b/i.test(l) && (US_RE.test(l) || /^remote$/i.test(l))) out.add('Remote')
    if (DFW_RE.test(l)) out.add('DFW')
    if (AUSTIN_RE.test(l)) out.add('Austin')
  }
  return (['DFW', 'Austin', 'Remote'] as const).filter((r) => out.has(r))
}

// Domains where "systems engineering" or "infrastructure" means physical or
// embedded systems, not cloud. Found in real listings: "Microcontrollers System
// Engineering Intern" (NXP) and "Autonomy & Intelligent Systems Engineering"
// (Caterpillar) were both being labelled cloud.
const HARDWARE = /\b(hardware|asic|silicon|chip|mechanical|electrical|analog|rf|pcb|firmware|manufacturing|robotics?|autonom\w*|embedded|microcontrollers?|avionics|aerospace|automotive|vehicles?)\b/i
const EXPLICIT_CLOUD = /\b(cloud|aws|azure|gcp|devops|devsecops|site reliability|sre)\b/i
const CLOUD = /\b(cloud|aws|azure|gcp|google cloud|devops|devsecops|site reliability|sre|infrastructure|platform (?:engineer\w*|software|operations)|kubernetes|systems? dev(?:elopment)? engineer\w*|systems? administrat\w*|network(?:ing)? (?:engineer\w*|operations|infrastructure)|data cent(?:er|re)s?|solutions architect\w*|cloud support|it (?:intern\w*|infrastructure|operations|engineer\w*|systems|support)|information technology|technology infrastructure|reliability engineer\w*)\b/i
const SECURITY = /\b(security|cyber\w*|detection engineer\w*|threat|soc analyst|identity and access|penetration|vulnerabilit\w*)\b/i
const SOFTWARE = /\b(software|sde|swe|developer|full[- ]?stack|back[- ]?end|front[- ]?end|mobile|web|programmer|application develop\w*|technology analyst|computer science)\b/i
const DATA = /\b(data|machine learning|ml|ai|artificial intelligence|analytics|scien\w+|llm|genai|business intelligence)\b/i

/**
 * Role type from a job title. Precedence is cloud > security > software >
 * data, so "Software Engineer Intern - AI & Cloud" is cloud and "AI Model
 * Optimization & Software Engineer" is software. Hardware, robotics and
 * embedded roles only count as cloud when the title says so outright:
 * "Hardware Engineering Intern - Infrastructure Solutions Group" is not cloud,
 * "Cloud Hardware Development Engineer" is.
 */
export function roleType(title: string): RoleType | null {
  const hardwareOnly = HARDWARE.test(title) && !EXPLICIT_CLOUD.test(title)
  if (!hardwareOnly && CLOUD.test(title)) return 'cloud'
  if (SECURITY.test(title)) return 'security'
  // A hardware or robotics domain only rules out "cloud". "Software Development
  // Engineer Intern, ROBOTICS" is still a software internship; titles with no
  // software or data words ("ASIC Engineer Intern") fall through to null.
  if (SOFTWARE.test(title)) return 'software'
  if (DATA.test(title)) return 'data'
  return null
}

export const isInternTitle = (title: string) =>
  /\b(intern(?:ship)?s?|co-?op)\b/i.test(title) && !/\bskillbridge\b/i.test(title)

/**
 * Summer 2027 unless the title says otherwise. Company career sites rarely
 * carry a structured term, so this rejects titles naming a different year or a
 * non-summer season, and keeps titles that name no term at all.
 */
export function looksSummer2027(title: string): boolean {
  const years = [...title.matchAll(/\b(20\d{2})\b/g)].map((m) => m[1])
  if (years.length && !years.includes('2027')) return false
  if (/\b(fall|spring|winter|autumn)\b/i.test(title) && !/\bsummer\b/i.test(title)) return false
  return true
}

const strip = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ')

/**
 * Degrees a posting requires, read from its description. Conservative on
 * purpose: a graduate degree only counts when the text says the candidate is
 * pursuing or enrolled in one, because "Master's preferred" doesn't exclude an
 * undergrad. Returns [] when nothing is clear, which the UI treats as eligible.
 */
export function degreesFromText(htmlOrText: string | null | undefined): string[] {
  if (!htmlOrText) return []
  const t = strip(htmlOrText)
  const bachelor = /\b(bachelor'?s?|undergrad\w*)\b/i.test(t)
  const near = (word: string) =>
    new RegExp(`\\b(pursuing|enrolled|working toward\\w*|candidate for|currently in|student in|completing)\\b[^.;]{0,80}\\b${word}`, 'i').test(t)
  const out: string[] = []
  if (bachelor) out.push("Bachelor's")
  if (near("(master'?s?|m\\.s\\.)")) out.push("Master's")
  if (near('(ph\\.?\\s?d|doctora\\w*)')) out.push('PhD')
  if (near('mba')) out.push('MBA')
  return out
}

/** Identity for spotting the same role reported by two sources. */
export function dedupeKey(company: string, title: string): string {
  const c = company.toLowerCase().replace(/\b(inc|llc|ltd|corp|corporation|company|co|technologies|technology|web services|group|holdings|the)\b/g, '').replace(/[^a-z0-9]+/g, '')
  const t = title.toLowerCase().replace(/\b(summer|20\d{2}|intern(ship)?s?|co-?op)\b/g, '').replace(/[^a-z0-9]+/g, '')
  return `${c}|${t}`
}

export const UA = 'Mozilla/5.0 (compatible; AscentPersonalJobTracker/1.0; single user, periodic refresh)'

export async function fetchJson<T>(url: string, init: RequestInit = {}, timeoutMs = 25_000): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { Accept: 'application/json', 'User-Agent': UA, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).hostname}`)
  return res.json() as Promise<T>
}

export async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]) }
  }))
  return out
}
