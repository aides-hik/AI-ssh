// AI 聊天服务目录。官方核对来源见 docs/ai-provider-catalog.md。

import type { ProviderConfig } from './ai-providers.types'

export const SPECIALIZED_PROVIDERS: ProviderConfig[] = [
  {
    id: 'minimax-speech',
    name: 'MiniMax Speech',
    description: '语音合成专用服务，当前终端 AI 对话不支持',
    icon: 'bi bi-mic',
    website: 'https://www.minimaxi.com',
    endpoint: '',
    config: { catalogStatus: 'unsupported', docsUrl: 'https://platform.minimax.cn/docs/guides/speech-t2a-http', verifiedAt: '2026-10-23' },
    models: []
  },
  {
    id: 'stability',
    name: 'Stability AI',
    description: '图像生成专用服务，当前终端 AI 对话不支持',
    icon: 'bi bi-image',
    website: 'https://stability.ai',
    endpoint: '',
    config: { catalogStatus: 'unsupported', docsUrl: 'https://platform.stability.ai/docs/api-reference', verifiedAt: '2026-10-23' },
    models: []
  },
  {
    id: 'midjourney',
    name: 'Midjourney',
    description: '当前未提供已适配的官方聊天 API，不预置第三方转发地址',
    icon: 'bi bi-palette',
    website: 'https://www.midjourney.com',
    endpoint: '',
    config: { catalogStatus: 'unsupported', docsUrl: 'https://docs.midjourney.com', verifiedAt: '2026-10-23' },
    models: []
  },
  {
    id: 'elevenlabs',
    name: 'ElevenLabs',
    description: '语音服务，当前终端 AI 对话不支持其原生接口',
    icon: 'bi bi-volume-up',
    website: 'https://elevenlabs.io',
    endpoint: '',
    config: { catalogStatus: 'unsupported', docsUrl: 'https://elevenlabs.io/docs', verifiedAt: '2026-10-23' },
    models: []
  },
  {
    id: 'runway',
    name: 'Runway',
    description: '视频生成服务，当前终端 AI 对话不支持其原生接口',
    icon: 'bi bi-camera-video',
    website: 'https://runwayml.com',
    endpoint: '',
    config: { catalogStatus: 'unsupported', docsUrl: 'https://docs.dev.runwayml.com', verifiedAt: '2026-10-23' },
    models: []
  },
  {
    id: 'suno',
    name: 'Suno AI',
    description: '音乐生成服务，当前未适配官方聊天接口',
    icon: 'bi bi-music-note-list',
    website: 'https://suno.ai',
    endpoint: '',
    config: { catalogStatus: 'unsupported', docsUrl: 'https://suno.com', verifiedAt: '2026-10-23' },
    models: []
  },
  {
    id: 'ideogram',
    name: 'Ideogram',
    description: '图像生成专用服务，当前终端 AI 对话不支持',
    icon: 'bi bi-fonts',
    website: 'https://ideogram.ai',
    endpoint: '',
    config: { catalogStatus: 'unsupported', docsUrl: 'https://developer.ideogram.ai', verifiedAt: '2026-10-23' },
    models: []
  },
  {
    id: 'together-image',
    name: 'Together Image',
    description: 'Together 图像生成接口；聊天请使用 Together AI',
    icon: 'bi bi-image-fill',
    website: 'https://together.ai',
    endpoint: '',
    config: { catalogStatus: 'unsupported', docsUrl: 'https://docs.together.ai/docs/images-overview', verifiedAt: '2026-10-23' },
    models: []
  }
]
