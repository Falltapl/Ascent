import { useState } from 'react'
import type { State, Cert } from '../api'
import { api } from '../api'
import { Card, Ring, Bar, inputCls, ACCENT } from './ui'
import { SectionHead } from './Dashboard'

export function Certs({ s, reload, celebrate }: { s: State; reload: () => void; celebrate: () => void }) {
  return (
    <div className="space-y-5">
      {s.certs.map((c) => <CertPanel key={c.code} cert={c} reload={reload} celebrate={celebrate} />)}
    </div>
  )
}

function CertPanel({ cert, reload, celebrate }: { cert: Cert; reload: () => void; celebrate: () => void }) {
  const [open, setOpen] = useState<string | null>(cert.domains[0]?.id ?? null)
  const passed = Boolean(cert.exam?.passed_at)
  const examDate = cert.exam?.scheduled_for
  const daysToExam = examDate ? Math.ceil((new Date(examDate).getTime() - Date.now()) / 86400000) : null

  const totalTasks = cert.domains.reduce((n, d) => n + d.tasks.length, 0)
  const doneCount = cert.doneTasks.length
  const accent = passed ? 'emerald' : cert.readiness >= 70 ? 'violet' : 'amber'

  return (
    <Card className="overflow-hidden" hover={false}>
      {/* Header */}
      <div className="relative border-b border-[var(--line)] p-6">
        <div className={`pointer-events-none absolute -right-20 -top-20 h-52 w-52 rounded-full blur-3xl`}
             style={{ background: `${ACCENT[accent].ring}25` }} />
        <div className="relative flex flex-wrap items-center gap-6">
          <Ring value={passed ? 100 : cert.readiness} size={120} accent={accent}
                label={passed ? '✓' : `${cert.readiness}%`} sub={passed ? 'Certified' : 'Ready'} />

          <div className="min-w-[260px] flex-1">
            <h2 className="font-[var(--font-display)] text-xl font-bold">{cert.name}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
              <code className="rounded bg-[var(--ink)]/5 px-1.5 py-0.5 font-[var(--font-mono)]">{cert.code}</code>
              <span>{cert.questions} questions</span><span>·</span>
              <span>{cert.minutes} min</span><span>·</span>
              <span>${cert.costUSD}</span><span>·</span>
              <span>pass at {cert.passingScore}</span>
            </div>

            {passed ? (
              <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-[var(--ok)]/30 bg-[var(--ok)]/10 px-4 py-2.5">
                <span className="text-xl">🏆</span>
                <div className="text-sm">
                  <span className="font-semibold text-[var(--ok)]">Certified</span>
                  <span className="text-[var(--muted)]"> · earned {new Date(cert.exam!.passed_at!).toLocaleDateString()}</span>
                  {cert.exam?.expires_at && (
                    <span className="text-[var(--muted)]"> · recert by {new Date(cert.exam.expires_at).toLocaleDateString()}</span>
                  )}
                </div>
                {cert.exam?.badge_url && (
                  <a href={cert.exam.badge_url} target="_blank" rel="noreferrer"
                     className="text-xs text-[var(--accent-2)] underline underline-offset-2">View badge</a>
                )}
              </div>
            ) : (
              <div className="mt-3">
                <div className="mb-1.5 flex items-baseline justify-between text-xs">
                  <span className="text-[var(--muted)]">Predicted scaled score</span>
                  <span className={`font-[var(--font-mono)] text-lg font-bold ${
                    cert.predictedScore >= cert.passingScore ? 'text-[var(--ok)]' : 'text-[var(--warn)]'}`}>
                    {cert.predictedScore}
                  </span>
                </div>
                {/* Pass line sits at its true position on the 100–1000 scale. */}
                <div className="relative">
                  <Bar value={cert.readiness} accent={accent} height={10} />
                  <div className="absolute -top-1 h-[18px] w-0.5 bg-[var(--ink)]/70"
                       style={{ left: `${((cert.passingScore - cert.scaledRange[0]) / (cert.scaledRange[1] - cert.scaledRange[0])) * 100}%` }}
                       title={`Passing score: ${cert.passingScore}`} />
                </div>
                <div className="mt-1.5 text-[11px] text-[var(--muted)]">
                  {doneCount}/{totalTasks} objectives checked off · white line marks the pass threshold
                </div>
              </div>
            )}
          </div>

          {!passed && (
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--ground)]/45 p-4 text-center">
              {daysToExam !== null ? (
                <>
                  <div className="font-[var(--font-mono)] text-3xl font-bold text-[var(--accent-2)]">{Math.max(0, daysToExam)}</div>
                  <div className="text-[10px] uppercase tracking-wider text-[var(--muted)]">days to exam</div>
                </>
              ) : (
                <div className="text-xs text-[var(--muted)]">No exam booked</div>
              )}
              <input type="date" className={`${inputCls} mt-2 text-xs`} value={examDate?.slice(0, 10) ?? ''}
                     onChange={async (e) => { await api.setExamDate(cert.code, e.target.value || null); reload() }} />
            </div>
          )}
        </div>
      </div>

      {/* Domains */}
      <div className="p-6">
        <SectionHead title="Exam domains"
          hint="Sliders are your own confidence. Readiness above is these numbers weighted by each domain's real exam percentage." />

        <div className="space-y-3">
          {cert.domains.map((d) => {
            const conf = cert.confidence[d.id] ?? 0
            const isOpen = open === d.id
            const domainTasksDone = d.tasks.filter((_, i) => cert.doneTasks.includes(`${d.id}::${i}`)).length
            return (
              <div key={d.id} className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--ground)]/45">
                <div className="flex flex-wrap items-center gap-4 p-4">
                  <button onClick={() => setOpen(isOpen ? null : d.id)}
                          className="flex min-w-[200px] flex-1 items-center gap-3 text-left">
                    <span className={`text-xs transition-transform ${isOpen ? 'rotate-90' : ''}`}>▶</span>
                    <div>
                      <div className="font-medium">{d.name}</div>
                      <div className="text-[11px] text-[var(--muted)]">
                        {d.weight}% of exam · {domainTasksDone}/{d.tasks.length} objectives
                      </div>
                    </div>
                  </button>

                  <div className="flex min-w-[220px] flex-1 items-center gap-3">
                    <input type="range" min={0} max={100} step={5} value={conf}
                      onChange={async (e) => { await api.setConfidence(cert.code, d.id, +e.target.value); reload() }}
                      className="flex-1 accent-[var(--accent)]" />
                    <span className="w-11 text-right font-[var(--font-mono)] text-sm font-bold"
                          style={{ color: conf >= 70 ? 'var(--ok)' : conf >= 40 ? 'var(--warn)' : 'var(--bad)' }}>
                      {conf}%
                    </span>
                  </div>

                  {/* Contribution of this domain to overall readiness. */}
                  <div className="w-20 shrink-0 text-right">
                    <div className="text-[10px] uppercase tracking-wider text-[var(--muted)]">contributes</div>
                    <div className="font-[var(--font-mono)] text-sm">
                      {((d.weight * conf) / 100).toFixed(1)}<span className="text-[var(--muted)]">/{d.weight}</span>
                    </div>
                  </div>
                </div>

                {isOpen && (
                  <ul className="animate-rise space-y-1 border-t border-[var(--line)] bg-[var(--ground)]/45 p-4">
                    {d.tasks.map((t, i) => {
                      const key = `${d.id}::${i}`
                      const done = cert.doneTasks.includes(key)
                      return (
                        <li key={key}>
                          <label className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-[var(--ink)]/5">
                            <input type="checkbox" checked={done}
                              onChange={async (e) => {
                                await api.toggleTask(cert.code, key, e.target.checked)
                                if (e.target.checked) celebrate()
                                reload()
                              }}
                              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--ok)]" />
                            <span className={done ? 'text-[var(--muted)] line-through' : 'text-[var(--ink-2)]'}>{t}</span>
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </Card>
  )
}
