import { isRetiredManagedProvider, isRetiredModelSelection } from './standalone-providers'

export interface TitleBarModelOption {
  id: string
  name: string
  shortName: string
  providerId: string
  providerName: string
  source?: 'local'
  group?: 'local'
  disabled?: boolean
  disabledReason?: string
}

interface ProviderLike {
  id: string
  name: string
  enabled?: boolean
  apiKey?: string
  config?: Record<string, any>
  models?: Array<{
    id: string
    name: string
    enabled?: boolean
  }>
}

export function buildTitleBarModels(providers: ProviderLike[]): TitleBarModelOption[] {
  const models: TitleBarModelOption[] = []

  for (const provider of providers) {
    if (isRetiredManagedProvider(provider)) continue
    const isManagedProvider = !!provider.config?.managedByApp
    const hasUsableAccess = !!provider.apiKey || provider.id === 'ollama'
    if (!provider.enabled || (!hasUsableAccess && !isManagedProvider)) {
      continue
    }

    for (const model of provider.models || []) {
      if (model.enabled === false) {
        continue
      }

      models.push({
        id: model.id,
        name: model.name,
        shortName: model.name.length > 15 ? `${model.name.substring(0, 15)}...` : model.name,
        providerId: provider.id,
        providerName: provider.name,
        source: 'local',
        group: 'local'
      })
    }
  }

  return models
}

export function resolveSelectedTitleBarModel(
  availableModels: TitleBarModelOption[],
  savedSelection: string | null
): { model: TitleBarModelOption | null; shouldClear: boolean; shouldPersist: boolean } {
  if (!savedSelection) {
    return { model: null, shouldClear: false, shouldPersist: false }
  }

  try {
    const parsed = JSON.parse(savedSelection)
    if (isRetiredModelSelection(parsed)) {
      return { model: null, shouldClear: true, shouldPersist: false }
    }
    const providerId = parsed?.provider?.id || parsed?.providerId
    const modelId = parsed?.model?.id || parsed?.modelId
    const model =
      availableModels.find(item => item.id === modelId && item.providerId === providerId) || null

    return {
      model,
      shouldClear: !model,
      shouldPersist: false
    }
  } catch {
    return {
      model: null,
      shouldClear: true,
      shouldPersist: false
    }
  }
}
