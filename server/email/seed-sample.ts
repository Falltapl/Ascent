/**
 * Realistic sample inbox for exercising the triage pipeline before any mailbox
 * is connected. `--clear` removes only these rows, never real mail.
 */
import { db, nowISO } from '../db.ts'

const at = (h: number) => new Date(Date.now() - h * 3600000).toISOString()

const SAMPLE: [string, string, string, string, number][] = [
  ['Dr. Elaine Muro', 'e.muro@uta.edu', 'INSY 4321 — no class Thursday',
   'Hi all, I have a conference conflict so we will not be meeting Thursday. The Project 1 checkpoint still opens Friday as planned. Use the time to work with your group.', 4],
  ['UTA Office of the Registrar', 'registrar@uta.edu', 'Action required: apply for May 2027 graduation',
   'Students expecting to graduate must submit the graduation application before the posted deadline. Applications received after 2026-11-14 will be deferred to the following term.', 9],
  ['Dr. Raymond Kells', 'r.kells@uta.edu', 'Re: your question about the midterm',
   'Hunter — good question. The exam will cover through chapter 7 only, not chapter 8. Also I moved my Wednesday office hours to 2pm this week.', 20],
  ['UTA Financial Aid', 'fao@uta.edu', 'Hold placed on your account',
   'A document is missing from your financial aid file. A hold has been placed that will prevent registration for the next term until it is resolved.', 28],
  ['BSTAT 3321 Canvas', 'notifications@instructure.com', 'Assignment graded: Assignment#1 (Ch#1 & 2)',
   'Your submission for Assignment#1 has been graded. Score: 150 out of 150.', 33],
  ['UTA Campus Recreation', 'camprec@uta.edu', 'Intramural dodgeball signups are open!',
   'Grab your friends and sign up for spring intramurals. Early bird pricing ends soon. Follow us on Instagram for updates.', 40],
  ['LinkedIn', 'messages-noreply@linkedin.com', '9 new jobs for software engineer intern',
   'Based on your profile, here are jobs we think you would be interested in. See all matches.', 44],
  ['Handshake', 'notifications@mail.joinhandshake.com', 'AWS is hosting a virtual info session',
   'Amazon Web Services is hosting a session for students interested in cloud roles. Registration closes Friday.', 52],
  ['Chipotle', 'no-reply@chipotle.com', 'Free guac is back 🥑',
   'For a limited time only. Order in the app and get free guacamole on any entree.', 58],
  ['Dr. Elaine Muro', 'e.muro@uta.edu', 'INSY 4321 syllabus update — grading weights',
   'I have adjusted the project weighting from 25% to 30% and reduced the final exam accordingly. The updated syllabus is posted on Canvas.', 70],
  ['UTA Academic Advising', 'advising@uta.edu', 'Your advising appointment is confirmed',
   'This confirms your appointment on the date you selected. Please bring your degree plan. Reply to reschedule.', 76],
  ['UTA IT Security', 'security-noreply@uta.edu', 'Scheduled maintenance this weekend',
   'Campus systems including Canvas and MyMav will be unavailable Saturday 2am-6am for scheduled maintenance.', 88],
]

if (process.argv.includes('--clear')) {
  const r = db.prepare(`DELETE FROM emails WHERE source='sample'`).run()
  console.log(`cleared ${r.changes} sample emails (real mail untouched)`)
  process.exit(0)
}

const stmt = db.prepare(`
  INSERT INTO emails (id, source, account, from_name, from_addr, subject, preview, received_at, is_read)
  VALUES (?, 'sample', ?, ?, ?, ?, ?, ?, 0)
  ON CONFLICT(id) DO NOTHING
`)
SAMPLE.forEach(([name, addr, subject, preview, hoursAgo], i) => {
  stmt.run(`sample:${i}`, addr.endsWith('uta.edu') || addr.includes('instructure') ? 'school' : 'personal',
           name, addr, subject, preview, at(hoursAgo))
})
console.log(`seeded ${SAMPLE.length} sample emails (unclassified) at ${nowISO()}`)
