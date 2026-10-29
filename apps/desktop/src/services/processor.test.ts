import test from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import { SessionProcessor, type ProcessorConfig } from './processor'
import type { AIModel, AIProvider } from '../types/ai-providers'

const provider = (id = 'openai'): AIProvider => ({
  id, name: id, description: '', icon: '', website: '', endpoint: 'https://fixture.invalid/v1',
  apiKey: 'fixture-only', enabled: true, isDefault: false, models: []
})
const model = (id: string): AIModel => ({
  id, name: id, providerId: 'openai', contextWindow: 8192,
  capabilities: { text: true, image: false, functionCall: true, vision: false }
})
const tool = (id: string) => ({
  id,
  init: async () => ({
    description: 'Read-only fixture', parameters: z.object({ path: z.string().optional() }),
    execute: async () => ({ title: '', metadata: {}, output: 'fixture' })
  })
})
const asResponse = (events: unknown[]) => new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''))
const call = (id = 'call_fixture', name = 'read_file') => ({ index: 0, id, type: 'function', function: { name, arguments: '{"path":"fixture"}' } })
const complete = () => asResponse([{ choices: [{ delta: { content: 'done' }, finish_reason: 'stop' }] }])

test('tool round budget reports unfinished work and retains completed tool output', async context => {
  let rounds = 0
  let executions = 0
  const finishes: string[] = []
  context.mock.method(globalThis, 'fetch', async () => asResponse([{ choices: [{ delta: { tool_calls: [call(`call_${++rounds}`)] }, finish_reason: 'tool_calls' }] }]))
  const result = await new SessionProcessor({
    provider: provider(), model: model('fixture'), messages: [{ role: 'user', content: 'inspect' }], tools: [tool('read_file')], maxSteps: 2,
    onToolExecute: async () => ({ output: `observation ${++executions}` }),
    onEvent: event => { if (event.type === 'done') finishes.push(event.finish) }
  }).process()
  assert.equal(rounds, 2)
  assert.equal(executions, 2)
  assert.equal(result.finish, 'step-limit')
  assert.equal(finishes.at(-1), 'step-limit')
  assert.equal(finishes.includes('stop'), false)
  assert.equal(result.messages?.at(-1)?.content, 'observation 2')
})

test('all tool rounds keep the model, provider and reasoning selected when the turn began', async context => {
  const requests: Array<{ url: unknown; body: Record<string, unknown> }> = []
  context.mock.method(globalThis, 'fetch', async (url: unknown, init: RequestInit) => {
    requests.push({ url, body: JSON.parse(String(init.body)) })
    return requests.length === 1 ? asResponse([{ choices: [{ delta: { tool_calls: [call()] }, finish_reason: 'tool_calls' }] }]) : complete()
  })
  const config: ProcessorConfig = {
    provider: provider(), model: model('gpt-5'), reasoning: 'high',
    messages: [{ role: 'user', content: 'inspect' }], tools: [tool('read_file')],
    onToolExecute: async () => {
      config.reasoning = 'low'
      config.model.id = 'gpt-4.1'
      config.provider.endpoint = 'https://changed.invalid/v1'
      return { output: 'fixture contents' }
    }
  }
  await new SessionProcessor(config).process()
  assert.equal(requests.length, 2)
  for (const request of requests) {
    assert.equal(request.url, 'https://fixture.invalid/v1/chat/completions')
    assert.equal(request.body.model, 'gpt-5')
    assert.equal(request.body.reasoning_effort, 'high')
    assert.equal(request.body.temperature, undefined)
  }
})

test('DeepSeek thinking content is replayed with tool calls without exposing it as answer text', async context => {
  const requests: Array<Record<string, unknown>> = []
  const visible: string[] = []
  context.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)))
    return requests.length === 1 ? asResponse([
      { choices: [{ delta: { reasoning_content: 'private ' } }] },
      { choices: [{ delta: { reasoning_content: 'reasoning', tool_calls: [call()] }, finish_reason: 'tool_calls' }] }
    ]) : complete()
  })
  const processor = new SessionProcessor({
    provider: provider('deepseek'), model: model('deepseek-v4-pro'), reasoning: 'high',
    messages: [{ role: 'user', content: 'inspect' }], tools: [tool('read_file')],
    onToolExecute: async () => ({ output: 'fixture contents' }),
    onEvent: event => { if (event.type === 'text-delta') visible.push(event.delta) }
  })
  await processor.process()
  assert.deepEqual(visible, ['done'])
  assert.deepEqual(requests[0].thinking, { type: 'enabled' })
  assert.equal(requests[0].reasoning_effort, 'high')
  const messages = requests[1].messages as Array<Record<string, unknown>>
  assert.equal(messages[1].reasoning_content, 'private reasoning')
  assert.equal(messages[1].content, null)
  assert.equal(messages[2].tool_call_id, 'call_fixture')
  assert.equal(messages[2].content, 'fixture contents')
})

test('Responses tool rounds replay encrypted reasoning and every function call with matching outputs', async context => {
  const reasoning = { id: 'rs_fixture', type: 'reasoning', encrypted_content: 'opaque-fixture', summary: [] }
  const firstCall = { id: 'fc_one', type: 'function_call', call_id: 'call_one', name: 'read_file', arguments: '{"path":"a"}', status: 'completed' }
  const secondCall = { id: 'fc_two', type: 'function_call', call_id: 'call_two', name: 'list_files', arguments: '{"path":"b"}', status: 'completed' }
  const requests: Array<Record<string, unknown>> = []
  const executed: string[] = []
  const visible: string[] = []
  context.mock.method(globalThis, 'fetch', async (url: unknown, init: RequestInit) => {
    assert.equal(url, 'https://fixture.invalid/v1/responses')
    requests.push(JSON.parse(String(init.body)))
    return requests.length === 1 ? asResponse([
      { type: 'response.output_item.done', output_index: 0, item: reasoning },
      { type: 'response.output_item.done', output_index: 1, item: firstCall },
      { type: 'response.output_item.done', output_index: 2, item: secondCall },
      { type: 'response.completed', response: { status: 'completed' } }
    ]) : asResponse([
      { type: 'response.output_text.delta', delta: 'result' },
      { type: 'response.completed', response: { output: [
        { type: 'message', id: 'msg_fixture', role: 'assistant', content: [{ type: 'output_text', text: 'result' }] }
      ] } }
    ])
  })
  const processor = new SessionProcessor({
    provider: provider(), model: model('gpt-6-astra'), reasoning: 'xhigh',
    messages: [{ role: 'user', content: 'inspect' }], tools: [tool('read_file'), tool('list_files')],
    onToolExecute: async name => { executed.push(name); return { output: `${name} output` } },
    onEvent: event => { if (event.type === 'text-delta') visible.push(event.delta) }
  })
  await processor.process()
  assert.deepEqual(executed, ['read_file', 'list_files'])
  assert.deepEqual(visible, ['result'])
  assert.equal(requests.length, 2)
  assert.deepEqual(requests[0].reasoning, { effort: 'xhigh' })
  assert.deepEqual(requests[1].reasoning, { effort: 'xhigh' })
  assert.deepEqual(requests[1].input, [
    { role: 'user', content: 'inspect' }, reasoning, firstCall, secondCall,
    { type: 'function_call_output', call_id: 'call_one', output: 'read_file output' },
    { type: 'function_call_output', call_id: 'call_two', output: 'list_files output' }
  ])
  const tools = requests[0].tools as Array<Record<string, unknown>>
  assert.equal(tools[0].name, 'read_file')
  assert.equal(tools[0].function, undefined)
  assert.equal(tools[0].strict, false)
  assert.deepEqual(requests[1].include, ['reasoning.encrypted_content'])
  assert.equal(requests[1].store, false)
})

test('completed Processor rounds cancel unread HTTP streams and release the reader', { timeout: 2000 }, async context => {
  let cancelled = false
  context.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'done' }, finish_reason: 'stop' }] })}\n\n`))
    },
    cancel() { cancelled = true }
  })))
  await new SessionProcessor({
    provider: provider(), model: model('gpt-5'), messages: [{ role: 'user', content: 'inspect' }], tools: []
  }).process()
  assert.equal(cancelled, true)
})

test('Gemini preserves each tool thought signature and original call order through subsequent tool rounds', async context => {
  const requests: Array<Record<string, unknown>> = []
  const signatureA = { google: { thought_signature: 'opaque-signature-A' } }
  const signatureB = { google: { thought_signature: 'opaque-signature-B' } }
  const executed: string[] = []
  const visible: string[] = []
  context.mock.method(globalThis, 'fetch', async (url: unknown, init: RequestInit) => {
    assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions')
    requests.push(JSON.parse(String(init.body)))
    if (requests.length === 1) return asResponse([
      // Index order, rather than transport chunk order, determines the signed first call.
      { choices: [{ delta: { tool_calls: [
        { index: 1, id: 'call_two', function: { name: 'list_files', arguments: '{"path":"b"}' } },
        { index: 0, id: 'call_one', function: { name: 'read_file', arguments: '{"path":"a"}' } }
      ] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, extra_content: signatureA }] }, finish_reason: 'tool_calls' }] }
    ])
    if (requests.length === 2) return asResponse([{ choices: [{ delta: { tool_calls: [
      { index: 0, id: 'call_three', extra_content: signatureB, function: { name: 'read_file', arguments: '{"path":"c"}' } }
    ] }, finish_reason: 'tool_calls' }] }])
    return complete()
  })
  await new SessionProcessor({
    provider: { ...provider('google'), endpoint: 'https://generativelanguage.googleapis.com/v1beta' },
    model: model('models/gemini-3.8-flash'), reasoning: 'high', tools: [tool('read_file'), tool('list_files')],
    messages: [{ role: 'user', content: 'inspect' }],
    onToolExecute: async name => { executed.push(name); return { output: `${name} output` } },
    onEvent: event => { if (event.type === 'text-delta') visible.push(event.delta) }
  }).process()
  assert.equal(requests.length, 3)
  const messages = requests[2].messages as Array<{
    role: string; tool_call_id?: string; tool_calls?: Array<{ id: string; extra_content?: unknown }>
  }>
  assert.deepEqual(messages[1].tool_calls?.map(tc => tc.id), ['call_one', 'call_two'])
  assert.deepEqual(messages[1].tool_calls?.[0].extra_content, signatureA)
  assert.equal(messages[1].tool_calls?.[1].extra_content, undefined)
  assert.equal(messages[2].tool_call_id, 'call_one')
  assert.equal(messages[3].tool_call_id, 'call_two')
  assert.deepEqual(messages[4].tool_calls?.[0].extra_content, signatureB)
  assert.equal(messages[5].tool_call_id, 'call_three')
  assert.deepEqual(executed, ['read_file', 'list_files', 'read_file'])
  assert.deepEqual(visible, ['done'])
  for (const request of requests) assert.equal(request.reasoning_effort, 'high')
})

for (const stopAt of ['before-tools', 'first-of-two', 'only-tool'] as const) {
  test(`cancelling ${stopAt} never starts another tool or reports the turn as complete`, async context => {
    const controller = new AbortController()
    const executed: string[] = []
    let requestCount = 0
    let successfulFinish = false
    context.mock.method(globalThis, 'fetch', async () => {
      requestCount++
      return asResponse([{ choices: [{ delta: { tool_calls: [
        call('call_one', 'read_file'),
        ...(stopAt === 'only-tool' ? [] : [{ ...call('call_two', 'list_files'), index: 1 }])
      ] }, finish_reason: 'tool_calls' }] }])
    })
    const processor = new SessionProcessor({
      provider: provider(), model: model('gpt-5'), tools: [tool('read_file'), tool('list_files')],
      messages: [{ role: 'user', content: 'inspect' }], abortSignal: controller.signal,
      onToolExecute: async name => {
        executed.push(name)
        controller.abort()
        // Simulate an in-flight tool that finishes instead of throwing on cancellation.
        return { output: 'read completed before stop' }
      },
      onEvent: event => {
        if (event.type === 'done' && event.finish === 'tool-calls' && stopAt === 'before-tools') controller.abort()
        if (event.type === 'done' && event.finish === 'stop') successfulFinish = true
      }
    })
    await assert.rejects(processor.process(), { name: 'AbortError' })
    assert.deepEqual(executed, stopAt === 'before-tools' ? [] : ['read_file'])
    assert.equal(requestCount, 1)
    assert.equal(successfulFinish, false)
    assert.equal(processor.isAborted(), true)
  })
}

test('OpenRouter replays the complete ordered reasoning_details sequence without rewriting or displaying blocks', async context => {
  const summary = { type: 'reasoning.summary', summary: 'fixture summary', id: 'rs_fixture', format: 'openai-responses-v1', index: 0 }
  const textStart = { type: 'reasoning.text', text: 'private ', signature: null, id: 'reasoning_fixture', format: 'anthropic-claude-v1', index: 1 }
  const textEnd = { type: 'reasoning.text', text: 'continuation', signature: 'fixture-signature', id: 'reasoning_fixture', format: 'anthropic-claude-v1', index: 1 }
  const encrypted = { type: 'reasoning.encrypted', data: 'opaque-fixture', id: 'encrypted_fixture', format: 'openai-responses-v1', index: 2 }
  const requests: Array<Record<string, unknown>> = []
  const visible: string[] = []
  context.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)))
    return requests.length === 1 ? asResponse([
      { choices: [{ delta: { reasoning: 'private ', reasoning_details: [summary, textStart] } }] },
      { choices: [{ delta: { reasoning: 'continuation', reasoning_details: [textEnd] } }] },
      { choices: [{ delta: { reasoning_details: [encrypted], tool_calls: [call()] }, finish_reason: 'tool_calls' }] }
    ]) : complete()
  })
  const result = await new SessionProcessor({
    provider: provider('openrouter'),
    model: { ...model('openai/gpt-6-astra'), reasoning: { protocol: 'openrouter', supportedEfforts: ['low', 'high'] } },
    reasoning: 'high', messages: [{ role: 'user', content: 'inspect' }], tools: [tool('read_file')],
    onToolExecute: async () => ({ output: 'fixture contents' }),
    onEvent: event => { if (event.type === 'text-delta') visible.push(event.delta) }
  }).process()
  const messages = requests[1].messages as Array<Record<string, unknown>>
  assert.deepEqual(messages[1].reasoning_details, [summary, textStart, textEnd, encrypted])
  assert.equal(messages[1].reasoning_content, undefined)
  assert.deepEqual(result.messages?.[1].reasoning_details, [summary, textStart, textEnd, encrypted])
  assert.equal(result.messages?.[1].reasoning_content, 'private continuation')
  assert.equal(messages[2].tool_call_id, 'call_fixture')
  assert.deepEqual(visible, ['done'])
  for (const request of requests) assert.deepEqual(request.reasoning, { effort: 'high' })
})

test('reasoning text aliases remain internal when no structured reasoning details are present', async context => {
  const requests: Array<Record<string, unknown>> = []
  const visible: string[] = []
  context.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)))
    return requests.length === 1 ? asResponse([
      { choices: [{ delta: { reasoning: 'private alias' } }] },
      { choices: [{ delta: { tool_calls: [call()] }, finish_reason: 'tool_calls' }] }
    ]) : complete()
  })
  await new SessionProcessor({
    provider: provider('openrouter'), model: model('fixture'),
    messages: [{ role: 'user', content: 'inspect' }], tools: [tool('read_file')],
    onToolExecute: async () => ({ output: 'fixture contents' }),
    onEvent: event => { if (event.type === 'text-delta') visible.push(event.delta) }
  }).process()
  const messages = requests[1].messages as Array<Record<string, unknown>>
  assert.equal(messages[1].reasoning_content, 'private alias')
  assert.equal(messages[1].reasoning_details, undefined)
  assert.deepEqual(visible, ['done'])
})
