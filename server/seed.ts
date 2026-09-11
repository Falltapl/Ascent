/**
 * Demo data so the UI can be evaluated before the real integrations are
 * connected. Reversible: `npx tsx server/seed.ts --clear` wipes everything.
 */
import { db, nowISO, uid } from './db.ts'

const clear = process.argv.includes('--clear')
for (const t of ['goal_steps', 'goals', 'assignments', 'cert_confidence', 'cert_tasks', 'cert_exams', 'study_sessions', 'courses', 'cal_events']) {
  db.exec(`DELETE FROM ${t}`)
}
if (clear) { console.log('cleared.'); process.exit(0) }

const day = (back: number) => {
  const d = new Date(); d.setDate(d.getDate() - back)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}
const at = (days: number) => new Date(Date.now() + days * 86400000).toISOString()

const goals: [string, string, string, number, string[]][] = [
  ['Pass AWS Cloud Practitioner', 'Foundation for the SAA and for cloud internship applications', 'cert', 34,
    ['Finish Cloud Technical Essentials', 'Score 800+ on two practice exams', 'Book the exam', 'Pass']],
  ['Pass AWS Solutions Architect – Associate', 'The cert that actually moves the resume', 'cert', 130,
    ['Complete SAA course', 'Build a 3-tier VPC lab', 'Two full practice exams', 'Book the exam']],
  ['Land a summer 2027 cloud internship', '', 'career', 180,
    ['Rewrite resume around AWS projects', 'Ship 2 portfolio projects', 'Apply to 25 postings', 'Mock interviews']],
  ['Finish the semester at 3.7+', '', 'academic', 110, ['Midterms done', 'All labs submitted', 'Finals week']],
]
for (const [title, detail, category, due, steps] of goals) {
  const id = uid()
  db.prepare(`INSERT INTO goals (id,title,detail,category,target_date,created_at) VALUES (?,?,?,?,?,?)`)
    .run(id, title, detail, category, at(due), nowISO())
  steps.forEach((label, i) => {
    db.prepare(`INSERT INTO goal_steps (id,goal_id,label,done,position) VALUES (?,?,?,?,?)`)
      .run(uid(), id, label, i < (title.includes('Cloud Practitioner') ? 2 : 1) ? 1 : 0, i)
  })
}

const assignments: [string, string, number, number][] = [
  ['CSE 3310 — Software Engineering', 'Sprint 2 retrospective', -1, 50],
  ['CSE 3310 — Software Engineering', 'Design document draft', 2, 100],
  ['CSE 3315 — Theoretical Concepts', 'Problem set 4', 3, 40],
  ['CSE 4344 — Computer Networks', 'Socket programming lab', 6, 80],
  ['CSE 4344 — Computer Networks', 'Routing protocols quiz', 9, 25],
  ['MATH 3330 — Linear Algebra', 'Written homework 6', 12, 30],
]
assignments.forEach(([course, title, due, pts], i) => {
  db.prepare(`INSERT INTO assignments (id,source,course_name,title,due_at,points,synced_at) VALUES (?,?,?,?,?,?,?)`)
    .run(`demo:${i}`, 'canvas', course, title, at(due), pts, nowISO())
})
db.prepare(`INSERT INTO assignments (id,source,course_name,title,due_at,points,submitted,graded_score,synced_at) VALUES (?,?,?,?,?,?,1,?,?)`)
  .run('demo:done1', 'canvas', 'CSE 3310 — Software Engineering', 'Sprint 1 deliverable', at(-8), 50, 47, nowISO())

const conf: Record<string, number> = {
  clf1: 80, clf2: 65, clf3: 70, clf4: 55,
  saa1: 40, saa2: 35, saa3: 25, saa4: 20,
}
for (const [d, c] of Object.entries(conf)) {
  db.prepare(`INSERT INTO cert_confidence (cert_code,domain_id,confidence,updated_at) VALUES (?,?,?,?)`)
    .run(d.startsWith('clf') ? 'CLF-C02' : 'SAA-C03', d, c, nowISO())
}
for (const k of ['clf1::0', 'clf1::1', 'clf1::2', 'clf2::0', 'clf2::1', 'clf3::0', 'clf3::3', 'clf4::0'])
  db.prepare(`INSERT INTO cert_tasks (cert_code,task_key,done) VALUES ('CLF-C02',?,1)`).run(k)
for (const k of ['saa1::0', 'saa2::0'])
  db.prepare(`INSERT INTO cert_tasks (cert_code,task_key,done) VALUES ('SAA-C03',?,1)`).run(k)
db.prepare(`INSERT INTO cert_exams (cert_code,scheduled_for) VALUES ('CLF-C02',?)`).run(at(31))

// ~10 weeks of study with a believable rhythm and one gap.
let seeded = 0
for (let b = 0; b < 72; b++) {
  const dow = new Date(Date.now() - b * 86400000).getDay()
  if (b > 11 && b < 17) continue                       // a dead week
  if (Math.random() < (dow === 0 || dow === 6 ? 0.55 : 0.2)) continue
  const mins = 20 + Math.round(Math.random() * (dow === 0 || dow === 6 ? 130 : 75))
  const subj = Math.random() < 0.55 ? 'CLF-C02' : Math.random() < 0.7 ? 'SAA-C03' : 'coursework'
  db.prepare(`INSERT INTO study_sessions (id,day,minutes,subject,kind,note,created_at) VALUES (?,?,?,?,?,?,?)`)
    .run(uid(), day(b), mins, subj, 'study', '', nowISO())
  seeded++
}
for (const [b, s] of [[4, 745], [18, 690], [33, 610]] as const) {
  db.prepare(`INSERT INTO study_sessions (id,day,minutes,subject,kind,score,note,created_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run(uid(), day(b), 90, 'CLF-C02', 'practice_exam', s, 'Tutorials Dojo set', nowISO())
}

db.prepare(`INSERT INTO courses (id,provider,slug,name,url,description,workload,total_modules,done_modules,added_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
  .run(uid(), 'coursera', 'aws-cloud-technical-essentials', 'AWS Cloud Technical Essentials',
       'https://www.coursera.org/learn/aws-cloud-technical-essentials', '', '4 weeks of study, 3-4 hours per week', 4, 3, nowISO())
db.prepare(`INSERT INTO courses (id,provider,slug,name,url,description,workload,total_modules,done_modules,added_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
  .run(uid(), 'coursera', 'aws-cloud-solutions-architect', 'AWS Cloud Solutions Architect',
       'https://www.coursera.org/professional-certificates/aws-cloud-solutions-architect', '', '6 months at 5 hours a week', 8, 2, nowISO())

const evs: [string, number, number][] = [
  ['CSE 3310 lecture', 1, 10], ['Study group — SAA', 2, 18],
  ['CSE 4344 lab', 3, 14], ['Advising appointment', 5, 11], ['Career fair', 8, 9],
]
evs.forEach(([title, d, h], i) => {
  const start = new Date(Date.now() + d * 86400000); start.setHours(h, 0, 0, 0)
  db.prepare(`INSERT INTO cal_events (id,source,title,start_at,end_at,all_day) VALUES (?,?,?,?,?,0)`)
    .run(`demo-ev:${i}`, 'apple', title, start.toISOString(), new Date(start.getTime() + 3600000).toISOString())
})

console.log(`seeded: ${goals.length} goals, 7 assignments, ${seeded + 3} study sessions, 2 courses, ${evs.length} events`)
