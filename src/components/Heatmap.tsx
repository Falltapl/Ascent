import { useEffect, useRef } from 'react'

/** Contribution-style study heatmap: 26 weeks of daily minutes. */
export function Heatmap({ data }: { data: Record<string, number> }) {
  // The most recent weeks are the ones worth seeing, so open scrolled to the end.
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [data])

  const days: { key: string; mins: number; date: Date }[] = []
  const end = new Date()
  const start = new Date(end)
  start.setDate(start.getDate() - 181)
  start.setDate(start.getDate() - start.getDay()) // align to Sunday

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
    days.push({ key, mins: data[key] ?? 0, date: new Date(d) })
  }

  const weeks: typeof days[] = []
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7))

  // Fixed thresholds rather than relative-to-max: a quiet month shouldn't
  // make 15 minutes look like a heavy day.
  const shade = (m: number) =>
    m === 0 ? 'var(--raised)'
    : m < 30 ? 'color-mix(in oklab, var(--accent) 32%, var(--ground))'
    : m < 60 ? 'color-mix(in oklab, var(--accent) 58%, var(--ground))'
    : m < 120 ? 'var(--accent)'
    : 'color-mix(in oklab, var(--accent) 62%, white)'

  let lastMonth = -1
  return (
    <div ref={scroller} className="overflow-x-auto pb-1">
      <div className="flex gap-[3px] min-w-max">
        {weeks.map((w, i) => {
          const m = w[0].date.getMonth()
          const showLabel = m !== lastMonth && w[0].date.getDate() <= 7
          if (showLabel) lastMonth = m
          return (
            <div key={i} className="flex flex-col gap-[3px]">
              <div className="h-3 text-[9px] leading-3 text-[var(--muted)]">
                {showLabel ? w[0].date.toLocaleDateString(undefined, { month: 'short' }) : ''}
              </div>
              {w.map((d) => (
                <div
                  key={d.key}
                  title={`${d.key} — ${d.mins} min`}
                  className="h-[11px] w-[11px] rounded-[3px] transition-transform hover:scale-150 hover:ring-1 hover:ring-white/50"
                  style={{ background: shade(d.mins), boxShadow: d.mins >= 120 ? '0 0 6px color-mix(in oklab, var(--accent) 55%, transparent)' : undefined }}
                />
              ))}
            </div>
          )
        })}
      </div>
      <div className="mt-3 flex items-center gap-1.5 text-[10px] text-[var(--muted)]">
        <span>Less</span>
        {[0, 20, 45, 90, 150].map((m) => (
          <div key={m} className="h-[11px] w-[11px] rounded-[3px]" style={{ background: shade(m) }} />
        ))}
        <span>More</span>
      </div>
    </div>
  )
}
