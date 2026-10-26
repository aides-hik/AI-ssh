import test from 'node:test'
import assert from 'node:assert/strict'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { inspect } from 'node:util'
import {
  createCredentialProtector,
  isProtectedCredential,
  type CredentialStorageProvider
} from './credential-protector'

function providerFixture() {
  const key = randomBytes(32)
  const calls = { available: 0, encrypt: 0, decrypt: 0, initializeBackend: 0 }
  const provider: CredentialStorageProvider = {
    async isAsyncEncryptionAvailable() { calls.available++; return true },
    async encryptStringAsync(value) {
      calls.encrypt++
      const nonce = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, nonce)
      const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
      return Buffer.concat([nonce, cipher.getAuthTag(), encrypted])
    },
    async decryptStringAsync(value) {
      calls.decrypt++
      const cipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12))
      cipher.setAuthTag(value.subarray(12, 28))
      const plain = Buffer.concat([cipher.update(value.subarray(28)), cipher.final()])
      return { result: plain.toString('utf8'), shouldReEncrypt: false }
    },
    getSelectedStorageBackend() { return 'gnome_libsecret' },
    isEncryptionAvailable() { calls.initializeBackend++; return true }
  }
  return { provider, calls }
}

test('credential encryption round-trips Unicode, multi-line private keys and whitespace without plaintext in storage', async () => {
  const { provider } = providerFixture()
  const protector = createCredentialProtector(provider, 'win32')
  for (const value of ['密码 with spaces 🔐', ' \n\t ', '-----BEGIN OPENSSH PRIVATE KEY-----\nkey-fixture\n-----END OPENSSH PRIVATE KEY-----']) {
    const first = await protector.protectCredential(value)
    const second = await protector.protectCredential(value)
    assert(isProtectedCredential(first))
    assert.notEqual(first, second, 'Native encryption can use a fresh nonce on each save')
    assert.equal(first.includes(value), false)
    assert.equal(await protector.revealCredential(first), value)
    assert.equal(await protector.revealCredential(second), value)
  }
})

test('legacy plaintext can be read for migration; empty credentials do not require the system keychain', async () => {
  const { provider, calls } = providerFixture()
  const protector = createCredentialProtector(provider, 'win32')
  assert.equal(await protector.revealCredential('legacy password'), 'legacy password')
  assert.equal(await protector.protectCredential(''), '')
  assert.equal(await protector.revealCredential(''), '')
  assert.deepEqual(calls, { available: 0, encrypt: 0, decrypt: 0, initializeBackend: 0 })
})

test('existing protected credentials are validated without double encryption or mutation', async () => {
  const { provider, calls } = providerFixture()
  const protector = createCredentialProtector(provider, 'darwin')
  const encrypted = await protector.protectCredential('saved secret')
  assert.equal(await protector.protectCredential(encrypted), encrypted)
  assert.equal(calls.encrypt, 1)
  assert.equal(calls.decrypt, 1)
})

test('tampered ciphertext and ciphertext from a different OS account cannot become plaintext credentials', async () => {
  const first = createCredentialProtector(providerFixture().provider, 'win32')
  const second = createCredentialProtector(providerFixture().provider, 'win32')
  const encrypted = await first.protectCredential('unavailable secret')
  const bytes = Buffer.from(encrypted.slice('prism:secret:v1:'.length), 'base64')
  bytes[bytes.length - 1] ^= 1
  const tampered = 'prism:secret:v1:' + bytes.toString('base64')
  for (const value of [tampered, encrypted]) {
    await assert.rejects(second.revealCredential(value), /无法解密/)
    await assert.rejects(second.protectCredential(value), /无法解密/)
  }
})

test('malformed and unsupported credential envelopes are rejected before native decryption', async () => {
  const { provider, calls } = providerFixture()
  const protector = createCredentialProtector(provider, 'win32')
  for (const value of ['prism:secret:v1:', 'prism:secret:v1:%%%=', 'prism:secret:v1:YWJj\n',
    'prism:secret:v1:Zh==', 'prism:secret:v1:YQ', 'prism:secret:v2:future']) {
    await assert.rejects(protector.revealCredential(value), /格式无效|版本不受支持/)
    await assert.rejects(protector.protectCredential(value), /格式无效|版本不受支持/)
  }
  assert.equal(calls.available, 0)
  assert.equal(calls.decrypt, 0)
  assert.equal(isProtectedCredential(null), false)
  assert.equal(isProtectedCredential({}), false)
  await assert.rejects(protector.protectCredential(12 as unknown as string), /格式无效/)
})

test('unavailable native encryption fails closed for reads and writes and can recover without restart', async () => {
  const { provider } = providerFixture()
  const protector = createCredentialProtector(provider, 'win32')
  const encrypted = await protector.protectCredential('recoverable secret')
  provider.isAsyncEncryptionAvailable = async () => false
  await assert.rejects(protector.protectCredential('new secret'), /安全存储不可用/)
  await assert.rejects(protector.revealCredential(encrypted), /安全存储不可用/)
  provider.isAsyncEncryptionAvailable = async () => true
  assert.equal(await protector.revealCredential(encrypted), 'recoverable secret')
})

test('provider errors cannot expose input, ciphertext, stack or cause to callers', async () => {
  const fixture = providerFixture()
  const protector = createCredentialProtector(fixture.provider, 'win32')
  const secret = 'should-never-appear-in-errors'
  const encrypted = await protector.protectCredential(secret)
  const failure = new Error('Native error contains ' + secret + ' and ' + encrypted)
  for (const operation of ['available', 'encrypt', 'decrypt'] as const) {
    const { provider } = providerFixture()
    if (operation === 'available') provider.isAsyncEncryptionAvailable = async () => { throw failure }
    if (operation === 'encrypt') provider.encryptStringAsync = async () => { throw failure }
    if (operation === 'decrypt') provider.decryptStringAsync = async () => { throw failure }
    const current = createCredentialProtector(provider, 'win32')
    const request = operation === 'decrypt' ? current.revealCredential(encrypted) : current.protectCredential(secret)
    await assert.rejects(request, error => {
      assert(error instanceof Error)
      assert.equal('cause' in error, false)
      assert.equal(inspect(error).includes(secret), false)
      assert.equal(inspect(error).includes(encrypted), false)
      return true
    })
  }
})

test('Linux refuses plaintext and unknown key providers even if native availability reports true', async () => {
  for (const backend of ['basic_text', 'unknown', 'unexpected_backend', undefined]) {
    const { provider, calls } = providerFixture()
    provider.getSelectedStorageBackend = backend === undefined ? undefined : () => backend
    const protector = createCredentialProtector(provider, 'linux')
    await assert.rejects(protector.protectCredential('linux secret'), /安全存储不可用/)
    assert.equal(calls.encrypt, 0)
  }
})

test('Linux refuses a named secure backend when the system keyring is unavailable', async () => {
  const { provider, calls } = providerFixture()
  provider.isEncryptionAvailable = () => false
  const protector = createCredentialProtector(provider, 'linux')
  await assert.rejects(protector.protectCredential('linux secret'), /安全存储不可用/)
  assert.equal(calls.available, 0)
  assert.equal(calls.encrypt, 0)
})

test('Linux can initialize a secure keyring identity and then uses only asynchronous cryptography', async () => {
  const { provider, calls } = providerFixture()
  let backend = 'unknown'
  provider.getSelectedStorageBackend = () => backend
  provider.isEncryptionAvailable = () => { calls.initializeBackend++; backend = 'kwallet6'; return true }
  const protector = createCredentialProtector(provider, 'linux')
  const encrypted = await protector.protectCredential('keyring secret')
  assert.equal(await protector.revealCredential(encrypted), 'keyring secret')
  assert.equal(calls.initializeBackend, 2)
  assert.equal(calls.encrypt, 1)
  assert.equal(calls.decrypt, 1)
})

test('non-Linux providers do not consult the synchronous compatibility API', async () => {
  for (const platform of ['win32', 'darwin'] as const) {
    const { provider, calls } = providerFixture()
    provider.getSelectedStorageBackend = () => { throw new Error('Must not be called') }
    provider.isEncryptionAvailable = () => { throw new Error('Must not be called') }
    const protector = createCredentialProtector(provider, platform)
    assert.equal(await protector.revealCredential(await protector.protectCredential('secret')), 'secret')
    assert.equal(calls.initializeBackend, 0)
  }
})

test('lazy providers are not initialized when creating the protector or reading legacy data', async () => {
  let loaded = 0
  const { provider } = providerFixture()
  const protector = createCredentialProtector(async () => { loaded++; return provider }, 'win32')
  assert.equal(loaded, 0)
  assert.equal(await protector.revealCredential('legacy'), 'legacy')
  assert.equal(loaded, 0)
  const encrypted = await protector.protectCredential('new secret')
  assert.equal(loaded, 1)
  assert.equal(await protector.revealCredential(encrypted), 'new secret')
})
