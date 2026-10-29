import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { EventEmitter } from 'node:events'
import ts from 'typescript'
import { SSHPTYOutput } from '../services/ssh-pty-output'
import { remoteEnvDocument } from '../services/remote-env-document'
import { UpdateServerEnvDocTool } from '../../src/services/tools/ssh-tools'

const sourcePath = new URL('./ssh-handlers.ts', import.meta.url)
const tick = () => new Promise<void>(resolve => setImmediate(resolve))

async function methods(names: string[]) {
  const source = await readFile(sourcePath, 'utf8')
  const parsed = ts.createSourceFile('ssh-handlers.ts', source, ts.ScriptTarget.Latest, true)
  const declaration = parsed.statements.find(statement => ts.isClassDeclaration(statement) && statement.name?.text === 'SSHManager')
  assert(declaration && ts.isClassDeclaration(declaration))
  const selected = declaration.members.filter(member => ts.isMethodDeclaration(member) && member.name && names.includes(member.name.getText(parsed)))
  assert.equal(selected.length, names.length)
  return selected.map(member => member.getText(parsed)).join('\n')
}

async function managerFixture() {
  const selected = await methods(['accessEnvDoc', 'readEnvDoc', 'writeEnvDoc', 'cancelEnvDoc', 'cancelConnectionEnvDocs'])
  const javascript = ts.transpileModule(`class Documents { connections = new Map(); pendingEnvDocs = new Map(); ${selected} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText
  const manager = new Function('remoteEnvDocument', 'randomUUID', javascript + '\nreturn new Documents()')(remoteEnvDocument, () => crypto.randomUUID())
  const calls: string[] = []
  let rename: any
  const channel = Object.assign(new EventEmitter(), {
    _extensions: { 'posix-rename@openssh.com': '1' },
    readFile(_path: string, done: any) { calls.push('read'); done(null, Buffer.from('# Old document')) },
    open(_path: string, _flags: string, _mode: unknown, done: any) { calls.push('open'); done(null, Buffer.from('handle')) },
    write(_handle: Buffer, _data: Buffer, _offset: number, _length: number, _position: number, done: any) { calls.push('write'); done(null) },
    close(_handle: Buffer, done: any) { calls.push('close'); done(null) },
    unlink(_path: string, done: any) { calls.push('unlink'); done(null) },
    ext_openssh_rename(_from: string, _to: string, done: any) { calls.push('rename'); rename = done },
    rename() { assert.fail('Use advertised atomic rename') },
    end() { calls.push('end') }
  })
  manager.connections.set('host-a', { isConnected: true, client: { sftp(done: any) { calls.push('sftp'); done(null, channel) } } })
  manager.getRemoteHome = async () => '/home/test'
  manager.cancelExecute = async (requestId: string) => { calls.push(`cancel:${requestId}`); return true }
  return { manager, calls, channel, finishRename: () => rename(null) }
}

test('main environment cancellation rejects before HOME finishes and never opens SFTP', async () => {
  const { manager, calls } = await managerFixture()
  let resolveHome: any
  manager.getRemoteHome = () => new Promise(resolve => { resolveHome = resolve })
  const pending = manager.writeEnvDoc('host-a', 'new content', 'cancel-home')
  assert.equal(manager.cancelEnvDoc('cancel-home'), true)
  const rejection = assert.rejects(pending, { name: 'AbortError' })
  resolveHome('/home/test')
  await rejection
  assert.deepEqual(calls, ['cancel:cancel-home:home'])
  assert.equal(manager.pendingEnvDocs.size, 0)
})

test('renderer abort reaches main request cancellation and preserves an already committing update', async t => {
  const { manager, calls, finishRename } = await managerFixture()
  const controller = new AbortController()
  const cancellationResults: boolean[] = []
  const requestIds: string[] = []
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', { value: { electronAPI: { ssh: {
    readEnvDoc: (id: string, requestId: string) => manager.readEnvDoc(id, requestId),
    writeEnvDoc: (id: string, content: string, requestId: string) => {
      requestIds.push(requestId)
      return manager.writeEnvDoc(id, content, requestId)
    },
    cancelEnvDoc: async (requestId: string) => {
      requestIds.push(requestId)
      const accepted = manager.cancelEnvDoc(requestId)
      cancellationResults.push(accepted)
      return accepted
    }
  }, docStorage: { save: async () => ({}) } } }, configurable: true, writable: true })
  t.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else delete (globalThis as any).window
  })
  const tool = await UpdateServerEnvDocTool.init()
  const pending = tool.execute({ content: '# New document', force_replace: true }, {
    sessionID: 'session', messageID: 'message', agent: 'test', abort: controller.signal,
    extra: { connectionId: 'host-a' }, metadata() {}
  })
  await tick()
  assert(calls.includes('rename'))
  controller.abort()
  assert.deepEqual(cancellationResults, [false])
  assert.equal(requestIds.length, 2)
  assert.equal(requestIds[0], requestIds[1], 'The renderer must cancel the exact active request')
  finishRename()
  const result = await pending
  assert.equal(result.metadata.committed, true)
  assert.equal(manager.pendingEnvDocs.size, 0)
  assert.equal(calls.includes('unlink'), false)
})

test('PTY connect buffers decoded initial stdout and stderr and flushes each stream once', async () => {
  const selected = await methods(['connect', 'getInitialOutput'])
  const javascript = ts.transpileModule(`class Connections { connections = new Map(); cancelConnectionExecutions() {} ${selected} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText
  const stream = Object.assign(new EventEmitter(), { stderr: new EventEmitter() })
  const sent: Array<{ channel: string; value: unknown }> = []
  class FakeClient extends EventEmitter {
    connect() { this.emit('ready') }
    shell(_options: unknown, done: any) { done(null, stream) }
  }
  const manager = new Function('Client', 'randomUUID', 'createSSHConnectConfig', 'sshHostTrust', 'SSHPTYOutput', 'windowEvents', 'emit', 'Events', javascript + '\nreturn new Connections()')(
    FakeClient, () => 'pty-host', async () => ({}), { prepare: async () => () => true }, SSHPTYOutput,
    { sendToRenderer(channel: string, value: unknown) { sent.push({ channel, value }) } }, () => {}, { SSH_CONNECTED: 'connected' }
  )
  await manager.connect({ host: 'test' })
  sent.length = 0
  const stdout = Buffer.from('中文😀')
  const stderr = Buffer.from('错误❌')
  for (let index = 0; index < Math.max(stdout.length, stderr.length); index++) {
    if (index < stdout.length) stream.emit('data', stdout.subarray(index, index + 1))
    if (index < stderr.length) stream.stderr.emit('data', stderr.subarray(index, index + 1))
  }
  assert.equal(sent.length, 0, 'Output must wait until the terminal claims its initial buffer')
  const initial = await manager.getInitialOutput('pty-host')
  assert.equal([...initial].sort().join(''), [...'中文😀错误❌'].sort().join(''))
  stream.emit('data', Buffer.from('下一行'))
  stream.stderr.emit('data', Buffer.from([0xe4, 0xb8]))
  stream.stderr.emit('end')
  stream.stderr.emit('close')
  stream.emit('close')
  assert.deepEqual(sent.filter(item => item.channel === 'ssh:output:pty-host').map(item => item.value), ['下一行', '�'])
})
