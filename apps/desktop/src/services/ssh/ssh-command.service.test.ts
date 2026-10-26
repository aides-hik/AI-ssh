import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { executeSSHCommand } from './ssh-command.service'
import { sshExecutionTimeout, type SSHExecuteOutputEvent } from './ssh-execution'

function fixture(context: TestContext) {
  const listeners = new Set<(event: SSHExecuteOutputEvent) => void>()
  const historical: Array<(event: SSHExecuteOutputEvent) => void> = []
  const calls: Array<{ id: string; command: string; requestId: string; options: unknown; resolve: (value: unknown) => void }> = []
  const cancelled: string[] = []
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { electronAPI: { ssh: {
    onExecuteOutput(callback: (event: SSHExecuteOutputEvent) => void) {
      listeners.add(callback); historical.push(callback)
      return () => { listeners.delete(callback) }
    },
    execute: async (id: string, command: string, requestId: string, options: unknown) => new Promise(resolve => {
      calls.push({ id, command, requestId, options, resolve })
    }),
    cancelExecute: async (requestId: string) => {
      cancelled.push(requestId)
      calls.find(call => call.requestId === requestId)?.resolve({ success: false, error: 'Command aborted' })
      return true
    }
  } } } })
  context.after(() => {
    if (original) Object.defineProperty(globalThis, 'window', original)
    else Reflect.deleteProperty(globalThis, 'window')
  })
  const publish = (event: SSHExecuteOutputEvent) => { for (const listener of listeners) listener(event) }
  return { listeners, historical, calls, cancelled, publish }
}

test('stream subscriptions are installed before execute and isolate interleaved host requests', async context => {
  const { listeners, calls, publish, historical } = fixture(context)
  const a: SSHExecuteOutputEvent[] = [], b: SSHExecuteOutputEvent[] = []
  const pendingA = executeSSHCommand('host-a', 'a', undefined, { timeoutMs: 10000, onOutput: event => a.push(event) })
  const pendingB = executeSSHCommand('host-b', 'b', undefined, { onOutput: event => b.push(event) })
  assert.equal(listeners.size, 2)
  assert.deepEqual(calls[0].options, { timeoutMs: 10000 })
  publish({ requestId: calls[0].requestId, connectionId: 'host-b', stream: 'stdout', data: 'wrong host' })
  publish({ requestId: 'old-request', connectionId: 'host-a', stream: 'stdout', data: 'wrong request' })
  publish({ requestId: calls[0].requestId, connectionId: 'host-a', stream: 'stdout', data: 'A' })
  publish({ requestId: calls[1].requestId, connectionId: 'host-b', stream: 'stderr', data: 'B diagnostic' })
  assert.equal(a.map(event => event.data).join(''), 'A')
  assert.equal(b.map(event => event.data).join(''), 'B diagnostic')
  calls[0].resolve({ success: true, output: 'A', exitCode: 0 })
  calls[1].resolve({ success: false, output: '', stderr: 'B diagnostic', exitCode: 1 })
  assert.equal((await pendingA).success, true)
  assert.equal((await pendingB).success, false)
  assert.equal(listeners.size, 0)
  for (const callback of historical) callback({ requestId: calls[0].requestId, connectionId: 'host-a', stream: 'stdout', data: 'late' })
  assert.equal(a.length, 1)
})

test('aborting a command cleans its subscription and cannot receive late output', async context => {
  const { listeners, calls, publish, cancelled, historical } = fixture(context)
  const output: SSHExecuteOutputEvent[] = []
  const controller = new AbortController()
  const pending = executeSSHCommand('host-a', 'pull', controller.signal, { onOutput: event => output.push(event) })
  publish({ requestId: calls[0].requestId, connectionId: 'host-a', stream: 'stdout', data: 'first layer' })
  const rejected = assert.rejects(pending, { name: 'AbortError' })
  controller.abort()
  publish({ requestId: calls[0].requestId, connectionId: 'host-a', stream: 'stdout', data: 'late' })
  await rejected
  assert.deepEqual(cancelled, [calls[0].requestId])
  assert.equal(listeners.size, 0)
  historical[0]({ requestId: calls[0].requestId, connectionId: 'host-a', stream: 'stdout', data: 'later' })
  assert.equal(output.map(event => event.data).join(''), 'first layer')
})

test('invalid timeouts never subscribe or invoke the remote bridge', async context => {
  const { calls, listeners } = fixture(context)
  for (const timeoutMs of [0, 9999, 1800001, Infinity, NaN, 10000.5, '10000']) {
    const result = await executeSSHCommand('host-a', 'pull', undefined, { timeoutMs } as never)
    assert.equal(result.success, false)
    assert.match(result.error || '', /超时/)
  }
  assert.equal(calls.length, 0)
  assert.equal(listeners.size, 0)
  assert.equal(sshExecutionTimeout(undefined), 300000)
  assert.equal(sshExecutionTimeout({ timeoutMs: 1800000 }), 1800000)
})

test('a display callback exception cannot mark a successful command failed', async context => {
  const { calls, listeners, publish } = fixture(context)
  const pending = executeSSHCommand('host-a', 'pull', undefined, { onOutput() { throw new Error('display unavailable') } })
  publish({ requestId: calls[0].requestId, connectionId: 'host-a', stream: 'stdout', data: 'progress' })
  calls[0].resolve({ success: true, output: 'complete', exitCode: 0 })
  assert.equal((await pending).success, true)
  assert.equal(listeners.size, 0)
})
