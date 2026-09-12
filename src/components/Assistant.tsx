import { useEffect, useRef, useState } from 'react'
import type { Config } from '../api'
import { Card, Button, inputCls } from './ui'
import { Markdown } from './markdown'

type Turn = { role: 'user' | 'assistant'; content: string; thinking?: string; usage?: string }

const STORE = 'ascent.chat.v1'
const load = (): Turn[] => {
  try { return JSON.parse(localStorage.getItem(STORE) ?? '[]') } catch { return [] }
}

const STARTERS = [
  'Explain the difference between an AWS security group and a NACL',
  'What actually happens during a TCP three-way handshake?',
  'Explain elasticity vs scalability with a concrete example',
  'How does an S3 lifecycle policy reduce storage cost?',
]

export function Assistant({ cfg }: { cfg: Config | null }) {
  const [turns, setTurns] = useState<Turn[]>(load)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [useContext, setUseContext] = useState(true)
  const [showThinking, setShowThinking] = useState(false)
  const [provider, setProvider] = useState<'claude' | 'gemini' | null>(null)
  const bottom = useRef<HTMLDivElement>(null)
  const abort = useRef<AbortController | null>(null)

  useEffect(() => { try { localStorage.setItem(STORE, JSON.stringify(turns.slice(-40))) } catch { /* quota */ } }, [turns])
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }) }, [turns, busy])

  const available = (cfg?.assistant.providers ?? []).filter((p) => p.configured)
  const active = provider ?? cfg?.assistant.active ?? null
  const ready = available.length > 0
  const activeModel = available.find((p) => p.id === active)?.model ?? ''

  async function send(text: string) {
    const q = text.trim()
    if (!q || busy) return

    const next: Turn[] = [...turns, { role: 'user', content: q }]
    setTurns([...next, { role: 'assistant', content: '', thinking: '' }])
    setInput('')
    setBusy(true)

    const ctrl = new AbortController()
    abort.current = ctrl

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next, includeContext: useContext, provider: active }),
        signal: ctrl.signal,
      })
      if (!res.ok || !res.body) throw new Error(`Request failed (${res.status})`)

      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''

      // SSE frames are delimited by a blank line; a chunk can split one.
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const frames = buf.split('\n\n')
        buf = frames.pop() ?? ''

        for (const frame of frames) {
          const line = frame.split('\n').find((l) => l.startsWith('data: '))
          if (!line) continue
          const { type, value: v } = JSON.parse(line.slice(6))
          setTurns((prev) => {
            const copy = [...prev]
            const last = { ...copy[copy.length - 1] }
            if (type === 'text') last.content += v
            else if (type === 'thinking') last.thinking = (last.thinking ?? '') + v
            else if (type === 'usage' || type === 'done') last.usage = v
            else if (type === 'error') last.content += `\n\n**Error:** ${v}`
            copy[copy.length - 1] = last
            return copy
          })
        }
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        setTurns((prev) => {
          const copy = [...prev]
          copy[copy.length - 1] = { ...copy[copy.length - 1], content: `**Error:** ${e.message}` }
          return copy
        })
      }
    } finally {
      setBusy(false)
      abort.current = null
    }
  }

  return (
    <Card className="flex h-[calc(100vh-230px)] min-h-[460px] flex-col overflow-hidden" hover={false}>
      {/* header */}
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--line)] px-5 py-3">
        <div className="flex-1">
          <h2 className="font-[var(--font-display)] text-base font-bold">Ask anything</h2>
          <p className="text-xs text-[var(--muted)]">
            {ready ? `${activeModel} · general knowledge, plus your study context when relevant` : 'Not connected'}
          </p>
        </div>
        {available.length > 1 && (
          <div className="flex overflow-hidden rounded-xl border border-[var(--line)]">
            {available.map((p) => (
              <button key={p.id} onClick={() => setProvider(p.id)} title={p.model}
                className={`px-2.5 py-1 text-xs capitalize transition ${
                  active === p.id ? 'bg-[var(--accent)]/25 text-[var(--ink)]' : 'text-[var(--muted)] hover:bg-[var(--ink)]/5'}`}>
                {p.id}
              </button>
            ))}
          </div>
        )}
        <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--muted)]">
          <input type="checkbox" checked={useContext} onChange={(e) => setUseContext(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--accent)]" />
          share my progress
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--muted)]">
          <input type="checkbox" checked={showThinking} onChange={(e) => setShowThinking(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--accent)]" />
          show reasoning
        </label>
        {turns.length > 0 && (
          <Button size="sm" onClick={() => { setTurns([]); localStorage.removeItem(STORE) }}>Clear</Button>
        )}
      </div>

      {/* transcript */}
      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {!ready && (
          <div className="rounded-xl border border-[var(--warn)]/30 bg-[var(--warn)]/8 p-4 text-sm text-[var(--warn)]">
            <p className="font-semibold">No API key set.</p>
            <p className="mt-1 text-[var(--ink-2)]">Add either one — whichever you have. Both work; if you set both you can switch between them here.</p>
            <div className="mt-2 space-y-2">
              <div>
                <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="text-[var(--accent-2)] underline underline-offset-2">aistudio.google.com/apikey</a>
                <span className="text-xs text-[var(--muted)]"> — Gemini, has a free tier</span>
                <pre className="mt-1 rounded bg-[var(--ground)]/70 px-3 py-2 font-[var(--font-mono)] text-xs text-[var(--ink-3)]">npm run token GEMINI_API_KEY</pre>
              </div>
              <div>
                <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" className="text-[var(--accent-2)] underline underline-offset-2">console.anthropic.com</a>
                <span className="text-xs text-[var(--muted)]"> — Claude, pay as you go</span>
                <pre className="mt-1 rounded bg-[var(--ground)]/70 px-3 py-2 font-[var(--font-mono)] text-xs text-[var(--ink-3)]">npm run token ANTHROPIC_API_KEY</pre>
              </div>
            </div>
            <p className="mt-2 text-xs text-[var(--muted)]">Input is hidden and written straight to .env. Restart the server afterwards.</p>
          </div>
        )}

        {ready && turns.length === 0 && (
          <div className="grid gap-2 sm:grid-cols-2">
            {STARTERS.map((s) => (
              <button key={s} onClick={() => send(s)}
                className="rounded-xl border border-[var(--line)] bg-[var(--ground)]/45 p-3 text-left text-sm text-[var(--muted)] transition hover:border-[var(--accent)]/50 hover:text-[var(--ink)]">
                {s}
              </button>
            ))}
          </div>
        )}

        {turns.map((t, i) =>
          t.role === 'user' ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-md bg-gradient-to-br from-[var(--accent)] to-[var(--accent-deep)] px-4 py-2.5 text-sm text-[var(--ground)]">
                {t.content}
              </div>
            </div>
          ) : (
            <div key={i} className="animate-rise">
              {showThinking && t.thinking && (
                <details className="mb-2 rounded-xl border border-[var(--line)] bg-[var(--ground)]/40 px-3 py-2" open>
                  <summary className="cursor-pointer text-xs text-[var(--muted)]">reasoning</summary>
                  <div className="mt-1.5 whitespace-pre-wrap text-xs text-[var(--muted)]">{t.thinking}</div>
                </details>
              )}
              {t.content ? <Markdown text={t.content} /> : (
                busy && i === turns.length - 1 && (
                  <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--line)] border-t-[var(--accent)]" />
                    thinking…
                  </div>
                )
              )}
              {t.usage && (() => {
                try {
                  const u = JSON.parse(t.usage)
                  return (
                    <div className="mt-1.5 font-[var(--font-mono)] text-[10px] text-[var(--faint)]">
                      {u.model} · {u.in} in · {u.out} out{u.thoughts ? ` · ${u.thoughts} thinking` : ''}{u.cacheRead ? ` · ${u.cacheRead} cached` : ''}
                    </div>
                  )
                } catch { return null }
              })()}
            </div>
          ),
        )}
        <div ref={bottom} />
      </div>

      {/* composer */}
      <form
        className="flex gap-2 border-t border-[var(--line)] px-5 py-3"
        onSubmit={(e) => { e.preventDefault(); send(input) }}>
        <textarea
          className={`${inputCls} max-h-32 min-h-[42px] flex-1 resize-none py-2.5`}
          rows={1}
          placeholder={ready ? 'Ask a question…  (Enter to send, Shift+Enter for a new line)' : 'Set ANTHROPIC_API_KEY to enable'}
          value={input}
          disabled={!ready}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) }
          }} />
        {busy ? (
          <Button variant="danger" onClick={() => abort.current?.abort()}>Stop</Button>
        ) : (
          <Button variant="primary" type="submit" disabled={!ready || !input.trim()}>Send</Button>
        )}
      </form>
    </Card>
  )
}
