// AI 聊天服务目录。官方核对来源见 docs/ai-provider-catalog.md。

import type { ProviderConfig } from './ai-providers.types'

export const PLATFORM_PROVIDERS: ProviderConfig[] = [
  {
    id: 'together',
    name: 'Together AI',
    description: 'Together AI 模型目录随服务更新，请刷新账号可用的聊天模型',
    icon: 'bi bi-people',
    website: 'https://api.together.xyz',
    endpoint: 'https://api.together.xyz/v1',
    config: { catalogStatus: 'dynamic', docsUrl: 'https://docs.together.ai/docs/serverless/models', verifiedAt: '2026-10-23' },
    models: []
  },
  {
    id: 'fireworks',
    name: 'Fireworks AI',
    description: 'Fireworks 推理服务；刷新聊天模型或填写部署 ID',
    icon: 'bi bi-rocket-takeoff',
    website: 'https://fireworks.ai',
    endpoint: 'https://api.fireworks.ai/inference/v1',
    config: { catalogStatus: 'dynamic', docsUrl: 'https://docs.fireworks.ai/getting-started/quickstart', verifiedAt: '2026-10-23' },
    models: []
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    description: '统一模型网关；刷新目录以获取模型能力和支持参数',
    icon: 'bi bi-router',
    website: 'https://openrouter.ai',
    endpoint: 'https://openrouter.ai/api/v1',
    config: { catalogStatus: 'dynamic', docsUrl: 'https://openrouter.ai/docs/guides/overview/models', verifiedAt: '2026-10-23' },
    models: []
  },
  {
    id: 'siliconcloud',
    name: 'SiliconCloud',
    description: '硅基流动；刷新账号可用的聊天模型，参数以该平台能力为准',
    icon: 'bi bi-cloud-arrow-up',
    website: 'https://siliconflow.cn',
    endpoint: 'https://api.siliconflow.cn/v1',
    config: { catalogStatus: 'dynamic', docsUrl: 'https://docs.siliconflow.cn/docs/userguide/quickstart', verifiedAt: '2026-10-23' },
    models: []
  },
  {
    id: 'huggingface',
    name: 'HuggingFace',
    description: 'Hugging Face Inference Providers；按路由与账号权限刷新模型',
    icon: 'bi bi-emoji-smile',
    website: 'https://huggingface.co',
    endpoint: 'https://router.huggingface.co/v1',
    config: { catalogStatus: 'dynamic', docsUrl: 'https://huggingface.co/docs/inference-providers/tasks/chat-completion', verifiedAt: '2026-10-23' },
    models: []
  },
  {
    id: 'replicate',
    name: 'Replicate',
    description: 'Replicate 使用 Predictions API；当前客户端不支持其原生聊天协议',
    icon: 'bi bi-layers',
    website: 'https://replicate.com',
    endpoint: '',
    config: { catalogStatus: 'unsupported', docsUrl: 'https://replicate.com/docs/reference/http', verifiedAt: '2026-10-23' },
    models: []
  },
  {
    id: 'custom-openai',
    name: '自定义 OpenAI 兼容',
    description: '填写你自己的 OpenAI 兼容聊天地址与模型 ID',
    icon: 'bi bi-globe',
    website: '',
    endpoint: '',
    config: { catalogStatus: 'dynamic', docsUrl: 'https://developers.openai.com/api/reference/resources/chat', verifiedAt: '2026-10-23' },
    models: []
  },
  {
    id: 'ollama',
    name: 'Ollama',
    description: '本地模型由 Ollama 安装情况决定；连接后刷新已下载模型',
    icon: 'bi bi-hdd',
    website: 'https://ollama.com',
    endpoint: 'http://localhost:11434',
    config: { catalogStatus: 'dynamic', docsUrl: 'https://docs.ollama.com/api/tags', verifiedAt: '2026-10-23' },
    models: []
  }
]
