import { db, meta, nowISO } from '../../db.ts'

/**
 * Microsoft Graph mail, via OAuth device-code flow.
 *
 * Device code is the right grant for a local tool: no redirect URI to host, no
 * client secret to store. The user visits a URL, types a short code, and the
 * poll below completes. Microsoft killed password-based IMAP for Microsoft 365,
 * so OAuth is the only remaining path to a university mailbox.
 *
 * Requires an app registration (free) with:
 *   - "Allow public client flows" enabled
 *   - delegated permission Mail.Read (and offline_access for refresh)
 */
const TENANT = process.env.GRAPH_TENANT || 'common'
const CLIENT_ID = process.env.GRAPH_CLIENT_ID || ''
const SCOPE = 'offline_access User.Read Mail.Read'
const AUTH = (p: string) => `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/${p}`

export const configured = () => Boolean(CLIENT_ID)
export const connected = () => Boolean(meta.get('graph:refresh_token'))

type DeviceCode = { user_code: string; device_code: string; verification_uri: string; expires_in: number; interval: number; message: string }

/** Step 1 — ask Microsoft for a code to show the user. */
export async function startDeviceLogin(): Promise<DeviceCode> {
  if (!CLIENT_ID) throw new Error('GRAPH_CLIENT_ID is not set — register an app first (see README)')
  const res = await fetch(AUTH('devicecode'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, scope: SCOPE }),
  })
  const json = await res.json() as any
  if (!res.ok) throw new Error(json.error_description || `device code request failed (${res.status})`)
  meta.set('graph:device_code', json.device_code)
  return json
}

/**
 * Step 2 — poll once. authorization_pending is the normal "not yet" answer and
 * is reported as still-waiting rather than as a failure, so the UI can keep
 * polling without treating it as an error.
 */
export async function pollDeviceLogin(): Promise<{ status: 'pending' | 'connected'; detail?: string }> {
  const device_code = meta.get('graph:device_code')
  if (!device_code) throw new Error('No device login in progress')

  const res = await fetch(AUTH('token'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      client_id: CLIENT_ID, device_code,
    }),
  })
  const json = await res.json() as any

  if (res.ok && json.access_token) {
    meta.set('graph:refresh_token', json.refresh_token)
    meta.set('graph:access_token', json.access_token)
    meta.set('graph:expires_at', String(Date.now() + (json.expires_in ?? 3600) * 1000))
    db.prepare(`DELETE FROM meta WHERE k='graph:device_code'`).run()
    return { status: 'connected' }
  }
  if (json.error === 'authorization_pending' || json.error === 'slow_down') return { status: 'pending' }
  throw new Error(json.error_description || json.error || 'device login failed')
}

async function accessToken(): Promise<string> {
  const exp = Number(meta.get('graph:expires_at') ?? 0)
  const cached = meta.get('graph:access_token')
  if (cached && Date.now() < exp - 60_000) return cached

  const refresh = meta.get('graph:refresh_token')
  if (!refresh) throw new Error('Not connected to Microsoft — run the device login first')

  const res = await fetch(AUTH('token'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: refresh, scope: SCOPE }),
  })
  const json = await res.json() as any
  if (!res.ok) {
    db.prepare(`DELETE FROM meta WHERE k='graph:refresh_token'`).run()
    throw new Error(`Microsoft sign-in expired (${json.error ?? res.status}) — reconnect in Settings`)
  }
  meta.set('graph:access_token', json.access_token)
  meta.set('graph:expires_at', String(Date.now() + (json.expires_in ?? 3600) * 1000))
  if (json.refresh_token) meta.set('graph:refresh_token', json.refresh_token)
  return json.access_token
}

export async function whoAmI() {
  const tok = await accessToken()
  const res = await fetch('https://graph.microsoft.com/v1.0/me', { headers: { Authorization: `Bearer ${tok}` } })
  if (!res.ok) throw new Error(`Graph /me returned ${res.status}`)
  return res.json() as Promise<{ displayName: string; userPrincipalName: string }>
}

/**
 * Pulls recent inbox headers. $select keeps the payload to what the classifier
 * needs — bodies are never requested, only Graph's own bodyPreview.
 */
export async function fetchMail(days = 14, max = 200) {
  const tok = await accessToken()
  const since = new Date(Date.now() - days * 86400000).toISOString()
  const url = new URL('https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages')
  url.searchParams.set('$select', 'id,subject,bodyPreview,receivedDateTime,isRead,from,webLink')
  url.searchParams.set('$filter', `receivedDateTime ge ${since}`)
  url.searchParams.set('$orderby', 'receivedDateTime desc')
  url.searchParams.set('$top', '50')

  const stmt = db.prepare(`
    INSERT INTO emails (id, source, account, from_name, from_addr, subject, preview, received_at, is_read, web_link)
    VALUES (?, 'graph', 'school', ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET is_read=excluded.is_read
  `)

  let next: string | null = url.toString()
  let n = 0, pages = 0
  while (next && n < max && pages++ < 10) {
    const res: Response = await fetch(next, { headers: { Authorization: `Bearer ${tok}` } })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Graph ${res.status}: ${body.slice(0, 200)}`)
    }
    const json = await res.json() as any
    for (const m of json.value ?? []) {
      stmt.run(
        `graph:${m.id}`,
        m.from?.emailAddress?.name ?? null,
        m.from?.emailAddress?.address ?? null,
        m.subject ?? null,
        (m.bodyPreview ?? '').slice(0, 600),
        m.receivedDateTime ?? null,
        m.isRead ? 1 : 0,
        m.webLink ?? null,
      )
      n++
    }
    next = json['@odata.nextLink'] ?? null
  }
  meta.set('sync:email:graph', nowISO())
  return { fetched: n }
}
