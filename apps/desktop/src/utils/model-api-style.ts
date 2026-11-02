import type { AIModel, AIProvider, ModelAPIStyle } from '../types/ai-providers.types'

/** Resolve an explicit/native transport without consulting reasoning capabilities. */
export function getDeclaredModelAPIStyle(provider: AIProvider, model: AIModel): ModelAPIStyle | undefined {
  if (model.parameters?.apiStyle) return model.parameters.apiStyle
  const runtime = typeof provider.config?.runtimeProviderId === 'string' ? provider.config.runtimeProviderId : provider.id
  const base = provider.endpoint.trim().replace(/\/+$/, '')
  let host = ''
  try { host = new URL(base).hostname.toLowerCase() } catch { /* Fetch validates custom URLs. */ }
  if (runtime === 'anthropic' || host === 'api.anthropic.com') return 'anthropic'
  if (runtime === 'google' && !/\/openai(?:\/v1)?$/i.test(base)) return 'gemini'
  if (runtime === 'ollama' && !/\/v1$/i.test(base)) return 'ollama'
  return undefined
}
