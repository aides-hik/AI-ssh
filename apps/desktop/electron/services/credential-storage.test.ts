import test from 'node:test'
import assert from 'node:assert/strict'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { createCredentialProtector, isProtectedCredential } from './credential-protector'
import { createCredentialStorage, migrateStoredCredentials, type CredentialCodec } from './credential-storage'
import { stripCredentials } from '../../src/utils/credential-fields'

const { LocalStorageAdapter } = createRequire(import.meta.url)('@ai-ssh/database')

function codecFixture() {
  const key = randomBytes(32)
  let available = true
  const protector = createCredentialProtector({
    async isAsyncEncryptionAvailable() { return available },
    async encryptStringAsync(value) {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      const bytes = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
      return Buffer.concat([iv, cipher.getAuthTag(), bytes])
    },
    async decryptStringAsync(value) {
      const decipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12))
      decipher.setAuthTag(value.subarray(12, 28))
      return { result: Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8'), shouldReEncrypt: false }
    }
  }, 'win32')
  const codec: CredentialCodec = { protect: protector.protectCredential, reveal: protector.revealCredential }
  return { codec, lock: () => { available = false } }
}

test('SSH and model credentials persist encrypted in real SQLite and remain usable after reopen', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'prism-credentials-'))
  const handles: { reopened?: any } = {}
  t.after(async () => {
    if (handles.reopened) await handles.reopened.disconnect()
    await rm(directory, { recursive: true, force: true })
  })
  const filename = join(directory, 'local.db')
  const raw = new LocalStorageAdapter({ connectionString: filename })
  await raw.connect()
  const { codec } = codecFixture()
  const storage = createCredentialStorage(raw, codec)
  const connection = await storage.create('SSHConnection', {
    userId: 'local-user', name: 'fixture', host: '127.0.0.1', username: 'fixture', authType: 'PRIVATE_KEY',
    password: 'fixture-password-敏感', privateKey: '~/.ssh/中文 私钥', passphrase: 'fixture-passphrase'
  })
  assert.equal(connection.password, 'fixture-password-敏感')
  const saved = await raw.findUnique('SSHConnection', { where: { id: connection.id } })
  for (const field of ['password', 'privateKey', 'passphrase']) assert(isProtectedCredential(saved[field]))
  const settings = { aiProviders: [{ id: 'fixture', apiKey: 'fixture-model-key', config: {
    headers: { 'X-Custom-Auth': 'fixture-custom-header' }, secretAccessKey: 'fixture-cloud-secret'
  } }], appearance: { fontSize: 17 }, credentialStorageVersion: 1 }
  await storage.create('UserSettings', { userId: 'local-user', data: settings })
  const storedSettings = (await raw.findUnique('UserSettings', { where: { userId: 'local-user' } })).data
  assert(isProtectedCredential(storedSettings.aiProviders[0].apiKey))
  assert(isProtectedCredential(storedSettings.aiProviders[0].config.headers['X-Custom-Auth']))
  assert.equal(storedSettings.appearance.fontSize, 17)
  await raw.disconnect()
  const reopened = new LocalStorageAdapter({ connectionString: filename })
  handles.reopened = reopened
  await reopened.connect()
  const recovered = createCredentialStorage(reopened, codec)
  assert.equal((await recovered.findUnique('SSHConnection', { where: { id: connection.id } })).passphrase, 'fixture-passphrase')
  assert.deepEqual((await recovered.findUnique('UserSettings', { where: { userId: 'local-user' } })).data, settings)
  const disk = await readFile(filename)
  for (const secret of ['fixture-password-敏感', 'fixture-passphrase', 'fixture-model-key', 'fixture-custom-header', 'fixture-cloud-secret']) {
    assert.equal(disk.includes(Buffer.from(secret)), false)
  }
})

test('legacy migration encrypts disconnected records and removes old SQLite/WAL plaintext without changing configuration', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'prism-migration-'))
  const filename = join(directory, 'local.db')
  const raw = new LocalStorageAdapter({ connectionString: filename })
  await raw.connect()
  t.after(async () => {
    await raw.disconnect()
    await rm(directory, { recursive: true, force: true })
  })
  const legacy = await raw.create('SSHConnection', {
    userId: 'local-user', name: 'archived', host: 'host', username: 'user', authType: 'PASSWORD',
    password: 'legacy-sensitive-password-to-remove', isActive: false
  })
  const settings = { aiProviders: [{ id: 'legacy', apiKey: 'legacy-model-sensitive-value' }] }
  await raw.create('UserSettings', { userId: 'local-user', data: settings })
  const { codec } = codecFixture()
  await migrateStoredCredentials(raw, codec)
  const snapshot = await raw.findMany('SSHConnection')
  assert(isProtectedCredential(snapshot[0].password))
  assert.equal(snapshot[0].isActive, false)
  assert.equal(snapshot[0].name, legacy.name)
  await migrateStoredCredentials(raw, codec)
  assert.deepEqual(await raw.findMany('SSHConnection'), snapshot, 'Repeated startup migration must be idempotent')
  assert.deepEqual((await createCredentialStorage(raw, codec).findUnique('UserSettings', { where: { userId: 'local-user' } })).data, settings)
  for (const path of [filename, filename + '-wal']) {
    const bytes = await readFile(path).catch(() => Buffer.alloc(0))
    assert.equal(bytes.includes(Buffer.from('legacy-sensitive-password-to-remove')), false)
    assert.equal(bytes.includes(Buffer.from('legacy-model-sensitive-value')), false)
  }
})

test('locked system store cannot overwrite or silently return plaintext legacy data', async t => {
  const raw = new LocalStorageAdapter({ connectionString: ':memory:' })
  await raw.connect()
  t.after(() => raw.disconnect())
  const legacy = await raw.create('SSHConnection', {
    userId: 'local-user', name: 'legacy', host: 'host', username: 'user', authType: 'PASSWORD', password: 'legacy-preserve-me'
  })
  const { codec, lock } = codecFixture()
  const storage = createCredentialStorage(raw, codec)
  lock()
  await assert.rejects(migrateStoredCredentials(raw, codec), /安全存储不可用/)
  await assert.rejects(storage.findUnique('SSHConnection', { where: { id: legacy.id } }), /安全存储不可用/)
  await assert.rejects(storage.update('SSHConnection', { where: { id: legacy.id }, data: { password: 'new-plaintext' } }), /安全存储不可用/)
  assert.equal((await raw.findUnique('SSHConnection', { where: { id: legacy.id } })).password, 'legacy-preserve-me')
})

test('bulk writes and imports cannot bypass credential protection; tampered values do not overwrite storage', async t => {
  const raw = new LocalStorageAdapter({ connectionString: ':memory:' })
  await raw.connect()
  t.after(() => raw.disconnect())
  const { codec } = codecFixture()
  const storage = createCredentialStorage(raw, codec)
  const data = { userId: 'local-user', name: 'bulk', host: 'host', username: 'user', authType: 'PASSWORD', password: 'bulk-password' }
  await storage.createMany('SSHConnection', [data])
  assert(isProtectedCredential((await raw.findMany('SSHConnection'))[0].password))
  await storage.updateMany('SSHConnection', { where: { userId: 'local-user' }, data: { password: 'bulk-replacement' } })
  const row = (await raw.findMany('SSHConnection'))[0]
  assert(isProtectedCredential(row.password))
  assert.equal((await storage.findMany('SSHConnection'))[0].password, 'bulk-replacement')
  await assert.rejects(storage.update('SSHConnection', { where: { id: row.id }, data: { password: 'prism:secret:v1:invalid' } }))
  assert.equal((await raw.findUnique('SSHConnection', { where: { id: row.id } })).password, row.password)
})

test('portable exports omit nested credentials and arbitrary custom headers without mutating runtime settings', () => {
  const value = { aiProviders: [{ id: 'openai', apiKey: 'secret', config: {
    api_key: 'alias', headers: { 'unusual-auth-name': 'secret' }, nested: { clientSecret: 'secret' }
  } }], password: 'password', privateKey: 'key', passphrase: 'phrase', theme: 'dark' }
  const exported = stripCredentials(value)
  assert.deepEqual(exported, { aiProviders: [{ id: 'openai', config: { headers: {}, nested: {} } }], theme: 'dark' })
  assert.equal(value.aiProviders[0].apiKey, 'secret')
  assert.equal(JSON.stringify(exported).includes('secret'), false)
})

test('transactions protect writes, defer compaction until commit, and serialize competing writes', async t => {
  const raw = new LocalStorageAdapter({ connectionString: ':memory:' })
  await raw.connect()
  t.after(() => raw.disconnect())
  const legacy = await raw.create('SSHConnection', {
    userId: 'local-user', name: 'legacy', host: 'host', username: 'user', authType: 'PASSWORD', password: 'transaction-legacy'
  })
  let compactions = 0
  const originalCompact = raw.compactLocalStorage.bind(raw)
  raw.compactLocalStorage = async () => {
    assert.equal(raw.db.inTransaction, false, 'Database cleanup cannot execute inside a transaction')
    compactions++
    await originalCompact()
  }
  const { codec } = codecFixture()
  const storage = createCredentialStorage(raw, codec)
  let enter!: () => void
  let release!: () => void
  const entered = new Promise<void>(resolve => { enter = resolve })
  const gate = new Promise<void>(resolve => { release = resolve })
  const operations: string[] = []
  const transaction = storage.transaction(async (tx: typeof storage) => {
    assert.equal((await tx.findUnique('SSHConnection', { where: { id: legacy.id } })).password, 'transaction-legacy')
    await tx.create('UserSettings', { userId: 'local-user', data: { apiKey: 'transaction-key' } })
    enter()
    await gate
    operations.push('transaction')
  })
  await entered
  const competing = storage.create('SSHFolder', { userId: 'local-user', name: 'queued' }).then(() => operations.push('write'))
  release()
  await Promise.all([transaction, competing])
  assert.deepEqual(operations, ['transaction', 'write'])
  assert.equal(compactions, 1)
  assert(isProtectedCredential((await raw.findUnique('SSHConnection', { where: { id: legacy.id } })).password))
  assert(isProtectedCredential((await raw.findUnique('UserSettings', { where: { userId: 'local-user' } })).data.apiKey))
})

test('a database write failure rolls back the entire legacy credential migration', async t => {
  const raw = new LocalStorageAdapter({ connectionString: ':memory:' })
  await raw.connect()
  t.after(() => raw.disconnect())
  for (const name of ['first', 'second']) await raw.create('SSHConnection', {
    userId: 'local-user', name, host: 'host', username: 'user', authType: 'PASSWORD', password: `original-${name}`
  })
  const originals = await raw.findMany('SSHConnection')
  const originalUpdate = raw.update.bind(raw)
  let writes = 0
  raw.update = async (...args: unknown[]) => {
    if (++writes === 2) throw new Error('Fixture database write failure')
    return originalUpdate(...args)
  }
  const { codec } = codecFixture()
  await assert.rejects(migrateStoredCredentials(raw, codec), /Fixture database write failure/)
  assert.deepEqual(await raw.findMany('SSHConnection'), originals)
})
