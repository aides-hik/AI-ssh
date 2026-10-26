import test from 'node:test'
import assert from 'node:assert/strict'
import { ExecutionLogBuffer } from './execution-log'

test('live logs isolate selected hosts and keep stream order without allowing snapshot mutation', () => {
  const buffer = new ExecutionLogBuffer()
  buffer.reset(['a', 'b'])
  buffer.append('a', 'stdout', 'A1\n')
  buffer.append('b', 'stderr', 'B error\n')
  buffer.append('unselected', 'stdout', 'must not appear')
  buffer.append('a', 'stdout', 'A2\n')
  buffer.append('a', 'stderr', 'A error\n')
  const logs = buffer.snapshot()
  assert.equal(logs.length, 2)
  assert.deepEqual(logs[0].entries, [{ stream: 'stdout', text: 'A1\nA2\n' }, { stream: 'stderr', text: 'A error\n' }])
  assert.deepEqual(logs[1].entries, [{ stream: 'stderr', text: 'B error\n' }])
  logs[0].entries[0].text = 'changed'
  assert.equal(buffer.snapshot()[0].entries[0].text, 'A1\nA2\n')
})

test('bounded logs keep the latest diagnostics and never split a UTF-8 character', () => {
  const buffer = new ExecutionLogBuffer(31)
  buffer.reset(['a'])
  buffer.append('a', 'stdout', '中🙂'.repeat(30))
  buffer.append('a', 'stderr', '\n最终错误🙂')
  const host = buffer.snapshot()[0]
  const text = host.entries.map(entry => entry.text).join('')
  assert.equal(host.truncated, true)
  assert.ok(new TextEncoder().encode(text).length <= 31)
  assert.equal(text.includes('\ufffd'), false)
  assert.ok(text.endsWith('最终错误🙂'))
})

test('reset clears earlier output and unknown late hosts cannot reappear', () => {
  const buffer = new ExecutionLogBuffer()
  buffer.reset(['old'])
  buffer.append('old', 'stdout', 'earlier request')
  buffer.reset(['new'])
  buffer.append('old', 'stdout', 'late output')
  buffer.append('new', 'stdout', '\x1b[32mready\x1b[0m\rnext\0')
  assert.deepEqual(buffer.snapshot(), [{ targetId: 'new', entries: [{ stream: 'stdout', text: 'ready\nnext' }], truncated: false }])
})

test('color and cursor controls split across live events leave only normal text', () => {
  const buffer = new ExecutionLogBuffer()
  buffer.reset(['a'])
  for (const chunk of ['\x1b[3', '2mready\x1b', '[0m\n', '\x1b[?2', '5l\x1b[2', 'Knext\t', 'value\0']) {
    buffer.append('a', 'stdout', chunk)
  }
  assert.deepEqual(buffer.snapshot()[0].entries, [{ stream: 'stdout', text: 'ready\nnext\tvalue' }])
})

test('unterminated terminal strings do not buffer or expose their payload and resume after split terminators', () => {
  const buffer = new ExecutionLogBuffer()
  buffer.reset(['a'])
  buffer.append('a', 'stdout', 'before\x1b]8;;https://fixture.invalid')
  buffer.append('a', 'stdout', '\x1b')
  buffer.append('a', 'stdout', '\\link\x1b]8;;')
  buffer.append('a', 'stdout', '\x07\x1bP')
  for (let packet = 0; packet < 100; packet++) buffer.append('a', 'stdout', 'hidden'.repeat(1000))
  assert.deepEqual(buffer.snapshot()[0].entries, [{ stream: 'stdout', text: 'beforelink' }])
  buffer.append('a', 'stdout', '\x1b')
  buffer.append('a', 'stdout', '\\after')
  assert.deepEqual(buffer.snapshot()[0], {
    targetId: 'a', entries: [{ stream: 'stdout', text: 'beforelinkafter' }], truncated: false
  })
})

test('fragmented controls are isolated by both host and output stream', () => {
  const buffer = new ExecutionLogBuffer()
  buffer.reset(['a', 'b'])
  buffer.append('a', 'stdout', '\x1b[3')
  buffer.append('a', 'stderr', '2merror\n')
  buffer.append('b', 'stdout', '2mother\n')
  buffer.append('a', 'stdout', '2mready')
  assert.deepEqual(buffer.snapshot().map(host => host.entries), [
    [{ stream: 'stderr', text: '2merror\n' }, { stream: 'stdout', text: 'ready' }],
    [{ stream: 'stdout', text: '2mother\n' }]
  ])
})

test('CRLF split across events produces one newline without sharing carriage return state', () => {
  const buffer = new ExecutionLogBuffer()
  buffer.reset(['a', 'b'])
  buffer.append('a', 'stdout', 'ready\r')
  buffer.append('a', 'stderr', '\nerror')
  buffer.append('b', 'stdout', '\nother')
  buffer.append('a', 'stdout', '\nnext\r')
  buffer.append('a', 'stdout', 'last\r')
  buffer.append('a', 'stdout', '\n')
  assert.deepEqual(buffer.snapshot().map(host => host.entries), [
    [{ stream: 'stdout', text: 'ready\n' }, { stream: 'stderr', text: '\nerror' }, { stream: 'stdout', text: 'next\nlast\n' }],
    [{ stream: 'stdout', text: '\nother' }]
  ])
})

test('reset discards incomplete controls and carriage returns even when the host id is reused', () => {
  const buffer = new ExecutionLogBuffer()
  buffer.reset(['a'])
  buffer.append('a', 'stdout', '\x1b[3')
  buffer.append('a', 'stderr', 'old\r')
  buffer.reset(['a'])
  buffer.append('a', 'stdout', '2mplain')
  buffer.append('a', 'stderr', '\nnew')
  assert.deepEqual(buffer.snapshot()[0].entries, [
    { stream: 'stdout', text: '2mplain' }, { stream: 'stderr', text: '\nnew' }
  ])
})
