import { GoogleGenAI, ThinkingLevel, type Content, type GenerateContentResponse } from '@google/genai'
import { SYSTEM, studyContext, type ChatTurn, type Chunk, type Effort } from './shared.ts'

/** Current stable general-purpose model. */
export const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash'

/**
 * Tried in order when the primary is out of capacity. Google's 503 "high
 * demand" is per model and intermittent — measured at 1 success in 8 on
 * gemini-3.8-flash while older models were still answering — so a short
 * fallback chain turns an outage into a slightly different model. Override
 * with GEMINI_FALLBACK_MODELS=a,b.
 *
 * Every default here was confirmed live against a new AI Studio key.
 * gemini-2.5-flash is deliberately absent: it still appears in the models
 * list but returns 404 "no longer available to new users".
 */
export const FALLBACKS = (process.env.GEMINI_FALLBACK_MODELS ?? 'gemini-3.5-flash,gemini-3.5-flash-lite')
  .split(',').map((s) => s.trim()).filter((m) => m && m !== MODEL)

export const configured = () => Boolean(process.env.GEMINI_API_KEY)

let client: GoogleGenAI | null = null
const getClient = () => (client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! }))

/** Our shared effort scale onto Gemini's thinking levels. */
const LEVEL: Record<Effort, ThinkingLevel> = {
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
  xhigh: ThinkingLevel.HIGH, // Gemini's scale tops out at HIGH
}

/** Gemini 3 takes a thinking level; Gemini 2.x takes a token budget (-1 = model decides). */
export function thinkingFor(model: string, effort: Effort) {
  return /^gemini-2\./.test(model)
    ? { includeThoughts: true, thinkingBudget: -1 }
    : { includeThoughts: true, thinkingLevel: LEVEL[effort] }
}

/** The model isn't usable for this key — retired, renamed, or never granted. */
export function isModelUnavailable(e: unknown): boolean {
  const err = e as { status?: number; code?: number; message?: string }
  const status = err?.status ?? err?.code
  return status === 404 || /NOT_FOUND|no longer available|"code":\s*404/i.test(String(err?.message ?? e))
}

/**
 * Worth another attempt: capacity (503), transient server errors, timeouts,
 * dropped connections. Deliberately NOT 429 — retrying a rate limit spends
 * more of the same quota and makes it worse — and not 4xx config errors.
 */
export function isRetriable(e: unknown): boolean {
  const err = e as { status?: number; code?: number; message?: string }
  const status = err?.status ?? err?.code
  const msg = String(err?.message ?? e)
  if (status === 429 || /RESOURCE_EXHAUSTED|quota|"code":\s*429/i.test(msg)) return false
  if (status === 500 || status === 502 || status === 503 || status === 504) return true
  return /UNAVAILABLE|high demand|overloaded|"code":\s*50[0-4]|DEADLINE_EXCEEDED|ETIMEDOUT|ECONNRESET|fetch failed|timed? ?out/i.test(msg)
}

type Opened<T> = { model: string; first: IteratorResult<T>; rest: AsyncIterator<T>; failed: string[] }

/**
 * Opens a stream on the first model that answers. The boundary is the first
 * chunk: a failure before any text arrives is retried or falls back, but once
 * text has streamed, errors propagate — retrying then would duplicate a
 * partial answer on screen. Primary gets `primaryAttempts`, each fallback one,
 * so a single question costs at most primaryAttempts + fallbacks requests.
 */
export async function openWithFallback<T>(
  models: string[],
  open: (model: string) => Promise<AsyncIterable<T>>,
  {
    primaryAttempts = 2,
    backoffMs = 1500,
    sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
  }: { primaryAttempts?: number; backoffMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<Opened<T>> {
  const primary = models[0]
  const plan = models.flatMap((m, i) => Array.from({ length: i === 0 ? primaryAttempts : 1 }, () => m))
  const failed: string[] = []
  let lastErr: unknown = new Error('no Gemini models to try')
  // When everything fails, report the capacity problem rather than whichever
  // unusable fallback happened to be tried last.
  let lastCapacityErr: unknown = null

  for (let i = 0; i < plan.length; i++) {
    const model = plan[i]
    try {
      const it = (await open(model))[Symbol.asyncIterator]()
      const first = await it.next()
      return { model, first, rest: it, failed }
    } catch (e) {
      lastErr = e
      failed.push(model)
      // A retired *fallback* is skipped; a retired *primary* is the user's
      // configuration and must surface, not be silently papered over.
      if (isModelUnavailable(e) && model !== primary) continue
      if (!isRetriable(e)) throw e
      lastCapacityErr = e
      if (i < plan.length - 1) await sleep(backoffMs * (plan[i + 1] === model ? 1 : 2))
    }
  }
  throw lastCapacityErr ?? lastErr
}

export async function* stream(
  history: ChatTurn[], includeContext: boolean, effort: Effort,
): AsyncGenerator<Chunk> {
  // Gemini names the model turn "model", not "assistant".
  const contents: Content[] = history.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))

  // There is no mid-conversation system role here, so the volatile snapshot is
  // appended to the final user turn instead — keeping systemInstruction itself
  // byte-stable so implicit caching can still hit on the prefix.
  if (includeContext && contents.at(-1)?.role === 'user') {
    contents.at(-1)!.parts!.push({ text: `\n\n<current_progress>\n${studyContext()}\n</current_progress>` })
  }

  const { model, first, rest, failed } = await openWithFallback([MODEL, ...FALLBACKS], (m) =>
    getClient().models.generateContentStream({
      model: m,
      contents,
      config: { systemInstruction: SYSTEM, thinkingConfig: thinkingFor(m, effort), maxOutputTokens: 16000 },
    }),
  )

  let usage: any = null
  // Gemini flags reasoning parts with `thought: true` rather than using a
  // separate block type, so the same stream carries both.
  function* partsOf(chunk: GenerateContentResponse): Generator<Chunk> {
    if (chunk.usageMetadata) usage = chunk.usageMetadata
    for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
      if (part.text) yield { type: part.thought ? 'thinking' : 'text', value: part.text }
    }
  }

  if (!first.done) yield* partsOf(first.value)
  for (let r = await rest.next(); !r.done; r = await rest.next()) yield* partsOf(r.value)

  yield {
    type: 'done',
    value: JSON.stringify({
      in: usage?.promptTokenCount ?? 0,
      out: usage?.candidatesTokenCount ?? 0,
      thoughts: usage?.thoughtsTokenCount ?? 0,
      cacheRead: usage?.cachedContentTokenCount ?? 0,
      provider: 'gemini',
      model,
      ...(failed.length ? { fellBackFrom: [...new Set(failed)] } : {}),
    }),
  }
}
