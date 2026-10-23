import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLLMSession } from './llm'
import type { AIModel, AIProvider } from '../types/ai-providers'
import type { ReasoningSelection } from '../utils/model-reasoning'

const currentDir = dirname(fileURLToPath(import.meta.url))
const llmPath = join(currentDir, 'llm.ts')

test('llm session aborts fetch and a blocked stream reader with one signal', async () => {
  const source = await readFile(llmPath, 'utf8')

  assert.doesNotMatch(source, /const controller = new AbortController\(\)/)
  assert.match(source, /signal\?\.addEventListener\('abort', cancelReader, \{ once: true \}\)/)
  assert.match(source, /reader\.cancel\(createAbortError\(\)\)/)
  assert.match(source, /if \(signal\?\.aborted\) throw createAbortError\(\)/)
})

const provider = (id = 'openai'): AIProvider => ({
  id, name: id, description: '', icon: '', website: '', endpoint: 'https://fixture.invalid/v1',
  apiKey: 'fixture-only', enabled: true, isDefault: false, models: []
})
const model = (id: string): AIModel => ({
  id, name: id, providerId: 'openai', contextWindow: 8192,
  capabilities: { text: true, image: false, functionCall: true, vision: false }
})

function streamResponse(events: unknown[]): Response {
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\r\n\r\n`).join(''))
}

for (const fixture of [
  { model: 'gpt-5', selection: 'high', effort: 'high', temperature: undefined },
  { model: 'gpt-5', selection: 'default', effort: undefined, temperature: undefined },
  { model: 'o3', selection: 'xhigh', effort: undefined, temperature: undefined },
  { model: 'gpt-4.1', selection: 'high', effort: undefined, temperature: 0.3 }
] satisfies Array<{ model: string; selection: ReasoningSelection; effort: string | undefined; temperature: number | undefined }>) {
  test(`terminal HTTP body validates ${fixture.model} ${fixture.selection} and sampling support`, async context => {
    let endpoint: unknown
    let request: Record<string, unknown> = {}
    context.mock.method(globalThis, 'fetch', async (input: unknown, init: RequestInit) => {
      endpoint = input
      request = JSON.parse(String(init.body))
      return streamResponse([{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }])
    })
    const session = createLLMSession(provider(), model(fixture.model), [], '', undefined, undefined, undefined, fixture.selection)
    const chunks = await Array.fromAsync(session.stream([{ role: 'user', content: 'hello' }]))
    assert.equal(endpoint, 'https://fixture.invalid/v1/chat/completions')
    assert.equal(request.reasoning_effort, fixture.effort)
    assert.equal(request.temperature, fixture.temperature)
    assert.equal(request.reasoning, undefined)
    assert.equal(request.tool_choice, undefined)
    assert.equal(chunks[0].content, 'ok')
  })
}

test('Responses-only models use /responses even with the provider default effort', async context => {
  let endpoint: unknown
  let request: Record<string, unknown> = {}
  context.mock.method(globalThis, 'fetch', async (input: unknown, init: RequestInit) => {
    endpoint = input
    request = JSON.parse(String(init.body))
    return streamResponse([{ type: 'response.completed', response: { output: [
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'answer', annotations: [] }] }
    ] } }])
  })
  const session = createLLMSession(provider(), model('gpt-6-astra'), [], '')
  const chunks = await Array.fromAsync(session.stream([{ role: 'user', content: 'hello' }]))
  assert.equal(endpoint, 'https://fixture.invalid/v1/responses')
  assert.equal(request.messages, undefined)
  assert.deepEqual(request.input, [{ role: 'user', content: 'hello' }])
  assert.equal(request.reasoning, undefined)
  assert.equal(request.temperature, undefined)
  assert.equal(request.store, false)
  assert.deepEqual(request.include, ['reasoning.encrypted_content'])
  assert.equal(chunks.find(chunk => chunk.type === 'text')?.content, 'answer')
})

for (const id of ['gpt-5', 'gpt-6-astra']) {
  test(`${id} cancels an in-flight HTTP body when the shared signal is aborted`, { timeout: 2000 }, async context => {
    let cancelled = false
    let observedSignal: AbortSignal | null | undefined
    let streamReady!: () => void
    const ready = new Promise<void>(resolve => { streamReady = resolve })
    context.mock.method(globalThis, 'fetch', async (_input: unknown, init: RequestInit) => {
      observedSignal = init.signal
      return new Response(new ReadableStream({
        pull() { streamReady() },
        cancel() { cancelled = true }
      }))
    })
    const controller = new AbortController()
    const session = createLLMSession(provider(), model(id), [], '', undefined, undefined, controller.signal, 'high')
    const result = Array.fromAsync(session.stream([]))
    await ready
    controller.abort()
    await assert.rejects(result, { name: 'AbortError' })
    assert.equal(observedSignal, controller.signal)
    assert.equal(cancelled, true)
  })
}

for (const event of [
  { type: 'error', message: 'invalid reasoning effort' },
  { type: 'response.failed', response: { error: { message: 'upstream failed' } } },
  { type: 'response.incomplete', response: { incomplete_details: { reason: 'max_output_tokens' } } }
]) {
  test(`Responses ${event.type} is a request failure instead of a successful empty answer`, async context => {
    context.mock.method(globalThis, 'fetch', async () => streamResponse([event]))
    const session = createLLMSession(provider(), model('gpt-6-astra'), [], '')
    await assert.rejects(Array.fromAsync(session.stream([])), /invalid reasoning effort|upstream failed|max_output_tokens/)
  })
}

test('truncated Responses streams and malformed tool arguments never execute as empty tools', async context => {
  const responses = [
    streamResponse([{ type: 'response.output_text.delta', delta: 'unfinished' }]),
    streamResponse([{ type: 'response.completed', response: { output: [
      { type: 'function_call', call_id: 'call_fixture', name: 'read_file', arguments: '{invalid' }
    ] } }])
  ]
  context.mock.method(globalThis, 'fetch', async () => {
    const response = responses.shift()
    assert.ok(response)
    return response
  })
  const session = createLLMSession(provider(), model('gpt-6-astra'), [], '')
  await assert.rejects(Array.fromAsync(session.stream([])), /before completing/)
  await assert.rejects(Array.fromAsync(session.stream([])), /invalid tool arguments/)
})

test('Chat Completions preserves UTF-8 and final SSE records split at every byte', async context => {
  const events = [
    { choices: [{ delta: { content: '中文✅' } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_fixture', function: { name: 'read_file', arguments: '{"path":' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"中文"}' } }] }, finish_reason: 'tool_calls' }] }
  ]
  const bytes = new TextEncoder().encode(events.map(event => `data: ${JSON.stringify(event)}`).join('\r\n\r\n'))
  let offset = 0
  context.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    pull(controller) {
      if (offset === bytes.length) controller.close()
      else controller.enqueue(bytes.subarray(offset, ++offset))
    }
  })))
  const chunks = await Array.fromAsync(createLLMSession(provider(), model('gpt-5'), [], '').stream([]))
  assert.equal(chunks.find(chunk => chunk.type === 'text')?.content, '中文✅')
  assert.deepEqual(chunks.find(chunk => chunk.type === 'tool-call')?.toolInput, { path: '中文' })
})

test('Responses preserves UTF-8 deltas split at every byte and renders refusal text', async context => {
  const events = [
    { type: 'response.refusal.delta', delta: '无法处理✅' },
    { type: 'response.completed', response: { status: 'completed', output: [
      { type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: '无法处理✅' }] }
    ] } }
  ]
  const bytes = new TextEncoder().encode(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}`).join('\n\n'))
  let offset = 0
  context.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    pull(controller) {
      if (offset === bytes.length) controller.close()
      else controller.enqueue(bytes.subarray(offset, ++offset))
    }
  })))
  const chunks = await Array.fromAsync(createLLMSession(provider(), model('gpt-6-astra'), [], '').stream([]))
  assert.deepEqual(chunks.filter(chunk => chunk.type === 'text').map(chunk => chunk.content), ['无法处理✅'])
})

for (const fixture of [
  { base: 'https://generativelanguage.googleapis.com/v1beta', model: 'models/gemini-2.5-pro', endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', sentModel: 'gemini-2.5-pro' },
  { base: 'https://generativelanguage.googleapis.com/v1/', model: 'models/gemini-2.5-pro', endpoint: 'https://generativelanguage.googleapis.com/v1/openai/chat/completions', sentModel: 'gemini-2.5-pro' },
  { base: 'https://generativelanguage.googleapis.com/v1beta/openai/', model: 'gemini-2.5-pro', endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', sentModel: 'gemini-2.5-pro' },
  { base: 'https://fixture.invalid/v1beta', model: 'models/gemini-2.5-pro', endpoint: 'https://fixture.invalid/v1beta/chat/completions', sentModel: 'models/gemini-2.5-pro' }
]) {
  test(`Gemini terminal requests preserve endpoint boundaries: ${fixture.base}`, async context => {
    let observedEndpoint: unknown
    let observedRequest: Record<string, unknown> = {}
    context.mock.method(globalThis, 'fetch', async (url: unknown, init: RequestInit) => {
      observedEndpoint = url
      observedRequest = JSON.parse(String(init.body))
      return streamResponse([{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }])
    })
    await Array.fromAsync(createLLMSession(
      { ...provider('google'), endpoint: fixture.base }, model(fixture.model), [], '',
      undefined, undefined, undefined, 'high'
    ).stream([{ role: 'user', content: 'hello' }]))
    assert.equal(observedEndpoint, fixture.endpoint)
    assert.equal(observedRequest.model, fixture.sentModel)
    assert.equal(observedRequest.reasoning_effort, 'high')
    assert.equal(observedRequest.temperature, undefined)
  })
}
