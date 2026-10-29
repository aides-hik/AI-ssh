/**
 * Settings 服务 - 统一接口
 * 仅使用本地存储实现
 */

import { createService } from './base/service-factory'
import { BaseLocalImpl } from './base/base-api-impl'
import type { AIModel } from '../types/ai-providers.types'
import { ProtectedSettingsPersistence } from './settings-persistence'
import { ChatHistoryStore } from './chat-history'

// ============= 接口定义 =============
export interface ISettingsService {
  getSettings(): Promise<AppSettings>
  saveSettings(settings: AppSettings): Promise<{ success: boolean }>
  resetSettings(): Promise<{ success: boolean }>
  exportSettings(exportPath: string): Promise<{ success: boolean }>
  importSettings(importPath: string): Promise<{ success: boolean; settings?: AppSettings }>
}

export interface AppSettings {
  // AI 配置
  aiProviders?: AIProviderConfig[]

  // 主题配置
  theme?: 'light' | 'dark' | 'auto'

  // 语言配置
  language?: string

  // 权限配置
  permissionConfig?: PermissionConfig

  // 其他配置...
  [key: string]: any
}

export interface AIProviderConfig {
  id: string
  name: string
  enabled: boolean
  apiKey?: string
  endpoint?: string
  config?: Record<string, any>
  isDefault?: boolean
  models?: AIModel[]
}

export interface PermissionConfig {
  version: string
  lastUpdated: string
  customRules: PermissionRule[]
  modeSettings: {
    plan: {
      enabled: boolean
    }
    build: {
      autoConfirmDangerous: boolean
    }
  }
}

export interface PermissionRule {
  pattern: string
  action: 'allow' | 'deny' | 'ask'
  description?: string
}

// ============= 本地存储实现 =============
class SettingsLocalImpl extends BaseLocalImpl implements ISettingsService {
  private readonly persistence = new ProtectedSettingsPersistence(
    () => {
      const bridge = this.electronAPI?.settings
      if (!bridge?.get || !bridge?.save) throw new Error('无法访问桌面安全设置，请在桌面应用中重试。')
      return bridge
    },
    () => [localStorage, sessionStorage],
    this.getUserId()
  )

  async getSettings(): Promise<AppSettings> {
    return this.persistence.get()
  }

  async saveSettings(settings: AppSettings): Promise<{ success: boolean }> {
    const result = await this.persistence.save(settings)
    if (result.success) new ChatHistoryStore(localStorage).applySettings(settings.aiAssistant || {})
    return result
  }

  async resetSettings(): Promise<{ success: boolean }> {
    const result = await this.persistence.reset()
    if (result.success) new ChatHistoryStore(localStorage).applySettings({ enableChatHistory: false })
    return result
  }

  async exportSettings(exportPath: string): Promise<{ success: boolean }> {
    return this.persistence.export(exportPath)
  }

  async importSettings(importPath: string): Promise<{ success: boolean; settings?: AppSettings }> {
    const result = await this.persistence.import(importPath)
    if (result.success) new ChatHistoryStore(localStorage).applySettings((result.settings || await this.persistence.get()).aiAssistant || {})
    return result
  }
}

// ============= 默认导出 =============
export const settingsService = createService<ISettingsService>(
  'SettingsService',
  SettingsLocalImpl,
  SettingsLocalImpl
)
