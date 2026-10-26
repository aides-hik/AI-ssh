import { isCredentialField, isCredentialHeaderContainer } from '../../src/utils/credential-fields'
import { protectCredential, revealCredential } from './credential-protector'

type Row = Record<string, unknown>
export interface CredentialStorageBackend {
  create(model: string, data: any): Promise<any>
  update(model: string, options: any): Promise<any>
  findMany(model: string, options?: any): Promise<any[]>
  findUnique(model: string, options: any): Promise<any>
  [key: string]: any
}

export interface CredentialCodec {
  protect(value: string): Promise<string>
  reveal(value: string): Promise<string>
}

const systemCodec: CredentialCodec = { protect: protectCredential, reveal: revealCredential }
const sshFields = new Set(['password', 'privateKey', 'passphrase'])

async function mapSettings(value: unknown, transform: (value: string) => Promise<string>, headers = false): Promise<unknown> {
  if (Array.isArray(value)) return Promise.all(value.map(item => mapSettings(item, transform, headers)))
  if (!value || typeof value !== 'object' || value instanceof Date) return value
  const result: Array<[string, unknown]> = []
  for (const [key, item] of Object.entries(value)) {
    if ((headers || isCredentialField(key)) && item !== null && item !== undefined) {
      if (typeof item !== 'string') throw new Error('凭据必须为文本，请检查配置。')
      result.push([key, await transform(item)])
    } else {
      result.push([key, await mapSettings(item, transform, isCredentialHeaderContainer(key))])
    }
  }
  return Object.fromEntries(result)
}

async function mapRow(model: string, value: unknown, transform: (value: string) => Promise<string>): Promise<any> {
  if (!value || typeof value !== 'object') return value
  const row = value as Row
  const result: Row = { ...row }
  if (model === 'SSHConnection') {
    for (const field of sshFields) {
      if (row[field] === undefined || row[field] === null) continue
      if (typeof row[field] !== 'string') throw new Error('SSH 凭据格式无效，请检查连接配置。')
      result[field] = await transform(row[field])
    }
  } else if (model === 'UserSettings' && row.data !== undefined) {
    result.data = await mapSettings(row.data, transform)
  }
  return result
}

/**
 * Enforce protection at the Electron storage boundary for all callers, including
 * imports and bulk writes. Runtime consumers receive decrypted copies only.
 */
export function createCredentialStorage<T extends CredentialStorageBackend>(
  backend: T,
  codec: CredentialCodec = systemCodec,
  compact = async () => { await backend.compactLocalStorage?.() }
): T {
  let queue: Promise<unknown> = Promise.resolve()
  const serialized = <R>(operation: () => Promise<R>): Promise<R> => {
    const result = queue.then(operation, operation)
    queue = result.catch(() => undefined)
    return result
  }
  const protect = (model: string, row: unknown) => mapRow(model, row, value => codec.protect(value))
  const reveal = (model: string, row: unknown) => mapRow(model, row, value => codec.reveal(value))

  async function readAndMigrate(model: string, row: any): Promise<any> {
    if (!row) return row
    const runtime = await reveal(model, row)
    const protectedRow = await protect(model, row)
    if (JSON.stringify(row) !== JSON.stringify(protectedRow)) {
      // Only changed protected fields are written. The untouched configuration,
      // timestamps and selector remain intact, and no plaintext is returned
      // until the encrypted write has succeeded.
      const data = Object.fromEntries(Object.entries(protectedRow).filter(([key, value]) =>
        JSON.stringify(value) !== JSON.stringify(row[key])))
      await backend.update(model, { where: { id: row.id }, data })
      await compact()
    }
    return runtime
  }

  const overrides: Record<string, (...args: any[]) => Promise<any>> = {
    create: (model, data) => serialized(async () => reveal(model, await backend.create(model, await protect(model, data)))),
    update: (model, options) => serialized(async () => readAndMigrate(model, await backend.update(model, {
      ...options, data: await protect(model, options.data)
    }))),
    findMany: (model, options) => serialized(async () => {
      const rows = await backend.findMany(model, options)
      const result = []
      for (const row of rows) result.push(await readAndMigrate(model, row))
      return result
    }),
    findUnique: (model, options) => serialized(async () => readAndMigrate(model, await backend.findUnique(model, options))),
    createMany: (model, rows) => serialized(async () => backend.createMany(model, await Promise.all(rows.map((row: Row) => protect(model, row))))),
    updateMany: (model, options) => serialized(async () => backend.updateMany(model, { ...options, data: await protect(model, options.data) })),
    delete: (model, options) => serialized(async () => {
      // Deletion remains possible if the system keyring cannot be unlocked.
      const result = await backend.delete(model, options)
      await compact()
      if (model === 'SSHConnection') return result && { ...result, password: undefined, privateKey: undefined, passphrase: undefined }
      if (model === 'UserSettings') return result && { ...result, data: undefined }
      return result
    }),
    deleteMany: (model, options) => serialized(async () => {
      const result = await backend.deleteMany(model, options)
      if (model === 'SSHConnection' || model === 'UserSettings') await compact()
      return result
    }),
    transaction: fn => serialized(async () => {
      let needsCompaction = false
      const result = await backend.transaction((tx: T) => fn(createCredentialStorage(tx, codec, async () => {
        // VACUUM/checkpoint must run after COMMIT, never inside a transaction.
        needsCompaction = true
      })))
      if (needsCompaction) await compact()
      return result
    })
  }
  return new Proxy(backend, {
    get(target, property) {
      if (typeof property === 'string' && overrides[property]) return overrides[property]
      const value = Reflect.get(target, property)
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value
    }
  })
}

/** Migrate every saved record, including disconnected/archived connections. */
export async function migrateStoredCredentials(backend: CredentialStorageBackend, codec: CredentialCodec = systemCodec): Promise<void> {
  const pending: Array<{ model: string; id: unknown; data: Row }> = []
  for (const model of ['SSHConnection', 'UserSettings']) {
    const rows = await backend.findMany(model)
    for (const row of rows) {
      const protectedRow = await mapRow(model, row, value => codec.protect(value))
      const data = Object.fromEntries(Object.entries(protectedRow).filter(([key, value]) =>
        JSON.stringify(value) !== JSON.stringify(row[key])))
      if (Object.keys(data).length) pending.push({ model, id: row.id, data })
    }
  }
  // Prepare all ciphertext first. A locked keyring cannot cause a partial
  // plaintext-to-ciphertext migration or overwrite an unreadable record.
  if (pending.length) await backend.transaction(async (tx: CredentialStorageBackend) => {
    for (const { model, id, data } of pending) await tx.update(model, { where: { id }, data })
  })
  if (pending.length) await backend.compactLocalStorage?.()
}
