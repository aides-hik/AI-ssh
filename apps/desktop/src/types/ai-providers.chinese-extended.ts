// AI 聊天服务目录。官方核对来源见 docs/ai-provider-catalog.md。

import type { ProviderConfig } from './ai-providers.types'

export const CHINESE_EXTENDED_PROVIDERS: ProviderConfig[] = [
  {
    id: 'sensenova',
    name: '商汤日日新',
    description: '商汤日日新；请按开放平台授权填写兼容端点与模型',
    icon: 'bi bi-sun',
    website: 'https://platform.sensenova.cn',
    endpoint: '',
    config: { catalogStatus: 'dynamic', docsUrl: 'https://platform.sensenova.cn', verifiedAt: '2026-10-23' },
    models: []
  },
  {
    id: 'taichu',
    name: '太初大模型',
    description: '暂无可核实的公开兼容聊天目录；请使用部署方提供的地址和模型 ID',
    icon: 'bi bi-yin-yang',
    website: 'https://taichu-web.ia.ac.cn',
    endpoint: '',
    config: { catalogStatus: 'unverified', docsUrl: 'https://taichu-web.ia.ac.cn', verifiedAt: '2026-10-23' },
    models: []
  },
  {
    id: 'skylark',
    name: '云雀（旧配置）',
    description: '旧版云雀预设缺少可靠官方聊天接口资料；建议使用豆包或自定义服务',
    icon: 'bi bi-bird',
    website: 'https://www.kunlun.com',
    endpoint: '',
    config: { catalogStatus: 'unverified', docsUrl: 'https://www.volcengine.com/product/doubao', verifiedAt: '2026-10-23' },
    models: []
  },
  {
    id: 'chatglm',
    name: 'ChatGLM',
    description: '旧 ChatGLM 配置入口，已切换智谱官方 v4 聊天接口',
    icon: 'bi bi-mortarboard',
    website: 'https://chatglm.cn',
    endpoint: 'https://open.bigmodel.cn/api/paas/v4',
    config: { catalogStatus: 'verified', docsUrl: 'https://docs.bigmodel.cn/cn/guide/models/text/glm-5.3', verifiedAt: '2026-10-23' },
    models: [
      { id: 'glm-5.3', name: 'GLM-5.3', providerId: 'chatglm', contextWindow: 1000000, capabilities: { text: true, image: false, functionCall: true, vision: false }, recommended: true, reasoning: { protocol: 'openai', supportedEfforts: ['low', 'high', 'max'], mandatory: true }, parameters: { maxOutputTokens: 128000, temperature: false, topP: false } }
    ]
  },
  {
    id: 'minimax-music',
    name: 'MiniMax Music',
    description: '音乐生成专用服务，当前终端 AI 对话不支持',
    icon: 'bi bi-music-note-beamed',
    website: 'https://www.minimaxi.com',
    endpoint: '',
    config: { catalogStatus: 'unsupported', docsUrl: 'https://platform.minimax.cn/docs/guides/music-generation', verifiedAt: '2026-10-23' },
    models: []
  },
  {
    id: 'infini-ai',
    name: '无问芯穹',
    description: '无问芯穹；请按控制台中的兼容服务地址与模型 ID 配置',
    icon: 'bi bi-infinity',
    website: 'https://cloud.infini-ai.com',
    endpoint: '',
    config: { catalogStatus: 'dynamic', docsUrl: 'https://cloud.infini-ai.com', verifiedAt: '2026-10-23' },
    models: []
  },
  {
    id: 'zhipuai-all',
    name: '智谱清言',
    description: '智谱官方兼容入口；保留旧配置 ID',
    icon: 'bi bi-chat-dots',
    website: 'https://chatglm.cn',
    endpoint: 'https://open.bigmodel.cn/api/paas/v4',
    config: { catalogStatus: 'verified', docsUrl: 'https://docs.bigmodel.cn/cn/guide/models/text/glm-5.3', verifiedAt: '2026-10-23' },
    models: [
      { id: 'glm-5.3', name: 'GLM-5.3', providerId: 'zhipuai-all', contextWindow: 1000000, capabilities: { text: true, image: false, functionCall: true, vision: false }, recommended: true, reasoning: { protocol: 'openai', supportedEfforts: ['low', 'high', 'max'], mandatory: true }, parameters: { maxOutputTokens: 128000, temperature: false, topP: false } }
    ]
  },
  {
    id: 'doubao',
    name: '豆包大模型',
    description: '火山方舟；请刷新已开通模型或填写自己的推理接入点 ID（ep-…）',
    icon: 'bi bi-bag',
    website: 'https://www.doubao.com',
    endpoint: 'https://ark.cn-beijing.volces.com/api/v3',
    config: { catalogStatus: 'dynamic', docsUrl: 'https://docs.volcengine.com/docs/ark/deep-thinking?lang=zh', verifiedAt: '2026-10-23' },
    models: []
  },
  {
    id: 'yuan',
    name: '源 2.0',
    description: '源模型需自建或企业部署；未核实统一公共兼容聊天端点',
    icon: 'bi bi-water',
    website: 'https://air.inspur.com',
    endpoint: '',
    config: { catalogStatus: 'unverified', docsUrl: 'https://air.inspur.com', verifiedAt: '2026-10-23' },
    models: []
  },
  {
    id: 'tiangong',
    name: '天工 AI',
    description: '暂未核实当前公开兼容聊天目录；请使用官方提供的端点和模型 ID',
    icon: 'bi bi-clouds',
    website: 'https://tiangong.kunlun.com',
    endpoint: '',
    config: { catalogStatus: 'unverified', docsUrl: 'https://tiangong.kunlun.com', verifiedAt: '2026-10-23' },
    models: []
  }
]
