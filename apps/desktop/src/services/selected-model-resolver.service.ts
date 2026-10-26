import { DEFAULT_PROVIDERS } from '../types/ai-providers'
import type { AIModel, AIProvider } from '../types/ai-providers.types'
import type { AIProviderConfig } from './settings.service'
import { isRetiredManagedProvider, isRetiredModelSelection } from '../utils/standalone-providers'
import { mergeSavedProviderWithDefault } from '../utils/provider-config-merge'

export interface PersistedSelectedModel {
  source?: 'local' | 'official'
  providerId?: string
  modelId?: string
  provider?: AIProvider
  model?: AIModel
}

export interface ResolvedSelectedModel {
  source: 'local'
  providerId: string
  providerName: string
  modelId: string
  modelName: string
  supportsDirectClientCall: boolean
  supportsManagedServerCall: boolean
  provider: AIProvider | null
  model: AIModel | null
}

function findLocalProvider(settingsProviders: AIProviderConfig[], providerId: string) {
  const savedConfig = settingsProviders.find(provider => provider.id === providerId)
  const defaultProvider = DEFAULT_PROVIDERS.find(provider => provider.id === providerId)
  if (!savedConfig || !defaultProvider || isRetiredManagedProvider(savedConfig)) {
    return null
  }

  return mergeSavedProviderWithDefault(defaultProvider, savedConfig)
}

export function resolveSelectedModel(
  savedSelection: string | null,
  settingsProviders: AIProviderConfig[]
): ResolvedSelectedModel | null {
  if (!savedSelection) {
    return null
  }

  try {
    const parsed = JSON.parse(savedSelection) as PersistedSelectedModel

    if (isRetiredModelSelection(parsed)) {
      return null
    }

    const providerId = parsed.providerId || parsed.provider?.id
    const modelId = parsed.modelId || parsed.model?.id
    if (providerId && modelId && settingsProviders.some(provider => provider.id === providerId)) {
      const provider = findLocalProvider(settingsProviders, providerId)
      const model = provider?.models.find(model => model.id === modelId)
      // Saved snapshots must never restore stale credentials or a disabled/retired preset.
      if (!provider || !model || provider.enabled === false || model.enabled === false) return null
      return {
        source: 'local', providerId: provider.id, providerName: provider.name,
        modelId: model.id, modelName: model.name,
        supportsDirectClientCall: true, supportsManagedServerCall: false, provider, model
      }
    }

    if (parsed.providerId && parsed.modelId) {
      const provider = findLocalProvider(settingsProviders, parsed.providerId)
      const model = provider?.models?.find(item => item.id === parsed.modelId) || null
      if (!provider || !model) {
        return null
      }

      return {
        source: 'local',
        providerId: provider.id,
        providerName: provider.name,
        modelId: model.id,
        modelName: model.name,
        supportsDirectClientCall: true,
        supportsManagedServerCall: false,
        provider,
        model
      }
    }

    return null
  } catch {
    return null
  }
}
