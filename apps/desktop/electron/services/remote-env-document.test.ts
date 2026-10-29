import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import type { Client } from 'ssh2'
import { remoteEnvDocument } from './remote-env-document'

const tick = () => new Promise<void>(resolve => setImmediate(resolve))
const cancelled = () => Object.assign(new Error('cancelled document'), { name: 'AbortError' })

function fixture() {
  const calls: string[] = []
  const channel = Object.assign(new EventEmitter(), {
    _extensions: { 'posix-rename@openssh.com': '1' },
    end() { calls.push('end') },
    readFile(_path: string, done: any) { calls.push('read'); done(null, Buffer.from('旧文档')) },
    open(_path: string, _flags: string, _mode: unknown, done: any) { calls.push('open'); done(null, Buffer.from('handle')) },
    write(_handle: Buffer, _bytes: Buffer, _offset: number, _length: number, _position: number, done: any) { calls.push('write'); done(null) },
    close(_handle: Buffer, done: any) { calls.push('close'); done(null) },
    unlink(_path: string, done: any) { calls.push('unlink'); done(null) },
    ext_openssh_rename(_from: string, _to: string, done: any) { calls.push('rename'); done(null) },
    rename(_from: string, _to: string, done: any) { calls.push('rename'); done(null) }
  })
  const client = { sftp(done: any) { calls.push('sftp'); done(null, channel) } }
  const controller = new AbortController()
  const options = { client: client as unknown as Client, home: '/home/测试/', signal: controller.signal,
    beginCommit() { controller.signal.throwIfAborted(); calls.push('commit') } }
  return { channel, client, controller, options, calls }
}

test('environment reads decode UTF-8 and close their dedicated SFTP session', async () => {
  const { options, calls } = fixture()
  assert.deepEqual(await remoteEnvDocument(options), { content: '旧文档', fullPath: '/home/测试/env.md' })
  assert.deepEqual(calls, ['sftp', 'read', 'end'])
})

test('cancellation before SFTP readiness closes a late channel without starting any file operation', async () => {
  const { client, channel, controller, options, calls } = fixture()
  let ready: any
  client.sftp = done => { ready = done }
  const pending = remoteEnvDocument({ ...options, content: 'new' })
  const rejection = assert.rejects(pending, { name: 'AbortError' })
  controller.abort(cancelled())
  await rejection
  ready(null, channel)
  assert.deepEqual(calls, ['end'])
})

test('cancelled read rejects even when its late response succeeds', async () => {
  const { channel, controller, options, calls } = fixture()
  let read: any
  channel.readFile = (_path, done) => { read = done; calls.push('read') }
  const pending = remoteEnvDocument(options)
  await tick()
  const rejection = assert.rejects(pending, { name: 'AbortError' })
  controller.abort(cancelled())
  await rejection
  read(null, Buffer.from('late'))
  assert.deepEqual(calls, ['sftp', 'read', 'end'])
})

test('cancellation while a temporary chunk is in flight prevents later writes and rename', async () => {
  const { channel, controller, options, calls } = fixture()
  let write: any
  channel.write = (_handle, _bytes, _offset, _length, _position, done) => { write = done; calls.push('write') }
  const pending = remoteEnvDocument({ ...options, content: '文'.repeat(100000) })
  await tick()
  const rejection = assert.rejects(pending, { name: 'AbortError' })
  controller.abort(cancelled())
  await rejection
  write(null)
  await tick()
  assert.equal(calls.filter(call => call === 'write').length, 1)
  assert.equal(calls.includes('rename'), false)
  assert.equal(calls.includes('commit'), false)
  assert.deepEqual(calls.slice(-3), ['close', 'unlink', 'end'])
})

test('cancellation during OPEN cleans the eventual owned temporary file without writing it', async () => {
  const { channel, controller, options, calls } = fixture()
  let open: any
  channel.open = (_path, _flags, _mode, done) => { open = done; calls.push('open') }
  const pending = remoteEnvDocument({ ...options, content: 'new' })
  await tick()
  const rejection = assert.rejects(pending, { name: 'AbortError' })
  controller.abort(cancelled())
  await rejection
  assert.equal(calls.includes('end'), false, 'The late handle still needs its channel for cleanup')
  open(null, Buffer.from('late-handle'))
  await tick()
  assert.deepEqual(calls, ['sftp', 'open', 'close', 'unlink', 'end'])
})

test('successful rename remains successful after cancellation arrives during commit', async () => {
  const { channel, controller, options, calls } = fixture()
  let rename: any
  channel.ext_openssh_rename = (_from, _to, done) => { rename = done; calls.push('rename') }
  const pending = remoteEnvDocument({ ...options, content: '新文档😀' })
  await tick()
  assert(calls.includes('commit'))
  controller.abort(cancelled())
  rename(null)
  assert.deepEqual(await pending, { content: '新文档😀', fullPath: '/home/测试/env.md' })
  assert.equal(calls.includes('unlink'), false)
})

test('rename failures preserve the real failure and remove only the temporary file', async () => {
  const { channel, options, calls } = fixture()
  channel.ext_openssh_rename = (_from, _to, done) => done(new Error('rename denied'))
  await assert.rejects(remoteEnvDocument({ ...options, content: 'new' }), /rename denied/)
  assert.deepEqual(calls.slice(-2), ['unlink', 'end'])
})
