import test from 'node:test'
import assert from 'node:assert/strict'
import { createLLMSession, type ChatMessage, type StreamChunk } from './llm'
import { toAnthropicMessages } from './anthropic-terminal'
import { SessionProcessor } from './processor'
import type { AIModel, AIProvider } from '../types/ai-providers.types'

const provider: AIProvider = {
  id: 'anthropic', name: 'Claude', description: '', icon: '', website: '',
  endpoint: 'https://api.anthropic.com/v1/', apiKey: 'fixture-only', enabled: true, isDefault: false, models: []
}
const model: AIModel = {
  id: 'claude-sonnet-4-6', name: 'Claude Sonnet', providerId: 'anthropic', contextWindow: 200000,
  capabilities: { text: true, vision: true, image: false, functionCall: true },
  reasoning: { protocol: 'anthropic', supportedEfforts: ['low', 'medium', 'high'], thinkingMode: 'adaptive' },
  parameters: { apiStyle: 'anthropic', maxOutputTokens: 64000, temperature: false, topP: false },
  requestConfig: { maxTokens: 8192, reasoning: 'high' }
}
const events = [
  { type: 'message_start', message: { role: 'assistant' } },
  { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Private fixture reasoning' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'fixture-' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'signature' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '检查中文目录' } },
  { type: 'content_block_stop', index: 1 },
  { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'tool_fixture', name: 'read_file', input: {} } },
  { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"path":' } },
  { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '"/中文"}' } },
  { type: 'content_block_stop', index: 2 },
  { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
  { type: 'message_stop' }
]

function fragmentedStream(input: unknown[]) {
  const bytes = new TextEncoder().encode(input.map(event => `event: fixture\ndata: ${JSON.stringify(event)}\n\n`).join(''))
  let index = 0
  return new Response(new ReadableStream({
    pull(controller) {
      if (index === bytes.length) controller.close()
      else controller.enqueue(bytes.subarray(index, ++index))
    }
  }))
}

test('native Claude terminal requests preserve signed thinking, UTF-8 tool calls and per-model parameters', async context => {
  let request: Record<string, any> = {}
  context.mock.method(globalThis, 'fetch', async (url: unknown, init: RequestInit) => {
    assert.equal(url, 'https://api.anthropic.com/v1/messages')
    const headers = init.headers as Record<string, string>
    assert.equal(headers['x-api-key'], 'fixture-only')
    assert.equal(headers.Authorization, undefined)
    request = JSON.parse(String(init.body))
    return fragmentedStream(events)
  })
  const session = createLLMSession(provider, model, [], '')
  const chunks = await Array.fromAsync(session.stream([{ role: 'system', content: 'System fixture' }, { role: 'user', content: 'inspect' }]))
  assert.equal(request.system, 'System fixture')
  assert.equal(request.max_tokens, 8192)
  assert.equal(request.temperature, undefined)
  assert.equal(request.top_p, undefined)
  assert.deepEqual(request.output_config, { effort: 'high' })
  assert.equal(chunks.find(chunk => chunk.type === 'text')?.content, '检查中文目录')
  assert.deepEqual(chunks.find(chunk => chunk.type === 'tool-call')?.toolInput, { path: '/中文' })
  const responseItems = chunks.flatMap(chunk => chunk.responseItem ? [chunk.responseItem] : [])
  assert.deepEqual(responseItems[0], { type: 'thinking', thinking: 'Private fixture reasoning', signature: 'fixture-signature' })
  const replay = toAnthropicMessages([
    { role: 'assistant', content: '检查中文目录', responseItems },
    { role: 'tool', tool_call_id: 'tool_fixture', content: 'file contents' },
    { role: 'tool', tool_call_id: 'tool_fixture_2', content: 'second result' }
  ])
  assert.deepEqual(replay.messages[0].content, responseItems)
  assert.equal(replay.messages[1].content.length, 2)
  assert.deepEqual(replay.messages[1].content[0], { type: 'tool_result', tool_use_id: 'tool_fixture', content: 'file contents' })
})

test('Claude interrupted or unsigned streams never emit executable tool calls', async context => {
  const fixtures = [
    events.slice(0, -1),
    events.filter(event => !('delta' in event && event.delta?.type === 'signature_delta')),
    events.map(event => event.type === 'message_delta' ? { ...event, delta: { stop_reason: 'max_tokens' } } : event),
    events.map(event => 'delta' in event && event.delta?.type === 'input_json_delta' ? { ...event, delta: { type: 'input_json_delta', partial_json: 'invalid' } } : event)
  ]
  context.mock.method(globalThis, 'fetch', async () => fragmentedStream(fixtures.shift()!))
  for (let index = 0; index < 4; index++) {
    const chunks: StreamChunk[] = []
    await assert.rejects(async () => {
      for await (const chunk of createLLMSession(provider, model, [], '').stream([])) chunks.push(chunk)
    })
    assert.equal(chunks.some(chunk => chunk.type === 'tool-call'), false)
  }
})

test('Claude translation preserves tool IDs and does not mutate signed input blocks', () => {
  const message: ChatMessage = { role: 'assistant', content: '', responseItems: [
    { type: 'redacted_thinking', data: 'opaque-fixture' },
    { type: 'tool_use', id: 'call_1', name: 'read_file', input: { path: '/tmp' } }
  ] }
  const before = JSON.stringify(message)
  const result = toAnthropicMessages([message, { role: 'tool', tool_call_id: 'call_1', content: 'ok' }])
  assert.equal(JSON.stringify(message), before)
  assert.equal(result.messages[1].content[0].tool_use_id, 'call_1')
})

test('Claude tool rounds replay signed blocks through the processor and keep request settings stable', async context => {
  const requests: Array<Record<string, any>> = []
  context.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)))
    return fragmentedStream(requests.length === 1 ? events : [
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'done' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' } }, { type: 'message_stop' }
    ])
  })
  const current = { ...model, requestConfig: { maxTokens: 8192, reasoning: 'high' as const } }
  const visible: string[] = []
  const result = await new SessionProcessor({
    provider, model: current, tools: [], messages: [{ role: 'user', content: 'inspect' }],
    onToolExecute: async () => {
      current.requestConfig.maxTokens = 500
      current.requestConfig.reasoning = 'high'
      return { output: 'file contents' }
    },
    onEvent: event => { if (event.type === 'text-delta') visible.push(event.delta) }
  }).process()
  assert.equal(result.finish, 'stop')
  assert.equal(requests.length, 2)
  assert.equal(requests[1].max_tokens, 8192)
  assert.equal(requests[1].messages[1].content[0].signature, 'fixture-signature')
  assert.equal(requests[1].messages[2].content[0].tool_use_id, 'tool_fixture')
  assert.deepEqual(visible, ['检查中文目录', 'done'])
  assert.equal(visible.join('').includes('Private fixture reasoning'), false)
})
