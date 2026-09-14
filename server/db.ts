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
for (const [table, col, decl] of [['assignments', 'state', 'TEXT']] as const) {
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
