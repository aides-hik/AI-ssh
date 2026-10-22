import test from 'node:test'
import assert from 'node:assert/strict'
import { chatCompletion, type StreamChunk } from './ai-api.service'
import type { AIProvider, AIModel } from '../types/ai-providers'

const text = '跨帧中文✅'
const model: AIModel = {
  id: 'fixture', name: 'fixture', providerId: 'fixture', contextWindow: 8192,
  capabilities: { text: true, image: false, functionCall: false, vision: false }
}
const streams: Record<string, string> = {
  openai: `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\r\n\r\ndata: [DONE]`,
  anthropic: `data: ${JSON.stringify({ type: 'content_block_delta', delta: { text } })}\r\n\r\ndata: {"type":"message_stop"}`,
  google: JSON.stringify([{ candidates: [{ content: { parts: [{ text }] } }] }]),
  ollama: `${JSON.stringify({ message: { content: text }, done: false })}\r\n${JSON.stringify({ done: true })}`
}

for (const [providerId, data] of Object.entries(streams)) {
  test(`${providerId} preserves JSON records and UTF-8 across byte-sized chunks and a final unterminated line`, async context => {
    const bytes = new TextEncoder().encode(data)
    let offset = 0
    context.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
      pull(controller) {
        if (offset === bytes.length) controller.close()
        else controller.enqueue(bytes.subarray(offset, ++offset))
      }
    })))
    const chunks: StreamChunk[] = []
    const response = await chatCompletion(
      { id: providerId, endpoint: 'http://localhost/fixture', apiKey: 'local-fixture' } as AIProvider,
      model,
      { messages: [{ role: 'user', content: 'test' }], stream: true },
      chunk => chunks.push(chunk)
    )
    assert.equal(response.content, text)
    assert.equal(chunks.filter(chunk => !chunk.done).map(chunk => chunk.content).join(''), text)
    assert.equal(chunks.filter(chunk => chunk.done).length, 1)
  })
}

test('every native provider forwards request cancellation to fetch', async context => {
  const controller = new AbortController()
  const observedSignals: Array<AbortSignal | null | undefined> = []
  context.mock.method(globalThis, 'fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
    observedSignals.push(init?.signal)
    init?.signal?.throwIfAborted()
    throw new Error('Missing cancellation signal')
  })
  controller.abort()
  for (const id of Object.keys(streams)) {
    await assert.rejects(chatCompletion(
      { id, endpoint: 'http://localhost/fixture', apiKey: 'local-fixture' } as AIProvider,
      model,
      { messages: [], signal: controller.signal }
    ), { name: 'AbortError' })
  }
  assert.deepEqual(observedSignals, Object.keys(streams).map(() => controller.signal))
})

test('OpenAI cancels an HTTP body left open after its DONE event', { timeout: 1000 }, async context => {
  let cancelled = false
  context.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(
        `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`
      ))
    },
    cancel() { cancelled = true }
  })))
  const response = await chatCompletion(
    { id: 'openai', endpoint: 'http://localhost/fixture', apiKey: 'local-fixture' } as AIProvider,
    model,
    { messages: [], stream: true },
    () => {}
  )
  assert.equal(response.content, text)
  assert.equal(cancelled, true)
})
