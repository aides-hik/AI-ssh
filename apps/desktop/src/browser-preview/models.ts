import { DEFAULT_PROVIDERS, type AIModel, type AIProvider } from '../types/ai-providers'
import type { AppSettings } from '../services/settings.service'

const providerId = 'prism-browser-preview'
const model = (id: string, name: string, reasoning: AIModel['reasoning']): AIModel => ({
  id,
  name,
  providerId,
  contextWindow: 128000,
  enabled: true,
  capabilities: { text: true, image: false, functionCall: true, vision: false },
  parameters: { apiStyle: 'chat-completions', maxOutputTokens: 8192 },
  reasoning
})

export const PREVIEW_PROVIDER: AIProvider = {
  id: providerId,
  name: 'Prism 演示模型',
  description: '网页预览专用的模拟模型，用于测试模型切换与推理强度。',
  icon: 'bi-stars',
  website: '',
  endpoint: 'https://models.prism-preview.invalid/v1',
  apiKey: 'preview-only-not-a-real-key',
  enabled: true,
  isDefault: false,
  config: { runtimeProviderId: 'custom-openai' },
  models: [
    model('preview-pro', 'Prism Pro · 多档推理', {
      protocol: 'openai',
      supportedEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max']
    }),
    model('preview-lite', 'Prism Lite · 三档推理', {
      protocol: 'openai',
      supportedEfforts: ['low', 'medium', 'high'],
      mandatory: true
    }),
    model('preview-think', 'Prism Think · 思考开关', {
      protocol: 'qwen',
      supportsToggle: true
    }),
    model('preview-chat', 'Prism Chat · 普通对话', false)
  ]
}

/** Called only by the browser preview entry, before mounting the real application. */
export function installPreviewModels(storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage) {
  // The resolver uses this catalogue to validate providers. Never replace a real preset.
  if (!DEFAULT_PROVIDERS.some(provider => provider.id === providerId)) {
    DEFAULT_PROVIDERS.push(structuredClone(PREVIEW_PROVIDER))
  }

  const raw = storage.getItem('app-settings')
  let settings: AppSettings
  try {
    settings = raw ? JSON.parse(raw) : { theme: 'dark', language: 'zh-CN' }
  } catch {
    return // Leave malformed user data intact for the normal settings error handling.
  }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return
  if (settings.aiProviders !== undefined && !Array.isArray(settings.aiProviders)) return

  const providers = settings.aiProviders || []
  if (!providers.some(provider => provider.id === providerId)) {
    storage.setItem(
      'app-settings',
      JSON.stringify({
        ...settings,
        aiProviders: [...providers, structuredClone(PREVIEW_PROVIDER)]
      })
    )
    if (!storage.getItem('selectedAIModel')) {
      storage.setItem(
        'selectedAIModel',
        JSON.stringify({
          source: 'local',
          providerId: PREVIEW_PROVIDER.id,
          modelId: PREVIEW_PROVIDER.models[0].id
        })
      )
    }
  }
}
