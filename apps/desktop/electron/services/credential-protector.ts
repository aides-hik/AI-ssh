/** OS-backed credential encryption. Plaintext exists only in process memory. */
const CREDENTIAL_PREFIX = 'prism:secret:v1:'
const CREDENTIAL_NAMESPACE = 'prism:secret:'
const MAX_ENCRYPTED_BYTES = 4 * 1024 * 1024

export interface CredentialStorageProvider {
  isAsyncEncryptionAvailable(): Promise<boolean>
  encryptStringAsync(value: string): Promise<Buffer>
  decryptStringAsync(value: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>
  getSelectedStorageBackend?(): string
  isEncryptionAvailable?(): boolean
}

export function isProtectedCredential(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(CREDENTIAL_PREFIX)
}

function validateInput(value: unknown): asserts value is string {
  if (typeof value !== 'string') throw new Error('凭据格式无效，未读取或保存凭据。')
  if (value.startsWith(CREDENTIAL_NAMESPACE) && !isProtectedCredential(value)) {
    throw new Error('凭据加密版本不受支持，未读取或覆盖凭据。')
  }
}

function decodeCiphertext(value: string): Buffer {
  const encoded = value.slice(CREDENTIAL_PREFIX.length)
  if (!encoded || encoded.length > Math.ceil(MAX_ENCRYPTED_BYTES / 3) * 4 ||
      encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error('已保存的凭据格式无效，未读取或覆盖凭据。')
  }
  const decoded = Buffer.from(encoded, 'base64')
  if (!decoded.length || decoded.length > MAX_ENCRYPTED_BYTES || decoded.toString('base64') !== encoded) {
    throw new Error('已保存的凭据格式无效，未读取或覆盖凭据。')
  }
  return decoded
}

export function createCredentialProtector(
  source: CredentialStorageProvider | (() => Promise<CredentialStorageProvider>),
  platform: NodeJS.Platform = process.platform
) {
  async function availableProvider(): Promise<CredentialStorageProvider> {
    try {
      const provider = typeof source === 'function' ? await source() : source
      if (platform === 'linux') {
        // Electron 45 exposes the backend identity only through its legacy API.
        // Initialize that identity to reject the insecure fallback, while all
        // encryption/decryption uses the non-blocking asynchronous API.
        const systemStoreAvailable = provider.isEncryptionAvailable?.()
        const selectedBackend = provider.getSelectedStorageBackend?.()
        if (systemStoreAvailable !== true || !selectedBackend ||
            !['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(selectedBackend)) {
          throw new Error('Unsafe system credential backend')
        }
      }
      if (!await provider.isAsyncEncryptionAvailable()) throw new Error('System credential store unavailable')
      return provider
    } catch {
      // Provider errors can contain input or OS-specific details. Never attach
      // them as a cause or log them in a context that may expose credentials.
      throw new Error('系统安全存储不可用，请解锁或启用系统密钥环后重试；凭据未以明文保存。')
    }
  }

  async function revealCredential(value: string): Promise<string> {
    validateInput(value)
    if (!isProtectedCredential(value)) return value
    const encrypted = decodeCiphertext(value)
    const provider = await availableProvider()
    try {
      const result = await provider.decryptStringAsync(encrypted)
      if (typeof result?.result !== 'string') throw new Error('Invalid decryption result')
      return result.result
    } catch {
      throw new Error('无法解密已保存的凭据，请在原系统账户解锁密钥环后重试；原凭据未被覆盖。')
    }
  }

  async function protectCredential(value: string): Promise<string> {
    validateInput(value)
    if (!value) return value
    if (isProtectedCredential(value)) {
      // Migration and repeated writes are idempotent, but a marker alone must
      // never allow corrupt or foreign-account ciphertext to be persisted.
      await revealCredential(value)
      return value
    }
    const provider = await availableProvider()
    try {
      const encrypted = await provider.encryptStringAsync(value)
      if (!Buffer.isBuffer(encrypted) || !encrypted.length || encrypted.length > MAX_ENCRYPTED_BYTES) {
        throw new Error('Invalid encryption result')
      }
      return CREDENTIAL_PREFIX + encrypted.toString('base64')
    } catch {
      throw new Error('凭据加密失败，未保存明文。请解锁系统密钥环后重试。')
    }
  }

  return { protectCredential, revealCredential, isProtectedCredential }
}

// Resolve Electron lazily. Importing this module does not access app readiness
// or initialize the native credential store (including in Node-only tests).
const systemProtector = createCredentialProtector(async () => (await import('electron')).safeStorage)
export const protectCredential = systemProtector.protectCredential
export const revealCredential = systemProtector.revealCredential
