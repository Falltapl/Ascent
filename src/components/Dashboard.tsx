import { useState } from 'react'
import type { State, Config } from '../api'
import { api } from '../api'
import { Card, Ring, Bar, Button, Modal, Field, inputCls, dueMeta } from './ui'
import { Heatmap } from './Heatmap'

export function Dashboard({ s, cfg, reload, celebrate }: {
  s: State; cfg: Config | null; reload: () => void; celebrate: () => void
}) {
  const [logOpen, setLogOpen] = useState(false)

  const openAssignments = s.assignments.filter((a) => !a.submitted && !a.done_manual)
  const upcoming = openAssignments.filter((a) => dueMeta(a.due_at).days <= 14).slice(0, 6)
  const overdue = openAssignments.filter((a) => dueMeta(a.due_at).days < 0).length
  const activeGoals = s.goals.filter((g) => g.status === 'active')
  const weekMins = Object.entries(s.stats.heatmap)
    .filter(([d]) => new Date(d).getTime() > Date.now() - 7 * 86400000)
    .reduce((n, [, m]) => n + m, 0)

  return (
    <div className="space-y-5">
      {/* Hero: level, XP, streak */}
      <Card className="relative overflow-hidden p-6" hover={false}>
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-[#a855f7]/20 blur-3xl" />
        <div className="relative flex flex-wrap items-center gap-6">
          <div className="relative">
            <Ring value={s.stats.pct} size={120} accent="violet" label={`${s.stats.level}`} sub="Level" />
          </div>

          <div className="min-w-[240px] flex-1">
            <div className="mb-1 flex items-baseline gap-2">
              <span className="font-[var(--font-display)] text-2xl font-bold text-grad">
                {s.stats.xp.toLocaleString()} XP
              </span>
              <span className="text-xs text-[#8b8bb0]">
                {s.stats.needed - s.stats.intoLevel} to level {s.stats.level + 1}
              </span>
            </div>
            <Bar value={s.stats.pct} accent="violet" height={10} striped />
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <Pill icon="📚" label={`${weekMins} min this week`} />
              <Pill icon="🎯" label={`${activeGoals.length} active goals`} />
              {overdue > 0 && <Pill icon="⚠️" label={`${overdue} overdue`} tone="rose" />}
            </div>
          </div>

          <div className="flex items-center gap-4 rounded-2xl border border-[#fbbf24]/25 bg-[#fbbf24]/8 px-5 py-4">
            <span className={`text-4xl ${s.stats.streak.current > 0 ? 'animate-flicker' : 'opacity-35 grayscale'}`}>🔥</span>
            <div>
              <div className="font-[var(--font-mono)] text-3xl font-bold leading-none text-[#fbbf24]">
                {s.stats.streak.current}
              </div>
              <div className="text-[10px] uppercase tracking-wider text-[#8b8bb0]">day streak</div>
              <div className="mt-0.5 text-[10px] text-[#8b8bb0]">best {s.stats.streak.best}</div>
            </div>
          </div>

          <Button variant="primary" onClick={() => setLogOpen(true)}>+ Log study</Button>
        </div>

        {!s.stats.streak.loggedToday && (
          <div className="relative mt-4 rounded-xl border border-[#fbbf24]/25 bg-[#fbbf24]/8 px-4 py-2.5 text-sm text-[#fbbf24]">
            Nothing logged today{s.stats.streak.current > 0 ? ` — your ${s.stats.streak.current}-day streak is still alive until midnight.` : '. Log a session to start a streak.'}
          </div>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Certification readiness */}
        <div className="space-y-5 lg:col-span-2">
          <Card className="p-5">
            <SectionHead title="Certification readiness" hint="Weighted by official exam-guide domain percentages" />
            <div className="grid gap-4 sm:grid-cols-2">
              {s.certs.map((c) => {
                const passed = Boolean(c.exam?.passed_at)
                return (
                  <div key={c.code} className="flex items-center gap-4 rounded-2xl border border-[#272740] bg-black/25 p-4">
                    <Ring
                      value={passed ? 100 : c.readiness}
                      size={86} stroke={8}
                      accent={passed ? 'emerald' : c.readiness >= 70 ? 'violet' : 'amber'}
                      label={passed ? '✓' : `${c.readiness}%`}
                    />
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{c.short}</div>
                      <div className="font-[var(--font-mono)] text-[11px] text-[#8b8bb0]">{c.code}</div>
                      {passed ? (
                        <div className="mt-1.5 text-xs text-[#34d399]">
                          Passed {new Date(c.exam!.passed_at!).toLocaleDateString()}
                        </div>
                      ) : (
                        <div className="mt-1.5 text-xs text-[#8b8bb0]">
                          ~{c.predictedScore} / {c.scaledRange[1]}
                          <span className={c.predictedScore >= c.passingScore ? 'ml-1.5 text-[#34d399]' : 'ml-1.5 text-[#fb7185]'}>
                            (pass {c.passingScore})
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </Card>

          <Card className="p-5">
            <SectionHead title="Due soon" hint={cfg?.canvas.mode === 'off' ? 'Canvas not connected yet' : `via Canvas (${cfg?.canvas.mode})`} />
            {upcoming.length === 0 ? (
              <Empty text={cfg?.canvas.mode === 'off'
                ? 'Connect Canvas in Settings to pull your UTA assignments.'
                : 'Nothing due in the next two weeks. Enjoy it.'} />
            ) : (
              <ul className="space-y-2">
                {upcoming.map((a, i) => {
                  const d = dueMeta(a.due_at)
                  return (
                    <li key={a.id} className="animate-rise flex items-center gap-3 rounded-xl border border-[#272740] bg-black/25 p-3" style={{ animationDelay: `${i * 45}ms` }}>
                      <button
                        onClick={async () => { await api.toggleAssignment(a.id, true); celebrate(); reload() }}
                        className="h-5 w-5 shrink-0 rounded-md border-2 border-[#3d3d66] transition hover:border-[#34d399] hover:bg-[#34d399]/20"
                        title="Mark done"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{a.title}</div>
                        <div className="truncate text-xs text-[#8b8bb0]">{a.course_name ?? 'Course'}</div>
                      </div>
                      <span className={`shrink-0 rounded-lg px-2 py-1 text-[11px] font-medium ${
                        d.tone === 'rose' ? 'bg-[#fb7185]/15 text-[#fb7185]'
                        : d.tone === 'amber' ? 'bg-[#fbbf24]/15 text-[#fbbf24]'
                        : 'bg-white/5 text-[#8b8bb0]'}`}>
                        {d.text}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>
        </div>

        {/* Right rail */}
        <div className="space-y-5">
          <Card className="p-5">
            <SectionHead title="Study heatmap" hint="Last 26 weeks" />
            <Heatmap data={s.stats.heatmap} />
          </Card>

          <Card className="p-5">
            <SectionHead title="This week" hint={cfg?.appleCalendar.configured ? 'Apple Calendar' : 'Calendar not connected'} />
            {s.events.length === 0 ? (
              <Empty text="No calendar events. Connect Apple Calendar in Settings." />
            ) : (
              <ul className="space-y-2">
                {s.events.slice(0, 6).map((e) => (
                  <li key={e.id} className="flex items-center gap-3 text-sm">
                    <div className="w-12 shrink-0 text-center">
                      <div className="text-[10px] uppercase text-[#8b8bb0]">
                        {new Date(e.start_at).toLocaleDateString(undefined, { weekday: 'short' })}
                      </div>
                      <div className="font-[var(--font-mono)] text-sm font-bold">{new Date(e.start_at).getDate()}</div>
                    </div>
                    <div className="min-w-0">
                      <div className="truncate">{e.title}</div>
                      <div className="text-xs text-[#8b8bb0]">
                        {e.all_day ? 'All day' : new Date(e.start_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-5">
            <SectionHead title="Recent sessions" />
            {s.sessions.length === 0 ? <Empty text="No study logged yet." /> : (
              <ul className="space-y-1.5 text-sm">
                {s.sessions.slice(0, 7).map((x) => (
                  <li key={x.id} className="flex items-center justify-between gap-2">
                    <span className="truncate text-[#c7c7e6]">
                      {x.kind === 'practice_exam' ? '📝 ' : '📖 '}{x.subject}
                    </span>
                    <span className="shrink-0 font-[var(--font-mono)] text-xs text-[#8b8bb0]">{x.minutes}m</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <LogModal open={logOpen} onClose={() => setLogOpen(false)} s={s} onSaved={() => { setLogOpen(false); celebrate(); reload() }} />
    </div>
  )
}

function Pill({ icon, label, tone = 'muted' }: { icon: string; label: string; tone?: 'muted' | 'rose' }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 ${
      tone === 'rose' ? 'bg-[#fb7185]/15 text-[#fb7185]' : 'bg-white/5 text-[#8b8bb0]'}`}>
      <span>{icon}</span>{label}
    </span>
  )
}

export function SectionHead({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-3">
      <div>
        <h2 className="font-[var(--font-display)] text-base font-bold">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-[#8b8bb0]">{hint}</p>}
      </div>
      {action}
    </div>
  )
}

export function Empty({ text }: { text: string }) {
  return <p className="rounded-xl border border-dashed border-[#272740] px-4 py-6 text-center text-sm text-[#8b8bb0]">{text}</p>
}

function LogModal({ open, onClose, s, onSaved }: { open: boolean; onClose: () => void; s: State; onSaved: () => void }) {
  const [minutes, setMinutes] = useState(45)
  const [subject, setSubject] = useState(s.certs[0]?.code ?? 'general')
  const [kind, setKind] = useState('study')
  const [score, setScore] = useState('')
  const [note, setNote] = useState('')

  const save = async () => {
    await api.logSession({
      minutes, subject, kind, note,
      score: kind === 'practice_exam' && score ? Number(score) : null,
    })
    setNote(''); setScore('')
    onSaved()
  }

  return (
    <Modal open={open} onClose={onClose} title="Log a study session">
      <div className="space-y-4">
        <Field label="Minutes">
          <div className="flex items-center gap-2">
            <input type="range" min={5} max={240} step={5} value={minutes}
              onChange={(e) => setMinutes(+e.target.value)}
              className="flex-1 accent-[#a855f7]" />
            <span className="w-16 text-right font-[var(--font-mono)] text-lg font-bold text-[#a855f7]">{minutes}m</span>
          </div>
          <div className="mt-1.5 text-[11px] text-[#8b8bb0]">
            +{Math.min(minutes, 180)} XP{minutes > 180 && ' (daily cap is 180)'}
          </div>
        </Field>

        <Field label="Subject">
          <select className={inputCls} value={subject} onChange={(e) => setSubject(e.target.value)}>
            {s.certs.map((c) => <option key={c.code} value={c.code}>{c.short}</option>)}
            {s.courses.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
            <option value="coursework">UTA coursework</option>
            <option value="general">General</option>
          </select>
        </Field>

        <Field label="Type">
          <div className="flex gap-2">
            {[['study', '📖 Study'], ['practice_exam', '📝 Practice exam'], ['assignment', '✍️ Assignment']].map(([v, l]) => (
              <button key={v} onClick={() => setKind(v)}
                className={`flex-1 rounded-xl border px-3 py-2 text-xs transition ${
                  kind === v ? 'border-[#a855f7] bg-[#a855f7]/15 text-[#f0f0ff]' : 'border-[#272740] text-[#8b8bb0] hover:border-[#3d3d66]'}`}>
                {l}
              </button>
            ))}
          </div>
        </Field>

        {kind === 'practice_exam' && (
          <Field label="Score (scaled, 100–1000)">
            <input className={inputCls} value={score} onChange={(e) => setScore(e.target.value)} placeholder="e.g. 780" inputMode="numeric" />
          </Field>
        )}

        <Field label="Note (optional)">
          <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did you cover?" />
        </Field>

        <Button variant="primary" onClick={save} className="w-full">Save session</Button>
      </div>
    </Modal>
  )
}
