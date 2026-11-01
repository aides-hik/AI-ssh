import assert from 'node:assert/strict'
import test from 'node:test'
import { compactMessages, filterCompactedMessages, toModelMessages } from './convert'
import { createUserMessage, type Message } from './message'
import { ProcessorHistory } from './processor-history'

test('legacy compaction flags cannot discard user requirements or system summaries', () => {
  const user = createUserMessage('requirements', 'preserve every volume\n'.repeat(400))
  user.info.compacted = true
  user.info.targets = [{ id: 'runtime-a', name: 'Production A', host: 'a.invalid' }]
  const system: Message = {
    info: { id: 'old-summary', role: 'system', createdAt: 1, compacted: true },
    parts: [{ type: 'text', text: '[历史对话摘要]\n' + 'Existing historical requirement\n'.repeat(300) }]
  }
  const obsolete: Message = {
    info: { id: 'replaced', role: 'assistant', createdAt: 2, compacted: true },
    parts: [{ type: 'text', text: 'already replaced by the summary' }]
  }
  const request = new ProcessorHistory().toModelMessages(
    filterCompactedMessages([system, user, obsolete]), 'scope', true
  )
  assert.deepEqual(request, [
    { role: 'system', content: system.parts[0].type === 'text' ? system.parts[0].text : '' },
    { role: 'user', content: '[操作目标: Production A (runtime-a)]\n' + 'preserve every volume\n'.repeat(400) }
  ])
})

function toolMessages(): Message[] {
  return [
    {
      info: { id: 'call', role: 'assistant', createdAt: 2 },
      parts: [{
        type: 'tool', tool: 'execute_ssh_command', callID: 'call_check',
        state: {
          status: 'pending', input: { targetId: 'runtime-a', command: 'check-service --json' },
          metadata: { targetId: 'runtime-a', targetName: 'Production A' }
        }
      }]
    },
    {
      info: { id: 'result', role: 'tool', createdAt: 3 },
      parts: [{
        type: 'tool', tool: 'execute_ssh_command', callID: 'call_check',
        state: { status: 'completed', output: 'OBSERVED_SERVICE_STATE: healthy' }
      }]
    }
  ]
}

test('history summaries combine a pending call with its later standalone result and host identity', () => {
  const messages = [
    createUserMessage('u1', 'Check Production A'), ...toolMessages(),
    createUserMessage('u2', 'Use the observed result')
  ]
  const snapshot = structuredClone(messages)
  const request = new ProcessorHistory().toModelMessages(compactMessages(messages, 1), 'scope', true)
  assert.deepEqual(request.filter(message => message.role === 'user').map(message => message.content), [
    'Check Production A', 'Use the observed result'
  ])
  const summary = request.find(message => message.role === 'assistant')?.content || ''
  assert.match(summary, /Production A \(runtime-a\) \/ completed/)
  assert.match(summary, /check-service --json/)
  assert.match(summary, /OBSERVED_SERVICE_STATE: healthy/)
  assert.equal(summary.includes('pending'), false)
  assert.equal(summary.match(/\[工具 /g)?.length, 1)
  assert.equal(request.some(message => message.tool_calls || message.role === 'tool'), false)
  assert.deepEqual(messages, snapshot)
})

test('compaction does not separate a retained standalone tool result from its call', () => {
  const request = toModelMessages(compactMessages([
    createUserMessage('u1', 'Check'), ...toolMessages(), createUserMessage('u2', 'Continue')
  ], 2))
  assert.equal(request[1].role, 'assistant')
  assert.equal(request[1].tool_calls?.[0].id, 'call_check')
  assert.equal(request[2].role, 'tool')
  assert.equal(request[2].tool_call_id, 'call_check')
  assert.equal(request[2].content, '[服务器: Production A (runtime-a)]\nOBSERVED_SERVICE_STATE: healthy')
  assert.equal(request[3].role, 'user')
})

test('large existing assistant summaries remain intact through repeated compaction and history conversion', () => {
  const fullSummary = '[历史执行记录摘要]\n' + 'Existing observed outcome\n'.repeat(300)
  const summary: Message = {
    info: { id: 'summary', role: 'assistant', createdAt: 1, compacted: true, summary: fullSummary },
    parts: [{ type: 'text', text: fullSummary }]
  }
  let messages = [summary, createUserMessage('u1', 'Keep the previous observations')]
  for (let index = 0; index < 3; index++) {
    messages = compactMessages([
      ...messages,
      { info: { id: `a${index}`, role: 'assistant', createdAt: index + 2 }, parts: [{ type: 'text', text: `New result ${index}` }] },
      createUserMessage(`u${index + 2}`, `Continue ${index}`)
    ], 1)
    const request = new ProcessorHistory().toModelMessages(filterCompactedMessages(messages), 'scope', true)
    assert.equal(request[0].role, 'assistant')
    assert.equal(request[0].content, fullSummary)
    assert.equal(request.filter(message => message.content === fullSummary).length, 1)
    assert.equal(request.filter(message => message.role === 'user').length, index + 2)
  }
})

function completedRound(id: string, output: string): Message {
  return {
    info: { id, role: 'assistant', createdAt: 1, finish: 'stop' },
    parts: [{ type: 'tool', tool: 'read_file', callID: 'reused_call', state: {
      status: 'completed', input: { path: `/srv/${id}` }, output
    } }]
  }
}

test('tool IDs reused in separate rounds keep both paired results and both compacted observations', () => {
  const messages = [
    createUserMessage('user', 'Read both files'),
    completedRound('first', 'FIRST_FILE_OBSERVATION'),
    completedRound('second', 'SECOND_FILE_OBSERVATION'),
    createUserMessage('follow-up', 'Compare the observations')
  ]
  const request = toModelMessages(messages)
  assert.deepEqual(request.filter(message => message.role === 'tool').map(message => message.content), [
    'FIRST_FILE_OBSERVATION', 'SECOND_FILE_OBSERVATION'
  ])
  for (const id of ['first', 'second']) {
    const summary = toModelMessages(compactMessages(messages, 1)).find(message => message.content?.includes('[历史执行记录摘要]'))?.content || ''
    assert.match(summary, new RegExp(`/srv/${id}`))
    assert.match(summary, new RegExp(`${id.toUpperCase()}_FILE_OBSERVATION`))
  }
})

test('incomplete, duplicate and orphaned historical calls become prose instead of invalid tool transcripts', () => {
  const pending = toolMessages()[0]
  const duplicate = completedRound('duplicate', 'Duplicate observation')
  duplicate.parts.push(structuredClone(duplicate.parts[0]))
  const orphan = toolMessages()[1]
  for (const messages of [[pending], [duplicate], [orphan], [pending, createUserMessage('interrupt', 'Stop'), orphan]]) {
    const request = toModelMessages(messages)
    assert.equal(request.some(message => message.tool_calls || message.role === 'tool'), false)
    assert.ok(request.some(message => message.role === 'assistant' && message.content?.includes('[工具 ')))
  }
})

test('plain history joins standalone results to their own call and retains command parameters', () => {
  const messages = toolMessages()
  const request = new ProcessorHistory().toModelMessages(messages, 'new-provider', true)
  assert.equal(request.length, 1)
  assert.equal(request[0].role, 'assistant')
  assert.equal(request[0].tool_calls, undefined)
  assert.match(request[0].content || '', /Production A \(runtime-a\)/)
  assert.match(request[0].content || '', /check-service --json/)
  assert.match(request[0].content || '', /OBSERVED_SERVICE_STATE: healthy/)
  assert.doesNotMatch(request[0].content || '', /\(pending\)/)
})

test('structured tool output limits also bound a single very long line', () => {
  const message = completedRound('long', `<file_content>\nHEAD_${'x'.repeat(60000)}_TAIL\n</file_content>`)
  const request = new ProcessorHistory().toModelMessages([message], 'new-provider', true)
  const summary = request[0].content || ''
  assert.ok(summary.length < 4000, `long single-line result grew to ${summary.length} characters`)
  assert.match(summary, /HEAD_/)
  assert.match(summary, /_TAIL/)
})
