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
      config.model.capabilities.functionCall = false
      config.tools.splice(0)
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
    assert.ok(Array.isArray(request.body.tools) && request.body.tools.length === 1)
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

const screenshotDSML = '我再次发起只读检查。\n\n<｜DSML｜calls><｜DSML｜invoke name="inspect_server"><｜DSML｜parameter name="targetId" string="true">5ab2a802-3361-472a-bcb1-35e4d743ba98</｜DSML｜parameter></｜DSML｜invoke></｜DSML｜calls>'
const inspectionInput = { targetId: '5ab2a802-3361-472a-bcb1-35e4d743ba98', checks: ['cpu', 'memory', 'disk', 'services'] }
const inspectionTool = {
  id: 'inspect_server',
  init: async () => ({
    description: 'Inspect selected server using bounded read-only checks',
    parameters: z.object({
      targetId: z.literal(inspectionInput.targetId),
      checks: z.array(z.enum(['cpu', 'memory', 'disk', 'services'])).min(1)
    }),
    execute: async () => ({ title: '', metadata: {}, output: 'fixture' })
  })
}
const inspectionCall = (id = 'native_inspection') => ({
  index: 0, id, type: 'function',
  function: { name: 'inspect_server', arguments: JSON.stringify(inspectionInput) }
})
const rawProtocolResponse = (text = screenshotDSML) => asResponse([
  ...Array.from(text, character => ({ choices: [{ delta: { content: character } }] })),
  { choices: [{ delta: {}, finish_reason: 'stop' }] }
])
const rawProtocolPattern = /<[/]?[｜|]DSML[｜|]/

test('raw screenshot DSML is repaired once using the original schema and executes only a complete native inspection', async context => {
  const requests: Array<Record<string, unknown>> = []
  const visible: string[] = []
  const executions: Array<{ name: string; input: unknown }> = []
  context.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)))
    if (requests.length === 1) return rawProtocolResponse()
    if (requests.length === 2) return asResponse([{ choices: [{ delta: { tool_calls: [inspectionCall()] }, finish_reason: 'tool_calls' }] }])
    return complete()
  })
  const processor = new SessionProcessor({
    provider: provider('deepseek'), model: model('deepseek-v4-pro'), tools: [inspectionTool], maxSteps: 2,
    messages: [{ role: 'system', content: 'Use read-only tools for inspection.' }, { role: 'user', content: '检查当前主机的 CPU、内存、磁盘和运行中的服务' }],
    onToolExecute: async (name, input) => {
      const info = await inspectionTool.init()
      assert.deepEqual(info.parameters.parse(input), inspectionInput)
      executions.push({ name, input })
      return { output: 'All four inspection checks completed' }
    },
    onEvent: event => { if (event.type === 'text-delta') visible.push(event.delta) }
  })
  const result = await processor.process()
  assert.equal(result.finish, 'stop')
  assert.equal(requests.length, 3, 'repair does not consume another tool round or loop indefinitely')
  assert.deepEqual(executions, [{ name: 'inspect_server', input: inspectionInput }])
  assert.doesNotMatch(visible.join(''), rawProtocolPattern)
  assert.doesNotMatch(JSON.stringify(processor.getMessages()), rawProtocolPattern)
  assert.deepEqual(requests[1].tools, requests[0].tools, 'retry must retain required checks and selected target schema')
  const firstMessages = requests[0].messages as Array<{ role: string; content: string }>
  const retryMessages = requests[1].messages as Array<{ role: string; content: string }>
  for (const message of firstMessages) assert.ok(retryMessages.some(candidate => candidate.role === message.role && candidate.content === message.content))
  assert.equal(retryMessages.filter(message => message.role === 'system').length, 2, 'one temporary correction accompanies the original policy')
  assert.ok(retryMessages.filter(message => message.role === 'assistant').every(message => !rawProtocolPattern.test(message.content || '')))
  const finalMessages = requests[2].messages as Array<{ role: string; tool_calls?: Array<{ id: string }> }>
  assert.equal(finalMessages.filter(message => message.role === 'system').length, 1, 'repair instruction is not stored in conversation history')
  assert.deepEqual(finalMessages.find(message => message.tool_calls)?.tool_calls?.map(item => item.id), ['native_inspection'])
})

test('persistent raw tool markup stops with a Chinese error after one repair and never reports success', async context => {
  let requests = 0
  let executions = 0
  const finishes: string[] = []
  const visible: string[] = []
  context.mock.method(globalThis, 'fetch', async () => { requests++; return rawProtocolResponse('<|DSML| calls><|DSML| invoke name="inspect_server">') })
  const processor = new SessionProcessor({
    provider: provider('deepseek'), model: model('deepseek-v4-pro'), tools: [inspectionTool],
    messages: [{ role: 'user', content: 'inspect' }],
    onToolExecute: async () => { executions++; return { output: 'must not execute' } },
    onEvent: event => {
      if (event.type === 'done') finishes.push(event.finish)
      if (event.type === 'text-delta') visible.push(event.delta)
    }
  })
  await assert.rejects(processor.process(), error => error instanceof Error && /[\u4e00-\u9fff]/.test(error.message) && /工具/.test(error.message))
  assert.equal(requests, 2)
  assert.equal(executions, 0)
  assert.deepEqual(finishes, [])
  assert.doesNotMatch(visible.join(''), rawProtocolPattern)
  assert.deepEqual(processor.getMessages(), [{ role: 'user', content: 'inspect' }])
})

test('a repair response that only claims completion cannot succeed without a native tool call', async context => {
  let requests = 0
  let executions = 0
  const visible: string[] = []
  const finishes: string[] = []
  context.mock.method(globalThis, 'fetch', async () => {
    requests++
    return requests === 1 ? rawProtocolResponse() : asResponse([
      { choices: [{ delta: { content: 'CPU、内存、磁盘和服务检查已完成，一切正常。' }, finish_reason: 'stop' }] }
    ])
  })
  const processor = new SessionProcessor({
    provider: provider(), model: model('fixture'), tools: [inspectionTool],
    messages: [{ role: 'user', content: 'inspect' }],
    onToolExecute: async () => { executions++; return { output: 'must not execute' } },
    onEvent: event => {
      if (event.type === 'text-delta') visible.push(event.delta)
      if (event.type === 'done') finishes.push(event.finish)
    }
  })
  await assert.rejects(processor.process(), /工具/)
  assert.equal(requests, 2)
  assert.equal(executions, 0)
  assert.deepEqual(finishes, [])
  assert.doesNotMatch(visible.join(''), /检查已完成|一切正常/)
  assert.doesNotMatch(JSON.stringify(processor.getMessages()), /检查已完成|一切正常/)
})

for (const configuration of ['no-tools', 'tools-disabled'] as const) {
  test(`raw DSML with ${configuration} fails without retrying or executing`, async context => {
    let requests = 0
    let executions = 0
    const currentModel = model('fixture')
    if (configuration === 'tools-disabled') currentModel.capabilities.functionCall = false
    context.mock.method(globalThis, 'fetch', async () => { requests++; return rawProtocolResponse() })
    const processor = new SessionProcessor({
      provider: provider(), model: currentModel, tools: configuration === 'no-tools' ? [] : [inspectionTool],
      messages: [{ role: 'user', content: 'inspect' }],
      onToolExecute: async () => { executions++; return { output: 'must not execute' } }
    })
    await assert.rejects(processor.process(), /工具/)
    assert.equal(requests, 1)
    assert.equal(executions, 0)
  })
}

test('mixed native and raw calls discard the failed batch before any tool execution', async context => {
  let requests = 0
  const executed: string[] = []
  const emittedCalls: string[] = []
  context.mock.method(globalThis, 'fetch', async () => {
    requests++
    if (requests === 1) return asResponse([
      { choices: [{ delta: { tool_calls: [inspectionCall('discarded_native')] } }] },
      { choices: [{ delta: { content: '<｜DSML｜invoke name="inspect_server">' } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }
    ])
    if (requests === 2) return asResponse([{ choices: [{ delta: { tool_calls: [inspectionCall('repaired_native')] }, finish_reason: 'tool_calls' }] }])
    return complete()
  })
  const processor = new SessionProcessor({
    provider: provider(), model: model('fixture'), tools: [inspectionTool],
    messages: [{ role: 'user', content: 'inspect' }],
    onToolExecute: async (_name, _input, id) => { executed.push(id || ''); return { output: 'inspection done' } },
    onEvent: event => { if (event.type === 'tool-call') emittedCalls.push(event.toolCallId) }
  })
  await processor.process()
  assert.equal(requests, 3)
  assert.deepEqual(executed, ['repaired_native'])
  assert.deepEqual(emittedCalls, ['repaired_native'])
  assert.doesNotMatch(JSON.stringify(processor.getMessages()), /discarded_native/)
})

test('protocol repair does not replay a previously completed tool round', async context => {
  let requests = 0
  const executed: string[] = []
  context.mock.method(globalThis, 'fetch', async () => {
    requests++
    if (requests === 1) return asResponse([{ choices: [{ delta: { tool_calls: [inspectionCall('completed_before_repair')] }, finish_reason: 'tool_calls' }] }])
    if (requests === 2) return rawProtocolResponse()
    if (requests === 3) return asResponse([{ choices: [{ delta: { tool_calls: [inspectionCall('completed_after_repair')] }, finish_reason: 'tool_calls' }] }])
    return complete()
  })
  const processor = new SessionProcessor({
    provider: provider(), model: model('fixture'), tools: [inspectionTool], maxSteps: 3,
    messages: [{ role: 'user', content: 'inspect' }],
    onToolExecute: async (_name, _input, id) => { executed.push(id || ''); return { output: `inspection ${id}` } }
  })
  const result = await processor.process()
  assert.equal(result.finish, 'stop')
  assert.equal(requests, 4)
  assert.deepEqual(executed, ['completed_before_repair', 'completed_after_repair'])
  assert.deepEqual(processor.getMessages().filter(message => message.role === 'tool').map(message => message.tool_call_id), executed)
})

test('repair within the last tool round executes once and preserves the step limit', async context => {
  let requests = 0
  const executed: string[] = []
  const finishes: string[] = []
  context.mock.method(globalThis, 'fetch', async () => ++requests === 1 ? rawProtocolResponse() : asResponse([
    { choices: [{ delta: { tool_calls: [inspectionCall()] }, finish_reason: 'tool_calls' }] }
  ]))
  const processor = new SessionProcessor({
    provider: provider(), model: model('fixture'), tools: [inspectionTool], maxSteps: 1,
    messages: [{ role: 'user', content: 'inspect' }],
    onToolExecute: async (_name, _input, id) => { executed.push(id || ''); return { output: 'bounded inspection result' } },
    onEvent: event => { if (event.type === 'done') finishes.push(event.finish) }
  })
  const result = await processor.process()
  assert.equal(requests, 2)
  assert.deepEqual(executed, ['native_inspection'])
  assert.equal(result.finish, 'step-limit')
  assert.deepEqual(finishes, ['tool-calls', 'step-limit'])
  assert.equal(result.messages?.at(-1)?.content, 'bounded inspection result')
})

test('mixed native and raw calls in the repair response never expose or execute the failed batch', async context => {
  let requests = 0
  const toolEvents: string[] = []
  context.mock.method(globalThis, 'fetch', async () => ++requests === 1 ? rawProtocolResponse() : asResponse([
    { choices: [{ delta: { tool_calls: [inspectionCall('invalid_repair_call')] } }] },
    { choices: [{ delta: { content: '<|DSML|invoke name="inspect_server">' } }] },
    { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }
  ]))
  const processor = new SessionProcessor({
    provider: provider(), model: model('fixture'), tools: [inspectionTool],
    messages: [{ role: 'user', content: 'inspect' }],
    onToolExecute: async () => { assert.fail('mixed repair batch must not execute') },
    onEvent: event => { if (event.type === 'tool-call' || event.type === 'tool-start' || event.type === 'done') toolEvents.push(event.type) }
  })
  await assert.rejects(processor.process(), /工具/)
  assert.equal(requests, 2)
  assert.deepEqual(toolEvents, [])
  assert.deepEqual(processor.getMessages(), [{ role: 'user', content: 'inspect' }])
})

test('cancellation during a raw protocol response does not dispatch a repair request', async context => {
  const controller = new AbortController()
  let requests = 0
  let executions = 0
  let cancelled = false
  context.mock.method(globalThis, 'fetch', async () => {
    requests++
    return new Response(new ReadableStream({
      start(stream) {
        stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: screenshotDSML } }] })}\n\n`))
      },
      cancel() {
        cancelled = true
        controller.abort()
      }
    }))
  })
  const processor = new SessionProcessor({
    provider: provider(), model: model('fixture'), tools: [inspectionTool], abortSignal: controller.signal,
    messages: [{ role: 'user', content: 'inspect' }],
    onToolExecute: async () => { executions++; return { output: 'must not execute' } }
  })
  await assert.rejects(processor.process(), { name: 'AbortError' })
  assert.equal(cancelled, true)
  assert.equal(requests, 1)
  assert.equal(executions, 0)
})
