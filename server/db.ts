import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'

const file = join(process.cwd(), 'data', 'ascent.db')
mkdirSync(dirname(file), { recursive: true })

export const db = new DatabaseSync(file)
db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA foreign_keys = ON')

db.exec(`
CREATE TABLE IF NOT EXISTS goals (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  detail      TEXT DEFAULT '',
  category    TEXT NOT NULL DEFAULT 'personal',  -- career | academic | cert | health | personal
  target_date TEXT,
  status      TEXT NOT NULL DEFAULT 'active',    -- active | done | archived
  created_at  TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS goal_steps (
  id       TEXT PRIMARY KEY,
  goal_id  TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  label    TEXT NOT NULL,
  done     INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0
);

-- Canvas assignments are cached here so the dashboard renders instantly and
-- still works when Canvas is down or the token is missing.
CREATE TABLE IF NOT EXISTS assignments (
  id           TEXT PRIMARY KEY,
  source       TEXT NOT NULL DEFAULT 'canvas',   -- canvas | ics | manual
  course_name  TEXT,
  course_id    TEXT,
  title        TEXT NOT NULL,
  due_at       TEXT,
  points       REAL,
  html_url     TEXT,
  submitted    INTEGER NOT NULL DEFAULT 0,
  graded_score REAL,
  done_manual  INTEGER NOT NULL DEFAULT 0,       -- local override for ICS-only mode
  synced_at    TEXT
);

-- One row per current-term course. Scores come from Canvas's own computation,
-- which applies the course's assignment-group weights; the breakdown is stored
-- as JSON because it is only ever read whole.
CREATE TABLE IF NOT EXISTS course_grades (
  course_id     TEXT PRIMARY KEY,
  course_name   TEXT NOT NULL,
  current_score REAL,          -- graded work only
  current_grade TEXT,
  final_score   REAL,          -- ungraded work counted as zero
  groups_json   TEXT,          -- [{name, weight, earned, possible, graded, total}]
  html_url      TEXT,
  synced_at     TEXT
);

-- Internship listings from SimplifyJobs, already filtered to the tracked term,
-- regions and role categories. Replaced wholesale on every sync.
CREATE TABLE IF NOT EXISTS jobs_feed (
  id          TEXT PRIMARY KEY,          -- Simplify listing id
  company     TEXT NOT NULL,
  title       TEXT NOT NULL,
  url         TEXT NOT NULL,
  company_url TEXT,
  locations   TEXT NOT NULL,             -- JSON array of "City, ST"
  regions     TEXT NOT NULL,             -- JSON array: DFW | Austin | Remote
  category    TEXT,
  degrees     TEXT,                      -- JSON array
  posted_at   TEXT,
  updated_at  TEXT
);

-- The application tracker. feed_id is UNIQUE so one listing can't be tracked
-- twice; SQLite allows many NULLs, so manual entries are unaffected.
-- What a company career site said about a posting the last time its detail
-- page was fetched, including postings that were rejected (wrong city, wrong
-- term). Without it every refresh re-opens the same out-of-region postings.
CREATE TABLE IF NOT EXISTS job_detail_cache (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  locations  TEXT NOT NULL,             -- JSON array
  degrees    TEXT NOT NULL,             -- JSON array
  posted_at  TEXT,
  url        TEXT NOT NULL,
  seen_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS applications (
  id                TEXT PRIMARY KEY,
  feed_id           TEXT UNIQUE,
  company           TEXT NOT NULL,
  role              TEXT NOT NULL,
  location          TEXT NOT NULL DEFAULT '',
  url               TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'saved',
  applied_on        TEXT,                -- YYYY-MM-DD
  next_step         TEXT NOT NULL DEFAULT '',
  next_step_on      TEXT,                -- YYYY-MM-DD
  referral          TEXT NOT NULL DEFAULT '',
  notes             TEXT NOT NULL DEFAULT '',
  posting_closed    INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  status_changed_at TEXT NOT NULL
);

-- Every status change, so "days since applied" and history survive edits.
CREATE TABLE IF NOT EXISTS application_events (
  id             TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  from_status    TEXT,
  to_status      TEXT NOT NULL,
  at             TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cert_confidence (
  cert_code  TEXT NOT NULL,
  domain_id  TEXT NOT NULL,
  confidence INTEGER NOT NULL DEFAULT 0,          -- 0..100, self-assessed
  updated_at TEXT,
  PRIMARY KEY (cert_code, domain_id)
);

CREATE TABLE IF NOT EXISTS cert_tasks (
  cert_code TEXT NOT NULL,
  task_key  TEXT NOT NULL,                        -- domainId::taskIndex
  done      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (cert_code, task_key)
);

CREATE TABLE IF NOT EXISTS cert_exams (
  cert_code   TEXT PRIMARY KEY,
  scheduled_for TEXT,
  passed_at   TEXT,
  badge_url   TEXT,
  expires_at  TEXT
);

-- Every unit of study. Drives XP, streaks, and the heatmap.
CREATE TABLE IF NOT EXISTS study_sessions (
  id         TEXT PRIMARY KEY,
  day        TEXT NOT NULL,                       -- YYYY-MM-DD (local)
  minutes    INTEGER NOT NULL,
  subject    TEXT NOT NULL,                       -- cert code, course id, or free text
  kind       TEXT NOT NULL DEFAULT 'study',       -- study | assignment | practice_exam
  note       TEXT DEFAULT '',
  score      INTEGER,                             -- practice exam score, if any
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_day ON study_sessions(day);

CREATE TABLE IF NOT EXISTS courses (
  id            TEXT PRIMARY KEY,
  provider      TEXT NOT NULL DEFAULT 'coursera',
  slug          TEXT,
  name          TEXT NOT NULL,
  url           TEXT,
  description   TEXT,
  workload      TEXT,
  total_modules INTEGER NOT NULL DEFAULT 0,
  done_modules  INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'active',
  added_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cal_events (
  id       TEXT PRIMARY KEY,
  source   TEXT NOT NULL,                         -- apple | canvas_ics
  title    TEXT,
  start_at TEXT,
  end_at   TEXT,
  all_day  INTEGER NOT NULL DEFAULT 0,
  location TEXT
);

-- Email headers only. Bodies are never stored; a preview is kept just long
-- enough to classify and to render a one-line summary.
CREATE TABLE IF NOT EXISTS emails (
  id            TEXT PRIMARY KEY,              -- "<source>:<provider message id>"
  source        TEXT NOT NULL,                 -- graph | gmail | outlook_local | sample
  account       TEXT NOT NULL,                 -- school | personal
  from_name     TEXT,
  from_addr     TEXT,
  subject       TEXT,
  preview       TEXT,
  received_at   TEXT,
  is_read       INTEGER NOT NULL DEFAULT 0,
  web_link      TEXT,
  -- classifier output
  importance    TEXT,                          -- critical | important | routine | noise
  category      TEXT,                          -- class_change | deadline | grades | admin | career | event | other
  reason        TEXT,
  action_by     TEXT,                          -- date the classifier extracted, if any
  classified_at TEXT,
  dismissed     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_emails_received ON emails(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_emails_importance ON emails(importance);

CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
`)

// Additive migrations. Guarded so startup is idempotent on an existing db.
for (const [table, col, decl] of [
  ['assignments', 'state', 'TEXT'],
  // Existing rows all came from SimplifyJobs, so that's the correct default.
  ['jobs_feed', 'source', "TEXT NOT NULL DEFAULT 'simplify'"],
  ['jobs_feed', 'role_type', 'TEXT'],
] as const) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (!cols.some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`)
}

export const meta = {
  get(k: string): string | null {
    const r = db.prepare('SELECT v FROM meta WHERE k=?').get(k) as { v: string } | undefined
    return r?.v ?? null
  },
  set(k: string, v: string) {
    db.prepare('INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, v)
  },
}

export const nowISO = () => new Date().toISOString()
export const uid = () => crypto.randomUUID()
