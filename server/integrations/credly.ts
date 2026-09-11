import { CERTS } from '../certs.ts'
import { db } from '../db.ts'

/**
 * Credly exposes a public, unauthenticated JSON feed of a user's accepted
 * badges. Verified working: credly.com/users/<handle>/badges.json -> 200.
 * This is the only real API surface for AWS certifications — AWS's own
 * CertMetrics portal and Skill Builder publish nothing.
 */
export type Badge = {
  id: string
  name: string
  issuer: string
  image: string | null
  url: string
  issuedAt: string | null
  expiresAt: string | null
}

export async function fetchBadges(handle: string): Promise<Badge[]> {
  const url = `https://www.credly.com/users/${encodeURIComponent(handle)}/badges.json?page=1&page_size=48`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (res.status === 404) throw new Error(`Credly has no public profile for "${handle}"`)
  if (!res.ok) throw new Error(`Credly returned ${res.status}`)

  const json = (await res.json()) as { data?: any[] }
  return (json.data ?? []).map((b) => ({
    id: b.id,
    name: b.badge_template?.name ?? 'Unknown badge',
    issuer: b.issuer?.entities?.[0]?.entity?.name ?? b.badge_template?.issuer?.entities?.[0]?.entity?.name ?? '',
    image: b.image_url ?? b.badge_template?.image_url ?? null,
    url: b.id ? `https://www.credly.com/badges/${b.id}/public_url` : '',
    issuedAt: b.issued_at_date ?? null,
    expiresAt: b.expires_at_date ?? null,
  }))
}

/**
 * Matches earned badges against the two certs being tracked and records the
 * pass date + expiry, so the recert clock starts on its own.
 */
export async function syncCredly(handle: string) {
  const badges = await fetchBadges(handle)
  const stmt = db.prepare(`
    INSERT INTO cert_exams (cert_code, passed_at, badge_url, expires_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(cert_code) DO UPDATE SET
      passed_at=excluded.passed_at, badge_url=excluded.badge_url, expires_at=excluded.expires_at
  `)

  const matched: string[] = []
  for (const cert of CERTS) {
    const hit = badges.find((b) => b.name.toLowerCase().includes(cert.badgeMatch))
    if (hit) {
      stmt.run(cert.code, hit.issuedAt, hit.url, hit.expiresAt)
      matched.push(cert.code)
    }
  }
  return { total: badges.length, matched, badges }
}
