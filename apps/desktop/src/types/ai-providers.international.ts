// AI 聊天服务目录。官方核对来源见 docs/ai-provider-catalog.md。

import type { ProviderConfig } from './ai-providers.types'

export const INTERNATIONAL_PROVIDERS: ProviderConfig[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'OpenAI 官方模型；推理和工具调用按模型使用 Responses API',
    icon: 'bi bi-robot',
    website: 'https://platform.openai.com',
    endpoint: 'https://api.openai.com/v1',
    config: { catalogStatus: 'verified', docsUrl: 'https://developers.openai.com/api/docs/models', verifiedAt: '2026-10-23' },
    models: [
      { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', providerId: 'openai', contextWindow: 1050000, capabilities: { text: true, image: false, functionCall: true, vision: true }, recommended: true, reasoning: { protocol: 'openai', supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'], mandatory: true }, parameters: { maxOutputTokens: 128000, temperature: false, topP: false, apiStyle: 'responses' } },
      { id: 'gpt-6-astra', name: 'GPT-6 Astra', providerId: 'openai', contextWindow: 1050000, capabilities: { text: true, image: false, functionCall: true, vision: true }, reasoning: { protocol: 'openai', supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'], mandatory: true }, parameters: { maxOutputTokens: 128000, temperature: false, topP: false, apiStyle: 'responses' } },
      { id: 'gpt-6-luna', name: 'GPT-6 Luna', providerId: 'openai', contextWindow: 1050000, capabilities: { text: true, image: false, functionCall: true, vision: true }, reasoning: { protocol: 'openai', supportedEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'] }, parameters: { maxOutputTokens: 128000, temperature: false, topP: false, apiStyle: 'responses' } }
    ]
  },
  {
    id: 'azure-openai',
    name: 'Azure OpenAI',
    description: '填写 Azure 资源的 /openai/v1 地址，模型 ID 使用你创建的部署名称',
    icon: 'bi bi-microsoft',
    website: 'https://azure.microsoft.com',
    endpoint: '',
    config: { catalogStatus: 'dynamic', docsUrl: 'https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/switching-endpoints', verifiedAt: '2026-10-23', endpointPlaceholder: 'https://YOUR-RESOURCE.openai.azure.com/openai/v1' },
    models: []
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    description: 'Claude 官方 Messages API；按模型限制调整思考深度',
    icon: 'bi bi-chat-quote',
    website: 'https://console.anthropic.com',
    endpoint: 'https://api.anthropic.com/v1',
    config: { catalogStatus: 'verified', docsUrl: 'https://platform.claude.com/docs/en/models/overview', verifiedAt: '2026-10-23' },
    models: [
      { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', providerId: 'anthropic', contextWindow: 1000000, capabilities: { text: true, image: false, functionCall: true, vision: true }, reasoning: { protocol: 'anthropic', supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'], mandatory: true, thinkingMode: 'always' }, parameters: { maxOutputTokens: 128000, temperature: false, topP: false } },
      { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', providerId: 'anthropic', contextWindow: 1000000, capabilities: { text: true, image: false, functionCall: true, vision: true }, recommended: true, reasoning: { protocol: 'anthropic', supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'], mandatory: true, thinkingMode: 'always' }, parameters: { maxOutputTokens: 128000, temperature: false, topP: false } },
      { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', providerId: 'anthropic', contextWindow: 1000000, capabilities: { text: true, image: false, functionCall: true, vision: true }, reasoning: { protocol: 'anthropic', supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'], mandatory: true, thinkingMode: 'always' }, parameters: { maxOutputTokens: 128000, temperature: false, topP: false } },
      { id: 'claude-fable-5-1', name: 'Claude Fable 5.1', providerId: 'anthropic', contextWindow: 1000000, capabilities: { text: true, image: false, functionCall: true, vision: true }, reasoning: { protocol: 'anthropic', supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'], mandatory: true, thinkingMode: 'always' }, parameters: { maxOutputTokens: 128000, temperature: false, topP: false } }
    ]
  },
  {
    id: 'google',
    name: 'Google Gemini',
    description: 'Google Gemini 官方多模态模型；仅显示当前稳定聊天模型',
    icon: 'bi bi-google',
    website: 'https://aistudio.google.com',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta',
    config: { catalogStatus: 'verified', docsUrl: 'https://ai.google.dev/gemini-api/docs/models', verifiedAt: '2026-10-23' },
    models: [
      { id: 'gemini-4-argon', name: 'Gemini 4 Argon', providerId: 'google', contextWindow: 1048576, capabilities: { text: true, image: false, functionCall: true, vision: true }, recommended: true, reasoning: { protocol: 'gemini', supportedEfforts: ['low', 'medium', 'high'], mandatory: true }, parameters: { maxOutputTokens: 65536, temperature: false, topP: false } },
      { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', providerId: 'google', contextWindow: 1048576, capabilities: { text: true, image: false, functionCall: true, vision: true }, recommended: true, reasoning: { protocol: 'gemini', supportedEfforts: ['low', 'medium', 'high'], mandatory: true }, parameters: { maxOutputTokens: 65536, temperature: false, topP: false } }
    ]
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    description: 'Mistral 官方稳定聊天模型；实验性模型可通过刷新目录添加',
    icon: 'bi bi-wind',
    website: 'https://console.mistral.ai',
    endpoint: 'https://api.mistral.ai/v1',
    config: { catalogStatus: 'verified', docsUrl: 'https://docs.mistral.ai/models', verifiedAt: '2026-10-23' },
    models: [
      { id: 'mistral-medium-3-5', name: 'Mistral Medium 3.5', providerId: 'mistral', contextWindow: 256000, capabilities: { text: true, image: false, functionCall: true, vision: true }, recommended: true },
      { id: 'mistral-small-2603', name: 'Mistral Small 4', providerId: 'mistral', contextWindow: 256000, capabilities: { text: true, image: false, functionCall: true, vision: true } }
    ]
  },
  {
    id: 'groq',
    name: 'Groq',
    description: 'Groq 生产聊天模型；企业专属和预览模型请按账号刷新',
    icon: 'bi bi-lightning-charge',
    website: 'https://console.groq.com',
    endpoint: 'https://api.groq.com/openai/v1',
    config: { catalogStatus: 'verified', docsUrl: 'https://console.groq.com/docs/models', verifiedAt: '2026-10-23' },
    models: [
      { id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B', providerId: 'groq', contextWindow: 131072, capabilities: { text: true, image: false, functionCall: true, vision: false }, recommended: true, reasoning: { protocol: 'openai', supportedEfforts: ['low', 'medium', 'high'], mandatory: true }, parameters: { maxOutputTokens: 65536, temperature: true, topP: true, maxTokensParameter: 'max_completion_tokens' } },
      { id: 'openai/gpt-oss-20b', name: 'GPT-OSS 20B', providerId: 'groq', contextWindow: 131072, capabilities: { text: true, image: false, functionCall: true, vision: false }, reasoning: { protocol: 'openai', supportedEfforts: ['low', 'medium', 'high'], mandatory: true }, parameters: { maxOutputTokens: 65536, temperature: true, topP: true, maxTokensParameter: 'max_completion_tokens' } }
    ]
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    description: 'Perplexity 已推荐迁移 Agent API；当前客户端未适配其专有 Agent 参数',
    icon: 'bi bi-search',
    website: 'https://www.perplexity.ai',
    endpoint: '',
    config: { catalogStatus: 'unsupported', docsUrl: 'https://docs.perplexity.ai/docs/agent-api/openai-compatibility', verifiedAt: '2026-10-23' },
    models: []
  },
  {
    id: 'cohere',
    name: 'Cohere',
    description: 'Cohere OpenAI 兼容聊天接口，支持工具调用',
    icon: 'bi bi-diagram-3',
    website: 'https://cohere.com',
    endpoint: 'https://api.cohere.ai/compatibility/v1',
    config: { catalogStatus: 'verified', docsUrl: 'https://docs.cohere.com/docs/compatibility-api', verifiedAt: '2026-10-23' },
    models: [
      { id: 'command-a-plus-05-2026', name: 'Command A+', providerId: 'cohere', contextWindow: 128000, capabilities: { text: true, image: false, functionCall: true, vision: true }, recommended: true, parameters: { maxOutputTokens: 64000 } },
      { id: 'command-a-03-2025', name: 'Command A', providerId: 'cohere', contextWindow: 256000, capabilities: { text: true, image: false, functionCall: true, vision: false }, parameters: { maxOutputTokens: 8000 } }
    ]
  },
  {
    id: 'xai',
    name: 'xAI (Grok)',
    description: 'Grok 官方多模态与工具调用模型',
    icon: 'bi bi-x-diamond',
    website: 'https://x.ai',
    endpoint: 'https://api.x.ai/v1',
    config: { catalogStatus: 'verified', docsUrl: 'https://docs.x.ai/developers/models/grok-4.7', verifiedAt: '2026-10-23' },
    models: [
      { id: 'grok-4.7', name: 'Grok 4.7', providerId: 'xai', contextWindow: 500000, capabilities: { text: true, image: false, functionCall: true, vision: true }, recommended: true, reasoning: { protocol: 'openai', supportedEfforts: ['low', 'medium', 'high', 'xhigh'], mandatory: true } }
    ]
  }
]
