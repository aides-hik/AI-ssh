/** Provider discovery preserves API metadata and does not infer tools from arbitrary model names. */
import type { AIModel, ModelParameterCapabilities, ModelReasoningConfig } from '../types/ai-providers.types'
import { DEFAULT_PROVIDERS } from '../types/ai-providers'
import { normalizeAIEndpoint, normalizeGoogleAPIBase } from '../utils/model-capabilities'
import { reasoningMetadataFromAPI } from '../utils/model-reasoning'

export interface ModelFetchResult {
  success: boolean
  models?: AIModel[]
  error?: string
}

type APIRecord = Record<string, any>

function positive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined
}

function catalogue(providerId: string, id: string): AIModel | undefined {
  return DEFAULT_PROVIDERS.find(provider => provider.id === providerId)?.models.find(model => model.id === id)
}

function knownTools(id: string): boolean {
  // Exact documented families and snapshots, never image/audio/deep-research variants or aliases.
  const value = id.toLowerCase().replace(/^(?:openai|deepseek)\//, '')
  return /^(?:gpt-4o(?:-mini)?|gpt-4-turbo|gpt-3\.5-turbo|o3(?:-mini)?|o4-mini|gpt-5(?:\.[1-5])?(?:-(?:mini|nano|codex(?:-mini|-max)?))?|gpt-5\.(?:2|4|5)-pro|gpt-5\.6(?:-(?:sol|terra|luna))?|gpt-6(?:\.1)?-(?:astra|sol|luna)|deepseek-chat|deepseek-flash|deepseek-v4-(?:pro|flash|flash-vision-exp))(?:-\d{4}-?\d{2}-?\d{2})?$/.test(value)
}

function metadataProtocol(providerId: string, endpoint: string): 'openrouter' | 'deepseek' | undefined {
  if (providerId === 'openrouter' || providerId === 'deepseek') return providerId
  try {
    const host = new URL(endpoint).hostname.toLowerCase()
    if (host === 'openrouter.ai') return 'openrouter'
    if (host === 'api.deepseek.com') return 'deepseek'
  } catch { /* Custom endpoint parsing is left to fetch. */ }
  return undefined
}

function arrayField(data: APIRecord, field: string): APIRecord[] {
  if (!Array.isArray(data[field])) throw new Error('模型接口返回格式不正确，缺少模型列表')
  return data[field].filter((item: unknown): item is APIRecord => !!item && typeof item === 'object' && !Array.isArray(item))
}

async function fetchJSON(endpoint: string, apiKey: string, extraHeaders: Record<string, string> = {}): Promise<APIRecord> {
  const response = await fetch(endpoint, {
    headers: { ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}), ...extraHeaders },
    signal: AbortSignal.timeout(15000)
  })
  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)
  const data: unknown = await response.json()
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('模型接口未返回有效 JSON 对象')
  return data as APIRecord
}

async function result(load: () => Promise<AIModel[]>): Promise<ModelFetchResult> {
  try {
    const models = await load()
    return { success: true, models: [...new Map(models.map(model => [model.id, model])).values()] }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : '获取模型失败' }
  }
}

function parsePrice(record: APIRecord): AIModel['price'] {
  if (!record.pricing || typeof record.pricing !== 'object') return undefined
  // Convert only fields with documented per-token units; do not guess units by magnitude.
  const input = Number(record.pricing.prompt ?? record.pricing.input_cost_per_token)
  const output = Number(record.pricing.completion ?? record.pricing.output_cost_per_token)
  return Number.isFinite(input) && input >= 0 && Number.isFinite(output) && output >= 0
    ? { input: input * 1000000, output: output * 1000000 } : undefined
}

function compatibleModel(providerId: string, record: APIRecord, endpoint: string): AIModel | null {
  if (typeof record.id !== 'string' || !record.id.trim()) return null
  const id = record.id
  const known = catalogue(providerId, id)
  const protocol = metadataProtocol(providerId, endpoint)
  const supported: string[] | undefined = Array.isArray(record.supported_parameters) ? record.supported_parameters : undefined
  const input: string[] | undefined = Array.isArray(record.architecture?.input_modalities) ? record.architecture.input_modalities : undefined
  const output: string[] | undefined = Array.isArray(record.architecture?.output_modalities) ? record.architecture.output_modalities : undefined
  const isRouter = protocol === 'openrouter'
  const maxOutputTokens = positive(record.max_output_tokens ?? record.max_completion_tokens ?? record.top_provider?.max_completion_tokens)
  const parameters: ModelParameterCapabilities = {
    ...known?.parameters,
    ...(maxOutputTokens ? { maxOutputTokens } : {}),
    ...(supported ? { temperature: supported.includes('temperature'), topP: supported.includes('top_p') } : {}),
    ...(isRouter ? { apiStyle: 'chat-completions', maxTokensParameter: 'max_tokens' } : {})
  }
  const functionCall = supported ? supported.includes('tools')
    : typeof record.function_calling === 'boolean' ? record.function_calling
    : known?.capabilities.functionCall ?? knownTools(id)
  return {
    ...known,
    id, name: record.name || known?.name || id, description: record.description || known?.description, providerId,
    contextWindow: positive(record.context_window ?? record.context_length ?? record.top_provider?.context_length) ?? known?.contextWindow ?? 0,
    capabilities: {
      text: output ? output.includes('text') : known?.capabilities.text ?? !/^(?:dall-e|gpt-image|text-embedding|whisper|tts|sora)(?:[-.]|$)/i.test(id),
      image: output ? output.includes('image') : known?.capabilities.image ?? false,
      vision: input ? input.includes('image') : known?.capabilities.vision ?? false,
      functionCall
    },
    price: parsePrice(record) ?? known?.price, parameters,
    reasoning: protocol ? reasoningMetadataFromAPI(record, protocol) ?? known?.reasoning : known?.reasoning
  }
}

export function fetchOpenAIModels(apiKey: string, endpoint = 'https://api.openai.com/v1'): Promise<ModelFetchResult> {
  return result(async () => {
    const base = normalizeAIEndpoint(endpoint)
    const data = await fetchJSON(`${base}/models`, apiKey)
    return arrayField(data, 'data')
      .filter(record => typeof record.id === 'string' && /^(?:gpt-|o[134](?:-|$)|dall-e)/.test(record.id))
      .map(record => compatibleModel('openai', record, base)).filter((model): model is AIModel => model !== null)
  })
}

/** Anthropic provides authenticated, paginated model discovery. */
export function fetchAnthropicModels(apiKey = '', endpoint = 'https://api.anthropic.com/v1'): Promise<ModelFetchResult> {
  return result(async () => {
    const base = normalizeAIEndpoint(endpoint)
    const models: AIModel[] = []
    let after = ''
    const seenCursors = new Set<string>()
    for (let page = 0; page < 20; page++) {
      const query = `limit=100${after ? `&after_id=${encodeURIComponent(after)}` : ''}`
      const data = await fetchJSON(`${base}/models?${query}`, apiKey, { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' })
      for (const record of arrayField(data, 'data')) {
        if (typeof record.id !== 'string' || record.lifecycle === 'retired') continue
        const known = catalogue('anthropic', record.id)
        const rawEffort = record.capabilities?.effort
        const efforts = (['low', 'medium', 'high', 'xhigh', 'max'] as const).filter(level => rawEffort?.[level]?.supported === true)
        const reasoning: ModelReasoningConfig | false | undefined = efforts.length
          ? { protocol: 'anthropic', supportedEfforts: efforts, mandatory: true, thinkingMode: record.capabilities?.thinking?.types?.disabled?.supported === false ? 'always' : 'adaptive' }
          : rawEffort?.supported === false ? false : known?.reasoning
        models.push({
          ...known,
          id: record.id, name: record.display_name || known?.name || record.id, providerId: 'anthropic',
          contextWindow: positive(record.max_input_tokens) ?? known?.contextWindow ?? 0,
          capabilities: { text: true, image: false, vision: record.capabilities?.image_input?.supported ?? known?.capabilities.vision ?? false, functionCall: known?.capabilities.functionCall ?? /^claude-/.test(record.id) },
          parameters: { ...known?.parameters, apiStyle: 'anthropic', ...(positive(record.max_tokens) ? { maxOutputTokens: positive(record.max_tokens) } : {}) },
          reasoning
        })
      }
      if (!data.has_more) return models
      if (typeof data.last_id !== 'string' || !data.last_id || seenCursors.has(data.last_id)) throw new Error('模型接口分页游标无效')
      after = data.last_id
      seenCursors.add(after)
    }
    throw new Error('模型列表超过分页上限，请缩小模型范围')
  })
}

export function googleAPIBase(endpoint: string): string {
  return normalizeGoogleAPIBase(endpoint)
}

export function fetchGoogleModels(apiKey: string, endpoint = 'https://generativelanguage.googleapis.com/v1beta'): Promise<ModelFetchResult> {
  return result(async () => {
    const base = googleAPIBase(endpoint)
    const models: AIModel[] = []
    let cursor = ''
    const seenCursors = new Set<string>()
    for (let page = 0; page < 20; page++) {
      const data = await fetchJSON(`${base}/models?pageSize=1000${cursor ? `&pageToken=${encodeURIComponent(cursor)}` : ''}`, '', { 'x-goog-api-key': apiKey })
      for (const record of arrayField(data, 'models')) {
        if (typeof record.name !== 'string' || !Array.isArray(record.supportedGenerationMethods) || !record.supportedGenerationMethods.includes('generateContent')) continue
        const id = record.name.replace(/^models\//, '')
        const known = catalogue('google', id)
        models.push({
          ...known,
          id, name: record.displayName || known?.name || id, description: record.description || known?.description, providerId: 'google',
          contextWindow: positive(record.inputTokenLimit) ?? known?.contextWindow ?? 0,
          capabilities: { text: true, image: known?.capabilities.image ?? false, vision: known?.capabilities.vision ?? false, functionCall: known?.capabilities.functionCall ?? false },
          parameters: { ...known?.parameters, apiStyle: 'gemini', ...(positive(record.outputTokenLimit) ? { maxOutputTokens: positive(record.outputTokenLimit) } : {}) },
          reasoning: record.thinking === false ? false : known?.reasoning
        })
      }
      if (!data.nextPageToken) return models
      if (typeof data.nextPageToken !== 'string' || seenCursors.has(data.nextPageToken)) throw new Error('模型接口分页游标无效')
      cursor = data.nextPageToken
      seenCursors.add(cursor)
    }
    throw new Error('模型列表超过分页上限，请缩小模型范围')
  })
}

export function fetchOpenAICompatibleModels(providerId: string, apiKey: string, endpoint: string): Promise<ModelFetchResult> {
  return result(async () => {
    const base = normalizeAIEndpoint(endpoint)
    const data = await fetchJSON(`${base}/models`, apiKey)
    return arrayField(data, 'data').map(record => compatibleModel(providerId, record, base)).filter((model): model is AIModel => model !== null)
  })
}

export function fetchDeepSeekModels(apiKey: string, endpoint = 'https://api.deepseek.com/v1'): Promise<ModelFetchResult> {
  return fetchOpenAICompatibleModels('deepseek', apiKey, endpoint)
}

export function fetchOpenRouterModels(apiKey: string, endpoint = 'https://openrouter.ai/api/v1'): Promise<ModelFetchResult> {
  return fetchOpenAICompatibleModels('openrouter', apiKey, endpoint)
}

export function fetchOllamaModels(endpoint = 'http://127.0.0.1:11434', apiKey = ''): Promise<ModelFetchResult> {
  return result(async () => {
    const base = normalizeAIEndpoint(endpoint).replace(/\/v1$/, '')
    const data = await fetchJSON(`${base}/api/tags`, apiKey)
    const models: AIModel[] = arrayField(data, 'models').filter(record => typeof (record.model || record.name) === 'string').map(record => ({
      id: record.model || record.name, name: record.name || record.model, providerId: 'ollama', contextWindow: 0,
      capabilities: { text: true, image: false, vision: record.capabilities?.includes('vision') === true, functionCall: record.capabilities?.includes('tools') === true },
      parameters: { apiStyle: 'ollama' }
    }))
    // /tags lists installed names; /show supplies actual tool/vision capabilities and context.
    // Four workers avoid flooding the local daemon when many models are installed.
    let next = 0
    await Promise.all(Array.from({ length: Math.min(4, models.length) }, async () => {
      while (next < models.length) {
        const model = models[next++]
        try {
          const response = await fetch(`${base}/api/show`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
            body: JSON.stringify({ model: model.id }), signal: AbortSignal.timeout(5000)
          })
          if (!response.ok) continue
          const details = await response.json()
          if (Array.isArray(details.capabilities)) {
            model.capabilities.functionCall = details.capabilities.includes('tools')
            model.capabilities.vision = details.capabilities.includes('vision')
            model.capabilities.text = details.capabilities.includes('completion')
          }
          const info = details.model_info
          if (info && typeof info === 'object') {
            const key = typeof info['general.architecture'] === 'string' ? `${info['general.architecture']}.context_length` : ''
            model.contextWindow = positive(info[key]) ?? 0
          }
        } catch { /* Older daemons/proxies may not expose /show; retain the valid installed list. */ }
      }
    }))
    return models
  })
}

export async function fetchModelsForProvider(providerId: string, apiKey: string, endpoint?: string, runtimeProviderId = providerId): Promise<ModelFetchResult> {
  switch (runtimeProviderId) {
    case 'openai': return fetchOpenAIModels(apiKey, endpoint)
    case 'anthropic': return fetchAnthropicModels(apiKey, endpoint)
    case 'google': return fetchGoogleModels(apiKey, endpoint)
    case 'deepseek': return fetchDeepSeekModels(apiKey, endpoint)
    case 'openrouter': return fetchOpenRouterModels(apiKey, endpoint)
    case 'ollama': return fetchOllamaModels(endpoint, apiKey)
    case 'minimax': return { success: false, error: 'MiniMax 未提供公开的模型列表接口，请使用已核对的预设或手动添加模型' }
    default: return endpoint ? fetchOpenAICompatibleModels(providerId, apiKey, endpoint) : { success: false, error: '请先配置服务端点' }
  }
}
