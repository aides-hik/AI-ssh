import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir, homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { Client, Server, utils, type Connection, type ConnectConfig } from 'ssh2'
import { SSHHostTrust, normalizeSSHHost, sshHostFingerprint, type SSHHostTrustQuestion } from './ssh-host-trust'
import { SSHPTYOutput } from './ssh-pty-output'
import { EventEmitter } from 'node:events'

const fixtureKey = () => generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'pkcs1', format: 'pem' }
}).privateKey

function publicKey(key: string): Buffer {
  const parsed = utils.parseKey(key)
  assert(!(parsed instanceof Error) && !Array.isArray(parsed))
  return parsed.getPublicSSH()
}

async function storage(t: TestContext) {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'prism-host-trust-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  return { directory, filePath: path.join(directory, 'ssh-known-hosts.json') }
}

async function loopback(t: TestContext, key = fixtureKey(), port = 0) {
  const peers = new Set<Connection>()
  const counters = { auth: 0, ready: 0 }
  const server = new Server({ hostKeys: [key] }, peer => {
    peers.add(peer)
    peer.on('error', () => {})
    peer.once('close', () => peers.delete(peer))
    peer.on('authentication', context => {
      counters.auth++
      if (context.method === 'password' && context.username === 'fixture-user' && context.password === 'fixture-password') context.accept()
      else context.reject()
    })
    peer.on('ready', () => {
      counters.ready++
      peer.on('session', accept => {
        const session = accept()
        session.on('pty', acceptPty => acceptPty?.())
        session.on('shell', acceptShell => acceptShell().write('fixture ready\r\n'))
      })
    })
  })
  let closed = false
  const close = async () => {
    if (closed) return
    closed = true
    for (const peer of peers) peer.end()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
  t.after(close)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  assert(address && typeof address !== 'string')
  return { server, counters, close, key, endpoint: { host: '127.0.0.1', port: address.port } }
}

async function authenticate(config: ConnectConfig): Promise<void> {
  const client = new Client()
  try {
    await new Promise<void>((resolve, reject) => {
      client.once('ready', resolve)
      client.on('error', reject)
      client.connect({ username: 'fixture-user', password: 'fixture-password', readyTimeout: 1500, ...config })
    })
  } finally { client.destroy() }
}

test('host identity normalization keeps the port and canonicalizes DNS and IPv6', () => {
  assert.deepEqual(normalizeSSHHost('Example.TEST.', undefined), { host: 'example.test', port: 22 })
  assert.deepEqual(normalizeSSHHost('[0:0:0:0:0:0:0:1]', 2200), { host: '::1', port: 2200 })
  assert.throws(() => normalizeSSHHost('https://example.test'), /地址无效/)
  assert.throws(() => normalizeSSHHost('example.test', 0), /端口无效/)
  for (const host of ['host\0.test', 'host\u001b.test', 'host\u007f.test']) {
    assert.throws(() => normalizeSSHHost(host), /地址无效/)
  }
})

test('rejecting the first host fingerprint sends no authentication and saves no trust', { timeout: 10000 }, async t => {
  const { filePath } = await storage(t)
  const fixture = await loopback(t)
  let prompts = 0
  const trust = new SSHHostTrust({ filePath: () => filePath, ask: async question => {
    prompts++
    assert.equal(question.kind, 'unknown')
    assert.equal(question.fingerprint, sshHostFingerprint(publicKey(fixture.key)).fingerprint)
    assert.deepEqual({ host: question.host, port: question.port }, fixture.endpoint)
    return false
  } })
  await assert.rejects(trust.prepare(fixture.endpoint), /连接已取消/)
  assert.equal(prompts, 1)
  assert.equal(fixture.counters.auth, 0)
  await assert.rejects(fs.stat(filePath), { code: 'ENOENT' })
})

test('first accepted host is persisted and reused after restart; the authenticated key is pinned again', { timeout: 10000 }, async t => {
  const { filePath } = await storage(t)
  const fixture = await loopback(t)
  let prompts = 0
  const trust = new SSHHostTrust({ filePath: () => filePath, ask: async () => { prompts++; return true } })
  const verifier = await trust.prepare(fixture.endpoint)
  assert.equal(fixture.counters.auth, 0, 'Identity discovery must not attempt even password-free authentication')
  await authenticate({ ...fixture.endpoint, hostVerifier: verifier })
  const saved = JSON.parse(await fs.readFile(filePath, 'utf8'))
  assert.equal(saved.hosts[0].fingerprint, sshHostFingerprint(publicKey(fixture.key)).fingerprint)
  assert.equal(saved.hosts[0].port, fixture.endpoint.port)
  const restarted = new SSHHostTrust({ filePath: () => filePath, ask: async () => { assert.fail('A persisted matching identity should not ask again') } })
  const secondVerifier = await restarted.prepare(fixture.endpoint)
  await authenticate({ ...fixture.endpoint, hostVerifier: secondVerifier })
  assert.equal(prompts, 1)
  assert.equal(fixture.counters.ready, 2)
  assert.equal(secondVerifier(publicKey(fixtureKey())), false, 'A different key after the probe must be denied')
})

test('changed host keys block authentication and only explicit double confirmation can reset trust for a retry', { timeout: 15000 }, async t => {
  const { filePath } = await storage(t)
  const initial = await loopback(t)
  const first = new SSHHostTrust({ filePath: () => filePath, ask: async () => true })
  await first.prepare(initial.endpoint)
  const oldFingerprint = sshHostFingerprint(publicKey(initial.key)).fingerprint
  await initial.close()
  const replacement = await loopback(t, fixtureKey(), initial.endpoint.port)
  const seen: SSHHostTrustQuestion[] = []
  let allowReset = false
  const trust = new SSHHostTrust({ filePath: () => filePath, ask: async question => {
    seen.push(question)
    assert.equal(question.previousFingerprint, oldFingerprint)
    return allowReset
  } })
  await assert.rejects(trust.prepare(replacement.endpoint), /指纹与已保存记录不一致/)
  assert.equal(replacement.counters.auth, 0)
  assert.equal(JSON.parse(await fs.readFile(filePath, 'utf8')).hosts[0].fingerprint, oldFingerprint)
  allowReset = true
  await assert.rejects(trust.prepare(replacement.endpoint), /本次连接已阻止.*请再次连接/)
  assert.deepEqual(seen.map(item => item.kind), ['changed', 'changed', 'replace'])
  assert.equal(replacement.counters.auth, 0, 'Resetting trust must not resume the blocked connection')
  const verifier = await trust.prepare(replacement.endpoint)
  await authenticate({ ...replacement.endpoint, hostVerifier: verifier })
  assert.equal(replacement.counters.ready, 1)
})

test('a long human confirmation does not exhaust the network handshake timeout', { timeout: 10000 }, async t => {
  const { filePath } = await storage(t)
  const fixture = await loopback(t)
  const trust = new SSHHostTrust({ filePath: () => filePath, ask: async () => {
    await new Promise(resolve => setTimeout(resolve, 1200))
    return true
  } })
  const verifier = await trust.prepare({ ...fixture.endpoint, readyTimeout: 1000 })
  await authenticate({ ...fixture.endpoint, readyTimeout: 1000, hostVerifier: verifier })
  assert.equal(fixture.counters.ready, 1)
})

test('a host swapped between discovery and authentication is rejected before credentials are sent', { timeout: 10000 }, async t => {
  const { filePath } = await storage(t)
  const original = await loopback(t)
  const trust = new SSHHostTrust({ filePath: () => filePath, ask: async () => true })
  const pinned = await trust.prepare(original.endpoint)
  await original.close()
  const impostor = await loopback(t, fixtureKey(), original.endpoint.port)
  await assert.rejects(authenticate({ ...impostor.endpoint, hostVerifier: pinned }), /verification failed|denied/i)
  assert.equal(impostor.counters.auth, 0)
  assert.equal(impostor.counters.ready, 0)
})

test('concurrent first connections prompt once per endpoint and concurrent different hosts do not lose records', async t => {
  const { filePath } = await storage(t)
  const key = publicKey(fixtureKey())
  let prompts = 0
  const trust = new SSHHostTrust({ filePath: () => filePath, probe: async () => key, ask: async () => {
    prompts++
    await new Promise(resolve => setTimeout(resolve, 5))
    return true
  } })
  await Promise.all([
    trust.prepare({ host: 'same.example.test', port: 22 }),
    trust.prepare({ host: 'same.example.test', port: 22 }),
    trust.prepare({ host: 'same.example.test', port: 2222 }),
    trust.prepare({ host: 'other.example.test', port: 22 })
  ])
  assert.equal(prompts, 3)
  const saved = JSON.parse(await fs.readFile(filePath, 'utf8'))
  assert.equal(saved.hosts.length, 3)
})

test('declining the final reset confirmation preserves the original trusted key', async t => {
  const { filePath } = await storage(t)
  const original = publicKey(fixtureKey())
  let key = original
  const questions: string[] = []
  const trust = new SSHHostTrust({ filePath: () => filePath, probe: async () => key, ask: async question => {
    questions.push(question.kind)
    return question.kind !== 'replace'
  } })
  const pinned = await trust.prepare({ host: 'fixture.invalid' })
  const before = await fs.readFile(filePath, 'utf8')
  key = publicKey(fixtureKey())
  await assert.rejects(trust.prepare({ host: 'fixture.invalid' }), /本次连接已阻止/)
  assert.deepEqual(questions, ['unknown', 'changed', 'replace'])
  assert.equal(await fs.readFile(filePath, 'utf8'), before)
  assert.equal(pinned(original), true)
  assert.equal(pinned(key), false)
})

test('invalid or duplicate persisted identities fail before probing and preserve the original file', async t => {
  const { filePath } = await storage(t)
  const identity = { host: 'fixture.invalid', port: 22, ...sshHostFingerprint(publicKey(fixtureKey())), trustedAt: new Date().toISOString() }
  const trust = new SSHHostTrust({ filePath: () => filePath,
    probe: async () => { assert.fail('Invalid saved identities must not start network probing') },
    ask: async () => { assert.fail('Invalid saved identities must not prompt for new trust') }
  })
  for (const hosts of [[identity, identity], [{ ...identity, host: 'Fixture.INVALID' }], [{ ...identity, port: 0 }], [{ ...identity, fingerprint: 'SHA256:invalid' }]]) {
    const original = JSON.stringify({ version: 1, hosts })
    await fs.writeFile(filePath, original)
    await assert.rejects(trust.prepare({ host: 'fixture.invalid' }), /原记录未被覆盖/)
    assert.equal(await fs.readFile(filePath, 'utf8'), original)
  }
})

test('corrupt trust storage fails closed and is not silently replaced', async t => {
  const { filePath } = await storage(t)
  const original = '{corrupt, keep for recovery'
  await fs.writeFile(filePath, original)
  const trust = new SSHHostTrust({ filePath: () => filePath,
    probe: async () => { assert.fail('A corrupt trust store must stop the network request') },
    ask: async () => { assert.fail('A corrupt trust store must not offer a misleading first-use confirmation') }
  })
  await assert.rejects(trust.prepare({ host: 'example.test' }), /原记录未被覆盖/)
  assert.equal(await fs.readFile(filePath, 'utf8'), original)
})

test('a failed trust write does not allow authentication or leave a temporary record', async t => {
  const { filePath, directory } = await storage(t)
  const fixture = await loopback(t)
  const trust = new SSHHostTrust({ filePath: () => filePath, ask: async () => {
    await fs.mkdir(filePath)
    return true
  } })
  await assert.rejects(trust.prepare(fixture.endpoint), /未能保存.*已停止连接/)
  assert.equal(fixture.counters.auth, 0)
  assert.deepEqual(await fs.readdir(directory), ['ssh-known-hosts.json'])
})

async function productionManager(trust: SSHHostTrust, options: {
  client?: typeof Client
  sendToRenderer?: (...args: unknown[]) => void
  setTimeout?: typeof setTimeout
  clearTimeout?: typeof clearTimeout
} = {}) {
  const filename = fileURLToPath(new URL('../ipc/ssh-handlers.ts', import.meta.url))
  const source = await fs.readFile(filename, 'utf8')
  const parsed = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true)
  const helpers = parsed.statements.filter(statement => ts.isFunctionDeclaration(statement) &&
    ['normalizeCredential', 'createSSHConnectConfig'].includes(statement.name?.text || ''))
  const manager = parsed.statements.find(statement => ts.isClassDeclaration(statement) && statement.name?.text === 'SSHManager')
  assert(manager && ts.isClassDeclaration(manager))
  const methods = manager.members.filter(member => ts.isMethodDeclaration(member) && member.name &&
    ['connect', 'testConnection'].includes(member.name.getText(parsed)))
  assert.equal(methods.length, 2)
  const code = ts.transpileModule(`${helpers.map(helper => helper.getText(parsed)).join('\n')}
    class FixtureManager {
      connections = new Map();
      closeFileListShell() {} cancelConnectionTransfers() {} cancelConnectionEnvDocs() {} cancelConnectionExecutions() {}
      ${methods.map(method => method.getText(parsed)).join('\n')}
    }`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  return new Function('fs', 'path', 'homedir', 'process', 'Client', 'randomUUID', 'windowEvents', 'emit', 'Events', 'sshHostTrust', 'SSHPTYOutput',
    'normalizeSSHHost', 'setTimeout', 'clearTimeout', code + '\nreturn new FixtureManager()')(
    fs, path, homedir, process, options.client || Client, randomUUID,
    { sendToRenderer: options.sendToRenderer || (() => {}) }, () => {}, { SSH_CONNECTED: 'connected' }, trust, SSHPTYOutput,
    normalizeSSHHost, options.setTimeout || setTimeout, options.clearTimeout || clearTimeout
  )
}

test('production connect and testConnection both enforce the same trust decision before authentication', { timeout: 15000 }, async t => {
  const { filePath } = await storage(t)
  const fixture = await loopback(t)
  let accepted = false
  let prompts = 0
  const trust = new SSHHostTrust({ filePath: () => filePath, ask: async () => { prompts++; return accepted } })
  const manager = await productionManager(trust)
  const config = { ...fixture.endpoint, name: 'fixture', username: 'fixture-user', password: 'fixture-password', timeout: 3, keepAlive: false }
  await assert.rejects(manager.testConnection(config), /连接已取消/)
  await assert.rejects(manager.connect(config), /连接已取消/)
  assert.equal(fixture.counters.auth, 0)
  accepted = true
  assert.equal((await manager.testConnection(config)).success, true)
  const id = await manager.connect(config)
  assert.equal(manager.connections.get(id).isConnected, true)
  manager.connections.get(id).client.destroy()
  assert.equal(prompts, 3, 'Accepted test trust is reused by production connect')
  assert.equal(fixture.counters.ready, 2)
})

test('production probing and authentication use the same canonical endpoint and connection events exclude credentials', { timeout: 10000 }, async t => {
  const { filePath } = await storage(t)
  const fixture = await loopback(t)
  const trust = new SSHHostTrust({ filePath: () => filePath, ask: async () => true })
  const events: unknown[][] = []
  const manager = await productionManager(trust, { sendToRenderer: (...args) => events.push(args) })
  const config = { ...fixture.endpoint, host: ' 127.0.0.1 ', name: 'fixture', username: 'fixture-user',
    authType: 'password', password: 'fixture-password', privateKey: 'UNUSED_PRIVATE_MATERIAL', passphrase: 'UNUSED_SECRET', keepAlive: false }
  assert.equal((await manager.testConnection(config)).success, true)
  const id = await manager.connect(config)
  const connection = manager.connections.get(id)
  const client = connection.client
  t.after(() => client.destroy())
  assert.equal(connection.host, '127.0.0.1')
  const connected = events.find(event => (event[1] as { status?: string })?.status === 'connected')
  assert.ok(connected)
  assert.deepEqual((connected[1] as { config: unknown }).config, {
    name: 'fixture', host: '127.0.0.1', port: fixture.endpoint.port, username: 'fixture-user', authType: 'password'
  })
  assert.doesNotMatch(JSON.stringify(events), /fixture-password|UNUSED_PRIVATE_MATERIAL|UNUSED_SECRET|privateKey|passphrase/)
})

class FixtureSSHClient extends EventEmitter {
  static onConnect: (client: FixtureSSHClient, config: ConnectConfig) => void = () => {}
  destroyed = false
  shellCallback?: (error: Error | null, stream?: { close: () => void }) => void
  connect(config: ConnectConfig) { FixtureSSHClient.onConnect(this, config); return this }
  destroy() {
    if (!this.destroyed) { this.destroyed = true; this.emit('close') }
    return this
  }
  shell(_options: unknown, callback: NonNullable<FixtureSSHClient['shellCallback']>) { this.shellCallback = callback }
}

test('a server closing before authentication settles both test and real connection attempts promptly', { timeout: 5000 }, async t => {
  const { filePath } = await storage(t)
  const key = publicKey(fixtureKey())
  const trust = new SSHHostTrust({ filePath: () => filePath, probe: async () => key, ask: async () => true })
  const manager = await productionManager(trust, { client: FixtureSSHClient as unknown as typeof Client })
  FixtureSSHClient.onConnect = client => { queueMicrotask(() => client.emit('close')) }
  const config = { host: 'fixture.invalid', username: 'fixture', timeout: 30 }
  assert.equal((await manager.testConnection(config)).success, false)
  await assert.rejects(manager.connect(config), /准备完成前已关闭/)
  assert.equal(manager.connections.size, 0)
})

test('connection testing honors the selected timeout and a late ready event cannot change the timeout result', async t => {
  const { filePath } = await storage(t)
  const key = publicKey(fixtureKey())
  const trust = new SSHHostTrust({ filePath: () => filePath, probe: async () => key, ask: async () => true })
  const scheduled: Array<{ fire: () => void; delay: number }> = []
  const started = Promise.withResolvers<FixtureSSHClient>()
  FixtureSSHClient.onConnect = client => { started.resolve(client) }
  const manager = await productionManager(trust, {
    client: FixtureSSHClient as unknown as typeof Client,
    setTimeout: ((fire: () => void, delay: number) => { scheduled.push({ fire, delay }); return 1 }) as unknown as typeof setTimeout,
    clearTimeout: (() => {}) as unknown as typeof clearTimeout
  })
  const pending = manager.testConnection({ host: 'fixture.invalid', username: 'fixture', timeout: 42 })
  const client = await started.promise
  assert.equal(scheduled.length, 1)
  assert.equal(scheduled[0].delay, 42000)
  scheduled[0].fire()
  const result = await pending
  assert.equal(result.success, false)
  assert.match(result.message, /超时/)
  assert.equal(client.destroyed, true)
  client.emit('ready')
  assert.equal(manager.connections.size, 0)
})

test('a stalled shell request times out and its late callback cannot create a live connection', async t => {
  const { filePath } = await storage(t)
  const key = publicKey(fixtureKey())
  const trust = new SSHHostTrust({ filePath: () => filePath, probe: async () => key, ask: async () => true })
  const scheduled: Array<() => void> = []
  const started = Promise.withResolvers<FixtureSSHClient>()
  FixtureSSHClient.onConnect = client => { queueMicrotask(() => { client.emit('ready'); started.resolve(client) }) }
  const manager = await productionManager(trust, {
    client: FixtureSSHClient as unknown as typeof Client,
    setTimeout: ((fire: () => void) => { scheduled.push(fire); return 1 }) as unknown as typeof setTimeout,
    clearTimeout: (() => {}) as unknown as typeof clearTimeout
  })
  const pending = manager.connect({ host: 'fixture.invalid', username: 'fixture', timeout: 5 })
  const rejected = assert.rejects(pending, /终端初始化超时/)
  const client = await started.promise
  assert.ok(client.shellCallback)
  scheduled[0]()
  await rejected
  let closed = 0
  client.shellCallback(null, { close: () => { closed++ } })
  assert.equal(closed, 1)
  assert.equal(client.destroyed, true)
  assert.equal(manager.connections.size, 0)
})
