import test from 'node:test'
import assert from 'node:assert/strict'
import { chatCompletion, type StreamChunk } from './ai-api.service'
import type { AIProvider, AIModel } from '../types/ai-providers'
import { testProviderConnection } from './ai-test.service'

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

test('Responses-only models route ordinary chat and connection probes through Responses without rejected parameters', async context => {
  const requests: Array<{ url: string; body: Record<string, any> }> = []
  context.mock.method(globalThis, 'fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(url), body: JSON.parse(String(init?.body)) })
    return Response.json({ model: 'gpt-6-astra', status: 'completed', output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text: 'OK' }] }], usage: { input_tokens: 1, output_tokens: 2 } })
  })
  const current = { ...model, id: 'gpt-6-astra', requestConfig: { reasoning: 'high' as const } }
  const provider = { id: 'openai', endpoint: 'https://fixture.invalid/v1/', apiKey: 'fixture-key', models: [current] } as AIProvider
  const response = await chatCompletion(provider, current, { messages: [{ role: 'user', content: 'Hi' }], temperature: 0.3, topP: 0.8, maxTokens: 8192 })
  assert.equal(response.content, 'OK')
  assert.equal(requests[0].url, 'https://fixture.invalid/v1/responses')
  assert.equal(requests[0].body.max_output_tokens, 8192)
  assert.deepEqual(requests[0].body.reasoning, { effort: 'high' })
  assert(!('temperature' in requests[0].body))
  assert(!('top_p' in requests[0].body))
  assert.equal((await testProviderConnection(provider, current.id)).success, true)
  assert.equal(requests[1].url, requests[0].url)
  assert.equal(requests[1].body.max_output_tokens, 64)
})

test('Responses streaming keeps Unicode and reports a completed frame once', async context => {
  const events = [
    { type: 'response.output_text.delta', delta: text },
    { type: 'response.completed', response: { model: 'gpt-6-astra', status: 'completed', usage: { input_tokens: 4, output_tokens: 6, total_tokens: 10 } } }
  ].map(event => `data: ${JSON.stringify(event)}\n\n`).join('')
  const bytes = new TextEncoder().encode(events)
  let offset = 0
  context.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({ pull(controller) { if (offset === bytes.length) controller.close(); else controller.enqueue(bytes.subarray(offset, ++offset)) } })))
  const chunks: StreamChunk[] = []
  const response = await chatCompletion({ id: 'openai', endpoint: 'https://fixture.invalid/v1', apiKey: '' } as AIProvider, { ...model, id: 'gpt-6-astra' }, { messages: [], stream: true }, chunk => chunks.push(chunk))
  assert.equal(response.content, text)
  assert.equal(response.usage?.totalTokens, 10)
  assert.equal(chunks.filter(chunk => chunk.done).length, 1)
})

test('Responses incomplete and failed events surface errors without falsely completing partial text', async context => {
  const chunks: StreamChunk[] = []
  context.mock.method(globalThis, 'fetch', async () => new Response([
    { type: 'response.output_text.delta', delta: 'partial' },
    { type: 'response.incomplete', response: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } } }
  ].map(event => `data: ${JSON.stringify(event)}\n\n`).join('')))
  const provider = { id: 'openai', endpoint: 'https://fixture.invalid/v1', apiKey: '' } as AIProvider
  const current = { ...model, id: 'gpt-6-astra' }
  await assert.rejects(chatCompletion(provider, current, { messages: [], stream: true }, chunk => chunks.push(chunk)), /max_output_tokens/)
  assert.deepEqual(chunks, [{ content: 'partial', done: false }])
  context.mock.method(globalThis, 'fetch', async () => Response.json({ status: 'failed', error: { message: 'fixture failure' } }))
  await assert.rejects(chatCompletion(provider, current, { messages: [] }), /fixture failure/)
  context.mock.method(globalThis, 'fetch', async () => Response.json({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }))
  await assert.rejects(chatCompletion(provider, current, { messages: [] }), /max_output_tokens/)
  assert.equal((await testProviderConnection({ ...provider, apiKey: 'fixture-key', models: [current] }, current.id)).success, true)
})

test('all transports reject tools on a model that does not declare tool support before making a request', async context => {
  let called = false
  context.mock.method(globalThis, 'fetch', async () => { called = true; return Response.json({}) })
  for (const id of ['openai', 'anthropic', 'google', 'ollama', 'openrouter', 'custom']) {
    await assert.rejects(chatCompletion({ id, endpoint: 'https://fixture.invalid', apiKey: '' } as AIProvider, model, { messages: [], tools: [{ type: 'function', function: { name: 'fixture' } }] }), /未声明支持工具/)
  }
  assert.equal(called, false)
})

test('native Claude handles leading thinking blocks and converts tools, omitting unsupported sampling', async context => {
  let body: Record<string, any> = {}
  context.mock.method(globalThis, 'fetch', async (_url: RequestInfo | URL, init?: RequestInit) => {
    body = JSON.parse(String(init?.body))
    return Response.json({ model: 'claude-opus-5-5', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'A' }, { type: 'text', text: 'B' }] })
  })
  const current = { ...model, id: 'claude-opus-5-5', capabilities: { ...model.capabilities, functionCall: true } }
  const response = await chatCompletion({ id: 'anthropic', endpoint: 'https://fixture.invalid/v1/', apiKey: '' } as AIProvider, current, {
    messages: [{ role: 'system', content: 'one' }, { role: 'system', content: 'two' }, { role: 'user', content: 'test' }],
    temperature: 0.2, topP: 0.7, reasoningSelection: 'max', tools: [{ type: 'function', function: { name: 'fixture', parameters: { type: 'object', properties: {} } } }]
  })
  assert.equal(response.content, 'AB')
  assert.equal(body.system, 'one\n\ntwo')
  assert.deepEqual(body.output_config, { effort: 'max' })
  assert.deepEqual(body.tools[0], { name: 'fixture', input_schema: { type: 'object', properties: {} } })
  assert(!('temperature' in body))
  assert(!('top_p' in body))
  assert.equal(body.max_tokens, 4096)
})

test('native Gemini uses API-key header and native thinking/output fields without duplicating v1beta', async context => {
  let captured: { url: string; init?: RequestInit } | undefined
  context.mock.method(globalThis, 'fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
    captured = { url: String(url), init }
    return Response.json({ candidates: [{ content: { parts: [{ thought: true, text: 'private' }, { text: 'OK' }] } }] })
  })
  const current = { ...model, id: 'gemini-3.8-flash' }
  const provider = { id: 'google', endpoint: 'https://generativelanguage.googleapis.com/v1beta/', apiKey: 'fixture-key', models: [current] } as AIProvider
  const response = await chatCompletion(provider, current, { messages: [{ role: 'user', content: 'Hi' }], reasoningSelection: 'low', maxTokens: 900, temperature: 0.5 })
  assert.equal(response.content, 'OK')
  assert.equal(captured?.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent')
  assert.equal((captured?.init?.headers as Record<string, string>)['x-goog-api-key'], 'fixture-key')
  assert.deepEqual(JSON.parse(String(captured?.init?.body)).generationConfig, { maxOutputTokens: 900, thinkingConfig: { thinkingLevel: 'low' } })
  assert.equal((await testProviderConnection(provider, current.id)).success, true)
  assert(!captured?.url.includes('fixture-key'))
})

test('MiniMax connection tests use the configured OpenAI-compatible path and model-specific tokens', async context => {
  let capturedURL = ''
  let capturedBody: Record<string, any> = {}
  context.mock.method(globalThis, 'fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
    capturedURL = String(url)
    capturedBody = JSON.parse(String(init?.body))
    return Response.json({ choices: [{ message: { content: 'OK' } }] })
  })
  const current = { ...model, id: 'MiniMax-M3.1-Flash', reasoning: { protocol: 'openai' as const, supportedEfforts: ['low' as const, 'high' as const], mandatory: true }, requestConfig: { reasoning: 'low' as const } }
  assert.equal((await testProviderConnection({ id: 'minimax', endpoint: 'https://api.minimax.cn/v1/', apiKey: 'fixture-key', models: [current] } as AIProvider, current.id)).success, true)
  assert.equal(capturedURL, 'https://api.minimax.cn/v1/chat/completions')
  assert.equal(capturedBody.max_tokens, 64)
  assert.equal(capturedBody.reasoning_effort, 'low')
})
