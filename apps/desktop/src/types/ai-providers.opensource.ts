// AI 聊天服务目录。官方核对来源见 docs/ai-provider-catalog.md。

import type { ProviderConfig } from './ai-providers.types'

export const OPENSOURCE_PROVIDERS: ProviderConfig[] = [
  {
    id: 'upstage',
    name: 'Upstage',
    description: 'Upstage Solar 官方兼容接口；推理可关闭或按任务调整强度',
    icon: 'bi bi-sunrise',
    website: 'https://www.upstage.ai',
    endpoint: 'https://api.upstage.ai/v1',
    config: { catalogStatus: 'verified', docsUrl: 'https://console.upstage.ai/docs/models/history', verifiedAt: '2026-10-23' },
    models: [
      { id: 'solar-pro4', name: 'Solar Pro 4', providerId: 'upstage', contextWindow: 512000, capabilities: { text: true, image: false, functionCall: true, vision: false }, recommended: true, reasoning: { protocol: 'openai', supportedEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'] }, parameters: { maxOutputTokens: 128000, temperature: true, topP: true } },
      { id: 'solar-mini4', name: 'Solar Mini 4', providerId: 'upstage', contextWindow: 512000, capabilities: { text: true, image: false, functionCall: true, vision: false }, reasoning: { protocol: 'openai', supportedEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'] }, parameters: { maxOutputTokens: 128000, temperature: true, topP: true } }
    ]
  },
  {
    id: 'lepton',
    name: 'Lepton AI',
    description: 'Lepton 模型需部署端点；请填写你的 OpenAI 兼容服务地址',
    icon: 'bi bi-lightning',
    website: 'https://lepton.ai',
    endpoint: '',
    config: { catalogStatus: 'dynamic', docsUrl: 'https://www.lepton.ai/docs', verifiedAt: '2026-10-23' },
    models: []
  },
  {
    id: 'anyscale',
    name: 'Anyscale',
    description: '旧 Anyscale Endpoints 预设待核实；请填写当前部署提供的兼容端点',
    icon: 'bi bi-bounding-box',
    website: 'https://www.anyscale.com',
    endpoint: '',
    config: { catalogStatus: 'unverified', docsUrl: 'https://docs.anyscale.com', verifiedAt: '2026-10-23' },
    models: []
  },
  {
    id: 'deepinfra',
    name: 'DeepInfra',
    description: 'DeepInfra 模型目录随托管服务更新；刷新或添加聊天模型',
    icon: 'bi bi-server',
    website: 'https://deepinfra.com',
    endpoint: 'https://api.deepinfra.com/v1/openai',
    config: { catalogStatus: 'dynamic', docsUrl: 'https://deepinfra.com/docs/openai_api', verifiedAt: '2026-10-23' },
    models: []
  },
  {
    id: 'octoai',
    name: 'OctoAI',
    description: '旧 OctoAI 公共服务状态未核实；请使用当前提供商或自建兼容端点',
    icon: 'bi bi-octagon',
    website: 'https://octo.ai',
    endpoint: '',
    config: { catalogStatus: 'unverified', docsUrl: 'https://octo.ai', verifiedAt: '2026-10-23' },
    models: []
  },
  {
    id: 'modal',
    name: 'Modal Labs',
    description: 'Modal 是部署平台；填写你部署的 OpenAI 兼容 Web Endpoint',
    icon: 'bi bi-window-stack',
    website: 'https://modal.com',
    endpoint: '',
    config: { catalogStatus: 'dynamic', docsUrl: 'https://modal.com/docs/examples/vllm_inference', verifiedAt: '2026-10-23' },
    models: []
  },
  {
    id: 'runpod',
    name: 'RunPod',
    description: 'RunPod 是部署平台；填写你的 vLLM /openai/v1 端点与模型',
    icon: 'bi bi-cpu',
    website: 'https://runpod.io',
    endpoint: '',
    config: { catalogStatus: 'dynamic', docsUrl: 'https://docs.runpod.io/serverless/vllm/openai-compatibility', verifiedAt: '2026-10-23' },
    models: []
  },
  {
    id: 'banana',
    name: 'Banana',
    description: '旧 Banana 托管接口状态未核实；请使用当前部署的兼容地址',
    icon: 'bi bi-bookmark',
    website: 'https://banana.dev',
    endpoint: '',
    config: { catalogStatus: 'unverified', docsUrl: 'https://banana.dev', verifiedAt: '2026-10-23' },
    models: []
  },
  {
    id: 'higress',
    name: 'Higress AI',
    description: 'Higress 是自建 AI 网关；填写你的网关地址与路由模型名',
    icon: 'bi bi-router',
    website: 'https://higress.io',
    endpoint: '',
    config: { catalogStatus: 'dynamic', docsUrl: 'https://higress.io/docs/latest/plugins/ai/api-provider/ai-proxy/', verifiedAt: '2026-10-23' },
    models: []
  },
  {
    id: 'friendli',
    name: 'Friendli AI',
    description: 'Friendli 模型服务；按账号模型目录和服务地址配置',
    icon: 'bi bi-emoji-smile',
    website: 'https://friendli.ai',
    endpoint: 'https://api.friendli.ai/serverless/v1',
    config: { catalogStatus: 'dynamic', docsUrl: 'https://friendli.ai/docs/guides/model-apis/quickstart', verifiedAt: '2026-10-23' },
    models: []
  }
]
