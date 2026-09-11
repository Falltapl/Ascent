import { useState } from 'react'
import type { State, Config } from '../api'
import { api } from '../api'
import { Card, Button, Bar, Modal, Field, inputCls, dueMeta } from './ui'
import { SectionHead, Empty } from './Dashboard'

export function Coursework({ s, cfg, reload, celebrate }: {
  s: State; cfg: Config | null; reload: () => void; celebrate: () => void
}) {
  const [showDone, setShowDone] = useState(false)
  const [addOpen, setAddOpen] = useState(false)

  const open = s.assignments.filter((a) => !a.submitted && !a.done_manual)
  const closed = s.assignments.filter((a) => a.submitted || a.done_manual)
  const list = showDone ? closed : open

  // Group by course so a heavy week reads as "which class" not just "how many".
  const byCourse = list.reduce<Record<string, typeof list>>((acc, a) => {
    const k = a.course_name ?? 'Other'
    ;(acc[k] ??= []).push(a)
    return acc
  }, {})

  return (
    <div className="space-y-5">
      <Card className="p-5" hover={false}>
        <SectionHead
          title="UTA coursework"
          hint={cfg?.canvas.mode === 'off'
            ? 'Canvas not connected — add a token or ICS feed in Settings'
            : `Synced from Canvas · ${cfg?.canvas.mode === 'ics' ? 'calendar feed (read-only)' : 'full API'}`}
          action={
            <div className="flex gap-2">
              <Button size="sm" onClick={() => setShowDone(!showDone)}>
                {showDone ? `Open (${open.length})` : `Done (${closed.length})`}
              </Button>
              <Button size="sm" variant="primary" onClick={async () => { try { await api.syncCanvas(); reload() } catch (e: any) { alert(e.message) } }}>
                ↻ Sync
              </Button>
            </div>
          } />

        {list.length === 0 ? (
          <Empty text={showDone ? 'Nothing completed yet.' : 'No open assignments. Either you are caught up, or Canvas is not connected yet.'} />
        ) : (
          <div className="space-y-5">
            {Object.entries(byCourse).map(([course, items]) => (
              <div key={course}>
                <div className="mb-2 flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-[#22d3ee]">{course}</h3>
                  <span className="rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] text-[#8b8bb0]">{items.length}</span>
                </div>
                <ul className="space-y-2">
                  {items.map((a, i) => {
                    const d = dueMeta(a.due_at)
                    const isDone = Boolean(a.submitted || a.done_manual)
                    return (
                      <li key={a.id} className="animate-rise flex items-center gap-3 rounded-xl border border-[#272740] bg-black/25 p-3"
                          style={{ animationDelay: `${i * 35}ms` }}>
                        <button
                          onClick={async () => { await api.toggleAssignment(a.id, !isDone); if (!isDone) celebrate(); reload() }}
                          className={`grid h-5 w-5 shrink-0 place-content-center rounded-md border-2 transition ${
                            isDone ? 'border-[#34d399] bg-[#34d399] text-[#0a0a14]' : 'border-[#3d3d66] hover:border-[#34d399] hover:bg-[#34d399]/20'}`}>
                          {isDone && <span className="text-xs font-bold">✓</span>}
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className={`truncate text-sm font-medium ${isDone ? 'text-[#8b8bb0] line-through' : ''}`}>{a.title}</div>
                          <div className="flex flex-wrap gap-2 text-xs text-[#8b8bb0]">
                            {a.points != null && <span>{a.points} pts</span>}
                            {a.graded_score != null && (
                              <span className="text-[#34d399]">
                                scored {a.graded_score}{a.points ? `/${a.points}` : ''}
                              </span>
                            )}
                            {a.state && a.state !== 'unsubmitted' && (
                              <span className={a.state === 'pending_review' ? 'text-[#fbbf24]' : 'text-[#34d399]'}>
                                {a.state.replace('_', ' ')}
                              </span>
                            )}
                          </div>
                        </div>
                        {!isDone && (
                          <span className={`shrink-0 rounded-lg px-2 py-1 text-[11px] font-medium ${
                            d.tone === 'rose' ? 'bg-[#fb7185]/15 text-[#fb7185]'
                            : d.tone === 'amber' ? 'bg-[#fbbf24]/15 text-[#fbbf24]'
                            : 'bg-white/5 text-[#8b8bb0]'}`}>{d.text}</span>
                        )}
                        {a.html_url && (
                          <a href={a.html_url} target="_blank" rel="noreferrer"
                             className="shrink-0 text-xs text-[#22d3ee] hover:underline">open ↗</a>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Coursera */}
      <Card className="p-5" hover={false}>
        <SectionHead title="Coursera" hint="Metadata auto-filled from Coursera's public catalog API; module progress is tracked here"
          action={<Button size="sm" variant="primary" onClick={() => setAddOpen(true)}>+ Add course</Button>} />

        {s.courses.length === 0 ? (
          <Empty text="No courses yet. Paste a Coursera URL and the name, description, and workload fill themselves in." />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {s.courses.map((c) => {
              const pct = c.total_modules ? Math.round((c.done_modules / c.total_modules) * 100) : 0
              return (
                <div key={c.id} className="rounded-2xl border border-[#272740] bg-black/25 p-4">
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <a href={c.url} target="_blank" rel="noreferrer" className="font-semibold leading-snug hover:text-[#22d3ee]">{c.name}</a>
                    <button onClick={async () => { await api.deleteCourse(c.id); reload() }}
                            className="shrink-0 px-1 text-[#555577] hover:text-[#fb7185]">×</button>
                  </div>
                  {c.workload && <div className="mb-2 text-[11px] text-[#8b8bb0]">⏱ {c.workload}</div>}
                  <div className="mb-1.5 flex items-baseline justify-between text-xs">
                    <span className="text-[#8b8bb0]">{c.done_modules}/{c.total_modules} modules</span>
                    <span className="font-[var(--font-mono)] font-bold text-[#22d3ee]">{pct}%</span>
                  </div>
                  <Bar value={pct} accent="cyan" />
                  <div className="mt-3 flex items-center gap-2">
                    <Button size="sm" disabled={c.done_modules <= 0}
                      onClick={async () => { await api.updateCourse(c.id, { done_modules: c.done_modules - 1 }); reload() }}>−</Button>
                    <Button size="sm" disabled={c.done_modules >= c.total_modules}
                      onClick={async () => {
                        const next = c.done_modules + 1
                        await api.updateCourse(c.id, { done_modules: next })
                        if (next === c.total_modules) celebrate()
                        reload()
                      }}>+ module</Button>
                    <input type="number" min={0} className={`${inputCls} ml-auto w-20 py-1 text-xs`}
                      value={c.total_modules}
                      onChange={async (e) => { await api.updateCourse(c.id, { total_modules: Math.max(0, +e.target.value) }); reload() }}
                      title="Total modules" />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      <AddCourse open={addOpen} onClose={() => setAddOpen(false)} onSaved={() => { setAddOpen(false); reload() }} />
    </div>
  )
}

function AddCourse({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [input, setInput] = useState('')
  const [modules, setModules] = useState(4)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const save = async () => {
    setBusy(true); setErr('')
    try {
      await api.addCourse(input, modules)
      setInput('')
      onSaved()
    } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add a Coursera course">
      <div className="space-y-4">
        <Field label="Course URL or slug">
          <input className={inputCls} value={input} onChange={(e) => setInput(e.target.value)}
            placeholder="https://www.coursera.org/learn/aws-cloud-technical-essentials" autoFocus />
        </Field>
        <Field label="Number of modules">
          <input type="number" min={1} className={inputCls} value={modules} onChange={(e) => setModules(+e.target.value)} />
        </Field>
        <p className="text-xs text-[#8b8bb0]">
          Name, description, and estimated workload are pulled from Coursera's public catalog.
          Coursera does not expose per-learner progress to individual accounts, so module
          completion is tracked here.
        </p>
        {err && <p className="rounded-lg bg-[#fb7185]/15 px-3 py-2 text-xs text-[#fb7185]">{err}</p>}
        <Button variant="primary" onClick={save} disabled={busy || !input.trim()} className="w-full">
          {busy ? 'Looking up…' : 'Add course'}
        </Button>
      </div>
    </Modal>
  )
}
