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

test('exec output cleanup only removes the first line when it is an actual command echo', async () => {
  const source = await readFile(sshHandlersPath, 'utf8')

  assert.match(source, /const trimmedCommand = command\.trim\(\)/)
  assert.match(source, /const firstLine = lines\[0\]\?\.trim\(\) \|\| ''/)
  assert.match(
    source,
    /if \(firstLine && firstLine === trimmedCommand\) \{[\s\S]*cleanedOutput = lines\.slice\(1\)\.join\('\\n'\)/
  )
  assert.doesNotMatch(source, /console\.log\('\[SSHManager\] 📝 第一行（命令回显）:'/)
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

test('execute cancellation is registered before ssh2 returns its stream', async () => {
  const source = await readFile(sshHandlersPath, 'utf8')

  assert.match(
    source,
    /pendingExecs\.set\(requestId, \{ stream: null, aborted: false, reject: settleReject \}\)/
  )
  assert.match(source, /if \(!pendingExec \|\| pendingExec\.aborted\)/)
  assert.match(source, /const stream = pendingExec\.stream[\s\S]*pendingExec\.reject\(/)
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
