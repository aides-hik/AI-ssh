import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import fs from 'node:fs/promises'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { Client, Server, utils } from 'ssh2'
import { SSHExecOutput } from '../services/ssh-exec-output'
import { SSHExecLiveOutput } from '../services/ssh-exec-live-output'
import { sshExecutionTimeout, type SSHExecuteOutputEvent } from '../../src/services/ssh/ssh-execution'

const currentDir = dirname(fileURLToPath(import.meta.url))
const sshHandlersPath = join(currentDir, 'ssh-handlers.ts')
const sshTreeServicePath = join(currentDir, '../services/ssh-tree.service.ts')

async function loadAuthentication(home: string, environment: Record<string, string> = {}, platform = 'win32') {
  const source = await readFile(sshHandlersPath, 'utf8')
  const parsed = ts.createSourceFile('ssh-handlers.ts', source, ts.ScriptTarget.Latest, true)
  const declarations = parsed.statements.filter(statement => ts.isFunctionDeclaration(statement) &&
    ['normalizeCredential', 'createSSHConnectConfig'].includes(statement.name?.text || ''))
  assert.equal(declarations.length, 2)
  const javascript = ts.transpileModule(declarations.map(item => item.getText(parsed)).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText
  return new Function('fs', 'path', 'homedir', 'process', javascript + '\nreturn createSSHConnectConfig')(
    fs, path, () => home, { env: environment, platform }
  )
}

test('SSH key authentication reads Chinese file paths and expands the current user home', async t => {
  const home = await mkdtemp(join(tmpdir(), 'ai-ssh-auth-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  await mkdir(join(home, '.ssh'))
  const key = Buffer.from('PRIVATE KEY FIXTURE CONTENT\n')
  await writeFile(join(home, '.ssh', '中文 key.pem'), key)
  const configure = await loadAuthentication(home)
  for (const filename of [join(home, '.ssh', '中文 key.pem'), '~/.ssh/中文 key.pem']) {
    const result = await configure({ authType: 'PRIVATE_KEY', privateKey: filename, passphrase: 'protected', password: 'stale-password' })
    assert.deepEqual(result.privateKey, key)
    assert.equal(result.passphrase, 'protected')
    assert.equal(result.password, undefined, 'Selecting a key must not silently authenticate using a saved password')
  }
  await assert.rejects(configure({ authType: 'privateKey', privateKey: join(home, 'missing-key') }), /ENOENT/)
})

test('SSH authentication preserves pasted key contents and obeys the selected method', async () => {
  const configure = await loadAuthentication(tmpdir())
  const key = '-----BEGIN OPENSSH PRIVATE KEY-----\nfixture\n-----END OPENSSH PRIVATE KEY-----'
  assert.equal((await configure({ privateKey: key })).privateKey, key)
  const result = await configure({ authType: 'PASSWORD', password: 12345, privateKey: 'stale-missing-file' })
  assert.equal(result.password, '12345')
  assert.equal(result.privateKey, undefined)
})

test('SSH Agent uses an explicit socket or the Windows OpenSSH named pipe without a password fallback', async () => {
  const socket = '\\\\.\\pipe\\disposable-ai-ssh-agent'
  const configure = await loadAuthentication(tmpdir(), { SSH_AUTH_SOCK: socket })
  const result = await configure({ authType: 'SSH_AGENT', password: 'stale', privateKey: 'missing-file' })
  assert.equal(result.agent, socket)
  assert.equal(result.password, undefined)
  assert.equal(result.privateKey, undefined)
  const windows = await loadAuthentication(tmpdir())
  assert.equal((await windows({ authType: 'agent' })).agent, '\\\\.\\pipe\\openssh-ssh-agent')
  const unix = await loadAuthentication(tmpdir(), {}, 'linux')
  await assert.rejects(unix({ authType: 'agent' }), /SSH_AUTH_SOCK/)
})

test('a passphrase-protected key at a Chinese path authenticates with a real loopback SSH server', { timeout: 20000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-ssh-private-auth-'))
  const passphrase = randomBytes(24).toString('base64url')
  const privateKey = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem', cipher: 'aes-256-cbc', passphrase },
    publicKeyEncoding: { type: 'pkcs1', format: 'pem' }
  }).privateKey
  const publicKey = utils.parseKey(privateKey, passphrase)
  assert(!(publicKey instanceof Error) && !Array.isArray(publicKey))
  const hostKey = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'pkcs1', format: 'pem' }
  }).privateKey
  const parsedHostKey = utils.parseKey(hostKey)
  assert(!(parsedHostKey instanceof Error) && !Array.isArray(parsedHostKey))
  const filename = join(directory, '中文 私钥.pem')
  await writeFile(filename, privateKey, { mode: 0o600 })
  const clients = new Set<Client>()
  const sockets = new Set<import('ssh2').Connection>()
  let authenticated = 0
  const server = new Server({ hostKeys: [hostKey] }, socket => {
    sockets.add(socket)
    socket.on('error', () => {})
    socket.on('close', () => sockets.delete(socket))
    socket.on('authentication', context => {
      if (context.method !== 'publickey' || context.username !== 'key-test' ||
        !context.key.data.equals(publicKey.getPublicSSH())) {
        context.reject()
        return
      }
      if (context.signature && (!context.blob || publicKey.verify(context.blob, context.signature, context.hashAlgo) !== true)) {
        context.reject()
        return
      }
      context.accept()
    })
    socket.on('ready', () => { authenticated++ })
  })
  t.after(async () => {
    for (const client of clients) client.destroy()
    for (const socket of sockets) socket.end()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await rm(directory, { recursive: true, force: true })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  assert(address && typeof address === 'object')
  const configure = await loadAuthentication(directory)
  const settings = await configure({
    host: '127.0.0.1', port: address.port, username: 'key-test',
    authType: 'PRIVATE_KEY', privateKey: filename, passphrase, keepAlive: false, timeout: 3
  })
  const connect = (credentials: typeof settings) => new Promise<void>((resolve, reject) => {
    const client = new Client()
    clients.add(client)
    client.once('ready', () => { client.end(); resolve() })
    client.on('error', reject)
    client.once('close', () => clients.delete(client))
    client.connect({
      ...credentials,
      hostVerifier: (received: Buffer) => received.equals(parsedHostKey.getPublicSSH())
    })
  })
  await connect(settings)
  assert.equal(authenticated, 1, 'The fixture must accept an actual signed SSH authentication')
  await assert.rejects(connect({ ...settings, passphrase: 'incorrect-passphrase' }))
  assert.equal(authenticated, 1, 'A wrong passphrase must not create a second authenticated session')
})

async function loadTransfers() {
  const source = await readFile(sshHandlersPath, 'utf8')
  const parsed = ts.createSourceFile('ssh-handlers.ts', source, ts.ScriptTarget.Latest, true)
  const declaration = parsed.statements.find(statement => ts.isClassDeclaration(statement) && statement.name?.text === 'SSHManager')
  assert(declaration && ts.isClassDeclaration(declaration))
  const names = new Set(['transferFile', 'uploadFile', 'downloadFile', 'cancelTransfer', 'cancelConnectionTransfers'])
  const methods = declaration.members.filter(member => ts.isMethodDeclaration(member) && member.name && names.has(member.name.getText(parsed)))
  assert.equal(methods.length, names.size)
  const javascript = ts.transpileModule(`class Transfers { connections = new Map(); pendingTransfers = new Map(); ${methods.map(item => item.getText(parsed)).join('\n')} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText
  return new Function('fs', 'path', 'windowEvents', 'randomUUID', javascript + '\nreturn new Transfers()')(
    fs, path, { sendToRenderer() {} }, () => 'generated-transfer-id'
  )
}

test('transfer cancellation before SFTP readiness rejects and closes the eventual dedicated channel', async () => {
  const manager = await loadTransfers()
  let ready: any
  let closed = 0
  manager.connections.set('connection', { isConnected: true, client: { sftp(callback: any) { ready = callback } } })
  const pending = manager.uploadFile('connection', 'local', 'remote', 'early-cancel')
  const rejected = assert.rejects(pending, { name: 'AbortError' })
  assert.equal(manager.cancelTransfer('early-cancel'), true)
  await rejected
  ready(null, { end() { closed++ }, fastPut() { assert.fail('A cancelled transfer must not start') } })
  assert.equal(closed, 1)
  assert.equal(manager.pendingTransfers.size, 0)
  assert.equal(manager.cancelTransfer('early-cancel'), false)
})

test('cancelling one active upload preserves another transfer and disconnect clears remaining work', async () => {
  const manager = await loadTransfers()
  const channels: any[] = []
  manager.connections.set('connection', { isConnected: true, client: { sftp(callback: any) {
    const channel = { closed: false, end() { this.closed = true }, on() {}, once() {}, fastPut() {} }
    channels.push(channel)
    callback(null, channel)
  } } })
  const first = manager.uploadFile('connection', 'local-a', 'remote-a', 'first')
  const second = manager.uploadFile('connection', 'local-b', 'remote-b', 'second')
  const rejections = [assert.rejects(first, { name: 'AbortError' }), assert.rejects(second, { name: 'AbortError' })]
  assert.equal(manager.cancelTransfer('first'), true)
  assert.equal(channels[0].closed, true)
  assert.equal(channels[1].closed, false)
  assert.equal(manager.pendingTransfers.size, 1)
  manager.cancelConnectionTransfers('connection')
  await Promise.all(rejections)
  assert.equal(channels[1].closed, true)
  assert.equal(manager.pendingTransfers.size, 0)
})

async function loadStructuredListing() {
  const source = await readFile(sshHandlersPath, 'utf8')
  const parsed = ts.createSourceFile('ssh-handlers.ts', source, ts.ScriptTarget.Latest, true)
  const declaration = parsed.statements.find(statement =>
    ts.isClassDeclaration(statement) && statement.name?.text === 'SSHManager'
  )
  assert(declaration && ts.isClassDeclaration(declaration))
  const names = new Set([
    'escapeShellSingleQuotes', 'sortListedFiles', 'parseStructuredListOutput',
    'displayNameFromIdentity', 'buildStructuredListCommand'
  ])
  const methods = declaration.members.filter(member =>
    ts.isMethodDeclaration(member) && member.name && names.has(member.name.getText(parsed))
  )
  assert.equal(methods.length, names.size, 'Execute the actual product command builder and parser')
  const javascript = ts.transpileModule(
    `class Listing { ${methods.map(member => member.getText(parsed)).join('\n')} }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }
  ).outputText
  return new Function('Buffer', javascript + '\nreturn new Listing()')(Buffer)
}

function findGnuShell() {
  let shell = 'sh'
  const env = { ...process.env }
  if (process.platform === 'win32') {
    const git = spawnSync('where.exe', ['git'], { encoding: 'utf8', windowsHide: true })
      .stdout?.trim().split(/\r?\n/)[0]
    if (!git) return null
    const bin = resolve(dirname(git), '..', 'usr', 'bin')
    shell = join(bin, 'sh.exe')
    if (!existsSync(shell)) return null
    env.PATH = `${bin};${env.PATH || ''}`
  }
  const tools = spawnSync(shell, ['-c', 'stat --version && find --version'], {
    env, encoding: 'utf8', windowsHide: true
  })
  if (tools.status !== 0 || !tools.stdout.includes('GNU coreutils') || !tools.stdout.includes('GNU findutils')) {
    return null
  }
  return { shell, env }
}

test('structured listing executes GNU tools and parses names, type, size and raw identities', async t => {
  const tools = findGnuShell()
  if (!tools) return t.skip('GNU sh/find/stat are unavailable on this host')
  const workspace = await mkdtemp(join(tmpdir(), 'ai-ssh-listing-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))
  const remotePath = "./带空格和'单引号的目录"
  const directory = join(workspace, remotePath)
  const payload = '真实 GNU stat 分隔符\n'
  await mkdir(join(directory, '子目录'), { recursive: true })
  await writeFile(join(directory, "空 格'中文.txt"), payload)
  await writeFile(join(directory, '-leading-dash.txt'), '')
  const listing = await loadStructuredListing()
  const result = spawnSync(tools.shell, ['-c', listing.buildStructuredListCommand(remotePath)], {
    cwd: workspace, env: tools.env, encoding: 'utf8', windowsHide: true
  })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.trim().split('\n').length, 3)
  for (const row of result.stdout.trim().split('\n')) assert.equal(row.split('\t').length, 5)
  const files = listing.parseStructuredListOutput(result.stdout)
  assert.equal(files[0].name, '子目录')
  assert.equal(files[0].type, 'directory')
  const file = files.find((entry: any) => entry.name === "空 格'中文.txt")
  assert(file)
  assert.equal(file.type, 'file')
  assert.equal(file.size, Buffer.byteLength(payload))
  assert.equal(Buffer.from(file.identity, 'base64').toString(), `${remotePath}/空 格'中文.txt`)
  assert(Number.isFinite(Date.parse(file.modifiedTime)))
  assert(Number.isFinite(file.permissions))
})

test('structured listing reports stat failures as a command failure instead of an empty directory', async t => {
  const tools = findGnuShell()
  if (!tools) return t.skip('GNU sh/find/stat are unavailable on this host')
  const workspace = await mkdtemp(join(tmpdir(), 'ai-ssh-stat-failure-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))
  await mkdir(join(workspace, 'files'))
  await writeFile(join(workspace, 'files', 'test.txt'), 'payload')
  await mkdir(join(workspace, 'failing-tools'))
  await writeFile(join(workspace, 'failing-tools', 'stat'), '#!/bin/sh\nexit 37\n', { mode: 0o755 })
  const listing = await loadStructuredListing()
  const result = spawnSync(tools.shell, [
    '-c', `PATH="$PWD/failing-tools:$PATH"; export PATH; ${listing.buildStructuredListCommand('./files')}`
  ], { cwd: workspace, env: tools.env, encoding: 'utf8', windowsHide: true })
  assert.notEqual(result.status, 0, 'The caller must be able to fall back to SFTP')
  assert.equal(result.stdout, '')
})

test('non-PTY exec preserves prompt-like data, matching command text and all leading or trailing newlines', async () => {
  const { manager, events } = await loadExecutions()
  const streams: ReturnType<typeof executionStream>[] = []
  manager.connections.set('host-a', { isConnected: true, client: { exec(_command: string, callback: (error: Error | null, channel: ReturnType<typeof executionStream>) => void) {
    const stream = executionStream()
    streams.push(stream)
    callback(null, stream)
  } } })
  const outputs = ['rate:95%', '<state>', 'price:$5#', 'hostname\nfixture-host\n', '\n\nstatus\n\n']
  for (const [index, output] of outputs.entries()) {
    const pending = manager.execute('host-a', 'hostname', `raw-output-${index}`)
    streams[index].emit('data', Buffer.from(output))
    streams[index].emit('exit', 0)
    streams[index].emit('close')
    const result = await pending
    assert.equal(result.output, output)
    assert.equal(result.stdout, output)
  }
  assert.deepEqual(events.filter(event => event.event === 'completed').map(event => event.payload.output), outputs)
})

test('listFiles prefers structured exec output and falls back to SFTP when needed', async () => {
  const source = await readFile(sshHandlersPath, 'utf8')

  assert.match(
    source,
    /private async listFilesViaExec\(id: string, remotePath: string\): Promise<any\[] \| null>/
  )
  assert.match(source, /private escapeShellSingleQuotes\(value: string\): string \{/)
  assert.match(source, /const execFiles = await this\.listFilesViaExec\(id, remotePath\)/)
  assert.match(source, /if \(execFiles !== null\) \{[\s\S]*return execFiles/)
  assert.match(source, /console\.warn\('\[SSHManager\] \[listFiles\] exec 列目录失败，回退 SFTP'/)
  assert.match(source, /const execCommand = this\.buildStructuredListCommand\(remotePath\)/)
  assert.match(source, /const execResult = await this\.executeSilent\(id, execCommand\)/)
  assert.match(source, /return this\.listFilesViaSftp\(id, remotePath, startTime\)/)
})

test('listFiles treats empty exec output as an empty directory instead of falling back', async () => {
  const source = await readFile(sshHandlersPath, 'utf8')

  assert.match(source, /if \(!execResult\.success\) \{[\s\S]*return null/)
  assert.match(source, /const output = \(execResult\.output \|\| ''\)\.trim\(\)/)
  assert.match(source, /if \(!output\) \{[\s\S]*return \[\]/)
  assert.doesNotMatch(source, /!execResult\.success \|\| !execResult\.output/)
})

test('listFiles prefers a dedicated persistent shell channel before exec and SFTP fallbacks', async () => {
  const source = await readFile(sshHandlersPath, 'utf8')

  assert.match(source, /private fileListShellChannels: Map<string, any> = new Map\(\)/)
  assert.match(source, /private async getFileListShell\(id: string\): Promise<any>/)
  assert.match(source, /private async executeOnFileListShell\(id: string, command: string\)/)
  assert.match(
    source,
    /const shellFiles = await this\.listFilesViaPersistentShell\(id, remotePath\)/
  )
  assert.match(source, /if \(shellFiles !== null\) \{[\s\S]*return shellFiles/)
  assert.match(source, /const execFiles = await this\.listFilesViaExec\(id, remotePath\)/)
  assert.match(source, /if \(execFiles !== null\) \{[\s\S]*return execFiles/)
  assert.match(source, /return this\.listFilesViaSftp\(id, remotePath, startTime\)/)
})

test('listFiles no longer runs exec diagnostics after successful listings', async () => {
  const source = await readFile(sshHandlersPath, 'utf8')

  assert.doesNotMatch(source, /private async runListFilesExecDiagnostic\(/)
  assert.doesNotMatch(source, /exec 对照诊断完成/)
  assert.doesNotMatch(source, /exec 对照诊断异常/)
})

test('getConnections exposes a serializable lastUsed string shape', async () => {
  const source = await readFile(sshHandlersPath, 'utf8')

  assert.match(
    source,
    /type SerializedSSHConnection = Omit<[\s\S]*'client' \| 'shell' \| 'sftp' \| 'password' \| 'privateKey' \| 'passphrase' \| 'lastUsed'[\s\S]*> & \{/
  )
  assert.match(source, /lastUsed: string/)
  assert.match(source, /getConnections\(\): SerializedSSHConnection\[]/)
  assert.match(source, /lastUsed: conn\.lastUsed\.toISOString\(\)/)
})

async function loadExecutions() {
  const source = await readFile(sshHandlersPath, 'utf8')
  const parsed = ts.createSourceFile('ssh-handlers.ts', source, ts.ScriptTarget.Latest, true)
  const declaration = parsed.statements.find(statement => ts.isClassDeclaration(statement) && statement.name?.text === 'SSHManager')
  assert(declaration && ts.isClassDeclaration(declaration))
  const names = new Set(['execute', 'cancelExecute', 'createCommandAbortError', 'cancelConnectionExecutions', 'disconnect'])
  const methods = declaration.members.filter(member => ts.isMethodDeclaration(member) && member.name && names.has(member.name.getText(parsed)))
  assert.equal(methods.length, names.size)
  const javascript = ts.transpileModule(`class Executions { connections = new Map(); pendingExecs = new Map(); closeFileListShell() {} cancelConnectionTransfers() {} ${methods.map(item => item.getText(parsed)).join('\n')} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText
  const timers: Array<() => void> = []
  const events: Array<{ event: string; payload: any }> = []
  let execution = 0
  const manager = new Function('SSHExecOutput', 'SSHExecLiveOutput', 'sshExecutionTimeout', 'randomUUID', 'emit', 'Events', 'setTimeout', 'clearTimeout', javascript + '\nreturn new Executions()')(
    SSHExecOutput, SSHExecLiveOutput, sshExecutionTimeout, () => `internal-${++execution}`, (event: string, payload: any) => events.push({ event, payload }),
    { SSH_COMMAND_STARTED: 'started', SSH_COMMAND_COMPLETED: 'completed', SSH_DISCONNECTED: 'disconnected' },
    (callback: () => void) => { timers.push(callback); return timers.length }, () => {}
  )
  return { manager, timers, events }
}

function executionStream() {
  const emitter = new EventEmitter()
  const stream = Object.assign(emitter, {
    stderr: new EventEmitter(), closed: 0, signals: [] as string[],
    close() { this.closed++; emitter.emit('close') },
    signal(name: string) { this.signals.push(name) }
  })
  return stream
}

test('execute cancellation before channel readiness rejects and closes the eventual channel', async () => {
  const { manager } = await loadExecutions()
  let ready: any
  manager.connections.set('host-a', { isConnected: true, client: { exec(_command: string, callback: any) { ready = callback } } })
  const pending = manager.execute('host-a', 'uptime', 'early')
  const rejection = assert.rejects(pending, { name: 'AbortError' })
  assert.equal(await manager.cancelExecute('early'), true)
  await rejection
  const stream = executionStream()
  ready(null, stream)
  assert.equal(stream.closed, 1)
  assert.equal(manager.pendingExecs.size, 0)
})

test('execute uses exit status, preserves stderr warnings and reports unknown or failed exits', async () => {
  const { manager } = await loadExecutions()
  const streams: ReturnType<typeof executionStream>[] = []
  manager.connections.set('host-a', { isConnected: true, client: { exec(_command: string, callback: any) {
    const stream = executionStream(); streams.push(stream); callback(null, stream)
  } } })
  const success = manager.execute('host-a', 'uptime', 'ok')
  streams[0].emit('data', Buffer.from('all good\n'))
  streams[0].stderr.emit('data', Buffer.from('warning\n'))
  streams[0].emit('exit', 0)
  streams[0].emit('close')
  const result = await success
  assert.equal(result.success, true)
  assert.equal(result.stdout, 'all good\n')
  assert.equal(result.stderr, 'warning\n')
  assert.equal(result.exitCode, 0)
  assert.equal(result.error, undefined)
  assert.equal(result.truncated, false)
  assert(result.durationMs >= 0)
  const failure = manager.execute('host-a', 'false', 'failed')
  streams[1].emit('exit', 17)
  streams[1].emit('close')
  assert.match((await failure).error, /17/)
  const unknown = manager.execute('host-a', 'uptime', 'unknown')
  streams[2].emit('close')
  assert.equal((await unknown).success, false)
  assert.equal(manager.pendingExecs.size, 0)
})

test('disconnect rejects only that host commands, including executions without a caller request id', async () => {
  const { manager } = await loadExecutions()
  const streams = new Map<string, ReturnType<typeof executionStream>>()
  for (const id of ['host-a', 'host-b']) {
    manager.connections.set(id, { isConnected: true, client: { end() {}, exec(_command: string, callback: any) {
      const stream = executionStream(); streams.set(id, stream); callback(null, stream)
    } } })
  }
  const first = manager.execute('host-a', 'uptime')
  const second = manager.execute('host-b', 'uptime', 'second')
  const rejected = assert.rejects(first, /SSH连接已断开/)
  await manager.disconnect('host-a')
  await rejected
  const firstStream = streams.get('host-a')
  const secondStream = streams.get('host-b')
  assert(firstStream && secondStream)
  assert.equal(firstStream.closed, 1)
  assert.equal(secondStream.closed, 0)
  secondStream.emit('exit', 0)
  secondStream.emit('close')
  assert.equal((await second).success, true)
  assert.equal(manager.pendingExecs.size, 0)
})

test('a synchronous ssh2 disconnect error releases the pending request immediately', async () => {
  const { manager } = await loadExecutions()
  manager.connections.set('host-a', { isConnected: true, client: { exec() { throw new Error('Not connected') } } })
  await assert.rejects(manager.execute('host-a', 'uptime', 'racing-disconnect'), /Not connected/)
  assert.equal(manager.pendingExecs.size, 0)
})

test('timeout preserves partial output and settles once when closing the channel synchronously', async () => {
  const { manager, timers, events } = await loadExecutions()
  const stream = executionStream()
  manager.connections.set('host-a', { isConnected: true, client: { exec(_command: string, callback: any) { callback(null, stream) } } })
  const pending = manager.execute('host-a', 'uptime', 'timeout')
  stream.emit('data', Buffer.from('partial\n'))
  timers[0]()
  const result = await pending
  assert.equal(result.success, false)
  assert.match(result.error, /5分钟/)
  assert.equal(result.stdout, 'partial\n')
  assert.equal(result.exitCode, null)
  assert.deepEqual(stream.signals, ['INT'])
  stream.emit('exit', 0)
  stream.emit('close')
  assert.equal(events.filter((item: any) => item.event === 'completed').length, 1)
  assert.equal(manager.pendingExecs.size, 0)
})

test('execute validates timeout options before opening SSH channels', async () => {
  const { manager } = await loadExecutions()
  let executions = 0
  manager.connections.set('host-a', { isConnected: true, client: { exec() { executions++ } } })
  for (const options of [null, [], { timeoutMs: 9999 }, { timeoutMs: 1800001 }, { timeoutMs: 10000.5 }, { timeoutMs: NaN }, { timeoutMs: '30000' }]) {
    await assert.rejects(manager.execute('host-a', 'uptime', 'bad-timeout', options), /超时/)
  }
  assert.equal(executions, 0)
  assert.equal(manager.pendingExecs.size, 0)
})

test('execute flushes correctly identified stdout and stderr before a failed result resolves', async () => {
  const { manager } = await loadExecutions()
  const stream = executionStream()
  const output: SSHExecuteOutputEvent[] = []
  manager.connections.set('host-a', { isConnected: true, client: { exec(_command: string, callback: (error: Error | null, channel: typeof stream) => void) { callback(null, stream) } } })
  const pending = manager.execute('host-a', 'compose up', 'failed-stream', { timeoutMs: 10000 }, (event: SSHExecuteOutputEvent) => output.push(event))
  const bytes = Buffer.from('正在启动🙂')
  stream.emit('data', bytes.subarray(0, 2))
  stream.emit('data', bytes.subarray(2))
  stream.stderr.emit('data', Buffer.from('port unavailable'))
  assert.equal(output.length, 0, 'tiny packets should be batched')
  stream.emit('exit', 9)
  stream.emit('close')
  const result = await pending
  assert.equal(result.success, false)
  assert.equal(result.exitCode, 9)
  assert.equal(result.stdout, '正在启动🙂')
  assert.equal(result.stderr, 'port unavailable')
  assert.deepEqual(output, [
    { requestId: 'failed-stream', connectionId: 'host-a', stream: 'stdout', data: '正在启动🙂' },
    { requestId: 'failed-stream', connectionId: 'host-a', stream: 'stderr', data: 'port unavailable' }
  ])
  stream.emit('data', Buffer.from('late-output'))
  assert.equal(output.length, 2)
})

test('cancelled execution discards pending notifications and ignores late output', async () => {
  const { manager } = await loadExecutions()
  const stream = executionStream()
  const output: SSHExecuteOutputEvent[] = []
  manager.connections.set('host-a', { isConnected: true, client: { exec(_command: string, callback: (error: Error | null, channel: typeof stream) => void) { callback(null, stream) } } })
  const pending = manager.execute('host-a', 'compose pull', 'cancel-output', {}, (event: SSHExecuteOutputEvent) => output.push(event))
  const rejected = assert.rejects(pending, { name: 'AbortError' })
  stream.emit('data', Buffer.from('buffered'))
  await manager.cancelExecute('cancel-output')
  await rejected
  stream.emit('data', Buffer.from('late'))
  assert.deepEqual(output, [])
  assert.equal(manager.pendingExecs.size, 0)
})

test('custom execution timeout preserves partial output and flushes it before closing', async () => {
  const { manager, timers } = await loadExecutions()
  const stream = executionStream()
  const output: SSHExecuteOutputEvent[] = []
  manager.connections.set('host-a', { isConnected: true, client: { exec(_command: string, callback: (error: Error | null, channel: typeof stream) => void) { callback(null, stream) } } })
  const pending = manager.execute('host-a', 'compose pull', 'custom-timeout', { timeoutMs: 10000 }, (event: SSHExecuteOutputEvent) => output.push(event))
  stream.emit('data', Buffer.from('downloaded layer'))
  timers[0]()
  const result = await pending
  assert.match(result.error, /10秒/)
  assert.equal(result.stdout, 'downloaded layer')
  assert.equal(output[0].data, 'downloaded layer')
  assert.equal(stream.closed, 1)
})

test('stream errors retain partial stdout and stderr instead of losing diagnostic evidence', async () => {
  const { manager } = await loadExecutions()
  const stream = executionStream()
  manager.connections.set('host-a', { isConnected: true, client: { exec(_command: string, callback: (error: Error | null, channel: typeof stream) => void) { callback(null, stream) } } })
  const pending = manager.execute('host-a', 'compose pull', 'stream-error')
  stream.emit('data', Buffer.from('downloaded first layer'))
  stream.stderr.emit('data', Buffer.from('registry closed connection'))
  stream.emit('error', new Error('channel reset'))
  const result = await pending
  assert.equal(result.success, false)
  assert.equal(result.stdout, 'downloaded first layer')
  assert.equal(result.stderr, 'registry closed connection')
  assert.match(result.error, /channel reset/)
})

test('execute IPC streams only to the invoking renderer and tolerates renderer destruction', async () => {
  const source = await readFile(sshHandlersPath, 'utf8')
  const parsed = ts.createSourceFile('ssh-handlers.ts', source, ts.ScriptTarget.Latest, true)
  const statement = parsed.statements.find(node => ts.isExpressionStatement(node) && node.getText(parsed).startsWith("ipcMain.handle('ssh:execute',"))
  assert(statement)
  const javascript = ts.transpileModule(statement.getText(parsed), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  let handler: (event: unknown, id: string, command: string, requestId?: string, options?: unknown) => Promise<unknown> = async () => { throw new Error('missing handler') }
  let publish: (event: SSHExecuteOutputEvent) => void = () => {}
  new Function('ipcMain', 'sshManager', javascript)(
    { handle(_channel: string, callback: typeof handler) { handler = callback } },
    { execute: async (_id: string, _command: string, _requestId: string, _options: unknown, callback: typeof publish) => { publish = callback; return { success: true } } }
  )
  const sent: Array<{ channel: string; event: SSHExecuteOutputEvent }> = []
  let destroyed = false
  await handler({ sender: { isDestroyed: () => destroyed, send: (channel: string, event: SSHExecuteOutputEvent) => sent.push({ channel, event }) } }, 'host-a', 'uptime', 'request-a')
  const event: SSHExecuteOutputEvent = { requestId: 'request-a', connectionId: 'host-a', stream: 'stdout', data: 'up' }
  publish(event)
  destroyed = true
  publish({ ...event, data: 'late' })
  assert.deepEqual(sent, [{ channel: 'ssh:execute-output', event }])
})

test('remote env doc resolves HOME and uses temp-file rename through dedicated IPC', async () => {
  const source = await readFile(sshHandlersPath, 'utf8')

  assert.match(source, /printf '%s' "\$HOME"/)
  assert.match(source, /\$\{fullPath\}\.tmp-/)
  assert.match(source, /_extensions\?\.\['posix-rename@openssh\.com'\] === '1'/)
  assert.match(source, /ext_openssh_rename\.bind\(sftp\)/)
  assert.match(source, /ipcMain\.handle\('ssh:read-env-doc'/)
  assert.match(source, /ipcMain\.handle\('ssh:write-env-doc'/)
})

test('file listing carries opaque raw path identity into recursive deletion', async () => {
  const source = await readFile(sshHandlersPath, 'utf8')

  assert.match(source, /identity=\$\(printf %s "\$p" \| base64/)
  assert.match(source, /name: this\.displayNameFromIdentity\(identity\)/)
  assert.match(source, /base64 -d \| xargs -0 rm \$\{removeFlag\} --/)
  assert.doesNotMatch(source, /const itemPath = `\$\{remotePath\}\/\$\{item\.filename\}`/)
})

test('current directory lookup uses a shell channel before falling back to silent pwd', async () => {
  const source = await readFile(sshHandlersPath, 'utf8')

  assert.match(source, /currentDirectoryProbe\?: \{/)
  assert.match(source, /if \(connection\.currentDirectoryProbe\) \{/)
  assert.match(source, /async getCurrentDirectory\(/)
  assert.match(source, /__OC_CWD_BEGIN__/)
  assert.match(source, /__OC_CWD_END__/)
  assert.match(source, /connection\.shell\.write\(wrappedCommand/)
  assert.match(source, /return await this\.executeSilent\(id, 'pwd'\)/)
  assert.match(source, /ipcMain\.handle\('ssh:get-current-directory'/)
})

test('connection list import and export use native JSON dialogs and SSHTreeService', async () => {
  const [source, serviceSource] = await Promise.all([
    readFile(sshHandlersPath, 'utf8'),
    readFile(sshTreeServicePath, 'utf8')
  ])

  assert.match(source, /ipcMain\.handle\('ssh:export-connections'/)
  assert.match(source, /dialog\.showSaveDialog\(\{/)
  assert.match(source, /sshTreeService\.exportConnections\(userId\)/)
  assert.match(source, /ipcMain\.handle\('ssh:import-connections'/)
  assert.match(source, /dialog\.showOpenDialog\(\{/)
  assert.match(source, /sshTreeService\.importConnections\(userId, JSON\.parse\(content\)\)/)
  assert.doesNotMatch(source, /\.ai-ssh-assistant[\s\S]*connections\.json/)
  assert.match(serviceSource, /storageManager\.create\('SSHConnection', \{[\s\S]*userId,[\s\S]*\.\.\.connection,[\s\S]*folderId: null,[\s\S]*status: 'DISCONNECTED',[\s\S]*isActive: true/)
})
