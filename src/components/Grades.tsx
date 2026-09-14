import { useState } from 'react'
import type { CourseGrade, GradeGroup } from '../api'
import { Card, Bar, type Accent } from './ui'
import { SectionHead, Empty } from './Dashboard'

const POINTS: Record<string, number> = { A: 4, B: 3, C: 2, D: 1, F: 0 }

/** Semantic, not decorative: grade colour must not change with the accent. */
function tone(letter: string | null): { accent: Accent; cls: string } {
  const l = letter?.[0]
  if (l === 'A') return { accent: 'emerald', cls: 'text-[var(--ok)] bg-[var(--ok)]/12 border-[var(--ok)]/30' }
  if (l === 'B') return { accent: 'cyan', cls: 'text-[var(--accent-2)] bg-[var(--accent-2)]/12 border-[var(--accent-2)]/30' }
  if (l === 'C') return { accent: 'amber', cls: 'text-[var(--warn)] bg-[var(--warn)]/12 border-[var(--warn)]/30' }
  if (l === 'D' || l === 'F') return { accent: 'rose', cls: 'text-[var(--bad)] bg-[var(--bad)]/12 border-[var(--bad)]/30' }
  return { accent: 'violet', cls: 'text-[var(--muted)] bg-[var(--ink)]/5 border-[var(--line)]' }
}

/**
 * UT Arlington course numbers encode credit hours in the second digit
 * (INSY 4321 → 3 hours). Falls back to 3 when a name doesn't parse.
 */
export function creditHours(courseName: string): number {
  const m = courseName.match(/[A-Z]{2,5}\s+(\d)(\d)\d\d/)
  const h = m ? Number(m[2]) : NaN
  return h >= 1 && h <= 6 ? h : 3
}

/** Share of total course weight that has at least one graded item behind it. */
export function settledWeight(groups: GradeGroup[]): number | null {
  const total = groups.reduce((n, g) => n + g.weight, 0)
  if (!total) return null
  const settled = groups.filter((g) => g.graded > 0).reduce((n, g) => n + g.weight, 0)
  return Math.round((settled / total) * 100)
}

export function Grades({ grades }: { grades: CourseGrade[] }) {
  const [open, setOpen] = useState<string | null>(null)

  const counted = grades.filter((g) => g.current_grade && POINTS[g.current_grade[0]] != null)
  const hours = counted.reduce((n, g) => n + creditHours(g.course_name), 0)
  const gpa = hours
    ? counted.reduce((n, g) => n + POINTS[g.current_grade![0]] * creditHours(g.course_name), 0) / hours
    : null

  return (
    <Card className="p-5">
      <SectionHead
        title="Grades"
        hint="Current scores from Canvas · graded work only"
        action={gpa != null ? (
          <div className="text-right" title="Estimate from current letter grades, weighted by credit hours">
            <div className="font-[var(--font-mono)] text-lg font-bold leading-none">{gpa.toFixed(2)}</div>
            <div className="text-[10px] uppercase tracking-wider text-[var(--muted)]">term GPA est.</div>
          </div>
        ) : undefined} />

      {grades.length === 0 ? (
        <Empty text="No grades yet. Grades sync with Canvas — hit Sync on the Coursework tab." />
      ) : (
        <ul className="space-y-2">
          {grades.map((g) => {
            const t = tone(g.current_grade)
            const isOpen = open === g.course_id
            const settled = settledWeight(g.groups)
            const [code, ...rest] = g.course_name.split(' · ')
            const visible = g.groups.filter((x) => x.weight > 0 || x.total > 0)

            return (
              <li key={g.course_id} className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--ground)]/45">
                <button
                  onClick={() => setOpen(isOpen ? null : g.course_id)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center gap-3 p-3 text-left transition hover:bg-[var(--ink)]/5">
                  <span className={`grid h-9 w-9 shrink-0 place-content-center rounded-lg border font-[var(--font-display)] text-base font-bold ${t.cls}`}>
                    {g.current_grade ?? '—'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-semibold">{code}</span>
                      <span className="shrink-0 font-[var(--font-mono)] text-sm font-bold tabular-nums">
                        {g.current_score != null ? `${g.current_score.toFixed(g.current_score % 1 ? 1 : 0)}%` : '—'}
                      </span>
                    </div>
                    <div className="truncate text-xs text-[var(--muted)]">{rest.join(' · ') || g.course_name}</div>
                    <div className="mt-1.5">
                      {g.current_score != null
                        ? <Bar value={g.current_score} accent={t.accent} height={5} />
                        : <div className="text-[11px] text-[var(--muted)]">Canvas isn't publishing a course total for this class</div>}
                    </div>
                  </div>
                  <span className={`shrink-0 text-xs text-[var(--muted)] transition-transform ${isOpen ? 'rotate-90' : ''}`}>▶</span>
                </button>

                {isOpen && (
                  <div className="animate-rise border-t border-[var(--line)] px-3 pb-3 pt-2.5">
                    {settled != null && (
                      <p className="mb-2.5 text-[11px] text-[var(--muted)]">
                        Based on categories worth <strong className="text-[var(--ink-2)]">{settled}%</strong> of the course
                        {settled < 100 && ' — the rest is still ungraded, so this can move a lot.'}
                      </p>
                    )}

                    <ul className="space-y-2">
                      {visible.map((x, i) => {
                        const pct = x.possible ? (x.earned / x.possible) * 100 : null
                        return (
                          <li key={`${x.name}-${i}`}>
                            <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
                              <span className="truncate">
                                {x.name}
                                {x.weight > 0 && <span className="ml-1.5 text-[var(--muted)]">{x.weight}%</span>}
                              </span>
                              <span className="shrink-0 font-[var(--font-mono)] tabular-nums text-[var(--muted)]">
                                {pct != null ? `${pct.toFixed(1)}%` : 'not graded'} · {x.graded}/{x.total}
                              </span>
                            </div>
                            <Bar value={pct ?? 0} accent={pct == null ? 'violet' : pct >= 90 ? 'emerald' : pct >= 80 ? 'cyan' : pct >= 70 ? 'amber' : 'rose'} height={4} />
                          </li>
                        )
                      })}
                    </ul>

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)] pt-2.5 text-[11px]">
                      {g.final_score != null && g.current_score != null && g.final_score < g.current_score ? (
                        <span className="text-[var(--muted)]" title="Canvas's final score counts every ungraded assignment as zero">
                          If nothing else is turned in: <strong className="text-[var(--ink-2)]">{g.final_score.toFixed(1)}%</strong>
                        </span>
                      ) : <span />}
                      {g.html_url && (
                        <a href={g.html_url} target="_blank" rel="noreferrer" className="text-[var(--accent-2)] hover:underline">
                          Open in Canvas ↗
                        </a>
                      )}
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
