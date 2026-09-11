import Anthropic from '@anthropic-ai/sdk'
import { SYSTEM, studyContext, type ChatTurn, type Chunk, type Effort } from './shared.ts'

export const MODEL = 'claude-opus-5'
export const configured = () => Boolean(process.env.ANTHROPIC_API_KEY)

let client: Anthropic | null = null
const getClient = () => (client ??= new Anthropic())

export async function* stream(
  history: ChatTurn[], includeContext: boolean, effort: Effort,
): AsyncGenerator<Chunk> {
  const messages: Anthropic.MessageParam[] = history.map((m) => ({ role: m.role, content: m.content }))

  // A mid-conversation system message sits after the cached prefix, so live
  // progress never invalidates the cache. Must follow a user turn and be last.
  if (includeContext && messages.at(-1)?.role === 'user') {
    messages.push({ role: 'system', content: studyContext() } as Anthropic.MessageParam)
  }

  const s = getClient().messages.stream({
    model: MODEL,
    max_tokens: 16000,
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    thinking: { type: 'adaptive', display: 'summarized' },
    output_config: { effort },
    messages,
  })

  for await (const event of s) {
    if (event.type === 'content_block_delta') {
      if (event.delta.type === 'thinking_delta') yield { type: 'thinking', value: event.delta.thinking }
      else if (event.delta.type === 'text_delta') yield { type: 'text', value: event.delta.text }
    }
  }

  const final = await s.finalMessage()
  if (final.stop_reason === 'refusal') yield { type: 'text', value: '\n\n_(This request was declined.)_' }

  const u = final.usage
  yield {
    type: 'done',
    value: JSON.stringify({
      in: u.input_tokens, out: u.output_tokens,
      cacheRead: u.cache_read_input_tokens ?? 0,
      provider: 'claude', model: MODEL,
    }),
  }
}
