// AI 聊天服务目录。官方核对来源见 docs/ai-provider-catalog.md。

import type { ProviderConfig } from './ai-providers.types'

export const CHINESE_PROVIDERS: ProviderConfig[] = [
  {
    id: 'qwen',
    name: '通义千问',
    description: '阿里云百炼；请按 API Key 所属地域填写兼容地址，新业务空间使用专属地址',
    icon: 'bi bi-cloud',
    website: 'https://dashscope.aliyun.com',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    config: { catalogStatus: 'verified', docsUrl: 'https://help.aliyun.com/zh/model-studio/models', verifiedAt: '2026-10-23', endpointPlaceholder: 'https://YOUR-WORKSPACE.cn-beijing.maas.aliyuncs.com/compatible-mode/v1' },
    models: [
      { id: 'qwen3.8-max', name: 'Qwen3.8 Max', providerId: 'qwen', contextWindow: 1000000, capabilities: { text: true, image: false, functionCall: true, vision: true }, reasoning: { protocol: 'qwen', supportsToggle: true }, parameters: { maxOutputTokens: 131072 } },
      { id: 'qwen3.7-plus', name: 'Qwen3.7 Plus', providerId: 'qwen', contextWindow: 1000000, capabilities: { text: true, image: false, functionCall: true, vision: true }, recommended: true, reasoning: { protocol: 'qwen', supportsToggle: true }, parameters: { maxOutputTokens: 131072 } },
      { id: 'qwen3.8-flash', name: 'Qwen3.8 Flash', providerId: 'qwen', contextWindow: 1000000, capabilities: { text: true, image: false, functionCall: true, vision: true }, reasoning: { protocol: 'qwen', supportsToggle: true }, parameters: { maxOutputTokens: 131072 } }
    ]
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    description: 'DeepSeek 官方混合思考模型；Flash 支持视觉，Pro 为文本模型',
    icon: 'bi bi-star',
    website: 'https://platform.deepseek.com',
    endpoint: 'https://api.deepseek.com/v1',
    config: { catalogStatus: 'verified', docsUrl: 'https://api-docs.deepseek.com/quick_start/pricing/', verifiedAt: '2026-10-23' },
    models: [
      { id: 'deepseek-flash', name: 'DeepSeek V4.1 Flash', providerId: 'deepseek', contextWindow: 1000000, capabilities: { text: true, image: false, functionCall: true, vision: true }, recommended: true, reasoning: { protocol: 'deepseek', supportedEfforts: ['low', 'high', 'max'], supportsToggle: true }, parameters: { maxOutputTokens: 393216, temperature: false, topP: false } },
      { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', providerId: 'deepseek', contextWindow: 1000000, capabilities: { text: true, image: false, functionCall: true, vision: false }, reasoning: { protocol: 'deepseek', supportedEfforts: ['low', 'high', 'max'], supportsToggle: true }, parameters: { maxOutputTokens: 393216, temperature: false, topP: false } }
    ]
  },
  {
    id: 'moonshot',
    name: 'Kimi · Moonshot AI',
    description: 'Kimi 官方多模态模型；API Key 与服务地域需要一致',
    icon: 'bi bi-moon-stars',
    website: 'https://platform.kimi.ai',
    endpoint: 'https://api.moonshot.ai/v1',
    config: { catalogStatus: 'verified', docsUrl: 'https://platform.kimi.ai/docs/models', verifiedAt: '2026-10-23' },
    models: [
      { id: 'kimi-k3', name: 'Kimi K3', providerId: 'moonshot', contextWindow: 1048576, capabilities: { text: true, image: false, functionCall: true, vision: true }, recommended: true, reasoning: { protocol: 'openai', supportedEfforts: ['low', 'high', 'max'], mandatory: true }, parameters: { maxOutputTokens: 1048576, temperature: false, topP: false, maxTokensParameter: 'max_completion_tokens' } },
      { id: 'kimi-k2.7-code', name: 'Kimi K2.7 Code', providerId: 'moonshot', contextWindow: 256000, capabilities: { text: true, image: false, functionCall: true, vision: true }, description: '专用编程模型；保留服务默认思考参数', parameters: { temperature: false, topP: false } },
      { id: 'kimi-k2.7-code-highspeed', name: 'Kimi K2.7 Code Highspeed', providerId: 'moonshot', contextWindow: 256000, capabilities: { text: true, image: false, functionCall: true, vision: true }, parameters: { temperature: false, topP: false } }
    ]
  },
  {
    id: 'zhipu',
    name: '智谱 AI',
    description: '智谱官方 GLM；思考强度和输出上限按模型适配',
    icon: 'bi bi-lightbulb',
    website: 'https://open.bigmodel.cn',
    endpoint: 'https://open.bigmodel.cn/api/paas/v4',
    config: { catalogStatus: 'verified', docsUrl: 'https://docs.bigmodel.cn/cn/guide/models/text/glm-5.3', verifiedAt: '2026-10-23' },
    models: [
      { id: 'glm-5.3', name: 'GLM-5.3', providerId: 'zhipu', contextWindow: 1000000, capabilities: { text: true, image: false, functionCall: true, vision: false }, recommended: true, reasoning: { protocol: 'openai', supportedEfforts: ['low', 'high', 'max'], mandatory: true }, parameters: { maxOutputTokens: 128000, temperature: false, topP: false } },
      { id: 'glm-5.3-flash', name: 'GLM-5.3 Flash', providerId: 'zhipu', contextWindow: 1000000, capabilities: { text: true, image: false, functionCall: true, vision: true }, recommended: true, reasoning: { protocol: 'openai', supportedEfforts: ['low', 'high', 'max'], mandatory: true }, parameters: { maxOutputTokens: 128000, temperature: true, topP: true } },
      { id: 'glm-5.3-flashx', name: 'GLM-5.3 FlashX', providerId: 'zhipu', contextWindow: 1000000, capabilities: { text: true, image: false, functionCall: true, vision: true }, reasoning: { protocol: 'openai', supportedEfforts: ['low', 'high', 'max'], mandatory: true }, parameters: { maxOutputTokens: 128000, temperature: true, topP: true } }
    ]
  },
  {
    id: 'baichuan',
    name: '百川智能',
    description: '百川开放平台；请按控制台授权添加聊天模型',
    icon: 'bi bi-tsunami',
    website: 'https://platform.baichuan-ai.com',
    endpoint: 'https://api.baichuan-ai.com/v1',
    config: { catalogStatus: 'dynamic', docsUrl: 'https://platform.baichuan-ai.com/docs-v2/api', verifiedAt: '2026-10-23' },
    models: []
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    description: 'MiniMax 官方 M3 系列多模态与编程模型',
    icon: 'bi bi-box',
    website: 'https://platform.minimax.cn',
    endpoint: 'https://api.minimax.cn/v1',
    config: { catalogStatus: 'verified', docsUrl: 'https://platform.minimax.cn/docs/guides/text-generation', verifiedAt: '2026-10-23' },
    models: [
      { id: 'MiniMax-M3.1-Flash', name: 'MiniMax M3.1 Flash', providerId: 'minimax', contextWindow: 1000000, capabilities: { text: true, image: false, functionCall: true, vision: true }, recommended: true, reasoning: { protocol: 'openai', supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'], mandatory: true }, parameters: { temperature: false, topP: false, maxTokensParameter: 'max_completion_tokens' } },
      { id: 'MiniMax-M3', name: 'MiniMax M3', providerId: 'minimax', contextWindow: 1000000, capabilities: { text: true, image: false, functionCall: true, vision: true }, description: '使用服务默认自适应思考', parameters: { temperature: false, topP: false, maxTokensParameter: 'max_completion_tokens' } }
    ]
  },
  {
    id: 'yi',
    name: '零一万物',
    description: '零一万物开放平台；请按账号授权刷新或添加模型',
    icon: 'bi bi-hexagon',
    website: 'https://platform.lingyiwanwu.com',
    endpoint: 'https://api.lingyiwanwu.com/v1',
    config: { catalogStatus: 'dynamic', docsUrl: 'https://platform.lingyiwanwu.com/docs', verifiedAt: '2026-10-23' },
    models: []
  },
  {
    id: 'stepfun',
    name: '阶跃星辰',
    description: '阶跃星辰多模态推理模型；中国与国际站的 API Key、端点需对应',
    icon: 'bi bi-stars',
    website: 'https://platform.stepfun.com',
    endpoint: 'https://api.stepfun.com/v1',
    config: { catalogStatus: 'verified', docsUrl: 'https://platform.stepfun.ai/docs/en/guides/models/step-3.7-flash', verifiedAt: '2026-10-23' },
    models: [
      { id: 'step-3.7-flash', name: 'Step 3.7 Flash', providerId: 'stepfun', contextWindow: 256000, capabilities: { text: true, image: false, functionCall: true, vision: true }, recommended: true, reasoning: { protocol: 'openai', supportedEfforts: ['low', 'medium', 'high'], mandatory: true } }
    ]
  },
  {
    id: 'spark',
    name: '讯飞星火',
    description: '讯飞星火 X2 Flash 接口；使用控制台对应的 API Password 与模型 ID',
    icon: 'bi bi-fire',
    website: 'https://xinghuo.xfyun.cn',
    endpoint: 'https://spark-api-open.xf-yun.com/agent/v1',
    config: { catalogStatus: 'dynamic', docsUrl: 'https://www.xfyun.cn/doc/spark/X2-Flash.html', verifiedAt: '2026-10-23' },
    models: []
  },
  {
    id: 'hunyuan',
    name: '腾讯混元',
    description: '混元旧平台仍服务已购模型；新模型请按 TokenHub 控制台配置',
    icon: 'bi bi-chat-left-dots',
    website: 'https://cloud.tencent.com/product/hunyuan',
    endpoint: 'https://api.hunyuan.cloud.tencent.com/v1',
    config: { catalogStatus: 'dynamic', docsUrl: 'https://cloud.tencent.com/document/product/1729/111007', verifiedAt: '2026-10-23' },
    models: []
  },
  {
    id: 'wenxin',
    name: '文心一言',
    description: '百度千帆 OpenAI 兼容接口；请按控制台授权添加模型',
    icon: 'bi bi-chat-square-text',
    website: 'https://cloud.baidu.com/product/wenxinworkshop',
    endpoint: 'https://qianfan.baidubce.com/v2',
    config: { catalogStatus: 'dynamic', docsUrl: 'https://cloud.baidu.com/doc/qianfan', verifiedAt: '2026-10-23' },
    models: []
  },
  {
    id: '360ai',
    name: '360智脑',
    description: '暂未核实当前公开聊天模型目录；请确认官方控制台中的端点和授权',
    icon: 'bi bi-shield-check',
    website: 'https://ai.360.cn',
    endpoint: '',
    config: { catalogStatus: 'unverified', docsUrl: 'https://ai.360.cn', verifiedAt: '2026-10-23' },
    models: []
  }
]
