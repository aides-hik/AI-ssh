/** Owns the saved appearance mode and the single resolved theme class. */
export type ThemeMode = 'dark' | 'light' | 'dark-modern' | 'light-modern' | 'auto'

const THEME_STORAGE_KEY = 'app-theme-mode'

export class ThemeService {
  private currentTheme: Exclude<ThemeMode, 'auto'> = 'dark-modern'
  private mode: ThemeMode = 'auto'
  private initialized = false
  private transitionFrame = 0

  init(): void {
    if (this.initialized || typeof window === 'undefined' || typeof document === 'undefined') return
    this.initialized = true
    this.applyTheme(this.loadTheme() ?? this.loadLegacyTheme() ?? 'auto')
    this.watchSystemTheme()
  }

  applyTheme(theme: ThemeMode): void {
    if (!this.isValidTheme(theme)) return
    this.mode = theme
    this.currentTheme = theme === 'auto' ? this.detectSystemTheme() : theme
    this.saveTheme(theme)
    this.renderTheme()
  }

  private renderTheme(): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') return
    const root = document.documentElement
    const themeClasses = ['dark', 'light', 'dark-modern', 'light-modern', 'auto']
    if (themeClasses.some(name => root.classList.contains(name) !== (name === this.currentTheme))) {
      root.dataset.themeSwitching = ''
      // Commit the transition guard before changing any theme-dependent values.
      void root.offsetWidth
      root.classList.remove('dark', 'light', 'dark-modern', 'light-modern', 'auto')
      root.classList.add(this.currentTheme)
      if (this.transitionFrame) window.cancelAnimationFrame(this.transitionFrame)
      this.transitionFrame = window.requestAnimationFrame(() => {
        // Keep the guard through the first paint of the new palette.
        this.transitionFrame = window.requestAnimationFrame(() => {
          delete root.dataset.themeSwitching
          this.transitionFrame = 0
        })
      })
    }
    root.dataset.themeMode = this.mode
    root.style.setProperty('color-scheme', this.isDarkTheme() ? 'dark' : 'light')
    window.dispatchEvent(
      new CustomEvent('theme-changed', {
        detail: { theme: this.currentTheme, mode: this.mode }
      })
    )
  }

  toggleTheme(): void {
    this.applyTheme(this.isDarkTheme() ? 'light-modern' : 'dark-modern')
  }

  /** Resolved appearance, retained for existing icon and terminal consumers. */
  getCurrentTheme(): Exclude<ThemeMode, 'auto'> {
    return this.currentTheme
  }

  /** User preference; auto stays auto when the operating system changes. */
  getMode(): ThemeMode {
    return this.mode
  }

  private detectSystemTheme(): 'dark-modern' | 'light-modern' {
    return typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-color-scheme: dark)').matches
      ? 'dark-modern'
      : 'light-modern'
  }

  private watchSystemTheme(): void {
    if (!window.matchMedia) return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', event => {
      if (this.mode !== 'auto') return
      this.currentTheme = event.matches ? 'dark-modern' : 'light-modern'
      // Resolve the new palette without overwriting the saved auto preference.
      this.renderTheme()
    })
  }

  private loadTheme(): ThemeMode | null {
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY)
      if (saved && this.isValidTheme(saved)) return saved
    } catch {
      // The in-memory preference remains available when storage is blocked.
    }
    return null
  }

  private loadLegacyTheme(): ThemeMode | null {
    try {
      const saved = localStorage.getItem('theme-settings')
      const legacy: unknown = saved ? JSON.parse(saved) : null
      if (
        legacy &&
        typeof legacy === 'object' &&
        'mode' in legacy &&
        typeof legacy.mode === 'string' &&
        this.isValidTheme(legacy.mode)
      )
        return legacy.mode
    } catch {
      // A malformed legacy preference falls back to following the system.
    }
    return null
  }

  private saveTheme(theme: ThemeMode): void {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme)
    } catch {
      // Theme changes still work without persistent storage.
    }
  }

  private isValidTheme(theme: string): theme is ThemeMode {
    return ['dark', 'light', 'dark-modern', 'light-modern', 'auto'].includes(theme)
  }

  getAvailableThemes(): Array<{ value: ThemeMode; label: string; description: string }> {
    return [
      { value: 'dark-modern', label: 'Dark Modern', description: '深色工作空间' },
      { value: 'light-modern', label: 'Light Modern', description: '浅色工作空间' },
      { value: 'dark', label: 'Dark (Legacy)', description: '传统深色主题（向后兼容）' },
      { value: 'light', label: 'Light (Legacy)', description: '传统浅色主题（向后兼容）' },
      { value: 'auto', label: 'Auto', description: '跟随系统主题自动切换' }
    ]
  }

  isDarkTheme(): boolean {
    return this.currentTheme.includes('dark')
  }

  isLightTheme(): boolean {
    return !this.isDarkTheme()
  }
}

export const themeService = new ThemeService()

if (typeof window !== 'undefined') themeService.init()
