import { db, meta, nowISO } from '../../db.ts'

/**
 * Gmail via OAuth 2.0 with a loopback redirect.
 *
 * Loopback is the standard grant for an app running on the user's own machine:
 * Google redirects back to http://localhost, which this server already answers,
 * so there is nothing to host.
 *
 * Scope note: gmail.metadata would be the tighter scope, but it excludes the
 * message snippet, which is the single most useful signal for triage — subject
 * lines alone misclassify badly. So gmail.readonly is requested, and every call
 * below asks for format=metadata. The scope permits more than the code uses;
 * bodies are never requested and never stored.
 */
const CLIENT_ID = process.env.GMAIL_CLIENT_ID || ''
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET || ''
const PORT = Number(process.env.PORT || 8787)
const REDIRECT = `http://localhost:${PORT}/api/email/gmail/callback`
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'

export const configured = () => Boolean(CLIENT_ID && CLIENT_SECRET)
export const connected = () => Boolean(meta.get('gmail:refresh_token'))

export function authUrl(): string {
  if (!configured()) throw new Error('GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET are not set — see README')
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  u.searchParams.set('client_id', CLIENT_ID)
  u.searchParams.set('redirect_uri', REDIRECT)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('scope', SCOPE)
  u.searchParams.set('access_type', 'offline')   // required to get a refresh token
  u.searchParams.set('prompt', 'consent')        // force one, even on re-auth
  return u.toString()
}

export async function handleCallback(code: string) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT, grant_type: 'authorization_code',
    }),
  })
  const json = await res.json() as any
  if (!res.ok) throw new Error(json.error_description || json.error || `token exchange failed (${res.status})`)
  if (!json.refresh_token) {
    throw new Error('Google returned no refresh token — revoke the app at myaccount.google.com/permissions and reconnect')
  }
  meta.set('gmail:refresh_token', json.refresh_token)
  meta.set('gmail:access_token', json.access_token)
  meta.set('gmail:expires_at', String(Date.now() + (json.expires_in ?? 3600) * 1000))
  return { connected: true }
}

async function accessToken(): Promise<string> {
  const exp = Number(meta.get('gmail:expires_at') ?? 0)
  const cached = meta.get('gmail:access_token')
  if (cached && Date.now() < exp - 60_000) return cached

  const refresh = meta.get('gmail:refresh_token')
  if (!refresh) throw new Error('Gmail not connected — connect it in Settings')

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      refresh_token: refresh, grant_type: 'refresh_token',
    }),
  })
  const json = await res.json() as any
  if (!res.ok) {
    db.prepare(`DELETE FROM meta WHERE k='gmail:refresh_token'`).run()
    // The overwhelmingly common cause is the 7-day expiry on "Testing" apps.
    const hint = json.error === 'invalid_grant'
      ? 'Gmail sign-in expired. Google expires refresh tokens after 7 days while the OAuth app is in "Testing" — set it to "In production" in Google Cloud Console to stop this. Reconnect in Settings.'
      : `Gmail token refresh failed (${json.error ?? res.status})`
    throw new Error(hint)
  }
  meta.set('gmail:access_token', json.access_token)
  meta.set('gmail:expires_at', String(Date.now() + (json.expires_in ?? 3600) * 1000))
  return json.access_token
}

const header = (h: any[], name: string) =>
  h?.find((x) => x.name?.toLowerCase() === name.toLowerCase())?.value ?? null

/** Splits "Prof Muro <m@uta.edu>" into its two halves. */
export function parseFrom(raw: string | null): { name: string | null; addr: string | null } {
  if (!raw) return { name: null, addr: null }
  const m = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/)
  if (m) return { name: m[1].trim() || null, addr: m[2].trim().toLowerCase() }
  return { name: null, addr: raw.trim().toLowerCase() }
}

/** Runs `jobs` with bounded concurrency so a sync doesn't burst the quota. */
async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  let i = 0
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++
      out[idx] = await fn(items[idx])
    }
  }))
  return out
}

export async function fetchMail(days = 14, max = 120) {
  const tok = await accessToken()
  const auth = { Authorization: `Bearer ${tok}` }

  // Category filters drop Promotions/Social/Forums before they cost a request.
  const q = `newer_than:${days}d -in:chats -category:promotions -category:social`
  const list = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages')
  list.searchParams.set('q', q)
  list.searchParams.set('maxResults', String(Math.min(max, 100)))

  const lres = await fetch(list.toString(), { headers: auth })
  if (!lres.ok) throw new Error(`Gmail list returned ${lres.status}: ${(await lres.text()).slice(0, 160)}`)
  const ids = ((await lres.json() as any).messages ?? []).map((m: any) => m.id) as string[]
  if (!ids.length) { meta.set('sync:email:gmail', nowISO()); return { fetched: 0 } }

  const stmt = db.prepare(`
    INSERT INTO emails (id, source, account, from_name, from_addr, subject, preview, received_at, is_read, web_link)
    VALUES (?, 'gmail', 'personal', ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET is_read=excluded.is_read
  `)

  let n = 0
  await pool(ids, 6, async (id) => {
    const u = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}`)
    u.searchParams.set('format', 'metadata')          // headers + snippet, never the body
    for (const h of ['From', 'Subject', 'Date']) u.searchParams.append('metadataHeaders', h)

    const r = await fetch(u.toString(), { headers: auth })
    if (!r.ok) return
    const m = await r.json() as any
    const hs = m.payload?.headers ?? []
    const { name, addr } = parseFrom(header(hs, 'From'))
    stmt.run(
      `gmail:${m.id}`, name, addr,
      header(hs, 'Subject'),
      (m.snippet ?? '').slice(0, 600),
      m.internalDate ? new Date(Number(m.internalDate)).toISOString() : null,
      (m.labelIds ?? []).includes('UNREAD') ? 0 : 1,
      `https://mail.google.com/mail/u/0/#inbox/${m.id}`,
    )
    n++
  })

  meta.set('sync:email:gmail', nowISO())
  return { fetched: n }
}
