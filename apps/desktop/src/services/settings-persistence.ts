import { isRetiredManagedProvider, isRetiredModelSelection } from '../utils/standalone-providers'

export type SettingsDocument = Record<string, unknown>
export interface SettingsBridge {
  get(userId?: string): Promise<unknown>
  save(userId: string, settings: SettingsDocument): Promise<{ success: boolean }>
  reset(userId?: string): Promise<{ success: boolean }>
  export(userId: string, path: string): Promise<{ success: boolean }>
  import(userId: string, path: string): Promise<{ success: boolean; settings?: unknown }>
}
export interface SettingsCache {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

const legacyKeys = ['app-settings', 'aiProviderConfigs', 'appSettings'] as const
const marker = 'credentialStorageVersion'

function record(value: unknown): value is SettingsDocument {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function copy<T>(value: T): T {
  // Remove Vue proxies and undefined fields before comparing IPC round trips.
  return JSON.parse(JSON.stringify(value)) as T
}

export function selectedModelReference(value: unknown): SettingsDocument | null {
  if (!record(value) || isRetiredModelSelection(value)) return null
  const provider = record(value.provider) ? value.provider : undefined
  const model = record(value.model) ? value.model : undefined
  const providerId = value.providerId ?? provider?.id
  const modelId = value.modelId ?? model?.id
  if (typeof providerId !== 'string' || typeof modelId !== 'string' || !providerId || !modelId) return null
  return { source: 'local', providerId, modelId }
}

function sanitize(settings: SettingsDocument): SettingsDocument {
  const result = copy(settings)
  if (Array.isArray(result.aiProviders)) {
    result.aiProviders = result.aiProviders.filter(provider => record(provider) && !isRetiredManagedProvider(provider))
  }
  return result
}

function mergeMissing(primary: SettingsDocument, fallback: SettingsDocument): SettingsDocument {
  const result = { ...fallback, ...primary }
  for (const [key, value] of Object.entries(primary)) {
    if (record(value) && record(fallback[key])) result[key] = mergeMissing(value, fallback[key])
  }
  const providers = (Array.isArray(primary.aiProviders) ? primary.aiProviders : []).filter(record)
  const fallbackProviders = (Array.isArray(fallback.aiProviders) ? fallback.aiProviders : []).filter(record)
  if (Array.isArray(primary.aiProviders) || Array.isArray(fallback.aiProviders)) {
    // A current provider is authoritative in its entirety: never restore an old
    // key, removed model or enabled flag from a persisted model snapshot.
    const ids = new Set(providers.map(provider => provider.id))
    result.aiProviders = [...providers, ...fallbackProviders.filter(provider => !ids.has(provider.id))]
  }
  return result
}

function contains(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length && expected.every((value, index) => contains(actual[index], value))
  if (record(expected)) return record(actual) && Object.entries(expected).every(([key, value]) => contains(actual[key], value))
  return actual === expected
}

function parseLegacy(serialized: string): unknown {
  try { return JSON.parse(serialized) }
  catch { throw new Error('旧设置格式有误，原有配置已保留，请先修复后重试。') }
}

/** All desktop settings persist through the main process. Browser caches are
 * consumed only for migration, and removed only after a verified IPC write. */
export class ProtectedSettingsPersistence {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly bridge: () => SettingsBridge,
    private readonly caches: () => SettingsCache[],
    private readonly userId = 'local-user'
  ) {}

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation)
    this.queue = result.then(() => undefined, () => undefined)
    return result
  }

  private async storeAndVerify(settings: SettingsDocument): Promise<SettingsDocument> {
    const response = await this.bridge().save(this.userId, settings)
    if (!response?.success) throw new Error('设置未能保存，原有配置已保留。')
    const verified = await this.bridge().get(this.userId)
    if (!record(verified) || !contains(verified, settings)) throw new Error('无法确认设置已完整保存，原有配置已保留。')
    return verified
  }

  private async load(): Promise<SettingsDocument> {
    const stored = await this.bridge().get(this.userId)
    if (!record(stored)) throw new Error('无法读取桌面设置，原有配置已保留。')
    const current = sanitize(stored)
    const caches = this.caches()
    const found = caches.flatMap(cache => legacyKeys.flatMap(key => {
      const serialized = cache.getItem(key)
      return serialized === null ? [] : [{ cache, key, serialized }]
    }))
    const selections = caches.flatMap(cache => {
      const serialized = cache.getItem('selectedAIModel')
      if (!serialized) return []
      let parsed: unknown
      try { parsed = JSON.parse(serialized) } catch { parsed = null }
      return [{ cache, parsed }]
    })
    let legacy: SettingsDocument = {}
    if (current[marker] !== 1) {
      // Session storage is a fallback; the local app-settings document was the
      // most recent source of truth in the previous desktop implementation.
      for (const item of found) {
        const parsed = parseLegacy(item.serialized)
        const candidate = item.key === 'aiProviderConfigs' && Array.isArray(parsed)
          ? { aiProviders: parsed } : parsed
        if (!record(candidate)) throw new Error('旧设置格式有误，原有配置已保留，请先修复后重试。')
        legacy = mergeMissing(legacy, candidate)
      }
      for (const { parsed } of selections) {
        if (record(parsed) && record(parsed.provider) && record(parsed.model) && selectedModelReference(parsed)) {
          const provider = { ...parsed.provider }
          if (!Array.isArray(provider.models)) provider.models = [parsed.model]
          legacy = mergeMissing(legacy, { aiProviders: [provider] })
        }
      }
    }
    const target = sanitize({ ...mergeMissing(current, legacy), [marker]: 1 })
    const needsWrite = current[marker] !== 1 || found.length > 0 || JSON.stringify(current) !== JSON.stringify(stored)
    const verified = needsWrite ? await this.storeAndVerify(target) : current
    // No cache changes occur until all migrated credentials survive a complete
    // save/read round trip. No credentials are written back to browser storage.
    for (const { cache, key } of found) cache.removeItem(key)
    for (const { cache, parsed } of selections) {
      const reference = selectedModelReference(parsed)
      if (reference) cache.setItem('selectedAIModel', JSON.stringify(reference))
      else cache.removeItem('selectedAIModel')
    }
    return verified
  }

  get(): Promise<SettingsDocument> {
    return this.serial(() => this.load())
  }

  save(settings: SettingsDocument): Promise<{ success: boolean }> {
    const snapshot = sanitize(settings)
    return this.serial(async () => {
      await this.load()
      await this.storeAndVerify({ ...snapshot, [marker]: 1 })
      return { success: true }
    })
  }

  reset(): Promise<{ success: boolean }> {
    return this.serial(async () => {
      const response = await this.bridge().reset(this.userId)
      if (!response?.success) throw new Error('重置设置失败，原有配置已保留。')
      const defaults = await this.bridge().get(this.userId)
      if (!record(defaults)) throw new Error('无法确认设置已重置。')
      await this.storeAndVerify({ ...defaults, [marker]: 1 })
      for (const cache of this.caches()) {
        for (const key of [...legacyKeys, 'selectedAIModel']) cache.removeItem(key)
      }
      return { success: true }
    })
  }

  export(path: string): Promise<{ success: boolean }> {
    return this.serial(async () => {
      await this.load()
      return this.bridge().export(this.userId, path)
    })
  }

  import(path: string): Promise<{ success: boolean; settings?: SettingsDocument }> {
    return this.serial(async () => {
      await this.load()
      const result = await this.bridge().import(this.userId, path)
      if (!result?.success) throw new Error('导入设置失败，原有配置已保留。')
      return { success: true, settings: await this.load() }
    })
  }
}
