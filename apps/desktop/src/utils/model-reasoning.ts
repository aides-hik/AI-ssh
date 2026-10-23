import type { AIModel, AIProvider, ModelReasoningConfig, ReasoningEffort } from '../types/ai-providers.types'

export type ReasoningSelection = 'default' | 'enabled' | ReasoningEffort
export interface ReasoningCapability {
  options: ReasoningSelection[]
  kind: 'effort' | 'toggle' | 'budget' | 'unsupported'
  adapter?: ModelReasoningConfig['protocol']
  protocol: 'chat-completions' | 'responses'
  omitTemperature: boolean
  reason?: 'unknown' | 'unsupported' | 'interface' | 'unconfigured'
}

const EFFORTS: ReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
const STANDARD: ReasoningEffort[] = ['low', 'medium', 'high']
const EXTENDED: ReasoningEffort[] = ['none', ...STANDARD, 'xhigh']

function profile(
  adapter: ModelReasoningConfig['protocol'],
  options: Exclude<ReasoningSelection, 'default'>[],
  extra: Partial<ReasoningCapability> = {}
): ReasoningCapability {
  return { options: ['default', ...options], kind: 'effort', adapter, protocol: 'chat-completions', omitTemperature: false, ...extra }
}

function unavailable(reason: ReasoningCapability['reason'], omitTemperature = false): ReasoningCapability {
  return { options: ['default'], kind: 'unsupported', protocol: 'chat-completions', omitTemperature, reason }
}

function hostname(endpoint: string): string {
  try { return new URL(endpoint).hostname.toLowerCase() } catch { return '' }
}

function modelId(id: string): string {
  // Known namespaces are unambiguous. Do not interpret arbitrary deployment/alias names.
  return id.toLowerCase().replace(/^(?:openai|google|models)\//, '')
}

// Exact families and dated snapshots only: future variants must declare their own capabilities.
function matches(id: string, base: string): boolean {
  return id === base || new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d{4}-?\\d{2}-?\\d{2}$`).test(id)
}

function openAIProfile(id: string): ReasoningCapability | null {
  // Official model pages: https://developers.openai.com/api/docs/models
  if (['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-sol', 'gpt-6-luna'].some(base => matches(id, base))) {
    const canDisable = matches(id, 'gpt-6-sol') || matches(id, 'gpt-6-luna')
    return profile('openai', [...(canDisable ? ['none' as const] : []), ...STANDARD, 'xhigh', 'max'], { protocol: 'responses', omitTemperature: true })
  }
  if (['gpt-5.2-pro', 'gpt-5.4-pro', 'gpt-5.5-pro'].some(base => matches(id, base))) {
    return profile('openai', ['medium', 'high', 'xhigh'], { protocol: 'responses', omitTemperature: true })
  }
  if (['gpt-5.6', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'].some(base => matches(id, base))) {
    return profile('openai', [...EXTENDED, 'max'], { protocol: 'responses', omitTemperature: true })
  }
  if (['gpt-5.1-codex-max', 'gpt-5.2-codex', 'gpt-5.3-codex'].some(base => matches(id, base))) {
    return profile('openai', [...STANDARD, 'xhigh'], { protocol: 'responses', omitTemperature: true })
  }
  if (['gpt-5-codex', 'gpt-5.1-codex', 'gpt-5.1-codex-mini'].some(base => matches(id, base))) {
    return profile('openai', STANDARD, { protocol: 'responses', omitTemperature: true })
  }
  if (['gpt-5.2', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5.5'].some(base => matches(id, base))) {
    return profile('openai', EXTENDED, { omitTemperature: true })
  }
  if (matches(id, 'gpt-5.1')) return profile('openai', ['none', ...STANDARD], { omitTemperature: true })
  if (['gpt-5', 'gpt-5-mini', 'gpt-5-nano'].some(base => matches(id, base))) {
    return profile('openai', ['minimal', ...STANDARD], { omitTemperature: true })
  }
  if (['o1', 'o3', 'o3-mini', 'o4-mini'].some(base => matches(id, base))) {
    return profile('openai', STANDARD, { omitTemperature: true })
  }
  return null
}

function declaredProfile(config: ModelReasoningConfig): ReasoningCapability | null {
  if (!['openai', 'openrouter', 'deepseek', 'qwen', 'gemini'].includes(config.protocol)) return null
  const efforts = EFFORTS.filter(effort => Array.isArray(config.supportedEfforts) && config.supportedEfforts.includes(effort) && !(config.mandatory && effort === 'none'))
  if (config.protocol === 'qwen') {
    const budgets = STANDARD.filter(effort => efforts.includes(effort))
    if (budgets.length) return profile('qwen', [...(config.supportsToggle && !config.mandatory ? ['none' as const] : []), ...budgets], { kind: 'budget' })
    return config.supportsToggle ? profile('qwen', config.mandatory ? ['enabled'] : ['none', 'enabled'], { kind: 'toggle' }) : null
  }
  if (efforts.length) return profile(config.protocol, efforts, { omitTemperature: config.protocol === 'openai' || config.protocol === 'deepseek' || config.protocol === 'gemini' })
  if (config.supportsToggle && ['openrouter', 'deepseek'].includes(config.protocol)) return profile(config.protocol, config.mandatory ? ['enabled'] : ['none', 'enabled'], { kind: 'toggle', omitTemperature: config.protocol === 'deepseek' })
  return null
}

export function getReasoningCapability(provider: AIProvider | null, model: AIModel | null): ReasoningCapability {
  if (!provider || !model) return unavailable('unconfigured')
  const host = hostname(provider.endpoint)
  const id = modelId(model.id)
  const isOpenRouter = provider.id === 'openrouter' || host === 'openrouter.ai'
  const knownOpenAI = openAIProfile(id)
  // Anthropic's compatibility layer ignores reasoning_effort. Do not offer ineffective controls.
  if (host === 'api.anthropic.com') return unavailable('interface', true)
  if (model.reasoning === false) return { ...unavailable('unsupported', knownOpenAI?.omitTemperature), protocol: isOpenRouter ? 'chat-completions' : knownOpenAI?.protocol || 'chat-completions' }
  if (model.reasoning) {
    const declared = declaredProfile(model.reasoning)
    if (declared) {
      if (isOpenRouter) return { ...declared, adapter: 'openrouter', protocol: 'chat-completions' }
      const known = knownOpenAI
      if (known && declared.adapter === 'openai') return { ...declared, protocol: known.protocol, omitTemperature: true }
      return declared
    }
    return { ...unavailable('unknown', knownOpenAI?.omitTemperature), protocol: isOpenRouter ? 'chat-completions' : knownOpenAI?.protocol || 'chat-completions' }
  }
  if (isOpenRouter) return unavailable('unknown') // Refresh /models to obtain per-model reasoning metadata.
  const openai = knownOpenAI
  if (openai) return openai

  // Gemini OpenAI compatibility: https://ai.google.dev/gemini-api/docs/openai#thinking
  const gemini = (options: ReasoningEffort[]) => profile('gemini', options, { omitTemperature: true })
  if (['gemini-2.5-pro', 'gemini-3.1-pro-preview', 'gemini-3.8-flash', 'gemini-4-argon'].some(base => matches(id, base))) return gemini(STANDARD)
  if (['gemini-2.5-flash', 'gemini-2.5-flash-lite'].some(base => matches(id, base))) return gemini(['none', ...STANDARD])
  if (matches(id, 'gemini-3-pro-preview')) return gemini(['low', 'high'])
  if (['gemini-3-flash-preview', 'gemini-3.1-flash-lite-preview', 'gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-3.6-flash'].some(base => matches(id, base))) return gemini(['minimal', ...STANDARD])

  // Provider-specific fields are enabled only for the corresponding service, never guessed for a gateway.
  if (provider.id === 'deepseek' || host === 'api.deepseek.com') {
    if (['deepseek-flash', 'deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp'].some(base => matches(id, base))) {
      return profile('deepseek', ['none', 'low', 'high', 'max'], { omitTemperature: true })
    }
  }
  if (provider.id === 'qwen' || /(?:^|\.)dashscope\.(?:aliyuncs\.com|intl\.aliyuncs\.com)$/.test(host)) {
    const snapshotDate = id.match(/(\d{4})-?(\d{2})-?(\d{2})$/)?.slice(1).join('') || ''
    const plus = id === 'qwen-plus' || id === 'qwen-plus-latest' || (matches(id, 'qwen-plus') && snapshotDate >= '20250428')
    const flash = id === 'qwen-flash' || id === 'qwen-flash-latest' || (matches(id, 'qwen-flash') && snapshotDate >= '20250728')
    if (plus || flash || /^qwen3-(?:0\.6b|1\.7b|4b|8b|14b|30b-a3b|32b|235b-a22b)$/.test(id)) {
      return profile('qwen', ['none', ...STANDARD], { kind: 'budget' })
    }
  }
  if (/^(?:gpt-4|gpt-3\.5|claude-3|gemini-1|qwen2)(?:[.-]|$)/.test(id)) return unavailable('unsupported')
  return unavailable('unknown')
}

export function normalizeReasoningSelection(capability: ReasoningCapability, value: unknown): ReasoningSelection {
  return capability.options.includes(value as ReasoningSelection) ? value as ReasoningSelection : 'default'
}

export function buildReasoningRequest(provider: AIProvider, model: AIModel, selection: ReasoningSelection = 'default'): {
  body: Record<string, unknown>
  omitTemperature: boolean
  protocol: 'chat-completions' | 'responses'
} {
  const capability = getReasoningCapability(provider, model)
  const valid = normalizeReasoningSelection(capability, selection)
  const body: Record<string, unknown> = {}
  if (valid !== 'default') {
    switch (capability.adapter) {
      case 'openai':
        if (capability.protocol === 'responses') body.reasoning = { effort: valid }
        else body.reasoning_effort = valid
        break
      case 'openrouter': body.reasoning = valid === 'enabled' ? { enabled: true } : { effort: valid }; break
      case 'gemini': body.reasoning_effort = valid; break
      case 'deepseek':
        body.thinking = { type: valid === 'none' ? 'disabled' : 'enabled' }
        if (valid !== 'none' && valid !== 'enabled') body.reasoning_effort = valid
        break
      case 'qwen':
        body.enable_thinking = valid !== 'none'
        if (valid === 'low' || valid === 'medium' || valid === 'high') body.thinking_budget = { low: 1024, medium: 4096, high: 8192 }[valid]
        break
    }
  }
  return { body, omitTemperature: capability.omitTemperature, protocol: capability.protocol }
}

export function reasoningPreferenceKey(provider: AIProvider, model: AIModel): string {
  return JSON.stringify([provider.id, model.id])
}

export function readReasoningPreferences(raw: string | null): Record<string, ReasoningSelection> {
  try {
    const parsed: unknown = JSON.parse(raw || '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const values: ReasoningSelection[] = ['default', 'enabled', ...EFFORTS]
    return Object.fromEntries(Object.entries(parsed).filter(([key, value]) => key.startsWith('[') && values.includes(value)))
  } catch { return {} }
}

export function reasoningMetadataFromAPI(data: unknown, protocol: 'openrouter' | 'deepseek'): ModelReasoningConfig | false | undefined {
  if (!data || typeof data !== 'object') return undefined
  const value = data as Record<string, unknown>
  const raw = protocol === 'openrouter' ? value.reasoning : value.effort
  if (!raw || typeof raw !== 'object') return undefined
  const metadata = raw as Record<string, unknown>
  const supported = protocol === 'openrouter' ? metadata.supported_efforts : metadata.supported_levels
  const supportedEfforts = supported === null && protocol === 'openrouter' ? [...EFFORTS] : Array.isArray(supported) ? EFFORTS.filter(effort => (protocol !== 'deepseek' || effort !== 'none') && supported.includes(effort)) : []
  if (protocol === 'deepseek' && supportedEfforts.length) supportedEfforts.unshift('none')
  return supportedEfforts.length ? { protocol, supportedEfforts, mandatory: metadata.mandatory === true } : false
}
