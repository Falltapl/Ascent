import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, type Application, type JobListing, type JobsPayload, type StatusDef } from '../api'
import { Card, Button, Modal, Field, inputCls } from './ui'
import { SectionHead, Empty } from './Dashboard'
import { byAttention, dueTone, gradOnlyLabel, groupOf, heardBackRate, relativeDay, relativeTime, staleDays, statusTone, undergradEligible } from '../jobs'

const GROUPS = [
  { id: 'all', label: 'All' },
  { id: 'saved', label: 'Saved' },
  { id: 'applied', label: 'Applied' },
  { id: 'active', label: 'In progress' },
  { id: 'offer', label: 'Offers' },
  { id: 'closed', label: 'Closed' },
] as const
type GroupId = (typeof GROUPS)[number]['id']

// No text colour here on purpose: two Tailwind colour utilities on one element
// resolve by stylesheet order, not class order, so a base colour silently beats
// overrides like the red overdue date. Each use sets its own.
const cell = 'w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm outline-none transition placeholder:text-[var(--faint)] hover:border-[var(--line)] focus:border-[var(--accent)] focus:bg-[var(--ground)]/55'

export function Internships() {
  const [data, setData] = useState<JobsPayload | null>(null)
  const [err, setErr] = useState('')
  const [syncing, setSyncing] = useState(false)

  const load = useCallback(() => api.jobs().then((d) => { setData(d); setErr('') }).catch((e) => setErr(e.message)), [])

  // The server refreshes in the background; this only asks it to start one.
  // Company career sites can take ~40s, so the request returns at once and the
  // tab polls until the server reports it's done.
  const sync = useCallback(async () => {
    setSyncing(true)
    try { await api.syncJobs() } catch (e: any) { setErr(e.message); setSyncing(false) }
  }, [])

  const refreshing = syncing || Boolean(data?.refreshing)
  useEffect(() => {
    if (!refreshing) return
    const t = setInterval(() => {
      api.jobs().then((d) => { setData(d); if (!d.refreshing) setSyncing(false) }).catch(() => {})
    }, 3000)
    return () => clearInterval(t)
  }, [refreshing])

  useEffect(() => {
    // Show cached listings immediately; ask for a refresh if they're old.
    api.jobs().then((d) => { setData(d); if (d.stale && !d.refreshing) sync() }).catch((e) => setErr(e.message))
  }, [sync])

  useEffect(() => {
    // Pick up background refreshes while the tab is open, and on return to it.
    const refetch = () => { if (document.visibilityState === 'visible') load() }
    const t = setInterval(refetch, 5 * 60_000)
    document.addEventListener('visibilitychange', refetch)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', refetch) }
  }, [load])

  if (!data) {
    return (
      <Card className="p-5" hover={false}>
        {err ? <p className="text-sm text-[var(--bad)]">{err}</p> : <p className="text-sm text-[var(--muted)]">Loading internships…</p>}
      </Card>
    )
  }

  const replace = (a: Application) =>
    setData((d) => d && { ...d, applications: d.applications.map((x) => (x.id === a.id ? a : x)) })

  return (
    <div className="space-y-5">
      {err && <p className="rounded-xl border border-[var(--bad)]/30 bg-[var(--bad)]/10 px-4 py-2.5 text-sm text-[var(--bad)]">{err}</p>}
      <Tracker data={data} onReplace={replace} reload={load} onError={setErr} />
      <Discover data={data} syncing={refreshing} onSync={sync} reload={load} onError={setErr} />
    </div>
  )
}

/* ── tracker ─────────────────────────────────────────────────────────── */

type SortKey = 'attention' | 'company' | 'status' | 'applied' | 'next'

function Tracker({ data, onReplace, reload, onError }: {
  data: JobsPayload; onReplace: (a: Application) => void; reload: () => void; onError: (m: string) => void
}) {
  const { applications: apps, statuses } = data
  const [group, setGroup] = useState<GroupId>('all')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<SortKey>('attention')
  const [adding, setAdding] = useState(false)

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: apps.length }
    for (const a of apps) c[groupOf(statuses, a.status)] = (c[groupOf(statuses, a.status)] ?? 0) + 1
    return c
  }, [apps, statuses])

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const order = statuses.map((s) => s.id)
    const cmp: Record<SortKey, (a: Application, b: Application) => number> = {
      attention: byAttention(statuses),
      company: (a, b) => a.company.localeCompare(b.company) || a.role.localeCompare(b.role),
      status: (a, b) => order.indexOf(a.status) - order.indexOf(b.status),
      applied: (a, b) => (b.applied_on ?? '').localeCompare(a.applied_on ?? ''),
      next: (a, b) => (a.next_step_on ?? '9999').localeCompare(b.next_step_on ?? '9999'),
    }
    return apps
      .filter((a) => group === 'all' || groupOf(statuses, a.status) === group)
      .filter((a) => !needle || `${a.company} ${a.role} ${a.location} ${a.notes} ${a.next_step}`.toLowerCase().includes(needle))
      .sort(cmp[sort])
  }, [apps, statuses, group, q, sort])

  const rate = heardBackRate(apps)
  const feedById = useMemo(() => new Map(data.feed.map((j) => [j.id, j])), [data.feed])

  const Th = ({ k, children, className = '' }: { k: SortKey; children: React.ReactNode; className?: string }) => (
    <th className={`px-2 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-[var(--muted)] ${className}`}
        aria-sort={sort === k ? 'ascending' : 'none'}>
      <button onClick={() => setSort(sort === k ? 'attention' : k)} className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-[var(--ink)]">
        {children}{sort === k && <span aria-hidden>▾</span>}
      </button>
    </th>
  )

  return (
    <Card className="p-5" hover={false}>
      <SectionHead
        title="Applications"
        hint={apps.length ? `${apps.length} tracked${rate != null ? ` · ${rate}% heard back` : ''}` : 'Track internships you want to apply to, and where each one stands'}
        action={
          <div className="flex gap-2">
            {apps.length > 0 && (
              <a href="/api/applications.csv" download
                 className="inline-flex items-center rounded-xl border border-[var(--line)] bg-[var(--ink)]/5 px-2.5 py-1.5 text-xs font-medium hover:border-[var(--line-2)]">
                Export CSV
              </a>
            )}
            <Button size="sm" variant="primary" onClick={() => setAdding(true)}>+ Add</Button>
          </div>
        } />

      {apps.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {GROUPS.map((g) => (
            <button key={g.id} onClick={() => setGroup(g.id)} aria-pressed={group === g.id}
              className={`rounded-xl border px-3 py-1.5 text-xs transition ${group === g.id
                ? 'border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--ink)]'
                : 'border-[var(--line)] text-[var(--muted)] hover:border-[var(--line-2)]'}`}>
              {g.label}<span className="ml-1.5 text-[var(--faint)]">{counts[g.id] ?? 0}</span>
            </button>
          ))}
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" aria-label="Search applications"
                 className={`${inputCls} ml-auto w-44 py-1.5 text-xs`} />
        </div>
      )}

      {apps.length === 0 ? (
        <Empty text="Nothing tracked yet. Hit Track on a listing below, or add one you found elsewhere." />
      ) : rows.length === 0 ? (
        <Empty text="No applications match this filter." />
      ) : (
        <div className="-mx-2 overflow-x-auto">
          <table className="w-full min-w-[880px] border-separate border-spacing-y-1">
            <thead>
              <tr>
                <Th k="company" className="w-[30%]">Company / role</Th>
                <th className="px-2 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-[var(--muted)] w-[15%]">Location</th>
                <Th k="status" className="w-[15%]">Status</Th>
                <Th k="applied" className="w-[12%]">Applied</Th>
                <Th k="next">Next step</Th>
                <th className="w-16"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <Row key={a.id} a={a} statuses={statuses} listing={a.feed_id ? feedById.get(a.feed_id) : undefined}
                     onReplace={onReplace} reload={reload} onError={onError} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AddModal open={adding} statuses={statuses} onClose={() => setAdding(false)}
        onAdded={() => { setAdding(false); reload() }} onError={onError} />
    </Card>
  )
}

function Row({ a, statuses, listing, onReplace, reload, onError }: {
  a: Application; statuses: StatusDef[]; listing?: JobListing
  onReplace: (a: Application) => void; reload: () => void; onError: (m: string) => void
}) {
  const [draft, setDraft] = useState(a)
  const [open, setOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  // The field currently being typed in. A save reply for this row (say, from a
  // status change or the previous field's blur) must not overwrite text that
  // hasn't been committed yet — found in testing, where it silently erased it.
  const editing = useRef<keyof Application | null>(null)
  useEffect(() => {
    setDraft((d) => {
      const k = editing.current
      return k ? { ...a, [k]: d[k] } : a
    })
  }, [a])

  const save = async (patch: Partial<Application>) => {
    const changed = Object.entries(patch).some(([k, v]) => (a as any)[k] !== v)
    if (!changed) return
    setDraft((d) => ({ ...d, ...patch }))
    try { onReplace(await api.updateApplication(a.id, patch)) }
    catch (e: any) { setDraft(a); onError(e.message) }
  }
  const text = (k: 'location' | 'next_step' | 'referral' | 'notes' | 'company' | 'role') => ({
    value: draft[k],
    onFocus: () => { editing.current = k },
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft((d) => ({ ...d, [k]: e.target.value })),
    onBlur: () => { editing.current = null; save({ [k]: draft[k] } as Partial<Application>) },
  })
  const enterBlurs = (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') e.currentTarget.blur() }

  const stale = staleDays(a)
  const gradOnly = listing ? !undergradEligible(listing) : false
  const due = dueTone(a.next_step_on)
  const closed = groupOf(statuses, a.status) === 'closed'
  const hasNotes = Boolean(a.notes || a.referral)
  const td = 'bg-[var(--ground)]/45 px-1.5 py-1.5 align-top first:rounded-l-xl last:rounded-r-xl border-y border-[var(--line)] first:border-l last:border-r'

  return (
    <>
      <tr className={closed ? 'opacity-60' : ''}>
        <td className={td}>
          <div className="flex items-center gap-1">
            <input {...text('company')} onKeyDown={enterBlurs} aria-label="Company" className={`${cell} font-semibold text-[var(--ink)]`} />
            {a.url && (
              <a href={a.url} target="_blank" rel="noreferrer" title="Open posting"
                 className="shrink-0 rounded-md px-1.5 py-1 text-xs text-[var(--accent-2)] hover:bg-[var(--ink)]/5">↗</a>
            )}
          </div>
          <input {...text('role')} onKeyDown={enterBlurs} aria-label="Role" title={draft.role} className={`${cell} text-xs text-[var(--muted)]`} />
          {(a.posting_closed === 1 || stale != null || gradOnly) && (
            <div className="mt-1 flex flex-wrap gap-1 px-1.5">
              {gradOnly && listing && (
                <span className="rounded-md bg-[var(--warn)]/12 px-1.5 py-0.5 text-[10px] text-[var(--warn)]"
                      title="The posting lists graduate degrees only. Check the company's requirements before applying.">
                  {gradOnlyLabel(listing.degrees)}
                </span>
              )}
              {a.posting_closed === 1 && (
                <span className="rounded-md bg-[var(--bad)]/12 px-1.5 py-0.5 text-[10px] text-[var(--bad)]" title="No longer listed on SimplifyJobs">Posting closed</span>
              )}
              {stale != null && (
                <span className="rounded-md bg-[var(--warn)]/12 px-1.5 py-0.5 text-[10px] text-[var(--warn)]" title="Consider a follow-up, or mark it ghosted">No reply in {stale}d</span>
              )}
            </div>
          )}
        </td>
        <td className={td}>
          <input {...text('location')} onKeyDown={enterBlurs} aria-label="Location" placeholder="—" className={`${cell} text-xs text-[var(--ink)]`} />
        </td>
        <td className={td}>
          <select value={draft.status} onChange={(e) => save({ status: e.target.value })} aria-label="Status"
                  className={`w-full cursor-pointer rounded-lg border px-2 py-1 text-xs font-medium outline-none ${statusTone(statuses, draft.status)}`}>
            {(['saved', 'applied', 'active', 'offer', 'closed'] as const).map((g) => (
              <optgroup key={g} label={GROUPS.find((x) => x.id === g)!.label}>
                {statuses.filter((s) => s.group === g).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </optgroup>
            ))}
          </select>
        </td>
        <td className={td}>
          <input type="date" value={draft.applied_on ?? ''} onChange={(e) => save({ applied_on: e.target.value || null })}
                 aria-label="Date applied" className={`${cell} text-xs text-[var(--ink)]`} />
        </td>
        <td className={td}>
          <div className="flex gap-1">
            <input {...text('next_step')} onKeyDown={enterBlurs} aria-label="Next step" placeholder="e.g. OA due, follow up…" className={`${cell} text-xs text-[var(--ink)]`} />
            <input type="date" value={draft.next_step_on ?? ''} onChange={(e) => save({ next_step_on: e.target.value || null })}
                   aria-label="Next step date"
                   className={`${cell} w-[8.5rem] shrink-0 text-xs ${due === 'overdue' ? 'font-semibold text-[var(--bad)]' : due === 'soon' ? 'font-semibold text-[var(--warn)]' : 'text-[var(--ink)]'}`} />
          </div>
        </td>
        <td className={`${td} whitespace-nowrap text-right`}>
          <button onClick={() => setOpen(!open)} aria-expanded={open} title="Notes & referral"
                  className="relative rounded-md px-2 py-1 text-xs text-[var(--muted)] hover:bg-[var(--ink)]/5 hover:text-[var(--ink)]">
            ✎{hasNotes && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[var(--accent)]" aria-label="has notes" />}
          </button>
          {confirmDelete ? (
            <button onClick={async () => { try { await api.deleteApplication(a.id); reload() } catch (e: any) { onError(e.message) } }}
                    onBlur={() => setConfirmDelete(false)} autoFocus
                    className="rounded-md bg-[var(--bad)]/15 px-2 py-1 text-xs font-medium text-[var(--bad)]">Delete?</button>
          ) : (
            <button onClick={() => setConfirmDelete(true)} title="Remove" aria-label={`Remove ${a.company}`}
                    className="rounded-md px-2 py-1 text-xs text-[var(--faint)] hover:bg-[var(--bad)]/12 hover:text-[var(--bad)]">✕</button>
          )}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={6} className="rounded-xl border border-[var(--line)] bg-[var(--ground)]/45 px-3 py-2.5">
            <div className="grid gap-2 sm:grid-cols-[14rem_1fr]">
              <label className="text-xs text-[var(--muted)]">
                Referral / contact
                <input {...text('referral')} onKeyDown={enterBlurs} aria-label="Referral or contact" placeholder="Who referred you, recruiter name…" className={`${inputCls} mt-1 text-xs`} />
              </label>
              <label className="text-xs text-[var(--muted)]">
                Notes
                <textarea {...text('notes')} aria-label="Notes" rows={3} placeholder="Interview questions, salary, anything worth remembering…" className={`${inputCls} mt-1 resize-y text-xs`} />
              </label>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function AddModal({ open, statuses, onClose, onAdded, onError }: {
  open: boolean; statuses: StatusDef[]; onClose: () => void; onAdded: () => void; onError: (m: string) => void
}) {
  const blank = { company: '', role: '', location: '', url: '', status: 'saved' }
  const [f, setF] = useState(blank)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { setF({ ...f, [k]: e.target.value }); setMsg('') }

  const submit = async () => {
    if (!f.company.trim() || !f.role.trim()) { setMsg('Company and role are both required.'); return }
    setBusy(true)
    try { await api.addApplication(f); setF(blank); onAdded() }
    catch (e: any) { onError(e.message) }
    finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add an application">
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Company"><input className={inputCls} value={f.company} onChange={set('company')} autoFocus /></Field>
          <Field label="Role"><input className={inputCls} value={f.role} onChange={set('role')} placeholder="Cloud Engineering Intern" /></Field>
          <Field label="Location"><input className={inputCls} value={f.location} onChange={set('location')} placeholder="Plano, TX" /></Field>
          <Field label="Status">
            <select className={inputCls} value={f.status} onChange={set('status')}>
              {statuses.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Posting link (optional)"><input className={inputCls} value={f.url} onChange={set('url')} placeholder="https://…" /></Field>
        {msg && <p className="text-xs text-[var(--bad)]" role="alert">{msg}</p>}
        <Button variant="primary" onClick={submit} disabled={busy} className="w-full">{busy ? 'Adding…' : 'Add application'}</Button>
      </div>
    </Modal>
  )
}

/* ── discover ────────────────────────────────────────────────────────── */

/**
 * Big companies list a dozen offices. Show the in-scope ones (Texas, remote)
 * and count the rest, so "Austin" isn't buried under Palo Alto and Cambridge.
 */
export function summarizeLocations(locs: string[]): string {
  if (locs.length <= 3) return locs.join('; ')
  const local = locs.filter((l) => /,\s*(TX|Texas)$/i.test(l.trim()) || /^remote/i.test(l.trim()))
  const shown = local.length ? local : locs.slice(0, 2)
  const rest = locs.length - shown.length
  return rest > 0 ? `${shown.join('; ')} +${rest} more` : shown.join('; ')
}

type Kind = 'all' | 'cloud' | 'software' | 'data' | 'security'
const KINDS: { id: Kind; label: string }[] = [
  { id: 'all', label: 'All roles' },
  { id: 'cloud', label: 'Cloud & infra' },
  { id: 'software', label: 'Software' },
  { id: 'data', label: 'AI / data' },
  { id: 'security', label: 'Security' },
]
/** Older rows may predate role types; fall back to Simplify's category. */
const roleOf = (j: JobListing): Exclude<Kind, 'all'> | null =>
  j.role_type ?? (/software/i.test(j.category ?? '') ? 'software' : /data|ai/i.test(j.category ?? '') ? 'data' : null)

export function sourceLabel(j: Pick<JobListing, 'source' | 'company'>): string {
  if (j.source === 'simplify') return 'SimplifyJobs'
  if (j.source === 'amazon') return 'amazon.jobs'
  return `${j.company} careers`
}

const REGIONS = ['DFW', 'Austin', 'Remote'] as const
const PAGE = 25

function Discover({ data, syncing, onSync, reload, onError }: {
  data: JobsPayload; syncing: boolean; onSync: () => void; reload: () => void; onError: (m: string) => void
}) {
  const [regions, setRegions] = useState<Set<string>>(new Set(REGIONS))
  const [kind, setKind] = useState<Kind>(() => {
    try { const k = localStorage.getItem('ascent.jobs.kind'); return KINDS.some((x) => x.id === k) ? (k as Kind) : 'all' } catch { return 'all' }
  })
  useEffect(() => { try { localStorage.setItem('ascent.jobs.kind', kind) } catch { /* storage blocked */ } }, [kind])
  const [hideTracked, setHideTracked] = useState(false)
  // On by default; remembered per browser. Grad-only roles are hidden, not deleted.
  const [undergradOnly, setUndergradOnly] = useState(() => {
    try { return localStorage.getItem('ascent.jobs.undergradOnly') !== 'false' } catch { return true }
  })
  useEffect(() => {
    try { localStorage.setItem('ascent.jobs.undergradOnly', String(undergradOnly)) } catch { /* storage blocked */ }
  }, [undergradOnly])
  const eligible = useMemo(() => (undergradOnly ? data.feed.filter(undergradEligible) : data.feed), [data.feed, undergradOnly])
  const gradHidden = data.feed.length - data.feed.filter(undergradEligible).length
  const [q, setQ] = useState('')
  const [shown, setShown] = useState(PAGE)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => setShown(PAGE), [regions, kind, hideTracked, undergradOnly, q])

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return eligible.filter((j) =>
      j.regions.some((r) => regions.has(r))
      && (kind === 'all' || roleOf(j) === kind)
      && (!hideTracked || !j.application_id)
      && (!needle || `${j.company} ${j.title} ${j.locations.join(' ')}`.toLowerCase().includes(needle)))
  }, [eligible, regions, kind, hideTracked, q])

  const inRegions = useMemo(() => eligible.filter((j) => j.regions.some((r) => regions.has(r))), [eligible, regions])

  const toggleRegion = (r: string) => setRegions((cur) => {
    const next = new Set(cur)
    if (next.has(r)) { if (next.size > 1) next.delete(r) } else next.add(r)
    return next
  })

  const track = async (j: JobListing) => {
    setBusy(j.id)
    try { await api.addApplication({ feed_id: j.id }); await reload() }
    catch (e: any) { onError(e.message); reload() }
    finally { setBusy(null) }
  }

  const chip = (on: boolean) => `rounded-xl border px-3 py-1.5 text-xs transition ${on
    ? 'border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--ink)]'
    : 'border-[var(--line)] text-[var(--muted)] hover:border-[var(--line-2)]'}`

  return (
    <Card className="p-5" hover={false}>
      <SectionHead
        title="Open internships"
        hint={`${data.term} · DFW, Austin and remote US · ${data.sources.length || 1} sources · ${syncing ? 'refreshing…' : data.lastSync ? `checked ${relativeTime(data.lastSync)}` : 'not synced yet'}`}
        action={<Button size="sm" onClick={onSync} disabled={syncing}>{syncing ? 'Refreshing…' : '↻ Refresh'}</Button>} />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {REGIONS.map((r) => (
          <button key={r} onClick={() => toggleRegion(r)} aria-pressed={regions.has(r)} className={chip(regions.has(r))}>
            {r === 'Remote' ? 'Remote US' : r}
            <span className="ml-1.5 text-[var(--faint)]">{eligible.filter((j) => j.regions.includes(r)).length}</span>
          </button>
        ))}
        <span className="mx-1 h-5 w-px bg-[var(--line)]" aria-hidden />
        {KINDS.map((k) => {
          const count = k.id === 'all' ? inRegions.length : inRegions.filter((j) => roleOf(j) === k.id).length
          return (
            <button key={k.id} onClick={() => setKind(k.id)} aria-pressed={kind === k.id} className={chip(kind === k.id)}>
              {k.label}<span className="ml-1.5 text-[var(--faint)]">{count}</span>
            </button>
          )
        })}
        <label className="ml-1 flex cursor-pointer items-center gap-1.5 text-xs text-[var(--muted)]">
          <input type="checkbox" aria-label="Hide tracked listings" checked={hideTracked} onChange={(e) => setHideTracked(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--accent)]" />
          Hide tracked
        </label>
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-[var(--muted)]"
               title={`${gradHidden} listing${gradHidden === 1 ? '' : 's'} require a Master's, PhD or MBA`}>
          <input type="checkbox" aria-label="Undergrad-eligible only" checked={undergradOnly}
                 onChange={(e) => setUndergradOnly(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--accent)]" />
          Undergrad only{undergradOnly && gradHidden > 0 && <span className="text-[var(--faint)]">({gradHidden} hidden)</span>}
        </label>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Company, role, city…" aria-label="Search listings"
               className={`${inputCls} ml-auto w-48 py-1.5 text-xs`} />
      </div>

      {data.feed.length === 0 ? (
        <Empty text={syncing ? 'Pulling the latest listings…' : 'No listings yet. Hit Refresh to pull them from SimplifyJobs.'} />
      ) : list.length === 0 ? (
        <Empty text={kind === 'cloud'
          ? 'No cloud or infrastructure internships match right now. Most cloud internships for next summer post between September and January — the list refreshes in the background every few hours and will pick them up.'
          : 'No listings match these filters.'} />
      ) : (
        <>
          <ul className="space-y-1.5">
            {list.slice(0, shown).map((j) => (
              <li key={j.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-[var(--line)] bg-[var(--ground)]/45 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-semibold">{j.company}</span>
                    <span className="truncate text-sm text-[var(--ink-2)]">{j.title}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-[var(--muted)]">
                    <span className="truncate" title={j.locations.join('; ')}>{summarizeLocations(j.locations)}</span>
                    {j.posted_at && <span>· posted {relativeDay(j.posted_at)}</span>}
                    {roleOf(j) && (
                      <span className={`rounded px-1.5 py-px ${roleOf(j) === 'cloud' ? 'bg-[var(--accent)]/15 text-[var(--accent)]' : 'bg-[var(--ink)]/5'}`}>
                        {KINDS.find((k) => k.id === roleOf(j))!.label}
                      </span>
                    )}
                    <span className="text-[var(--faint)]">via {sourceLabel(j)}</span>
                    {!undergradEligible(j) && (
                      <span className="rounded bg-[var(--warn)]/12 px-1.5 py-px text-[var(--warn)]">{gradOnlyLabel(j.degrees)}</span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <a href={j.url} target="_blank" rel="noreferrer"
                     className="inline-flex items-center rounded-xl border border-[var(--line)] bg-[var(--ink)]/5 px-2.5 py-1.5 text-xs font-medium hover:border-[var(--line-2)]">
                    Apply ↗
                  </a>
                  {j.application_id ? (
                    <span className="inline-flex items-center rounded-xl border border-[var(--ok)]/30 bg-[var(--ok)]/12 px-2.5 py-1.5 text-xs font-medium text-[var(--ok)]">Tracked ✓</span>
                  ) : (
                    <Button size="sm" variant="primary" onClick={() => track(j)} disabled={busy === j.id}>{busy === j.id ? 'Adding…' : '+ Track'}</Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-center justify-between text-xs text-[var(--muted)]">
            <span>Showing {Math.min(shown, list.length)} of {list.length}</span>
            {shown < list.length && <Button size="sm" onClick={() => setShown(shown + PAGE)}>Show {Math.min(PAGE, list.length - shown)} more</Button>}
          </div>
        </>
      )}
      <SourcesPanel sources={data.sources} />
      <p className="mt-2 text-[11px] text-[var(--faint)]">
        Listings from <a href="https://github.com/SimplifyJobs/Summer2027-Internships" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-[var(--muted)]">SimplifyJobs</a> (maintained by Simplify and Pitt CSC) and employers' own career sites. Refreshes in the background while the app is running. Always confirm details on the company's posting.
      </p>
    </Card>
  )
}

function SourcesPanel({ sources }: { sources: JobsPayload['sources'] }) {
  if (!sources.length) return null
  const failed = sources.filter((s) => !s.ok)
  const withListings = sources.filter((s) => s.count > 0)
  return (
    <details className="mt-3 rounded-xl border border-[var(--line)] bg-[var(--ground)]/30 px-3 py-2 text-xs">
      <summary className="cursor-pointer text-[var(--muted)]">
        Checked {sources.length} sources · {withListings.length} with matches
        {failed.length > 0 && <span className="text-[var(--warn)]"> · {failed.length} unreachable</span>}
      </summary>
      <ul className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
        {sources.map((s) => (
          <li key={s.id} className="flex items-baseline justify-between gap-2">
            <span className={`truncate ${s.ok ? '' : 'text-[var(--warn)]'}`} title={s.error}>{s.ok ? '' : '⚠ '}{s.name}</span>
            <span className="shrink-0 font-[var(--font-mono)] text-[var(--faint)]">
              {s.count} · {s.ok ? (s.checked_at ? relativeTime(s.checked_at) : '—') : 'failed'}
            </span>
          </li>
        ))}
      </ul>
    </details>
  )
}
