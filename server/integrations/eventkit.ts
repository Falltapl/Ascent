import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { db } from '../db.ts'

const exec = promisify(execFile)
const BIN = join(process.cwd(), 'bin', 'calfetch')

type Payload = {
  ok: boolean
  reason?: string
  calendars: string[]
  events: {
    uid: string; title: string; start: string; end: string | null
    allDay: boolean; location: string | null; calendar: string
  }[]
}

export const eventKitBuilt = () => existsSync(BIN)

/**
 * Reads Calendar.app directly. Nothing is published and no credential is
 * involved — but macOS gates it behind a TCC prompt that is attributed to the
 * process which launched this binary. Run from a terminal, that terminal gets
 * the prompt once; thereafter it is silent. If the launching process can't
 * prompt (a background agent, say), this returns ok:false rather than hanging.
 */
async function run(args: string[]): Promise<Payload> {
  if (!eventKitBuilt()) {
    return { ok: false, reason: 'not_built', calendars: [], events: [] }
  }
  try {
    const { stdout } = await exec(BIN, args, { timeout: 40_000, maxBuffer: 16 * 1024 * 1024 })
    return JSON.parse(stdout) as Payload
  } catch (e: any) {
    // The helper prints JSON even when it fails, so prefer that over the throw.
    if (e?.stdout) {
      try { return JSON.parse(e.stdout) as Payload } catch { /* fall through */ }
    }
    return { ok: false, reason: e?.message ?? 'helper_failed', calendars: [], events: [] }
  }
}

export const checkEventKit = () => run(['--check'])

export async function syncEventKit(days = 60) {
  const out = await run(['--days', String(days)])
  if (!out.ok) {
    const hint =
      out.reason === 'not_built' ? 'Run: npm run build:native'
      : out.reason === 'access_denied' ? 'Grant Calendar access to the terminal you started the app from, in System Settings › Privacy & Security › Calendars.'
      : out.reason === 'timed_out_waiting_for_permission' ? 'The macOS permission prompt was never answered.'
      : out.reason ?? 'unknown error'
    throw new Error(`Calendar read failed — ${hint}`)
  }

  const stmt = db.prepare(`
    INSERT INTO cal_events (id, source, title, start_at, end_at, all_day, location)
    VALUES (?, 'apple', ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title=excluded.title, start_at=excluded.start_at,
      end_at=excluded.end_at, all_day=excluded.all_day, location=excluded.location
  `)
  // Events can be deleted or moved upstream; rebuild this source each sync so
  // stale entries don't linger forever.
  db.prepare(`DELETE FROM cal_events WHERE source='apple'`).run()

  for (const e of out.events) {
    stmt.run(`apple:${e.uid}`, e.title, e.start, e.end, e.allDay ? 1 : 0, e.location)
  }
  return { events: out.events.length, calendars: out.calendars.length }
}
