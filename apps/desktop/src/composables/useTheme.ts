/**
 * 主题管理 Composable
 * 替代原 Theme Store
 */

import { ref, computed, watch } from 'vue'
import { themeService, type ThemeMode as ServiceThemeMode } from '../services/theme.service'

type ThemeMode = 'light' | 'dark' | 'auto'
type ColorScheme = 'blue' | 'green' | 'purple' | 'orange' | 'red'

// 全局状态（单例模式）
const normalizeMode = (value: ServiceThemeMode): ThemeMode =>
  value === 'auto' ? 'auto' : value.includes('dark') ? 'dark' : 'light'
const mode = ref<ThemeMode>(normalizeMode(themeService.getMode()))
const colorScheme = ref<ColorScheme>('blue')
const fontSize = ref<'small' | 'medium' | 'large'>('medium')
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
        vars['--font-size-base'] = '14px'
        vars['--font-size-sm'] = '12px'
        vars['--font-size-lg'] = '16px'
        break
      case 'large':
        vars['--font-size-base'] = '18px'
        vars['--font-size-sm'] = '16px'
        vars['--font-size-lg'] = '20px'
        break
      default:
        vars['--font-size-base'] = '16px'
        vars['--font-size-sm'] = '14px'
        vars['--font-size-lg'] = '18px'
    }

    return vars
  })

  // 加载主题设置
  const loadThemeSettings = () => {
    try {
      const savedTheme = localStorage.getItem('theme-settings')
      if (savedTheme) {
        const settings = JSON.parse(savedTheme)
        if (['blue', 'green', 'purple', 'orange', 'red'].includes(settings.colorScheme)) {
          colorScheme.value = settings.colorScheme
        }
        if (['small', 'medium', 'large'].includes(settings.fontSize))
          fontSize.value = settings.fontSize
        animations.value = settings.animations !== false
        transitions.value = settings.transitions !== false
      }
    } catch {
      // Keep the current theme when saved preferences cannot be read.
    }
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
  const setFontSize = (size: 'small' | 'medium' | 'large') => {
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
