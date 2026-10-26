import assert from 'node:assert/strict'
import test from 'node:test'
import { SSHExecLiveOutput } from './ssh-exec-live-output'
import type { SSHExecuteOutputEvent } from '../../src/services/ssh/ssh-execution'

test('live output batches small packets and keeps UTF-8 split across packets intact', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const events: SSHExecuteOutputEvent[] = []
  const output = new SSHExecLiveOutput('request-a', 'host-a', event => events.push(event))
  const bytes = Buffer.from('状态🙂')
  output.append('stdout', bytes.subarray(0, 2))
  output.append('stderr', Buffer.from('warning'))
  output.append('stdout', bytes.subarray(2))
  assert.equal(events.length, 0)
  context.mock.timers.tick(49)
  assert.equal(events.length, 0)
  context.mock.timers.tick(1)
  assert.equal(events.length, 2)
  assert.equal(events.find(event => event.stream === 'stdout')?.data, '状态🙂')
  assert.equal(events.find(event => event.stream === 'stderr')?.data, 'warning')
  output.finish()
})

test('live output bounds bytes across streams, marks truncation once and omits incomplete characters', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const events: SSHExecuteOutputEvent[] = []
  const output = new SSHExecLiveOutput('request-a', 'host-a', event => events.push(event), 5)
  output.append('stderr', Buffer.from('a'))
  output.append('stdout', Buffer.from('状态'))
  for (let packet = 0; packet < 100; packet++) output.append('stdout', Buffer.alloc(4096))
  output.finish()
  assert.equal(events.map(event => event.data).join(''), 'a状')
  assert.equal(events.filter(event => event.truncated).length, 1)
  assert.equal(events.some(event => event.data.includes('\ufffd')), false)
  context.mock.timers.tick(100)
  assert.equal(events.length, 2)
})

test('dispose suppresses queued and late notifications, including timer callbacks', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const events: SSHExecuteOutputEvent[] = []
  const output = new SSHExecLiveOutput('request-a', 'host-a', event => events.push(event))
  output.append('stdout', Buffer.from('queued'))
  output.dispose()
  context.mock.timers.tick(100)
  output.append('stderr', Buffer.from('late'))
  output.finish()
  assert.deepEqual(events, [])
})

test('live output merges only adjacent packets and preserves stdout stderr arrival order', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const events: SSHExecuteOutputEvent[] = []
  const output = new SSHExecLiveOutput('request-a', 'host-a', event => events.push(event))
  output.append('stdout', Buffer.from('before'))
  output.append('stdout', Buffer.from('\n'))
  output.append('stderr', Buffer.from('error'))
  output.append('stderr', Buffer.from('\n'))
  output.append('stdout', Buffer.from('after'))
  context.mock.timers.tick(50)
  output.append('stderr', Buffer.from('final error'))
  output.append('stdout', Buffer.from('final output'))
  output.finish()
  assert.deepEqual(events.map(({ stream, data }) => ({ stream, data })), [
    { stream: 'stdout', data: 'before\n' },
    { stream: 'stderr', data: 'error\n' },
    { stream: 'stdout', data: 'after' },
    { stream: 'stderr', data: 'final error' },
    { stream: 'stdout', data: 'final output' }
  ])
})

test('interleaved executions retain exact host and request identity without reordering alternating streams', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const events: SSHExecuteOutputEvent[] = []
  const a = new SSHExecLiveOutput('request-a', 'host-a', event => events.push(event))
  const b = new SSHExecLiveOutput('request-b', 'host-b', event => events.push(event))
  for (let packet = 0; packet < 1000; packet++) {
    a.append(packet % 2 ? 'stderr' : 'stdout', Buffer.from('a'))
    b.append('stdout', Buffer.from('b'))
  }
  context.mock.timers.tick(50)
  assert.equal(events.length, 1001, 'only adjacent same-stream packets may coalesce')
  assert.deepEqual(events.filter(event => event.requestId === 'request-a').map(event => event.stream),
    Array.from({ length: 1000 }, (_, index) => index % 2 ? 'stderr' : 'stdout'))
  assert.equal(events.filter(event => event.requestId === 'request-a').every(event => event.connectionId === 'host-a'), true)
  assert.equal(events.find(event => event.requestId === 'request-b')?.data, 'b'.repeat(1000))
  a.finish(); b.finish()
})
