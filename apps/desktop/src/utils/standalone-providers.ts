interface ProviderAccess {
  id?: string
  endpoint?: string
  baseURL?: string
  baseUrl?: string
  apiBaseUrl?: string
  apiUrl?: string
  config?: Record<string, any>
}

// Migration-only list: these retired origins must never be restored from cache.
const RETIRED_SERVICE_HOSTS = [
  'tx07.cn',
  'aifuqiang.win',
  '151.245.90.96',
  '110.42.111.221',
  'ai-ssh-assistant.app'
]

export function isRetiredServiceUrl(value: unknown): boolean {
  if (typeof value !== 'string' || !value.trim()) return false
  try {
    const hostname = new URL(value.includes('://') ? value : `https://${value}`)
      .hostname.toLowerCase().replace(/\.$/, '')
    return RETIRED_SERVICE_HOSTS.some(host => hostname === host || hostname.endsWith(`.${host}`))
  } catch {
    return false
  }
}

// Reject the retired application-managed provider, including cached runtime aliases.
export function isRetiredManagedProvider(provider: ProviderAccess | null | undefined): boolean {
  return (
    provider?.id === 'official' ||
    provider?.config?.runtimeProviderId === 'official' ||
    [provider, provider?.config].some(config =>
      ['endpoint', 'baseURL', 'baseUrl', 'apiBaseUrl', 'apiBaseURL', 'apiUrl', 'url']
        .some(key => isRetiredServiceUrl((config as Record<string, any> | undefined)?.[key]))
    )
  )
}

export function isRetiredModelSelection(selection: any): boolean {
  return (
    selection?.source === 'official' ||
    selection?.providerId === 'official' ||
    isRetiredManagedProvider(selection?.provider)
  )
}

export function pruneRetiredProviders<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.filter(provider => !isRetiredManagedProvider(provider)) as T
  }
  if (value && typeof value === 'object') {
    const settings = { ...value } as Record<string, any>
    for (const key of ['aiProviders', 'aiProviderConfigs']) {
      if (Array.isArray(settings[key])) {
        settings[key] = pruneRetiredProviders(settings[key])
      }
    }
    return settings as T
  }
  return value
}

export function clearRetiredAccountSession(): void {
  for (const storage of [localStorage, sessionStorage]) {
    storage.removeItem('userToken')
    storage.removeItem('userInfo')
    storage.removeItem('refreshToken')
    if (isRetiredServiceUrl(storage.getItem('apiUrl'))) storage.removeItem('apiUrl')
    // Leave old settings intact until ProtectedSettingsPersistence verifies
    // their encrypted replacement. That migration also rejects retired providers.
    const savedSelection = storage.getItem('selectedAIModel')
    if (!savedSelection) continue
    try {
      if (isRetiredModelSelection(JSON.parse(savedSelection))) {
        storage.removeItem('selectedAIModel')
      }
    } catch {
      storage.removeItem('selectedAIModel')
    }
  }
}
