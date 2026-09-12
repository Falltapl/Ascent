import { useState } from 'react'
import type { State, Goal } from '../api'
import { api } from '../api'
import { Card, Button, Modal, Field, inputCls, Bar, dueMeta } from './ui'
import { SectionHead, Empty } from './Dashboard'

const CATEGORIES = [
  { id: 'career', label: 'Career', emoji: '💼', accent: 'violet' as const },
  { id: 'academic', label: 'Academic', emoji: '🎓', accent: 'cyan' as const },
  { id: 'cert', label: 'Certification', emoji: '☁️', accent: 'amber' as const },
  { id: 'health', label: 'Health', emoji: '💪', accent: 'emerald' as const },
  { id: 'personal', label: 'Personal', emoji: '✨', accent: 'rose' as const },
]

export function Goals({ s, reload, celebrate }: { s: State; reload: () => void; celebrate: () => void }) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('all')

  const active = s.goals.filter((g) => g.status === 'active')
  const done = s.goals.filter((g) => g.status === 'done')
  const shown = (filter === 'all' ? active : active.filter((g) => g.category === filter))

  return (
    <div className="space-y-5">
      <Card className="p-5" hover={false}>
        <SectionHead title="Goals" hint={`${active.length} active · ${done.length} completed`}
          action={<Button variant="primary" onClick={() => setOpen(true)}>+ New goal</Button>} />
        <div className="flex flex-wrap gap-2">
          <Chip active={filter === 'all'} onClick={() => setFilter('all')}>All</Chip>
          {CATEGORIES.map((c) => (
            <Chip key={c.id} active={filter === c.id} onClick={() => setFilter(c.id)}>
              {c.emoji} {c.label}
            </Chip>
          ))}
        </div>
      </Card>

      {shown.length === 0 ? (
        <Card className="p-5" hover={false}><Empty text="No goals here yet. Add one to get started." /></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {shown.map((g, i) => <GoalCard key={g.id} g={g} i={i} reload={reload} celebrate={celebrate} />)}
        </div>
      )}

      {done.length > 0 && (
        <Card className="p-5" hover={false}>
          <SectionHead title="Completed" hint={`${done.length} goals · ${done.length * 200} XP earned`} />
          <ul className="space-y-2">
            {done.map((g) => (
              <li key={g.id} className="flex items-center gap-3 rounded-xl border border-[var(--ok)]/20 bg-[var(--ok)]/5 px-4 py-2.5">
                <span className="text-[var(--ok)]">✓</span>
                <span className="flex-1 truncate text-sm text-[var(--muted)] line-through">{g.title}</span>
                <span className="text-xs text-[var(--muted)]">
                  {g.completed_at && new Date(g.completed_at).toLocaleDateString()}
                </span>
                <Button size="sm" onClick={async () => { await api.updateGoal(g.id, { status: 'active' }); reload() }}>Reopen</Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <NewGoal open={open} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); reload() }} />
    </div>
  )
}

function GoalCard({ g, i, reload, celebrate }: { g: Goal; i: number; reload: () => void; celebrate: () => void }) {
  const [newStep, setNewStep] = useState('')
  const cat = CATEGORIES.find((c) => c.id === g.category) ?? CATEGORIES[4]
  const doneSteps = g.steps.filter((s) => s.done).length
  const pct = g.steps.length ? Math.round((doneSteps / g.steps.length) * 100) : 0
  const due = dueMeta(g.target_date)

  const complete = async () => {
    await api.updateGoal(g.id, { status: 'done' })
    celebrate()
    reload()
  }

  return (
    <Card className="animate-rise p-5" style={{ animationDelay: `${i * 60}ms` }}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2">
            <span>{cat.emoji}</span>
            <span className="text-[10px] uppercase tracking-wider text-[var(--muted)]">{cat.label}</span>
          </div>
          <h3 className="font-[var(--font-display)] font-bold leading-snug">{g.title}</h3>
          {g.detail && <p className="mt-1 text-sm text-[var(--muted)]">{g.detail}</p>}
        </div>
        <button onClick={async () => { await api.deleteGoal(g.id); reload() }}
                className="shrink-0 rounded-lg px-2 py-1 text-[var(--faint)] transition hover:bg-[var(--bad)]/15 hover:text-[var(--bad)]">×</button>
      </div>

      {g.target_date && (
        <div className={`mb-3 inline-block rounded-lg px-2 py-1 text-[11px] ${
          due.tone === 'rose' ? 'bg-[var(--bad)]/15 text-[var(--bad)]'
          : due.tone === 'amber' ? 'bg-[var(--warn)]/15 text-[var(--warn)]'
          : 'bg-[var(--ink)]/5 text-[var(--muted)]'}`}>
          🗓 {due.text}
        </div>
      )}

      {g.steps.length > 0 && (
        <>
          <div className="mb-1.5 flex items-baseline justify-between text-xs">
            <span className="text-[var(--muted)]">{doneSteps}/{g.steps.length} steps</span>
            <span className="font-[var(--font-mono)] font-bold" style={{ color: cat.accent === 'violet' ? 'var(--accent)' : undefined }}>{pct}%</span>
          </div>
          <Bar value={pct} accent={cat.accent} />
          <ul className="mt-3 space-y-0.5">
            {g.steps.map((st) => (
              <li key={st.id} className="group flex items-center gap-2">
                <label className="flex flex-1 cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 text-sm hover:bg-[var(--ink)]/5">
                  <input type="checkbox" checked={!!st.done}
                    onChange={async (e) => { await api.toggleStep(st.id, e.target.checked); if (e.target.checked) celebrate(); reload() }}
                    className="h-4 w-4 accent-[var(--ok)]" />
                  <span className={st.done ? 'text-[var(--muted)] line-through' : ''}>{st.label}</span>
                </label>
                <button onClick={async () => { await api.deleteStep(st.id); reload() }}
                        className="px-1 text-[var(--faint)] opacity-0 transition group-hover:opacity-100 hover:text-[var(--bad)]">×</button>
              </li>
            ))}
          </ul>
        </>
      )}

      <form className="mt-3 flex gap-2"
            onSubmit={async (e) => { e.preventDefault(); if (!newStep.trim()) return; await api.addStep(g.id, newStep); setNewStep(''); reload() }}>
        <input className={`${inputCls} text-xs`} placeholder="Add a step…" value={newStep} onChange={(e) => setNewStep(e.target.value)} />
        <Button size="sm" type="submit">Add</Button>
      </form>

      {pct === 100 && (
        <Button variant="primary" className="mt-3 w-full" onClick={complete}>🎉 Mark complete · +200 XP</Button>
      )}
    </Card>
  )
}

function Chip({ children, active, onClick }: { children: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={`rounded-xl border px-3 py-1.5 text-xs transition ${
        active ? 'border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--ink)]' : 'border-[var(--line)] text-[var(--muted)] hover:border-[var(--line-2)]'}`}>
      {children}
    </button>
  )
}

function NewGoal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState('')
  const [detail, setDetail] = useState('')
  const [category, setCategory] = useState('career')
  const [date, setDate] = useState('')
  const [steps, setSteps] = useState('')

  const save = async () => {
    if (!title.trim()) return
    await api.addGoal({
      title, detail, category,
      target_date: date || null,
      steps: steps.split('\n').filter((s) => s.trim()),
    })
    setTitle(''); setDetail(''); setDate(''); setSteps('')
    onSaved()
  }

  return (
    <Modal open={open} onClose={onClose} title="New goal">
      <div className="space-y-4">
        <Field label="Goal"><input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Pass AWS Solutions Architect Associate" autoFocus /></Field>
        <Field label="Why it matters (optional)"><input className={inputCls} value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="Unlocks cloud engineering internships" /></Field>
        <Field label="Category">
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((c) => (
              <button key={c.id} onClick={() => setCategory(c.id)}
                className={`rounded-xl border px-3 py-1.5 text-xs transition ${
                  category === c.id ? 'border-[var(--accent)] bg-[var(--accent)]/15' : 'border-[var(--line)] text-[var(--muted)] hover:border-[var(--line-2)]'}`}>
                {c.emoji} {c.label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Target date"><input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Steps — one per line">
          <textarea className={`${inputCls} h-24 resize-none`} value={steps} onChange={(e) => setSteps(e.target.value)}
            placeholder={'Finish Cloud Practitioner\nComplete 3 practice exams\nBook the exam'} />
        </Field>
        <Button variant="primary" onClick={save} className="w-full">Create goal</Button>
      </div>
    </Modal>
  )
}
