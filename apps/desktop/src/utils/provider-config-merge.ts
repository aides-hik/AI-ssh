import type { AIModel, AIProvider, ProviderConfig } from '../types/ai-providers'
import type { AIProviderConfig } from '../services/settings.service'
import { LEGACY_PROVIDER_CATALOG } from './provider-catalog-legacy'

type SavedProviderConfig = AIProviderConfig & Partial<Pick<AIProvider, 'isDefault'>>

const normalizedEndpoint = (endpoint: string | undefined) => endpoint?.trim().replace(/\/+$/, '')
const MINIMAX_PREVIOUS_IDS: Record<string, string> = {
  'MiniMax-M2.7': 'MiniMax-M2.5',
  'MiniMax-M2.7-highspeed': 'MiniMax-M2.5-highspeed'
}

function hasCustomEndpoint(defaultProvider: ProviderConfig, savedProvider: SavedProviderConfig) {
  const endpoint = normalizedEndpoint(savedProvider.endpoint)
  return !!endpoint && endpoint !== normalizedEndpoint(defaultProvider.endpoint) &&
    endpoint !== normalizedEndpoint(LEGACY_PROVIDER_CATALOG[defaultProvider.id]?.endpoint)
}

function mergeProviderModels(defaultProvider: ProviderConfig, savedProvider: SavedProviderConfig): AIModel[] {
  if (!Array.isArray(savedProvider.models)) return structuredClone(defaultProvider.models)
  // An intentionally empty list must survive loading and exporting settings.
  if (!savedProvider.models.length) return []
  // User deployments may assign an official ID to a completely different model.
  if (hasCustomEndpoint(defaultProvider, savedProvider) || ['custom-openai', 'ollama'].includes(defaultProvider.id)) {
    return structuredClone(savedProvider.models)
  }

  const savedModels = new Map(savedProvider.models.map(model => [model.id, model]))
  const legacyIds = new Set(LEGACY_PROVIDER_CATALOG[defaultProvider.id]?.models || [])
  const currentIds = new Set(defaultProvider.models.map(model => model.id))
  const previousIds = new Set(defaultProvider.id === 'minimax'
    ? defaultProvider.models.map(model => MINIMAX_PREVIOUS_IDS[model.id]).filter(Boolean) : [])
  const allDisabled = savedProvider.models.every(model => model.enabled === false)
  const currentModels = defaultProvider.models.map(model => {
    const previous = defaultProvider.id === 'minimax' ? savedModels.get(MINIMAX_PREVIOUS_IDS[model.id]) : undefined
    const saved = savedModels.get(model.id) || (previous?.isCustom ? undefined : previous)
    if (saved?.isCustom) return structuredClone(saved)
    return {
      ...structuredClone(model),
      ...(saved ? { enabled: saved.enabled, requestConfig: saved.requestConfig } : allDisabled ? { enabled: false } : {})
    }
  })
  const extras = savedProvider.models.filter(model =>
    !currentIds.has(model.id) && (model.isCustom || (!legacyIds.has(model.id) && !previousIds.has(model.id)))
  )
  return [...currentModels, ...structuredClone(extras)]
}

export function mergeSavedProviderWithDefault(
  defaultProvider: ProviderConfig,
  savedProvider: SavedProviderConfig
) {
  const legacyEndpoint = normalizedEndpoint(LEGACY_PROVIDER_CATALOG[defaultProvider.id]?.endpoint)
  const migrateEndpoint = legacyEndpoint && normalizedEndpoint(savedProvider.endpoint) === legacyEndpoint
  const config = { ...defaultProvider.config, ...savedProvider.config }
  // Catalog facts are maintained by the app; user request defaults are preserved.
  for (const key of ['catalogStatus', 'docsUrl', 'verifiedAt']) {
    if (defaultProvider.config?.[key] !== undefined) config[key] = defaultProvider.config[key]
  }
  return {
    ...defaultProvider,
    ...savedProvider,
    endpoint: migrateEndpoint ? defaultProvider.endpoint : savedProvider.endpoint ?? defaultProvider.endpoint,
    apiKey: savedProvider.apiKey || defaultProvider.apiKey || '',
    enabled: defaultProvider.config?.catalogStatus === 'unsupported' ? false : savedProvider.enabled ?? false,
    isDefault: savedProvider.isDefault ?? false,
    config,
    models: mergeProviderModels(defaultProvider, savedProvider)
  }
}
