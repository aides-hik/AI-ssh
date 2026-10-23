import assert from 'node:assert/strict'
import test from 'node:test'
import { toModelMessages, type ModelMessage } from './convert.ts'
import { createUserMessage, type Message } from './message.ts'
import { ProcessorHistory } from './processor-history.ts'

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
