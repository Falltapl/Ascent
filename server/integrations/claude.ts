import Anthropic from '@anthropic-ai/sdk'
import { db } from '../db.ts'
import { CERTS, readiness } from '../certs.ts'

export const claudeConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY)

let client: Anthropic | null = null
const getClient = () => (client ??= new Anthropic())

export const CHAT_MODEL = 'claude-opus-5'

/**
 * Frozen system prompt. Kept byte-stable and cached — anything that varies
 * per request (dates, the user's current progress) would invalidate the cache
 * prefix on every turn, so that lives in a mid-conversation system message
 * instead. See shared/prompt-caching.md: render order is tools → system →
 * messages, and a prefix match is all-or-nothing.
 */
const SYSTEM = `You are the study assistant built into Ascent, a personal dashboard that tracks goals, AWS certification progress, and university coursework.

Your primary job is answering general knowledge questions well — clearly, accurately, and without padding. Treat this like a capable general assistant that happens to live inside a study app.

Guidelines:
- Answer the question that was asked. Don't restate it back or open with filler.
- Be concise by default. Expand when the topic genuinely needs it, not to seem thorough.
- For technical questions, include a small concrete example when it aids understanding.
- If you are uncertain, say so plainly rather than hedging through a whole paragraph.
- You may be given a snapshot of the user's current study state. Use it only when it is relevant to what they asked — do not steer every conversation back to their certifications.
- Format with Markdown. Use fenced code blocks with a language tag for code.`

/** Compact snapshot of current progress, refreshed per request. */
function studyContext(): string {
  const certLines = CERTS.map((c) => {
    const rows = db.prepare(`SELECT domain_id, confidence FROM cert_confidence WHERE cert_code=?`).all(c.code) as any[]
    const conf: Record<string, number> = {}
    for (const r of rows) conf[r.domain_id] = r.confidence
    const exam = db.prepare(`SELECT * FROM cert_exams WHERE cert_code=?`).get(c.code) as any
    const status = exam?.passed_at
      ? `passed ${String(exam.passed_at).slice(0, 10)}`
      : `${readiness(c, conf)}% ready${exam?.scheduled_for ? `, exam booked ${String(exam.scheduled_for).slice(0, 10)}` : ', no exam booked'}`
    return `- ${c.name} (${c.code}): ${status}`
  }).join('\n')

  const due = db.prepare(`
    SELECT title, course_name, due_at FROM assignments
    WHERE submitted=0 AND done_manual=0 AND due_at BETWEEN datetime('now','-3 days') AND datetime('now','+10 days')
    ORDER BY due_at LIMIT 8
  `).all() as any[]

  const goals = db.prepare(`SELECT title FROM goals WHERE status='active' LIMIT 6`).all() as any[]
  const streak = db.prepare(`SELECT COUNT(DISTINCT day) c FROM study_sessions WHERE day >= date('now','-7 days')`).get() as any

  return [
    `Current date: ${new Date().toISOString().slice(0, 10)}`,
    ``,
    `AWS certifications in progress:`,
    certLines,
    ``,
    due.length ? `Assignments due soon:\n${due.map((d) => `- ${d.title} (${d.course_name}) — due ${String(d.due_at).slice(0, 10)}`).join('\n')}` : `No assignments due in the next 10 days.`,
    ``,
    goals.length ? `Active goals:\n${goals.map((g) => `- ${g.title}`).join('\n')}` : `No active goals set.`,
    ``,
    `Study days logged in the last week: ${streak.c}`,
  ].join('\n')
}

export type ChatTurn = { role: 'user' | 'assistant'; content: string }

/**
 * Streams a reply. Yields tagged chunks so the client can render Claude's
 * reasoning separately from the answer.
 *
 * Effort is "medium" rather than the default "high": this is a chat route,
 * where the measured tradeoff generally does not repay top-of-range effort,
 * and latency matters more than on a long agentic task. Raise it per request
 * if a question deserves it.
 */
export async function* streamChat(
  history: ChatTurn[],
  includeContext: boolean,
  effort: 'low' | 'medium' | 'high' | 'xhigh' = 'medium',
): AsyncGenerator<{ type: 'thinking' | 'text' | 'done'; value: string }> {
  if (!claudeConfigured()) throw new Error('ANTHROPIC_API_KEY is not set — add it with: npm run token ANTHROPIC_API_KEY')

  const messages: Anthropic.MessageParam[] = history.map((m) => ({ role: m.role, content: m.content }))

  // A mid-conversation system message carries operator authority without
  // touching the cached prefix. It must follow a user turn and be last.
  if (includeContext && messages.at(-1)?.role === 'user') {
    messages.push({ role: 'system', content: studyContext() } as Anthropic.MessageParam)
  }

  const stream = getClient().messages.stream({
    model: CHAT_MODEL,
    max_tokens: 16000,
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    thinking: { type: 'adaptive', display: 'summarized' },
    output_config: { effort },
    messages,
  })

  for await (const event of stream) {
    if (event.type === 'content_block_delta') {
      if (event.delta.type === 'thinking_delta') yield { type: 'thinking', value: event.delta.thinking }
      else if (event.delta.type === 'text_delta') yield { type: 'text', value: event.delta.text }
    }
  }

  const final = await stream.finalMessage()
  if (final.stop_reason === 'refusal') {
    yield { type: 'text', value: '\n\n_(This request was declined.)_' }
  }
  const u = final.usage
  yield {
    type: 'done',
    value: JSON.stringify({
      in: u.input_tokens, out: u.output_tokens,
      cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0,
    }),
  }
}
