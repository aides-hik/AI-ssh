import type { AIModel, AIProvider, ModelAPIStyle, ModelRequestConfig } from '../types/ai-providers.types'
import { buildReasoningRequest, getReasoningCapability, normalizeReasoningSelection, type ReasoningCapability, type ReasoningSelection } from './model-reasoning'

export interface ModelCapabilities {
  apiStyle: ModelAPIStyle
  protocolLabel: string
  maxOutputTokens?: number
  supportsTemperature: boolean
  supportsTopP: boolean
  supportsTools: boolean
  temperatureRange: [number, number]
  reasoning: ReasoningCapability
}

export interface ModelRequestOptions {
  temperature?: number
  topP?: number
  maxTokens?: number
  frequencyPenalty?: number
  presencePenalty?: number
  reasoningSelection?: ReasoningSelection
  /** A caller may use a documented compatibility transport (e.g. Gemini /openai). */
  apiStyle?: ModelAPIStyle
}

export function getRuntimeProviderId(provider: AIProvider): string {
  return typeof provider.config?.runtimeProviderId === 'string' ? provider.config.runtimeProviderId : provider.id
}

export function normalizeAIEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, '')
}

export function normalizeGoogleAPIBase(endpoint: string): string {
  let base = normalizeAIEndpoint(endpoint).replace(/\/openai$/, '')
  try {
    const url = new URL(base)
    if (!url.pathname || url.pathname === '/') base += '/v1beta'
  } catch { /* fetch reports an invalid custom endpoint. */ }
  return base
}

/** Model metadata overrides transport inference. Custom deployments keep their existing base URL. */
export function getModelAPIStyle(provider: AIProvider, model: AIModel): ModelAPIStyle {
  if (model.parameters?.apiStyle) return model.parameters.apiStyle
  const runtime = getRuntimeProviderId(provider)
  const base = normalizeAIEndpoint(provider.endpoint)
  let host = ''
  try { host = new URL(base).hostname.toLowerCase() } catch { /* A custom URL is validated by fetch. */ }
  if (runtime === 'anthropic' || host === 'api.anthropic.com') return 'anthropic'
  if (runtime === 'google' && !/\/openai(?:\/v1)?$/i.test(base)) return 'gemini'
  if (runtime === 'ollama' && !/\/v1$/i.test(base)) return 'ollama'
  return getReasoningCapability(provider, model).protocol
}

export function getModelCapabilities(provider: AIProvider, model: AIModel, selection?: ReasoningSelection): ModelCapabilities {
  const runtime = getRuntimeProviderId(provider)
  const reasoning = getReasoningCapability(provider, model)
  const chosen = normalizeReasoningSelection(reasoning, selection ?? model.requestConfig?.reasoning ?? 'default')
  const id = model.id.toLowerCase().replace(/^(?:openai|google|models)\//, '')
  const apiStyle = getModelAPIStyle(provider, model)
  // Sampling is invalid for reasoning OpenAI requests, and removed in recent Claude/Gemini models.
  // Explicit none restores sampling only on OpenAI families whose docs allow it.
  const openAINone = chosen === 'none' && reasoning.adapter === 'openai' && /^(?:gpt-5\.[1245](?:-(?:mini|nano))?|gpt-5\.6(?:-(?:sol|terra|luna))?|gpt-6-(?:sol|luna))(?:-\d{4}-?\d{2}-?\d{2})?$/.test(id)
  const removedClaudeSampling = /^claude-(?:(?:opus-4-[78])|(?:opus|sonnet|haiku|fable|mythos)-5(?:-[015])?)(?:-|$)/.test(id)
  const removedGeminiSampling = /^gemini-(?:4(?:[.-]|$)|3\.[678](?:-|$))/.test(id)
  const restrictedOpenAISampling = reasoning.omitTemperature && /^(?:o[134](?:-|$)|gpt-[56](?:[.-]|$))/.test(id) && !openAINone
  const noSampling = removedClaudeSampling || removedGeminiSampling || (reasoning.omitTemperature && !openAINone)
  const max = model.parameters?.maxOutputTokens
  return {
    apiStyle,
    protocolLabel: { 'chat-completions': 'Chat Completions', responses: 'Responses', anthropic: 'Claude Messages', gemini: 'Gemini GenerateContent', ollama: 'Ollama Chat' }[apiStyle],
    maxOutputTokens: typeof max === 'number' && Number.isFinite(max) && max > 0 ? Math.floor(max) : undefined,
    supportsTemperature: !removedClaudeSampling && !removedGeminiSampling && !restrictedOpenAISampling && (model.parameters?.temperature === true || (!noSampling && model.parameters?.temperature !== false)),
    supportsTopP: !removedClaudeSampling && !removedGeminiSampling && !restrictedOpenAISampling && (model.parameters?.topP === true || (!noSampling && model.parameters?.topP !== false)),
    supportsTools: model.capabilities.functionCall,
    temperatureRange: [0, runtime === 'anthropic' ? 1 : 2],
    reasoning
  }
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function getModelRequestSettings(provider: AIProvider, model: AIModel, options: ModelRequestOptions = {}): ModelRequestConfig {
  const configured = model.requestConfig
  // Provider values are a compatibility fallback for previously configured defaults.
  return {
    temperature: finite(options.temperature ?? configured?.temperature ?? provider.config?.temperature),
    topP: finite(options.topP ?? configured?.topP ?? provider.config?.topP),
    maxTokens: finite(options.maxTokens ?? configured?.maxTokens ?? provider.config?.maxTokens),
    reasoning: options.reasoningSelection ?? configured?.reasoning ?? 'default'
  }
}

/** Only returns supported fields; an omitted default never becomes an invented sampling value. */
export function buildModelParameterBody(provider: AIProvider, model: AIModel, options: ModelRequestOptions = {}): Record<string, unknown> {
  const settings = getModelRequestSettings(provider, model, options)
  const capability = getModelCapabilities(provider, model, settings.reasoning)
  const style = options.apiStyle ?? capability.apiStyle
  const selection = normalizeReasoningSelection(capability.reasoning, settings.reasoning)
  const reasoning = buildReasoningRequest(provider, model, selection)
  let body: Record<string, unknown> = { ...reasoning.body }
  if (style === 'anthropic' && capability.reasoning.adapter !== 'anthropic') body = {}
  if (style !== 'anthropic' && capability.reasoning.adapter === 'anthropic') body = {}
  if (capability.reasoning.adapter === 'openai' && style === 'responses' && selection !== 'default') body = { reasoning: { effort: selection } }
  if (capability.reasoning.adapter === 'openai' && style === 'chat-completions' && selection !== 'default') body = { reasoning_effort: selection }
  const temperature = capability.supportsTemperature && settings.temperature !== undefined
    ? Math.max(capability.temperatureRange[0], Math.min(capability.temperatureRange[1], settings.temperature)) : undefined
  const topP = capability.supportsTopP && settings.topP !== undefined && settings.topP > 0 ? Math.min(1, settings.topP) : undefined
  const maxTokens = settings.maxTokens !== undefined && settings.maxTokens >= 1
    ? Math.min(Math.floor(settings.maxTokens), capability.maxOutputTokens ?? Number.MAX_SAFE_INTEGER) : undefined
  if (style === 'gemini') {
    const generationConfig: Record<string, unknown> = {}
    if (temperature !== undefined) generationConfig.temperature = temperature
    if (topP !== undefined) generationConfig.topP = topP
    if (maxTokens !== undefined) generationConfig.maxOutputTokens = maxTokens
    if (capability.reasoning.adapter === 'gemini' && selection !== 'default') {
      const isBudget = /^(?:models\/)?gemini-2\.5-/.test(model.id)
      generationConfig.thinkingConfig = isBudget
        ? { thinkingBudget: { none: 0, minimal: 1024, low: 1024, medium: 8192, high: 24576 }[selection as 'low'] }
        : { thinkingLevel: selection }
    }
    return Object.keys(generationConfig).length ? { generationConfig } : {}
  }
  if (style === 'ollama') {
    const ollamaOptions: Record<string, unknown> = {}
    if (temperature !== undefined) ollamaOptions.temperature = temperature
    if (topP !== undefined) ollamaOptions.top_p = topP
    if (maxTokens !== undefined) ollamaOptions.num_predict = maxTokens
    return Object.keys(ollamaOptions).length ? { options: ollamaOptions } : {}
  }
  if (temperature !== undefined) body.temperature = temperature
  // Claude disallows configuring temperature and top_p together on newer model generations.
  if (topP !== undefined && !(style === 'anthropic' && temperature !== undefined)) body.top_p = topP
  if (maxTokens !== undefined) {
    const id = model.id.replace(/^openai\//, '')
    const openAITokens = /^(?:o[134](?:-|$)|gpt-[56](?:[.-]|$))/.test(id)
    let isOpenRouter = getRuntimeProviderId(provider) === 'openrouter'
    try { isOpenRouter ||= new URL(provider.endpoint).hostname === 'openrouter.ai' } catch { /* Custom endpoint. */ }
    const parameter = style === 'responses' ? 'max_output_tokens' : style === 'anthropic' ? 'max_tokens'
      : model.parameters?.maxTokensParameter ?? (openAITokens && !isOpenRouter ? 'max_completion_tokens' : 'max_tokens')
    body[parameter] = maxTokens
  }
  if (style === 'anthropic' && body.max_tokens === undefined) body.max_tokens = Math.min(4096, capability.maxOutputTokens ?? 4096)
  if (style === 'anthropic' && capability.reasoning.thinkingMode === 'budget' && selection !== 'none' && selection !== 'default') {
    const thinking = body.thinking as { budget_tokens?: number } | undefined
    if (thinking?.budget_tokens) {
      // Claude requires budget_tokens >= 1024 and strictly less than max_tokens.
      const outputLimit = Number(body.max_tokens)
      if (outputLimit > 1024) thinking.budget_tokens = Math.min(thinking.budget_tokens, outputLimit - 1)
      else delete body.thinking
    }
  }
  if (style === 'chat-completions' && !capability.reasoning.omitTemperature) {
    const frequency = finite(options.frequencyPenalty)
    const presence = finite(options.presencePenalty)
    if (frequency !== undefined) body.frequency_penalty = Math.max(-2, Math.min(2, frequency))
    if (presence !== undefined) body.presence_penalty = Math.max(-2, Math.min(2, presence))
  }
  return body
}
