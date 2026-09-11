import { db } from './db.ts'

/**
 * XP model. Every number here is deliberate: the goal is that the cheapest way
 * to gain XP is also the behaviour worth reinforcing (steady daily study),
 * and that nothing can be farmed by clicking. Minutes are capped per day so a
 * single marathon session can't inflate a streak's worth.
 */
export const XP = {
  perStudyMinute: 1,
  dailyMinuteCap: 180,
  assignmentDone: 50,
  certTaskDone: 25,
  goalStepDone: 15,
  goalDone: 200,
  practiceExamBase: 40,
} as const

/** Superlinear curve: early levels come fast, later ones take real work. */
export function levelFor(xp: number) {
  let level = 1
  let need = 100
  let acc = 0
  while (xp >= acc + need) {
    acc += need
    level++
    need = Math.round(100 * Math.pow(level, 1.35))
  }
  return { level, intoLevel: xp - acc, needed: need, pct: Math.round(((xp - acc) / need) * 100) }
}

const localDay = (d = new Date()) => {
  const off = d.getTimezoneOffset() * 60000
  return new Date(d.getTime() - off).toISOString().slice(0, 10)
}

export function computeXp() {
  const rows = db.prepare(`
    SELECT day, SUM(minutes) mins, SUM(CASE WHEN kind='practice_exam' THEN 1 ELSE 0 END) exams,
           SUM(COALESCE(score,0)) scoresum
    FROM study_sessions GROUP BY day
  `).all() as any[]

  let xp = 0
  for (const r of rows) {
    xp += Math.min(r.mins, XP.dailyMinuteCap) * XP.perStudyMinute
    xp += r.exams * XP.practiceExamBase
    xp += Math.round(r.scoresum / 10)
  }

  const a = db.prepare(`SELECT COUNT(*) c FROM assignments WHERE submitted=1 OR done_manual=1`).get() as any
  const t = db.prepare(`SELECT COUNT(*) c FROM cert_tasks WHERE done=1`).get() as any
  const s = db.prepare(`SELECT COUNT(*) c FROM goal_steps WHERE done=1`).get() as any
  const g = db.prepare(`SELECT COUNT(*) c FROM goals WHERE status='done'`).get() as any

  xp += a.c * XP.assignmentDone + t.c * XP.certTaskDone + s.c * XP.goalStepDone + g.c * XP.goalDone
  return xp
}

/** Consecutive days with any logged study, counting back from today. */
export function computeStreak() {
  const days = new Set(
    (db.prepare(`SELECT DISTINCT day FROM study_sessions`).all() as any[]).map((r) => r.day),
  )
  let streak = 0
  const cur = new Date()
  // Today not yet logged shouldn't break a streak that was alive yesterday.
  if (!days.has(localDay(cur))) cur.setDate(cur.getDate() - 1)
  while (days.has(localDay(cur))) {
    streak++
    cur.setDate(cur.getDate() - 1)
  }

  let best = 0, run = 0, prev: string | null = null
  for (const d of [...days].sort()) {
    if (prev) {
      const gap = (new Date(d).getTime() - new Date(prev).getTime()) / 86400000
      run = gap === 1 ? run + 1 : 1
    } else run = 1
    best = Math.max(best, run)
    prev = d
  }
  return { current: streak, best, loggedToday: days.has(localDay()) }
}

/** 26 weeks of daily study minutes for the contribution-style heatmap. */
export function heatmap() {
  const rows = db.prepare(`
    SELECT day, SUM(minutes) mins FROM study_sessions
    WHERE day >= date('now','-182 days') GROUP BY day
  `).all() as any[]
  return Object.fromEntries(rows.map((r) => [r.day, r.mins]))
}
