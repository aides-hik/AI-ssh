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
  assert.equal(request[2].content, 'OBSERVED_SERVICE_STATE: healthy')
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
