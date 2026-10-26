/**
 * 主题管理 Composable
 * 替代原 Theme Store
 */

import { ref, computed, watch } from 'vue'
import { themeService, type ThemeMode as ServiceThemeMode } from '../services/theme.service'

type ThemeMode = 'light' | 'dark' | 'auto'
type ColorScheme = 'blue' | 'green' | 'purple' | 'orange' | 'red'
type FontSize = 'small' | 'medium' | 'large'

function readSavedObject(key: string): Record<string, unknown> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) || 'null')
    return saved && typeof saved === 'object' && !Array.isArray(saved)
      ? saved as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function isFontSize(value: unknown): value is FontSize {
  return value === 'small' || value === 'medium' || value === 'large'
}

function isColorScheme(value: unknown): value is ColorScheme {
  return typeof value === 'string' && ['blue', 'green', 'purple', 'orange', 'red'].includes(value)
}

// 全局状态（单例模式）
const normalizeMode = (value: ServiceThemeMode): ThemeMode =>
  value === 'auto' ? 'auto' : value.includes('dark') ? 'dark' : 'light'
const mode = ref<ThemeMode>(normalizeMode(themeService.getMode()))
const colorScheme = ref<ColorScheme>('blue')
const fontSize = ref<FontSize>('medium')
const isDark = ref(themeService.isDarkTheme())
const animations = ref(true)
const transitions = ref(true)
const isInitialized = ref(false)

export function useTheme() {
  // 计算属性
  const currentTheme = computed(() => {
    if (mode.value === 'auto') {
      return isDark.value ? 'dark' : 'light'
    }
    return mode.value
  })

  const cssVariables = computed(() => {
    const vars: Record<string, string> = {}

    // 根据颜色方案设置主色调
    switch (colorScheme.value) {
      case 'blue':
        vars['--primary-color'] = '#3979e7'
        vars['--primary-hover'] = '#2864c9'
        vars['--vscode-accent'] = '#3979e7'
        vars['--vscode-accent-hover'] = '#2864c9'
        break
      case 'green':
        vars['--primary-color'] = '#10b981'
        vars['--primary-hover'] = '#059669'
        vars['--vscode-accent'] = '#10b981'
        vars['--vscode-accent-hover'] = '#059669'
        break
      case 'purple':
        vars['--primary-color'] = '#8b5cf6'
        vars['--primary-hover'] = '#7c3aed'
        vars['--vscode-accent'] = '#8b5cf6'
        vars['--vscode-accent-hover'] = '#7c3aed'
        break
      case 'orange':
        vars['--primary-color'] = '#f59e0b'
        vars['--primary-hover'] = '#d97706'
        vars['--vscode-accent'] = '#f59e0b'
        vars['--vscode-accent-hover'] = '#d97706'
        break
      case 'red':
        vars['--primary-color'] = '#ef4444'
        vars['--primary-hover'] = '#dc2626'
        vars['--vscode-accent'] = '#ef4444'
        vars['--vscode-accent-hover'] = '#dc2626'
        break
    }

    // 字体大小
    switch (fontSize.value) {
      case 'small':
        vars['--prism-font-scale'] = '0.875'
        vars['--font-size-base'] = '14px'
        vars['--font-size-sm'] = '12px'
        vars['--font-size-lg'] = '16px'
        break
      case 'large':
        vars['--prism-font-scale'] = '1.125'
        vars['--font-size-base'] = '18px'
        vars['--font-size-sm'] = '16px'
        vars['--font-size-lg'] = '20px'
        break
      default:
        vars['--prism-font-scale'] = '1'
        vars['--font-size-base'] = '16px'
        vars['--font-size-sm'] = '14px'
        vars['--font-size-lg'] = '18px'
    }

    return vars
  })

  // 加载主题设置
  const loadThemeSettings = () => {
    const saved = readSavedObject('theme-settings')
    const appSettings = readSavedObject('app-settings')
    const legacy = appSettings.appearance && typeof appSettings.appearance === 'object'
      ? appSettings.appearance as Record<string, unknown> : {}

    // Current preferences win field by field. Old app settings only seed missing
    // values; initialization then persists the migrated appearance without touching
    // the user's unrelated app settings or model configuration.
    if (isColorScheme(saved.colorScheme)) colorScheme.value = saved.colorScheme
    else if (isColorScheme(legacy.colorScheme)) colorScheme.value = legacy.colorScheme
    if (isFontSize(saved.fontSize)) fontSize.value = saved.fontSize
    else if (isFontSize(legacy.fontSize)) fontSize.value = legacy.fontSize
    animations.value = saved.animations !== false
    transitions.value = saved.transitions !== false
  }

  // 保存主题设置
  const saveThemeSettings = () => {
    try {
      const settings = {
        mode: mode.value,
        colorScheme: colorScheme.value,
        fontSize: fontSize.value,
        animations: animations.value,
        transitions: transitions.value
      }
      localStorage.setItem('theme-settings', JSON.stringify(settings))
    } catch {
      // Theme changes remain usable when persistent storage is unavailable.
    }
  }

  // Apply appearance options; themeService alone owns light/dark classes.
  const applyTheme = () => {
    if (typeof document === 'undefined') return
    const root = document.documentElement

    // 设置 CSS 变量
    Object.entries(cssVariables.value).forEach(([key, value]) => {
      root.style.setProperty(key, value)
    })

    // 设置动画和过渡
    root.style.setProperty('--animation-duration', animations.value ? '0.3s' : '0s')
    root.style.setProperty('--transition-duration', transitions.value ? '0.2s' : '0s')
    root.dataset.motion = animations.value ? 'on' : 'off'
    root.dataset.transitions = transitions.value ? 'on' : 'off'
  }

  // 初始化主题
  const initialize = () => {
    if (isInitialized.value) return

    loadThemeSettings()
    themeService.init()
    const syncTheme = () => {
      mode.value = normalizeMode(themeService.getMode())
      isDark.value = themeService.isDarkTheme()
      saveThemeSettings()
    }
    syncTheme()
    applyTheme()
    window.addEventListener('theme-changed', syncTheme)
    // Compare normalized preferences so a service event never loops back into it.
    watch(
      mode,
      value => {
        if (value !== normalizeMode(themeService.getMode())) {
          themeService.applyTheme(value === 'auto' ? 'auto' : `${value}-modern`)
        }
        saveThemeSettings()
      },
      { flush: 'sync' }
    )
    watch(
      [colorScheme, fontSize, animations, transitions],
      () => {
        applyTheme()
        saveThemeSettings()
      },
      { flush: 'sync' }
    )

    isInitialized.value = true
  }

  // 切换主题模式
  const toggleMode = () => {
    const modes: ThemeMode[] = ['light', 'dark', 'auto']
    const currentIndex = modes.indexOf(mode.value)
    mode.value = modes[(currentIndex + 1) % modes.length]
  }

  // 设置主题模式
  const setMode = (newMode: ThemeMode) => {
    mode.value = newMode
  }

  // 设置颜色方案
  const setColorScheme = (scheme: ColorScheme) => {
    colorScheme.value = scheme
  }

  // 设置字体大小
  const setFontSize = (size: FontSize) => {
    fontSize.value = size
  }

  // 切换动画
  const toggleAnimations = () => {
    animations.value = !animations.value
  }

  // 切换过渡效果
  const toggleTransitions = () => {
    transitions.value = !transitions.value
  }

  // 重置为默认主题
  const resetToDefault = () => {
    mode.value = 'auto'
    colorScheme.value = 'blue'
    fontSize.value = 'medium'
    animations.value = true
    transitions.value = true
    applyTheme()
    saveThemeSettings()
  }

  // 获取可用的颜色方案
  const getAvailableColorSchemes = (): { value: ColorScheme; label: string; color: string }[] => [
    { value: 'blue', label: '蓝色', color: '#3979e7' },
    { value: 'green', label: '绿色', color: '#10b981' },
    { value: 'purple', label: '紫色', color: '#8b5cf6' },
    { value: 'orange', label: '橙色', color: '#f59e0b' },
    { value: 'red', label: '红色', color: '#ef4444' }
  ]

  return {
    // 状态
    mode,
    colorScheme,
    fontSize,
    isDark,
    animations,
    transitions,

    // 计算属性
    currentTheme,
    cssVariables,

    // 方法
    initialize,
    toggleMode,
    setMode,
    setColorScheme,
    setFontSize,
    toggleAnimations,
    toggleTransitions,
    resetToDefault,
    getAvailableColorSchemes,
    applyTheme
  }
}
