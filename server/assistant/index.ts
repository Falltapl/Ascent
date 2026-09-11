import * as claude from './claude.ts'
import * as gemini from './gemini.ts'
import type { ChatTurn, Chunk, Effort } from './shared.ts'
export type { ChatTurn, Chunk, Effort }

export const PROVIDERS = { claude, gemini } as const
export type ProviderId = keyof typeof PROVIDERS

export const providerStatus = () =>
  (Object.keys(PROVIDERS) as ProviderId[]).map((id) => ({
    id,
    model: PROVIDERS[id].MODEL,
    configured: PROVIDERS[id].configured(),
  }))

/** First configured provider, preferring an explicit ASSISTANT_PROVIDER. */
export function defaultProvider(): ProviderId | null {
  const pref = process.env.ASSISTANT_PROVIDER as ProviderId | undefined
  if (pref && PROVIDERS[pref]?.configured()) return pref
  return (Object.keys(PROVIDERS) as ProviderId[]).find((id) => PROVIDERS[id].configured()) ?? null
}

/**
 * Provider SDKs surface failures very differently — Google nests a JSON string
 * inside a JSON error, Anthropic throws typed classes. Flatten both to one
 * readable sentence so the UI never shows a wall of escaped braces.
 */
export function readableError(e: any): string {
  const raw = e?.message ?? String(e)
  // Unwrap arbitrarily nested JSON error envelopes.
  let msg = raw
  for (let i = 0; i < 4; i++) {
    try {
      const parsed = JSON.parse(msg)
      const inner = parsed?.error?.message ?? parsed?.message
      if (typeof inner !== 'string') break
      msg = inner
    } catch { break }
  }
  if (/API key not valid|API_KEY_INVALID/i.test(msg)) {
    return 'That API key was rejected. Re-add it with: npm run token GEMINI_API_KEY'
  }
  if (/authentication_error|invalid x-api-key/i.test(msg)) {
    return 'That API key was rejected. Re-add it with: npm run token ANTHROPIC_API_KEY'
  }
  if (/rate.?limit|RESOURCE_EXHAUSTED|quota/i.test(msg)) {
    return 'Rate limited or out of quota. Wait a moment, or switch provider in the header.'
  }
  return msg.split('\n')[0].slice(0, 300)
}

export function streamChat(
  provider: ProviderId | null, history: ChatTurn[], includeContext: boolean, effort: Effort,
): AsyncGenerator<Chunk> {
  const id = provider && PROVIDERS[provider]?.configured() ? provider : defaultProvider()
  if (!id) {
    throw new Error(
      'No assistant provider configured. Add a key with: npm run token ANTHROPIC_API_KEY  (or GEMINI_API_KEY)',
    )
  }
  return PROVIDERS[id].stream(history, includeContext, effort)
}
