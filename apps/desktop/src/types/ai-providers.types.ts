// AI 服务商类型定义

export interface AIProvider {
  id: string
  name: string
  description: string
  icon: string
  website: string

  // 配置
  apiKey: string
  endpoint: string
  enabled: boolean
  isDefault: boolean

  // 支持的模型
  models: AIModel[]

  // 额外配置
  config?: Record<string, any>
}

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface ModelReasoningConfig {
  protocol: 'openai' | 'openrouter' | 'deepseek' | 'qwen' | 'gemini' | 'anthropic'
  supportedEfforts?: ReasoningEffort[]
  supportsToggle?: boolean
  mandatory?: boolean
  thinkingMode?: 'adaptive' | 'budget' | 'always'
}

export type ModelAPIStyle = 'chat-completions' | 'responses' | 'anthropic' | 'gemini' | 'ollama'

/** Capabilities supplied by a verified catalogue or by model discovery, never user defaults. */
export interface ModelParameterCapabilities {
  apiStyle?: ModelAPIStyle
  maxOutputTokens?: number
  temperature?: boolean
  topP?: boolean
  maxTokensParameter?: 'max_tokens' | 'max_completion_tokens'
}

/** Missing values delegate to the service. Explicit request options take precedence. */
export interface ModelRequestConfig {
  temperature?: number
  topP?: number
  maxTokens?: number
  reasoning?: 'default' | 'enabled' | ReasoningEffort
}

export interface AIModel {
  id: string
  name: string
  description?: string
  providerId: string
  contextWindow: number

  capabilities: {
    text: boolean
    image: boolean
    functionCall: boolean
    vision: boolean
  }

  price?: {
    input: number // USD per 1M tokens
    output: number // USD per 1M tokens
  }

  recommended?: boolean
  enabled?: boolean // 是否启用该模型（默认启用）
  isCustom?: boolean // 是否为用户手动添加的模型
  // Optional capabilities reported by the model service; false explicitly disables adjustment.
  reasoning?: ModelReasoningConfig | false
  parameters?: ModelParameterCapabilities
  requestConfig?: ModelRequestConfig
}

// 默认服务商配置允许携带预置 API Key 和额外配置
export type ProviderConfig = Omit<AIProvider, 'apiKey' | 'enabled' | 'isDefault'> & {
  apiKey?: string
}
