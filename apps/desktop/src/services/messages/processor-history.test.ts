import assert from 'node:assert/strict'
import test from 'node:test'
import { compactMessages, toModelMessages, type ModelMessage } from './convert.ts'
import { createUserMessage, type Message } from './message.ts'
import { ProcessorHistory } from './processor-history.ts'
import { SessionProcessor } from '../processor.ts'
import type { AIModel, AIProvider } from '../../types/ai-providers.types.ts'

function assistant(id: string, toolId = `call_${id}`): Message {
  return {
    info: { id, role: 'assistant', createdAt: 1, finish: 'stop' },
    parts: [
      { type: 'text', text: `Visible answer ${id}` },
      {
        type: 'tool',
        tool: 'read_file',
        callID: toolId,
        state: { status: 'completed', output: `Visible tool result ${id}`, input: { path: id } }
      }
    ]
  }
}

function rawTurn(id: string, opaque = `opaque_${id}`): ModelMessage[] {
  return [
    {
      role: 'assistant',
      content: 'Read first',
      reasoning_content: `reasoning_${id}`,
      reasoning_details: [
        { type: 'reasoning.encrypted', data: opaque, signature: `signature_${id}` }
      ],
      responseItems: [{ type: 'reasoning', encrypted_content: opaque }],
      tool_calls: [
        {
          id: `call_${id}`,
          type: 'function',
          extra_content: { google: { thought_signature: opaque } },
          function: { name: 'read_file', arguments: JSON.stringify({ path: id }) }
        }
      ]
    },
    { role: 'tool', tool_call_id: `call_${id}`, content: `Raw result ${id}` },
    { role: 'assistant', content: `Original final answer ${id}` }
  ]
}

test('processor histories replay complete raw rounds in chronological order across user turns', () => {
  const history = new ProcessorHistory()
  const userOne = createUserMessage('u1', 'First user request')
  const visibleOne = assistant('a1')
  const firstInput = history.toModelMessages([userOne], 'same-model-session', true)
  const firstTurn = [...rawTurn('a1').slice(0, -1), ...rawTurn('a1_second')]
  history.remember('a1', [
    { role: 'system', content: 'original system' },
    ...firstInput,
    ...firstTurn
  ])

  const userTwo = createUserMessage('u2', 'Second user request')
  const secondInput = history.toModelMessages(
    [userOne, visibleOne, userTwo],
    'same-model-session',
    true
  )
  assert.deepEqual(secondInput, [
    ...firstInput,
    ...firstTurn,
    { role: 'user', content: 'Second user request' }
  ])
  history.remember('a2', [...secondInput, ...rawTurn('a2')])

  const finalInput = history.toModelMessages(
    [userOne, visibleOne, userTwo, assistant('a2')],
    'same-model-session',
    true
  )
  assert.deepEqual(finalInput, [...secondInput, ...rawTurn('a2')])
  assert.equal(finalInput.filter(message => message.role === 'user').length, 2)
  assert.equal(finalInput.filter(message => message.role === 'system').length, 0)
})

test('raw state is copied on remember and replay without contaminating visible or serialized state', context => {
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new Error('processor state must not access persistent storage')
    }
  })
  context.after(() => {
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  })

  const history = new ProcessorHistory()
  const user = createUserMessage('u', 'Inspect')
  const visible = assistant('a')
  const input = history.toModelMessages([user], 'scope', true)
  const original = rawTurn('a')
  const expected = structuredClone(original)
  history.remember('a', [...input, ...original])
  assert.ok(original[0].responseItems)
  assert.ok(original[0].tool_calls)
  original[0].responseItems[0].encrypted_content = 'changed externally'
  original[0].tool_calls[0].extra_content = { changed: true }

  const replay = history.toModelMessages([user, visible], 'scope', true)
  assert.deepEqual(replay.slice(1), expected)
  replay[1].reasoning_content = 'changed by processor'
  assert.ok(replay[1].responseItems)
  replay[1].responseItems[0].encrypted_content = 'changed by processor'
  assert.deepEqual(history.toModelMessages([user, visible], 'scope', true).slice(1), expected)
  assert.equal(JSON.stringify(history), '{}')
  assert.doesNotMatch(
    JSON.stringify(visible),
    /opaque_|reasoning_|thought_signature|encrypted_content/
  )
})

test('scope changes discard raw state and cannot resurrect it by returning to a previous scope', () => {
  const history = new ProcessorHistory()
  const user = createUserMessage('u', 'Inspect')
  const visible = assistant('a')
  const input = history.toModelMessages([user], 'provider-endpoint-model-session-A', true)
  history.remember('a', [...input, ...rawTurn('a')])
  assert.equal(
    history.toModelMessages([user, visible], 'provider-endpoint-model-session-A', true).length,
    4
  )

  for (const scope of ['provider-endpoint-model-session-B', 'provider-endpoint-model-session-A']) {
    const switched = history.toModelMessages([user, visible], scope, true)
    assert.equal(switched.length, 2)
    assert.equal(switched[1].role, 'assistant')
    assert.match(
      switched[1].content || '',
      /Visible answer a[\s\S]*工具 read_file[\s\S]*Visible tool result a/
    )
    assert.doesNotMatch(
      JSON.stringify(switched),
      /tool_calls|tool_call_id|opaque_|reasoning_content/
    )
  }
})

test('compaction prunes absent assistant cache entries while preserving retained turns', () => {
  const history = new ProcessorHistory()
  const u1 = createUserMessage('u1', 'One')
  const u2 = createUserMessage('u2', 'Two')
  const firstInput = history.toModelMessages([u1], 'scope', true)
  history.remember('a1', [...firstInput, ...rawTurn('a1')])
  const secondInput = history.toModelMessages([u1, assistant('a1'), u2], 'scope', true)
  history.remember('a2', [...secondInput, ...rawTurn('a2')])

  const compacted = history.toModelMessages([u2, assistant('a2')], 'scope', true)
  assert.deepEqual(compacted, [{ role: 'user', content: 'Two' }, ...rawTurn('a2')])
  const olderRestored = history.toModelMessages(
    [u1, assistant('a1'), u2, assistant('a2')],
    'scope',
    true
  )
  assert.equal(olderRestored[1].tool_calls, undefined)
  assert.match(olderRestored[1].content || '', /Visible answer a1/)
  assert.deepEqual(olderRestored.slice(-3), rawTurn('a2'))
})

test('turn count and total JSON size evict oldest entries rather than previous user histories', () => {
  const history = new ProcessorHistory()
  const visible: Message[] = []
  for (let turn = 0; turn < 11; turn += 1) {
    visible.push(createUserMessage(`u${turn}`, `Request ${turn}`))
    const input = history.toModelMessages(visible, 'scope', true)
    history.remember(`a${turn}`, [...input, ...rawTurn(`a${turn}`)])
    visible.push(assistant(`a${turn}`))
  }
  const replay = history.toModelMessages(visible, 'scope', true)
  assert.equal(replay[1].tool_calls, undefined)
  assert.match(replay[1].content || '', /Visible answer a0/)
  assert.equal(replay.filter(message => message.reasoning_content).length, 10)

  const sized = new ProcessorHistory()
  const first = createUserMessage('u1', 'One')
  const firstInput = sized.toModelMessages([first], 'size-scope', true)
  sized.remember('a1', [...firstInput, ...rawTurn('a1', 'x'.repeat(70000))])
  const second = createUserMessage('u2', 'Two')
  const secondInput = sized.toModelMessages([first, assistant('a1'), second], 'size-scope', true)
  sized.remember('a2', [...secondInput, ...rawTurn('a2', 'y'.repeat(70000))])
  const bounded = sized.toModelMessages(
    [first, assistant('a1'), second, assistant('a2')],
    'size-scope',
    true
  )
  assert.equal(bounded[1].tool_calls, undefined)
  assert.equal(bounded.filter(message => message.reasoning_content).length, 1)
  assert.match(
    bounded.findLast(message => message.reasoning_content)?.reasoning_content || '',
    /a2/
  )
})

test('oversize and incomplete rounds fall back to visible summaries without unsigned tool calls', () => {
  for (const suffix of [
    rawTurn('a', 'x'.repeat(260000)),
    rawTurn('a').slice(0, 1),
    rawTurn('a').slice(0, 2),
    [rawTurn('a')[0], rawTurn('a')[2]],
    [
      { role: 'tool', tool_call_id: 'unmatched', content: 'Output' },
      rawTurn('a')[2]
    ] as ModelMessage[]
  ]) {
    const history = new ProcessorHistory()
    const user = createUserMessage('u', 'Inspect')
    const input = history.toModelMessages([user], 'scope', true)
    history.remember('a', [...input, ...suffix])
    const replay = history.toModelMessages([user, assistant('a')], 'scope', true)
    assert.equal(replay.length, 2)
    assert.equal(replay[1].tool_calls, undefined)
    assert.equal(
      replay.some(message => message.role === 'tool'),
      false
    )
  }
})

test('uncached interrupted assistants and standalone tools become bounded plain text', () => {
  const visible = assistant('a')
  visible.info.finish = 'unknown'
  visible.parts.push({ type: 'reasoning', text: 'Do not replay unsigned private reasoning' })
  visible.parts.push({
    type: 'tool',
    tool: 'execute_ssh_command',
    callID: 'unfinished',
    state: { status: 'aborted', input: { command: 'pwd' } }
  })
  const completed = visible.parts.find(part => part.type === 'tool')
  assert.ok(completed)
  completed.state.output = 'long result '.repeat(2000)
  const standalone: Message = {
    info: { id: 'tool-message', role: 'tool', createdAt: 1 },
    parts: [
      {
        type: 'tool',
        tool: 'list_files',
        callID: 'standalone',
        state: { status: 'completed', output: 'one.txt' }
      }
    ]
  }
  const result = new ProcessorHistory().toModelMessages([visible, standalone], 'scope', true)
  assert.equal(result.length, 2)
  assert.ok(result.every(message => message.role === 'assistant' && !message.tool_calls))
  assert.match(result[0].content || '', /read_file[\s\S]*execute_ssh_command \(aborted\)/)
  assert.ok((result[0].content || '').length < 5000)
  assert.match(result[1].content || '', /list_files[\s\S]*one.txt/)
  assert.doesNotMatch(
    JSON.stringify(result),
    /private reasoning|thought_signature|tool_call_id|"role":"tool"/
  )
})

test('unknown compatible models retain legacy conversion when no opaque state is required', () => {
  const visible = [createUserMessage('u', 'Inspect'), assistant('a')]
  assert.deepEqual(
    new ProcessorHistory().toModelMessages(visible, 'scope'),
    toModelMessages(visible)
  )
})

test('complete user and system instructions survive first requests, cached turns and model switches', () => {
  const instruction = `${'request preface\n'.repeat(260)}MIDDLE_USER_CONSTRAINT: never delete /srv/customer-data\n${'request appendix\n'.repeat(260)}`
  const policy = `${'system context\n'.repeat(300)}MIDDLE_SYSTEM_CONSTRAINT: require deployment approval\n${'system appendix\n'.repeat(300)}`
  assert(instruction.length > 4000)
  assert(policy.length > 4000)
  const system: Message = {
    info: { id: 'system-context', role: 'system', createdAt: 1 },
    parts: [{ type: 'text', text: policy }]
  }
  const user = createUserMessage('long-user', instruction)
  const history = new ProcessorHistory()
  const first = history.toModelMessages([system, user], 'model-a', true)
  assert.deepEqual(first, [
    { role: 'system', content: policy },
    { role: 'user', content: instruction }
  ])
  history.remember('long-answer', [...first, ...rawTurn('long-answer')])
  const visible = [system, user, assistant('long-answer'), createUserMessage('follow-up', 'Continue under the original constraints')]
  const snapshot = structuredClone(visible)
  for (const scope of ['model-a', 'model-b', 'model-a']) {
    const request = history.toModelMessages(visible, scope, true)
    assert.equal(request.find(message => message.role === 'system')?.content, policy)
    assert.equal(request.find(message => message.role === 'user')?.content, instruction)
    assert.equal(request.findLast(message => message.role === 'user')?.content, 'Continue under the original constraints')
  }
  assert.deepEqual(visible, snapshot, 'model conversion must not rewrite the visible or persisted message source')
})

function assertPairedToolCalls(messages: ModelMessage[]): void {
  const pending = new Set<string>()
  for (const message of messages) {
    if (message.role === 'tool') {
      assert(message.tool_call_id && pending.delete(message.tool_call_id), 'every tool result needs its preceding call')
      continue
    }
    assert.equal(pending.size, 0, 'tool calls must be resolved before a later conversation message')
    for (const call of message.tool_calls || []) {
      assert(!pending.has(call.id), 'tool call ids must be unique within a round')
      pending.add(call.id)
    }
  }
  assert.equal(pending.size, 0, 'a request cannot end with unresolved historical tool calls')
}

test('real compaction reaches the processor request with old constraints and matched cached tools, then survives recompaction', async context => {
  const requests: ModelMessage[][] = []
  context.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body))
    assert(Array.isArray(body.messages), 'the real processor must produce chat completion messages')
    requests.push(body.messages)
    return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Visible final answer' }, finish_reason: 'stop' }] })}\n\n`)
  })
  const provider: AIProvider = {
    id: 'context-fixture', name: 'Context fixture', description: '', icon: '', website: '',
    endpoint: 'https://context.fixture.invalid/v1', apiKey: 'fixture-only',
    enabled: true, isDefault: false, models: []
  }
  const model: AIModel = {
    id: 'context-model-a', name: 'Context model', providerId: provider.id, contextWindow: 128000,
    capabilities: { text: true, image: false, functionCall: true, vision: false }
  }
  const oldRequests = Array.from({ length: 6 }, (_, index) =>
    `${'background '.repeat(index === 4 ? 600 : 15)}OLD_CONSTRAINT_${index}: preserve service-${index} and require approval${' appendix'.repeat(index === 4 ? 600 : 15)}`)
  const visible = oldRequests.flatMap((text, index) => [createUserMessage(`u${index}`, text), assistant(`a${index}`)])
  visible.push(createUserMessage('u6', 'Continue while retaining every earlier constraint'))
  const original = structuredClone(visible)
  const history = new ProcessorHistory()
  const beforeLastAnswer = history.toModelMessages(visible.slice(0, -2), 'model-a', true)
  history.remember('a5', [...beforeLastAnswer, ...rawTurn('a5', 'opaque-retained-a5')])
  const compacted = compactMessages(visible, 4)
  assert(compacted.some(message => message.info.role === 'assistant' && message.info.compacted))
  const visibleOutputs: string[] = []
  for (const scope of ['model-a', 'model-b']) {
    const converted = history.toModelMessages(compacted, scope, true)
    await new SessionProcessor({
      provider, model: { ...model, id: `context-${scope}` }, tools: [], messages: converted,
      onEvent: event => { if (event.type === 'text-delta') visibleOutputs.push(event.delta) }
    }).process()
    const request = requests.at(-1)
    assert(request)
    const summary = request.find(message => message.role === 'assistant' && message.content?.includes('[历史执行记录摘要]'))
    assert(summary, 'the actual request must contain the generated history summary')
    assert.match(summary.content || '', /Visible answer a0[\s\S]*read_file[\s\S]*Visible tool result a0/)
    assert.equal(request.some(message => message.role === 'system'), false, 'assistant and remote tool summaries cannot acquire system instruction authority')
    const requestText = request.map(message => message.content || '').join('\n')
    for (let index = 0; index < 5; index += 1) {
      assert(requestText.includes(oldRequests[index]), `compacted request ${index} must retain its complete user constraints`)
    }
    assertPairedToolCalls(request)
    assert.equal(request.findLast(message => message.role === 'user')?.content, 'Continue while retaining every earlier constraint')
    if (scope === 'model-a') {
      assert.deepEqual(request.find(message => message.tool_calls)?.tool_calls?.map(call => call.id), ['call_a5'])
      assert.match(JSON.stringify(request), /opaque-retained-a5/)
    } else {
      assert.doesNotMatch(JSON.stringify(request), /opaque-retained-a5|reasoning_content|tool_call_id|thought_signature/)
    }
  }
  const recompacted = compactMessages([
    ...compacted, assistant('a6'), createUserMessage('u7', 'NEW_CONSTRAINT: keep the audit trail'),
    assistant('a7'), createUserMessage('u8', 'Continue again')
  ], 4)
  await new SessionProcessor({
    provider, model, tools: [], messages: history.toModelMessages(recompacted, 'model-b', true)
  }).process()
  const repeatedRequest = requests.at(-1)
  assert(repeatedRequest)
  const repeatedText = repeatedRequest.map(message => message.content || '').join('\n')
  for (const text of oldRequests) assert(repeatedText.includes(text))
  assert.match(JSON.stringify(repeatedRequest), /NEW_CONSTRAINT: keep the audit trail/)
  assertPairedToolCalls(repeatedRequest)
  assert.deepEqual(visible, original)
  assert.deepEqual(visibleOutputs, ['Visible final answer', 'Visible final answer'])
  assert.doesNotMatch(JSON.stringify(compacted), /opaque-retained-a5|reasoning_content|encrypted_content|thought_signature/)
  assert.equal(JSON.stringify(history), '{}', 'opaque processor state cannot leak through JSON persistence')
})
