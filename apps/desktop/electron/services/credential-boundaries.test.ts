import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import ts from 'typescript'
import { stripCredentials } from '../../src/utils/credential-fields'
import * as connectionTransfer from './ssh-connection-transfer'
import { createCredentialStorage, type CredentialStorageBackend } from './credential-storage'
import { createCredentialProtector, isProtectedCredential } from './credential-protector'

const { LocalStorageAdapter } = createRequire(import.meta.url)('@ai-ssh/database')

function protectedBackend(raw: CredentialStorageBackend) {
  const key = randomBytes(32)
  let locked = false
  // Use a real authenticated cipher as the injected native provider.
  const provider = {
    async isAsyncEncryptionAvailable() { return !locked },
    async encryptStringAsync(value: string) {
      const nonce = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, nonce)
      const bytes = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
      return Buffer.concat([nonce, cipher.getAuthTag(), bytes])
    },
    async decryptStringAsync(value: Buffer) {
      const cipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12))
      cipher.setAuthTag(value.subarray(12, 28))
      return { result: Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]).toString('utf8'), shouldReEncrypt: false }
    }
  }
  const usable = createCredentialProtector(provider, 'win32')
  return {
    storage: createCredentialStorage(raw, { protect: usable.protectCredential, reveal: usable.revealCredential }),
    lock() { locked = true },
    unlock() { locked = false }
  }
}

async function loadSettingsHandlers(storage: CredentialStorageBackend) {
  const source = await readFile(new URL('../ipc/settings-handlers.ts', import.meta.url), 'utf8')
  const javascript = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText
  const handlers = new Map<string, (...args: any[]) => Promise<any>>()
  const files = new Map<string, string>()
  const writes: Array<{ filename: string; contents: string; options: unknown }> = []
  const dependencies: Record<string, unknown> = {
    electron: { ipcMain: { handle(channel: string, handler: (...args: any[]) => Promise<any>) { handlers.set(channel, handler) } } },
    '../main/storage': { getStorageManager: () => storage },
    'node:fs/promises': {
      async readFile(filename: string) {
        const value = files.get(filename)
        if (value === undefined) throw new Error('Fixture file not found')
        return value
      },
      async writeFile(filename: string, contents: string, options: unknown) { writes.push({ filename, contents, options }) }
    },
    '../../src/utils/credential-fields': { stripCredentials }
  }
  const exports = {}
  new Function('require', 'exports', javascript)((name: string) => {
    assert(name in dependencies, 'Unexpected settings handler dependency')
    return dependencies[name]
  }, exports)
  return {
    files, writes,
    async invoke(channel: string, ...args: unknown[]) {
      const handler = handlers.get(channel)
      assert(handler, `Missing actual IPC handler ${channel}`)
      return handler({}, ...args)
    }
  }
}

test('actual settings IPC saves and imports protected credentials, but portable exports omit them', async t => {
  const raw = new LocalStorageAdapter({ connectionString: ':memory:' })
  await raw.connect()
  t.after(() => raw.disconnect())
  const { storage } = protectedBackend(raw)
  const ipc = await loadSettingsHandlers(storage)
  const settings = { language: 'zh-CN', aiProviders: [{ id: 'fixture', apiKey: 'model-secret', config: {
    headers: { 'X-Unusual-Auth': 'header-secret' }, nested: { clientSecret: 'client-secret' }
  } }] }
  assert.deepEqual(await ipc.invoke('settings:save', 'local-user', settings), { success: true })
  const persisted = (await raw.findUnique('UserSettings', { where: { userId: 'local-user' } })).data
  assert(isProtectedCredential(persisted.aiProviders[0].apiKey))
  assert(isProtectedCredential(persisted.aiProviders[0].config.headers['X-Unusual-Auth']))
  assert.deepEqual(await ipc.invoke('settings:get', 'local-user'), settings)
  await ipc.invoke('settings:export', 'local-user', '/fixture/settings.json')
  assert.equal(ipc.writes.length, 1)
  assert.deepEqual(ipc.writes[0].options, { encoding: 'utf8', mode: 0o600 })
  const exported = JSON.parse(ipc.writes[0].contents)
  assert.deepEqual(exported, { language: 'zh-CN', aiProviders: [{ id: 'fixture', config: { headers: {}, nested: {} } }] })
  assert.deepEqual(await ipc.invoke('settings:get', 'local-user'), settings, 'Export must not modify live credentials')

  ipc.files.set('/fixture/legacy.json', JSON.stringify({ ...settings, language: 'en-US' }))
  const imported = await ipc.invoke('settings:import', 'local-user', '/fixture/legacy.json')
  assert.equal(imported.success, true)
  assert.equal(imported.settings.aiProviders[0].apiKey, 'model-secret')
  assert.equal(imported.settings.language, 'en-US')
  assert(isProtectedCredential((await raw.findUnique('UserSettings', { where: { userId: 'local-user' } })).data.aiProviders[0].apiKey))
})

test('actual settings IPC exposes decryption failures and preserves existing settings instead of returning defaults', async t => {
  const raw = new LocalStorageAdapter({ connectionString: ':memory:' })
  await raw.connect()
  t.after(() => raw.disconnect())
  const fixture = protectedBackend(raw)
  const ipc = await loadSettingsHandlers(fixture.storage)
  const settings = { aiProviders: [{ id: 'fixture', apiKey: 'preserve-this-key' }], appearance: { fontSize: 18 } }
  await ipc.invoke('settings:save', 'local-user', settings)
  const before = await raw.findUnique('UserSettings', { where: { userId: 'local-user' } })
  fixture.lock()
  await assert.rejects(ipc.invoke('settings:get', 'local-user'), /安全存储不可用/)
  await assert.rejects(ipc.invoke('settings:save', 'local-user', { aiProviders: [], theme: 'light' }), /安全存储不可用/)
  await assert.rejects(ipc.invoke('settings:export', 'local-user', '/fixture/export.json'), /安全存储不可用/)
  assert.deepEqual(await raw.findUnique('UserSettings', { where: { userId: 'local-user' } }), before)
  assert.equal(ipc.writes.length, 0)
  fixture.unlock()
  assert.deepEqual(await ipc.invoke('settings:get', 'local-user'), settings)
})

test('invalid settings imports cannot replace existing settings and reset removes saved credentials', async t => {
  const raw = new LocalStorageAdapter({ connectionString: ':memory:' })
  await raw.connect()
  t.after(() => raw.disconnect())
  const { storage } = protectedBackend(raw)
  const ipc = await loadSettingsHandlers(storage)
  await ipc.invoke('settings:save', 'local-user', { aiProviders: [{ id: 'fixture', apiKey: 'secret' }] })
  const before = await raw.findUnique('UserSettings', { where: { userId: 'local-user' } })
  ipc.files.set('/fixture/invalid.json', '[]')
  await assert.rejects(ipc.invoke('settings:import', 'local-user', '/fixture/invalid.json'), /格式无效/)
  assert.deepEqual(await raw.findUnique('UserSettings', { where: { userId: 'local-user' } }), before)
  await ipc.invoke('settings:reset', 'local-user')
  const reset = await ipc.invoke('settings:get', 'local-user')
  assert.equal(reset.credentialStorageVersion, 1)
  assert.deepEqual(reset.aiProviders, [])
})

test('actual SSH export keeps connection metadata and public keys while omitting every saved credential', async t => {
  const raw = new LocalStorageAdapter({ connectionString: ':memory:' })
  await raw.connect()
  t.after(() => raw.disconnect())
  const { storage } = protectedBackend(raw)
  const source = await readFile(new URL('./ssh-tree.service.ts', import.meta.url), 'utf8')
  const javascript = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText
  const exports: { SSHTreeService?: new () => { exportConnections(userId: string): Promise<connectionTransfer.SSHConnectionExportEnvelope> } } = {}
  new Function('require', 'exports', javascript)((name: string) => {
    if (name === '../main/storage') return { storageManager: storage }
    if (name === './ssh-connection-transfer') return connectionTransfer
    throw new Error('Unexpected SSH service dependency')
  }, exports)
  assert(exports.SSHTreeService)
  await storage.create('SSHConnection', {
    userId: 'local-user', name: 'Key host', host: 'host', port: 22, username: 'fixture', authType: 'PRIVATE_KEY', isActive: true,
    password: 'password-secret', privateKey: '-----BEGIN PRIVATE KEY-----\nprivate-secret', passphrase: 'phrase-secret', publicKey: 'ssh-ed25519 public-fixture'
  })
  const service = new exports.SSHTreeService()
  const exported = await service.exportConnections('local-user')
  assert.deepEqual(exported.connections, [{ name: 'Key host', host: 'host', port: 22, username: 'fixture', authType: 'PRIVATE_KEY', publicKey: 'ssh-ed25519 public-fixture' }])
  for (const value of ['password-secret', 'private-secret', 'phrase-secret', 'prism:secret:']) {
    assert.equal(JSON.stringify(exported).includes(value), false)
  }
  const stored = (await raw.findMany('SSHConnection'))[0]
  assert(isProtectedCredential(stored.privateKey))
  const runtime = (await storage.findMany('SSHConnection'))[0]
  assert.equal(runtime.passphrase, 'phrase-secret')
})
