/**
 * Coursera's Catalog API is public and unauthenticated — verified working.
 * Learner PROGRESS is gated behind Coursera for Business/Campus OAuth and is
 * unavailable to individual accounts, so progress is tracked locally and only
 * course metadata is auto-filled here.
 */
const API = 'https://api.coursera.org/api/courses.v1'

export type CourseMeta = {
  slug: string
  name: string
  description?: string
  workload?: string
  photoUrl?: string
}

/** Accepts a full coursera.org/learn/<slug> URL or a bare slug. */
export function parseSlug(input: string): string | null {
  const s = input.trim()
  const m = s.match(/coursera\.org\/(?:learn|specializations|professional-certificates)\/([a-z0-9-]+)/i)
  if (m) return m[1]
  return /^[a-z0-9-]+$/i.test(s) ? s : null
}

export async function lookupCourse(input: string): Promise<CourseMeta> {
  const slug = parseSlug(input)
  if (!slug) throw new Error('Could not read a Coursera slug from that input')

  const url = `${API}?q=slug&slug=${encodeURIComponent(slug)}&fields=name,description,workload,photoUrl`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`Coursera catalog returned ${res.status}`)

  const json = (await res.json()) as { elements?: any[] }
  const el = json.elements?.[0]
  if (!el) throw new Error(`No Coursera course found for slug "${slug}"`)

  return {
    slug,
    name: el.name,
    description: el.description,
    workload: el.workload,
    photoUrl: el.photoUrl,
  }
}
