import type { ReactNode } from 'react'

/**
 * Small Markdown renderer for assistant output.
 *
 * Everything is built as React elements from escaped text — model output is
 * never handed to dangerouslySetInnerHTML, so a code sample that happens to
 * contain markup can't execute.
 */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  // `code`, **bold**, *italic*, [label](url)
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)|(\[[^\]]+\]\((https?:\/\/[^\s)]+)\))/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0

  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const tok = m[0]
    const k = `${keyBase}-${i++}`
    if (tok.startsWith('`')) {
      out.push(<code key={k} className="rounded bg-[var(--ink)]/10 px-1 py-0.5 font-[var(--font-mono)] text-[0.9em]">{tok.slice(1, -1)}</code>)
    } else if (tok.startsWith('**')) {
      out.push(<strong key={k} className="font-semibold text-[var(--ink)]">{tok.slice(2, -2)}</strong>)
    } else if (tok.startsWith('[')) {
      const label = tok.slice(1, tok.indexOf(']'))
      out.push(<a key={k} href={m[5]} target="_blank" rel="noreferrer" className="text-[var(--accent-2)] underline underline-offset-2">{label}</a>)
    } else {
      out.push(<em key={k}>{tok.slice(1, -1)}</em>)
    }
    last = m.index + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  const lines = text.split('\n')
  let i = 0
  let key = 0

  while (i < lines.length) {
    const line = lines[i]

    // Fenced code block
    if (line.trimStart().startsWith('```')) {
      const lang = line.trim().slice(3).trim()
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) body.push(lines[i++])
      i++ // closing fence (may be absent while still streaming)
      blocks.push(
        <div key={key++} className="my-2 overflow-hidden rounded-xl border border-[var(--line)]">
          {lang && <div className="border-b border-[var(--line)] bg-[var(--ground)]/55 px-3 py-1 font-[var(--font-mono)] text-[10px] uppercase tracking-wider text-[var(--muted)]">{lang}</div>}
          <pre className="overflow-x-auto bg-[var(--ground)]/70 p-3"><code className="font-[var(--font-mono)] text-[12.5px] leading-relaxed text-[var(--ink-3)]">{body.join('\n')}</code></pre>
        </div>,
      )
      continue
    }

    // Heading
    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) {
      blocks.push(<div key={key++} className="mt-3 mb-1 font-[var(--font-display)] font-bold text-[var(--ink)]">{inline(h[2], `h${key}`)}</div>)
      i++
      continue
    }

    // List run (bulleted or numbered)
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const items: string[] = []
      const ordered = /^\s*\d+\./.test(line)
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, ''))
        i++
      }
      const L = ordered ? 'ol' : 'ul'
      blocks.push(
        <L key={key++} className={`my-1.5 space-y-1 pl-5 ${ordered ? 'list-decimal' : 'list-disc'} marker:text-[var(--muted)]`}>
          {items.map((it, n) => <li key={n}>{inline(it, `li${key}-${n}`)}</li>)}
        </L>,
      )
      continue
    }

    if (line.trim() === '') { i++; continue }

    // Paragraph: gather until a blank line or a block-level construct
    const para: string[] = []
    while (i < lines.length && lines[i].trim() !== ''
           && !lines[i].trimStart().startsWith('```')
           && !/^\s*([-*+]|\d+\.)\s+/.test(lines[i])
           && !/^#{1,4}\s/.test(lines[i])) {
      para.push(lines[i++])
    }
    blocks.push(<p key={key++} className="my-1.5 leading-relaxed">{inline(para.join(' '), `p${key}`)}</p>)
  }

  return <div className="text-[14px] text-[var(--ink-2)]">{blocks}</div>
}
