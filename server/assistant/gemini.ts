import { GoogleGenAI, ThinkingLevel, type Content } from '@google/genai'
import { SYSTEM, studyContext, type ChatTurn, type Chunk, type Effort } from './shared.ts'

/** Current stable general-purpose model. */
export const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash'
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

  const res = await getClient().models.generateContentStream({
    model: MODEL,
    contents,
    config: {
      systemInstruction: SYSTEM,
      thinkingConfig: { includeThoughts: true, thinkingLevel: LEVEL[effort] },
      maxOutputTokens: 16000,
    },
  })

  let usage: any = null
  for await (const chunk of res) {
    if (chunk.usageMetadata) usage = chunk.usageMetadata
    for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
      if (!part.text) continue
      // Gemini flags reasoning parts with `thought: true` rather than using a
      // separate block type, so the same stream carries both.
      yield { type: part.thought ? 'thinking' : 'text', value: part.text }
    }
  }

  yield {
    type: 'done',
    value: JSON.stringify({
      in: usage?.promptTokenCount ?? 0,
      out: usage?.candidatesTokenCount ?? 0,
      thoughts: usage?.thoughtsTokenCount ?? 0,
      cacheRead: usage?.cachedContentTokenCount ?? 0,
      provider: 'gemini', model: MODEL,
    }),
  }
}
