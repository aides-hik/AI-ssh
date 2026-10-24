// AI 聊天服务目录。官方核对来源见 docs/ai-provider-catalog.md。

import type { ProviderConfig } from './ai-providers.types'

export const CLOUD_PROVIDERS: ProviderConfig[] = [
  {
    id: 'aws-bedrock',
    name: 'AWS Bedrock',
    description: 'Bedrock 原生 API 需要 AWS 签名与区域配置；请通过 OpenAI 兼容网关接入',
    icon: 'bi bi-amazon',
    website: 'https://aws.amazon.com/bedrock',
    endpoint: '',
    config: { catalogStatus: 'unsupported', docsUrl: 'https://docs.aws.amazon.com/bedrock/latest/APIReference/welcome.html', verifiedAt: '2026-10-23' },
    models: []
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare AI',
    description: 'Cloudflare Workers AI；填写包含账号 ID 的 /ai/v1 兼容地址',
    icon: 'bi bi-cloud',
    website: 'https://ai.cloudflare.com',
    endpoint: '',
    config: { catalogStatus: 'dynamic', docsUrl: 'https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/', verifiedAt: '2026-10-23', endpointPlaceholder: 'https://api.cloudflare.com/client/v4/accounts/YOUR-ACCOUNT-ID/ai/v1' },
    models: []
  },
  {
    id: 'github-models',
    name: 'GitHub Models',
    description: 'GitHub Models 已于 2026-07-30 退役，请迁移到其他模型服务',
    icon: 'bi bi-github',
    website: 'https://github.com/marketplace/models',
    endpoint: '',
    config: { catalogStatus: 'unsupported', docsUrl: 'https://docs.github.com/en/github-models', verifiedAt: '2026-10-23' },
    models: []
  },
  {
    id: 'ai21',
    name: 'AI21 Labs',
    description: 'AI21 Jamba；按官方部署或账号权限添加模型 ID',
    icon: 'bi bi-lightbulb-fill',
    website: 'https://www.ai21.com',
    endpoint: 'https://api.ai21.com/studio/v1',
    config: { catalogStatus: 'dynamic', docsUrl: 'https://docs.ai21.com/docs/jamba-foundation-models', verifiedAt: '2026-10-23' },
    models: []
  },
  {
    id: 'novita',
    name: 'Novita AI',
    description: 'Novita 模型服务；刷新账号可用的聊天模型',
    icon: 'bi bi-gpu-card',
    website: 'https://novita.ai',
    endpoint: 'https://api.novita.ai/openai',
    config: { catalogStatus: 'dynamic', docsUrl: 'https://docs.novita.ai/guides/llm-api', verifiedAt: '2026-10-23' },
    models: []
  }
]
