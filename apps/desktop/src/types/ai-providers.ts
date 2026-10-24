// AI 聊天服务目录；保留历史服务商 ID 以兼容用户配置。
// 模型和接入状态的官方核对来源见 docs/ai-provider-catalog.md。

export * from './ai-providers.types'

import { INTERNATIONAL_PROVIDERS } from './ai-providers.international'
import { CHINESE_PROVIDERS } from './ai-providers.chinese'
import { CHINESE_EXTENDED_PROVIDERS } from './ai-providers.chinese-extended'
import { PLATFORM_PROVIDERS } from './ai-providers.platforms'
import { CLOUD_PROVIDERS } from './ai-providers.cloud'
import { OPENSOURCE_PROVIDERS } from './ai-providers.opensource'
import { SPECIALIZED_PROVIDERS } from './ai-providers.specialized'
import type { ProviderConfig } from './ai-providers.types'

// 合并聊天预设、需自行配置的服务和历史兼容入口。
export const DEFAULT_PROVIDERS: ProviderConfig[] = [
  ...INTERNATIONAL_PROVIDERS,
  ...CHINESE_PROVIDERS,
  ...CHINESE_EXTENDED_PROVIDERS,
  ...PLATFORM_PROVIDERS,
  ...CLOUD_PROVIDERS,
  ...OPENSOURCE_PROVIDERS,
  ...SPECIALIZED_PROVIDERS
]

// 按类别导出
export { 
  INTERNATIONAL_PROVIDERS, 
  CHINESE_PROVIDERS,
  CHINESE_EXTENDED_PROVIDERS,
  PLATFORM_PROVIDERS,
  CLOUD_PROVIDERS,
  OPENSOURCE_PROVIDERS,
  SPECIALIZED_PROVIDERS
}

// 统计信息
export const PROVIDER_STATS = {
  total: DEFAULT_PROVIDERS.length,
  international: INTERNATIONAL_PROVIDERS.length,
  chinese: CHINESE_PROVIDERS.length + CHINESE_EXTENDED_PROVIDERS.length,
  platforms: PLATFORM_PROVIDERS.length,
  cloud: CLOUD_PROVIDERS.length,
  opensource: OPENSOURCE_PROVIDERS.length,
  specialized: SPECIALIZED_PROVIDERS.length,
  totalModels: DEFAULT_PROVIDERS.reduce((sum, p) => sum + p.models.length, 0)
}

// 按用途分类
export const PROVIDER_CATEGORIES = {
  text: DEFAULT_PROVIDERS.filter(p => p.models.some(m => m.capabilities.text)),
  vision: DEFAULT_PROVIDERS.filter(p => p.models.some(m => m.capabilities.vision)),
  image: DEFAULT_PROVIDERS.filter(p => p.models.some(m => m.capabilities.image)),
  functionCall: DEFAULT_PROVIDERS.filter(p => p.models.some(m => m.capabilities.functionCall))
}
