import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLLMSession, type StreamChunk } from './llm'
import { ToolCallProtocolError } from './tool-call-protocol'
import type { AIModel, AIProvider } from '../types/ai-providers'
import type { ReasoningSelection } from '../utils/model-reasoning'
import { z } from 'zod'

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
const fixtureTool = (id = 'read_file') => ({
  id,
  init: async () => ({ description: 'Read a fixture', parameters: z.object({ path: z.string().optional() }),
    execute: async () => ({ title: '', metadata: {}, output: 'fixture' }) })
})

test('leaked DSML cancels the HTTP reader without exposing raw markup or executable tools', async context => {
  let cancelled = false
  const events = [
    { choices: [{ delta: { content: '<｜DS' } }] },
    { choices: [{ delta: { content: 'ML｜invoke name="inspect_server">' } }] }
  ]
  context.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    start(controller) {
      for (const event of events) controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`))
    },
    cancel() { cancelled = true }
  })))
  const chunks: StreamChunk[] = []
  await assert.rejects(async () => {
    for await (const chunk of createLLMSession(provider('deepseek'), model('deepseek-v4-pro'), [], '').stream([])) chunks.push(chunk)
  }, ToolCallProtocolError)
  assert.equal(cancelled, true)
  assert.deepEqual(chunks, [])
})

test('Responses rejects mixed raw and native tools before exposing the native call', async context => {
  context.mock.method(globalThis, 'fetch', async () => streamResponse([
    { type: 'response.completed', response: { output: [
      { type: 'function_call', call_id: 'discarded_call', name: 'inspect_server', arguments: '{}' },
      { type: 'message', content: [{ type: 'output_text', text: '<|DSML|tool_calls>' }] }
    ] } }
  ]))
  const calls: StreamChunk[] = []
  await assert.rejects(async () => {
    for await (const chunk of createLLMSession(provider(), model('gpt-6-astra'), [], '').stream([])) {
      if (chunk.type === 'tool-call' || chunk.type === 'done') calls.push(chunk)
    }
  }, ToolCallProtocolError)
  assert.deepEqual(calls, [])
})

test('Responses terminal-only text suffixes are guarded even after ordinary streamed text', async context => {
  context.mock.method(globalThis, 'fetch', async () => streamResponse([
    { type: 'response.output_text.delta', delta: '准备检查。' },
    { type: 'response.completed', response: { output: [
      { type: 'function_call', call_id: 'discarded', name: 'read_file', arguments: '{}' },
      { type: 'message', content: [{ type: 'output_text', text: '准备检查。<|DSML|tool_calls>' }] }
    ] } }
  ]))
  const calls: StreamChunk[] = []
  await assert.rejects(async () => {
    for await (const chunk of createLLMSession(provider(), model('gpt-6-astra'), [fixtureTool()], '').stream([])) {
      if (chunk.type === 'tool-call' || chunk.type === 'done') calls.push(chunk)
    }
  }, ToolCallProtocolError)
  assert.deepEqual(calls, [])
})

test('Responses completes a terminal-only suffix once and rejects changed streamed content', async context => {
  for (const completed of ['first second', 'changed text']) {
    context.mock.method(globalThis, 'fetch', async () => streamResponse([
      { type: 'response.output_text.delta', delta: 'first' },
      { type: 'response.completed', response: { output: [
        { type: 'message', content: [{ type: 'output_text', text: completed }] }
      ] } }
    ]))
    const session = createLLMSession(provider(), model('gpt-6-astra'), [], '')
    if (completed === 'changed text') await assert.rejects(Array.fromAsync(session.stream([])), /changed its streamed text/)
    else {
      const chunks = await Array.fromAsync(session.stream([]))
      assert.equal(chunks.filter(chunk => chunk.type === 'text').map(chunk => chunk.content).join(''), completed)
      assert.equal(chunks.at(-1)?.finish, 'stop')
    }
  }
})

test('DSML documentation in streamed Markdown code remains ordinary answer text', async context => {
  const answer = '示例：`<｜DSML｜calls>`\n\n```xml\n<|DSML|invoke name="inspect_server">\n```\n仅作说明。'
  context.mock.method(globalThis, 'fetch', async () => streamResponse([
    ...Array.from(answer, content => ({ choices: [{ delta: { content } }] })),
    { choices: [{ delta: {}, finish_reason: 'stop' }] }
  ]))
  const chunks = await Array.fromAsync(createLLMSession(provider(), model('fixture'), [], '').stream([]))
  assert.equal(chunks.filter(chunk => chunk.type === 'text').map(chunk => chunk.content).join(''), answer)
  assert.equal(chunks.at(-1)?.finish, 'stop')
  assert.equal(chunks.some(chunk => chunk.type === 'tool-call'), false)
})

function streamResponse(events: unknown[]): Response {
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\r\n\r\n`).join(''))
}

test('Chat Completions preserves long user and system text containing legacy invoke examples', async context => {
  let request: Record<string, unknown> = {}
  context.mock.method(globalThis, 'fetch', async (_input: unknown, init: RequestInit) => {
    request = JSON.parse(String(init.body))
    return streamResponse([{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }])
  })
  const example = '<invoke><read_file>\n{"path":"/srv/config.json"}\n</read_file></invoke>'
  const messages = [
    { role: 'system' as const, content: `Keep this entire policy.\n${'policy '.repeat(800)}\n${example}\nTreat it as an example.` },
    { role: 'user' as const, content: `Explain this example.\n${'request '.repeat(800)}\n${example}\nDo not execute it.` }
  ]
  await Array.fromAsync(createLLMSession(provider(), model('gpt-4.1'), [], '').stream(messages))
  assert.deepEqual(request.messages, messages)
})

test('Chat Completions still converts legacy assistant invoke messages into tool calls', async context => {
  let request: Record<string, unknown> = {}
  context.mock.method(globalThis, 'fetch', async (_input: unknown, init: RequestInit) => {
    request = JSON.parse(String(init.body))
    return streamResponse([{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }])
  })
  await Array.fromAsync(createLLMSession(provider(), model('gpt-4.1'), [], '').stream([
    { role: 'assistant', content: '<invoke><read_file>\n{"path":"/srv/config.json"}\n</read_file></invoke>', tool_call_id: 'legacy_call' },
    { role: 'tool', content: 'saved result', tool_call_id: 'legacy_call' }
  ]))
  assert.deepEqual(request.messages, [{
    role: 'assistant',
    content: null,
    tool_calls: [{ id: 'legacy_call', type: 'function', function: { name: 'read_file', arguments: '{"path":"/srv/config.json"}' } }]
  }, { role: 'tool', content: 'saved result', tool_call_id: 'legacy_call' }])
})

test('unpaired legacy invoke text stays text and malformed paired legacy input is never invented as empty arguments', async context => {
  let request: Record<string, unknown> = {}
  let fetches = 0
  context.mock.method(globalThis, 'fetch', async (_input: unknown, init: RequestInit) => {
    fetches++
    request = JSON.parse(String(init.body))
    return streamResponse([{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }])
  })
  const content = '<invoke><read_file>\n{"path":"/srv/config.json"}\n</read_file></invoke>'
  const messages = [{ role: 'assistant' as const, content, tool_call_id: 'unpaired' }]
  await Array.fromAsync(createLLMSession(provider(), model('fixture'), [], '').stream(messages))
  assert.deepEqual(request.messages, [{ role: 'assistant', content }])
  for (const invalid of ['{invalid', '[]', 'null']) {
    await assert.rejects(Array.fromAsync(createLLMSession(provider(), model('fixture'), [], '').stream([
      { role: 'assistant', tool_call_id: 'paired', content: `<invoke><read_file>\n${invalid}\n</read_file></invoke>` },
      { role: 'tool', tool_call_id: 'paired', content: 'old result' }
    ])), /invalid tool arguments/)
  }
  assert.equal(fetches, 1)
})

test('Chat Completions preserves assistant summaries and prose that quote invoke examples', async context => {
  let request: Record<string, unknown> = {}
  context.mock.method(globalThis, 'fetch', async (_input: unknown, init: RequestInit) => {
    request = JSON.parse(String(init.body))
    return streamResponse([{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }])
  })
  const example = '<invoke><read_file>\n{"path":"/srv/config.json"}\n</read_file></invoke>'
  const messages = [
    { role: 'assistant' as const, content: `[历史执行记录摘要]\n[工具 read_file / completed]\n${example}` },
    { role: 'assistant' as const, content: `Here is an example:\n${example}\nKeep it as text.` },
    { role: 'assistant' as const, content: `${example}\nThis was an example, not a tool request.` }
  ]
  await Array.fromAsync(createLLMSession(provider(), model('gpt-4.1'), [], '').stream(messages))
  assert.deepEqual(request.messages, messages)
})

for (const fixture of [
  { model: 'gpt-5', selection: 'high', effort: 'high', temperature: undefined },
  { model: 'gpt-5', selection: 'default', effort: undefined, temperature: undefined },
  { model: 'o3', selection: 'xhigh', effort: undefined, temperature: undefined },
  { model: 'gpt-4.1', selection: 'high', effort: undefined, temperature: undefined }
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

for (const fixture of [
  { name: 'custom alias override', providerId: 'custom', modelId: 'deployment-alias',
    override: { protocol: 'openai', supportedEfforts: ['low', 'high'] }, selection: 'high', effort: 'high' },
  { name: 'discovered Ollama levels', providerId: 'ollama', modelId: 'local-effort-model',
    reasoning: { protocol: 'ollama', supportedEfforts: ['low', 'medium', 'high'], mandatory: true }, selection: 'high', effort: 'high' },
  { name: 'discovered Ollama toggle on', providerId: 'ollama', modelId: 'local-toggle-model',
    reasoning: { protocol: 'ollama', supportsToggle: true }, selection: 'enabled', effort: 'medium' },
  { name: 'discovered Ollama toggle off', providerId: 'ollama', modelId: 'local-toggle-model',
    reasoning: { protocol: 'ollama', supportsToggle: true }, selection: 'none', effort: 'none' },
  { name: 'ordinary model', providerId: 'custom', modelId: 'ordinary-model', selection: 'high', effort: undefined },
  { name: 'explicitly disabled override', providerId: 'custom', modelId: 'gpt-5', override: false, selection: 'high', effort: undefined },
  { name: 'explicitly unsupported model', providerId: 'custom', modelId: 'gpt-5', reasoning: false, selection: 'high', effort: undefined }
] satisfies Array<{ name: string; providerId: string; modelId: string; reasoning?: AIModel['reasoning']; override?: AIModel['reasoningOverride']; selection: ReasoningSelection; effort: string | undefined }>) {
  test(`terminal HTTP body preserves ${fixture.name}`, async context => {
    let request: Record<string, unknown> = {}
    let endpoint: unknown
    context.mock.method(globalThis, 'fetch', async (url: unknown, init: RequestInit) => {
      endpoint = url
      request = JSON.parse(String(init.body))
      return streamResponse([{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }])
    })
    const current: AIModel = {
      ...model(fixture.modelId),
      reasoning: 'reasoning' in fixture ? fixture.reasoning : undefined,
      reasoningOverride: 'override' in fixture ? fixture.override : undefined
    }
    await Array.fromAsync(createLLMSession(provider(fixture.providerId), current, [], '', undefined, undefined, undefined, fixture.selection).stream([]))
    assert.equal(endpoint, 'https://fixture.invalid/v1/chat/completions')
    assert.equal(request.reasoning_effort, fixture.effort)
    for (const key of ['reasoning', 'thinking', 'think', 'enable_thinking', 'thinking_budget', 'output_config']) {
      assert.equal(request[key], undefined, `${key} must not leak into this compatibility request`)
    }
  })
}

test('terminal generation uses model defaults, output limits and excludes tools for text-only models', async context => {
  let request: Record<string, unknown> = {}
  context.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    request = JSON.parse(String(init.body))
    return streamResponse([{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }])
  })
  const current = model('gpt-5')
  current.parameters = { maxOutputTokens: 16000 }
  current.requestConfig = { temperature: 0.9, topP: 0.8, maxTokens: 50000, reasoning: 'high' }
  current.capabilities.functionCall = false
  const tool = { id: 'read_file', init: async () => { throw new Error('Text-only model must not initialize tools') } }
  await Array.fromAsync(createLLMSession(provider(), current, [tool], '').stream([]))
  assert.equal(request.max_completion_tokens, 16000)
  assert.equal(request.reasoning_effort, 'high')
  assert.equal(request.temperature, undefined)
  assert.equal(request.top_p, undefined)
  assert.equal(request.tools, undefined)
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
  const chunks = await Array.fromAsync(createLLMSession(provider(), model('gpt-5'), [fixtureTool()], '').stream([]))
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
  { base: 'https://generativelanguage.googleapis.com', model: 'gemini-2.5-pro', endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', sentModel: 'gemini-2.5-pro' },
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

test('invalid native call batches never expose a partial executable batch or successful completion', async context => {
  const call = (index: number, id = `call_${index}`, name = 'read_file', args: unknown = '{}') => ({
    index, id, type: 'function', function: { name, arguments: args }
  })
  const fixtures: Array<{ name: string; events: unknown[] }> = [
    { name: 'empty batch', events: [{ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }] },
    { name: 'duplicate IDs', events: [{ choices: [{ delta: { tool_calls: [call(0, 'same'), call(1, 'same')] }, finish_reason: 'tool_calls' }] }] },
    { name: 'duplicate indices', events: [{ choices: [{ delta: { tool_calls: [call(0), call(0, 'another')] }, finish_reason: 'tool_calls' }] }] },
    { name: 'negative index', events: [{ choices: [{ delta: { tool_calls: [call(-1)] }, finish_reason: 'tool_calls' }] }] },
    { name: 'changed ID', events: [
      { choices: [{ delta: { tool_calls: [call(0)] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'changed' }] }, finish_reason: 'tool_calls' }] }
    ] },
    { name: 'empty ID', events: [{ choices: [{ delta: { tool_calls: [call(0, ' ')] }, finish_reason: 'tool_calls' }] }] },
    { name: 'empty name', events: [{ choices: [{ delta: { tool_calls: [call(0, 'call', ' ')] }, finish_reason: 'tool_calls' }] }] },
    { name: 'missing arguments', events: [{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call', function: { name: 'read_file' } }] }, finish_reason: 'tool_calls' }] }] },
    { name: 'non-string arguments', events: [{ choices: [{ delta: { tool_calls: [call(0, 'call', 'read_file', {})] }, finish_reason: 'tool_calls' }] }] },
    { name: 'invalid second arguments', events: [{ choices: [{ delta: { tool_calls: [call(0), call(1, 'second', 'read_file', '{unfinished')] }, finish_reason: 'tool_calls' }] }] },
    { name: 'unavailable second tool', events: [{ choices: [{ delta: { tool_calls: [call(0), call(1, 'second', 'not_registered')] }, finish_reason: 'tool_calls' }] }] },
    { name: 'ambiguous local fragments', events: [
      { choices: [{ delta: { tool_calls: [call(0), call(1)] } }] },
      { choices: [{ delta: { tool_calls: [{ function: { arguments: '' } }] }, finish_reason: 'tool_calls' }] }
    ] }
  ]
  for (const fixture of fixtures) {
    context.mock.method(globalThis, 'fetch', async () => streamResponse(fixture.events))
    const exposed: StreamChunk[] = []
    await assert.rejects(async () => {
      for await (const chunk of createLLMSession(provider(), model('fixture'), [fixtureTool()], '').stream([])) exposed.push(chunk)
    }, Error, fixture.name)
    assert.equal(exposed.some(chunk => chunk.type === 'tool-call' || chunk.type === 'done'), false, fixture.name)
  }
})

test('tool calls cannot bypass an empty or disabled request tool set on any native transport', async context => {
  for (const id of ['fixture', 'gpt-6-astra', 'claude-sonnet-4-6']) {
    for (const enabled of [true, false]) {
      const current = model(id)
      current.capabilities.functionCall = enabled
      const events = id.startsWith('claude') ? [
        { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'call', name: 'read_file', input: {} } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'tool_use' } }, { type: 'message_stop' }
      ] : id === 'gpt-6-astra' ? [
        { type: 'response.completed', response: { output: [{ type: 'function_call', call_id: 'call', name: 'read_file', arguments: '{}' }] } }
      ] : [{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call', function: { name: 'read_file', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] }]
      context.mock.method(globalThis, 'fetch', async () => streamResponse(events))
      const chunks: StreamChunk[] = []
      await assert.rejects(async () => {
        for await (const chunk of createLLMSession(provider(id.startsWith('claude') ? 'anthropic' : 'openai'), current,
          enabled ? [] : [fixtureTool()], '').stream([])) chunks.push(chunk)
      }, /unavailable tool/)
      assert.equal(chunks.some(chunk => chunk.type === 'tool-call' || chunk.type === 'done'), false)
    }
  }
})

test('local compatibility calls keep missing IDs unique and route index-free fragments by ID', async context => {
  context.mock.method(globalThis, 'fetch', async () => streamResponse([
    { choices: [{ delta: { tool_calls: [
      { index: 0, function: { name: 'read_file', arguments: '{}' } },
      { index: 1, id: '0', function: { name: 'read_file', arguments: '{}' } }
    ] }, finish_reason: 'stop' }] }
  ]))
  const session = createLLMSession(provider('ollama'), model('fixture'), [fixtureTool()], '')
  const first = (await Array.fromAsync(session.stream([]))).filter(chunk => chunk.type === 'tool-call')
  const second = (await Array.fromAsync(session.stream([]))).filter(chunk => chunk.type === 'tool-call')
  assert.equal(first.length, 2)
  assert.notEqual(first[0].toolCallId, first[1].toolCallId)
  assert.notEqual(first[0].toolCallId, second[0].toolCallId)
  assert.equal(first[1].toolCallId, '0')
  context.mock.method(globalThis, 'fetch', async () => streamResponse([
    { choices: [{ delta: { tool_calls: [
      { id: 'a', function: { name: 'read_', arguments: '{"path":' } },
      { id: 'b', function: { name: 'read_file', arguments: '{"path":' } }
    ] } }] },
    { choices: [{ delta: { tool_calls: [
      { id: 'b', function: { arguments: '"second"}' } },
      { id: 'a', function: { name: 'file', arguments: '"first"}' } }
    ] }, finish_reason: 'tool_calls' }] }
  ]))
  const calls = (await Array.fromAsync(session.stream([]))).filter(chunk => chunk.type === 'tool-call')
  assert.deepEqual(calls.map(chunk => [chunk.toolCallId, chunk.toolName, chunk.toolInput]), [
    ['a', 'read_file', { path: 'first' }], ['b', 'read_file', { path: 'second' }]
  ])
})

test('a DONE sentinel without a completion reason is a truncated response', async context => {
  context.mock.method(globalThis, 'fetch', async () => new Response('data: {"choices":[{"delta":{"content":"unfinished"}}]}\n\ndata: [DONE]\n\n'))
  const chunks: StreamChunk[] = []
  await assert.rejects(async () => {
    for await (const chunk of createLLMSession(provider(), model('fixture'), [], '').stream([])) chunks.push(chunk)
  }, /before completing/)
  assert.equal(chunks.some(chunk => chunk.type === 'done'), false)
})

test('completed Responses cannot execute incomplete, conflicting or duplicate output items', async context => {
  const call = { type: 'function_call', id: 'item_a', call_id: 'call_a', name: 'read_file', arguments: '{}', status: 'completed' }
  const fixtures = [
    [{ type: 'response.completed' }],
    [{ type: 'response.completed', response: { output: [{ ...call, status: 'incomplete' }] } }],
    [{ type: 'response.completed', response: { output: [call, { ...call, id: 'item_b' }] } }],
    [{ type: 'response.completed', response: { output: [call, { ...call, call_id: 'call_b' }] } }],
    [{ type: 'response.completed', response: { output: [{ ...call, call_id: '' }] } }],
    [{ type: 'response.completed', response: { output: [{ ...call, name: ' ' }] } }],
    [{ type: 'response.completed', response: { output: [{ ...call, arguments: undefined }] } }],
    [{ type: 'response.completed', response: { output: [call, { type: 'message', status: 'incomplete', content: [] }] } }],
    [{ type: 'response.output_item.done', output_index: 0, item: call }, { type: 'response.completed', response: { output: [] } }],
    [{ type: 'response.output_item.done', output_index: 0, item: call }, { type: 'response.output_item.done', output_index: 0, item: { ...call, call_id: 'changed' } }, { type: 'response.completed', response: {} }]
  ]
  for (const events of fixtures) {
    context.mock.method(globalThis, 'fetch', async () => streamResponse(events))
    const chunks: StreamChunk[] = []
    await assert.rejects(async () => {
      for await (const chunk of createLLMSession(provider(), model('gpt-6-astra'), [fixtureTool()], '').stream([])) chunks.push(chunk)
    })
    assert.equal(chunks.some(chunk => chunk.type === 'tool-call' || chunk.type === 'done'), false)
  }
})

test('Responses translates multimodal Chat content without mutating the saved conversation', async context => {
  const messages = [{ role: 'user' as const, content: [
    { type: 'text', text: 'Read this screen' },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,fixture', detail: 'high' } }
  ] }]
  const before = JSON.stringify(messages)
  let request: Record<string, unknown> = {}
  context.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    request = JSON.parse(String(init.body))
    return streamResponse([{ type: 'response.completed', response: { output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }] } }])
  })
  await Array.fromAsync(createLLMSession(provider(), model('gpt-6-astra'), [], '').stream(messages))
  assert.deepEqual(request.input, [{ role: 'user', content: [
    { type: 'input_text', text: 'Read this screen' },
    { type: 'input_image', image_url: 'data:image/png;base64,fixture', detail: 'high' }
  ] }])
  assert.equal(JSON.stringify(messages), before)
})

test('SSE supports CR-only event delimiters split at every byte', async context => {
  const bytes = new TextEncoder().encode('data: {"choices":[{"delta":{"content":"中文"}}]}\r\rdata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\r\r')
  let index = 0
  context.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    pull(controller) {
      if (index === bytes.length) controller.close()
      else controller.enqueue(bytes.subarray(index, ++index))
    }
  })))
  const chunks = await Array.fromAsync(createLLMSession(provider(), model('fixture'), [], '').stream([]))
  assert.equal(chunks.filter(chunk => chunk.type === 'text').map(chunk => chunk.content).join(''), '中文')
  assert.equal(chunks.at(-1)?.finish, 'stop')
})

test('malformed Responses items cannot release a valid function call in the same batch', async context => {
  const valid = { type: 'function_call', id: 'valid_item', call_id: 'valid_call', name: 'read_file', arguments: '{}' }
  const malformed = [
    {}, { type: '' }, { type: 0 }, { type: 'reasoning', id: null }, { type: 'reasoning', id: 42 },
    { type: 'message' }, { type: 'message', content: {} }, { type: 'message', content: [null] },
    { type: 'message', content: [{ type: 'output_text', text: 0 }] },
    { type: 'message', content: [{ type: 'refusal', refusal: false }] },
    { type: 'message', role: 'user', content: [{ type: 'output_text', text: 'wrong role' }] }
  ]
  for (const item of malformed) {
    context.mock.method(globalThis, 'fetch', async () => streamResponse([
      { type: 'response.completed', response: { output: [valid, item] } }
    ]))
    const chunks: StreamChunk[] = []
    await assert.rejects(async () => {
      for await (const chunk of createLLMSession(provider(), model('gpt-6-astra'), [fixtureTool()], '').stream([])) chunks.push(chunk)
    })
    assert.equal(chunks.some(chunk => chunk.type === 'tool-call' || chunk.type === 'done'), false)
  }
})

test('Responses rejects unsupported client operations while preserving completed server operations', async context => {
  const clientTypes = ['custom_tool_call', 'computer_call', 'local_shell_call', 'shell_call', 'apply_patch_call', 'tool_search_call']
  for (const type of clientTypes) {
    context.mock.method(globalThis, 'fetch', async () => streamResponse([
      { type: 'response.completed', response: { output: [
        { type: 'function_call', call_id: 'valid', name: 'read_file', arguments: '{}' },
        { type, id: 'unsupported', call_id: 'other', execution: 'client', status: 'completed' }
      ] } }
    ]))
    const chunks: StreamChunk[] = []
    await assert.rejects(async () => {
      for await (const chunk of createLLMSession(provider(), model('gpt-6-astra'), [fixtureTool()], '').stream([])) chunks.push(chunk)
    }, /unsupported client tool call/)
    assert.equal(chunks.some(chunk => chunk.type === 'tool-call' || chunk.type === 'done'), false)
  }
  context.mock.method(globalThis, 'fetch', async () => streamResponse([
    { type: 'response.completed', response: { output: [
      { type: 'web_search_call', id: 'search', status: 'completed' },
      { type: 'tool_search_call', id: 'tools', execution: 'server', status: 'completed' },
      { type: 'future_metadata', id: 'future' },
      { type: 'message', content: [{ type: 'output_text', text: 'Search completed.' }] }
    ] } }
  ]))
  const chunks = await Array.fromAsync(createLLMSession(provider(), model('gpt-6-astra'), [], '').stream([]))
  assert.equal(chunks.at(-1)?.finish, 'stop')
  assert.equal(chunks.some(chunk => chunk.type === 'tool-call'), false)
  assert.equal(chunks.filter(chunk => chunk.type === 'text').map(chunk => chunk.content).join(''), 'Search completed.')
})

test('SSE terminal CR records finish and cancel an HTTP connection that stays open', { timeout: 2000 }, async context => {
  let cancelled = false
  const abort = new AbortController()
  context.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\r\r'))
    },
    cancel() { cancelled = true }
  })))
  // A failure aborts the blocked reader instead of leaving the regression test
  // waiting forever for the deliberately absent HTTP EOF.
  const timeout = setTimeout(() => abort.abort(), 500)
  try {
    const chunks = await Array.fromAsync(createLLMSession(provider(), model('fixture'), [], '', undefined, undefined, abort.signal).stream([]))
    assert.equal(chunks.at(-1)?.finish, 'stop')
    assert.equal(cancelled, true)
  } finally {
    clearTimeout(timeout)
  }
})

function terminalEvents(style: 'chat' | 'responses' | 'anthropic', mode: 'empty' | 'whitespace' | 'reasoning' | 'refusal' | 'tools'): unknown[] {
  const text = mode === 'whitespace' ? ' \t\r\n' : mode === 'refusal' ? 'Cannot fulfill that request.' : ''
  if (style === 'chat') return [{ choices: [{ delta: {
    ...(mode === 'reasoning' ? { reasoning_content: 'private reasoning' } : {}),
    ...(mode === 'refusal' ? { refusal: text } : { content: text }),
    ...(mode === 'tools' ? { tool_calls: [{ index: 0, id: 'call', function: { name: 'read_file', arguments: '{}' } }] } : {})
  }, finish_reason: mode === 'tools' ? 'tool_calls' : 'stop' }] }]
  if (style === 'responses') return [{ type: 'response.completed', response: { output:
    mode === 'empty' ? [] : mode === 'reasoning' ? [{ type: 'reasoning', encrypted_content: 'private', summary: [] }]
      : mode === 'tools' ? [{ type: 'function_call', call_id: 'call', name: 'read_file', arguments: '{}' }]
        : [{ type: 'message', content: [mode === 'refusal' ? { type: 'refusal', refusal: text } : { type: 'output_text', text }] }]
  } }]
  return [
    ...(mode === 'empty' ? [] : [
      { type: 'content_block_start', index: 0, content_block:
        mode === 'reasoning' ? { type: 'thinking', thinking: 'private reasoning', signature: 'signed' }
          : mode === 'tools' ? { type: 'tool_use', id: 'call', name: 'read_file', input: {} }
            : { type: 'text', text } },
      { type: 'content_block_stop', index: 0 }
    ]),
    { type: 'message_delta', delta: { stop_reason: mode === 'tools' ? 'tool_use' : 'end_turn' } }, { type: 'message_stop' }
  ]
}

for (const style of ['chat', 'responses', 'anthropic'] as const) {
  test(`${style} does not report an empty, whitespace-only or reasoning-only answer as success`, async context => {
    for (const mode of ['empty', 'whitespace', 'reasoning'] as const) {
      context.mock.method(globalThis, 'fetch', async () => streamResponse(terminalEvents(style, mode)))
      const chunks: StreamChunk[] = []
      await assert.rejects(async () => {
        for await (const chunk of createLLMSession(provider(style === 'anthropic' ? 'anthropic' : 'openai'),
          model(style === 'responses' ? 'gpt-6-astra' : 'fixture'), [], '').stream([])) chunks.push(chunk)
      }, /empty response/)
      assert.equal(chunks.some(chunk => chunk.type === 'done'), false)
    }
  })

  test(`${style} retains valid refusals and tool-only turns`, async context => {
    for (const mode of ['refusal', 'tools'] as const) {
      context.mock.method(globalThis, 'fetch', async () => streamResponse(terminalEvents(style, mode)))
      const chunks = await Array.fromAsync(createLLMSession(provider(style === 'anthropic' ? 'anthropic' : 'openai'),
        model(style === 'responses' ? 'gpt-6-astra' : 'fixture'), [fixtureTool()], '').stream([]))
      assert.equal(chunks.at(-1)?.finish, mode === 'tools' ? 'tool-calls' : 'stop')
      if (mode === 'tools') assert.equal(chunks.filter(chunk => chunk.type === 'tool-call').length, 1)
      else assert.equal(chunks.filter(chunk => chunk.type === 'text').map(chunk => chunk.content).join(''), 'Cannot fulfill that request.')
    }
  })
}
