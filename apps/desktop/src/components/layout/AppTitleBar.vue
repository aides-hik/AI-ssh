<template>
  <div class="vscode-titlebar flex items-center text-vscode-fg select-none">
    <!-- 左侧：应用标识 -->
    <div class="titlebar-leading flex items-center space-x-4 pl-4">
      <!-- 应用图标和名称 -->
      <div class="titlebar-brand flex items-center space-x-2">
        <AppIcon />
        <span class="text-sm font-medium" data-testid="app-brand">{{
          $t('welcome.appTitle')
        }}</span>
      </div>
    </div>

    <!-- 中间：当前文件路径 -->
    <div class="titlebar-path flex-1 flex justify-center">
      <div class="text-xs text-vscode-fg-muted truncate max-w-md">
        {{ currentFilePath }}
      </div>
    </div>

    <!-- 右侧：主题切换和窗口控制按钮 -->
    <div class="flex items-center ml-auto">
      <!-- 快捷主题切换按钮 -->
      <button
        @click="handleQuickThemeToggle"
        class="vscode-window-control theme-toggle"
        :data-prism-tooltip="`${$t('titlebar.currentTheme')}: ${currentNewThemeLabel}`"
        :aria-label="`${$t('titlebar.currentTheme')}: ${currentNewThemeLabel}`"
      >
        <svg
          v-if="currentNewTheme.includes('light')"
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="currentColor"
        >
          <!-- 太阳图标 -->
          <path
            d="M8 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm0 1a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM8 0a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 0zm0 13a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 13zm8-5a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1 0-1h2a.5.5 0 0 1 .5.5zM3 8a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1 0-1h2A.5.5 0 0 1 3 8zm10.657-5.657a.5.5 0 0 1 0 .707l-1.414 1.415a.5.5 0 1 1-.707-.708l1.414-1.414a.5.5 0 0 1 .707 0zm-9.193 9.193a.5.5 0 0 1 0 .707L3.05 13.657a.5.5 0 0 1-.707-.707l1.414-1.414a.5.5 0 0 1 .707 0zm9.193 2.121a.5.5 0 0 1-.707 0l-1.414-1.414a.5.5 0 0 1 .707-.707l1.414 1.414a.5.5 0 0 1 0 .707zM4.464 4.465a.5.5 0 0 1-.707 0L2.343 3.05a.5.5 0 1 1 .707-.707l1.414 1.414a.5.5 0 0 1 0 .708z"
          />
        </svg>
        <svg
          v-else-if="currentNewTheme.includes('dark')"
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="currentColor"
        >
          <!-- 月亮图标 -->
          <path
            d="M6 .278a.768.768 0 0 1 .08.858 7.208 7.208 0 0 0-.878 3.46c0 4.021 3.278 7.277 7.318 7.277.527 0 1.04-.055 1.533-.16a.787.787 0 0 1 .81.316.733.733 0 0 1-.031.893A8.349 8.349 0 0 1 8.344 16C3.734 16 0 12.286 0 7.71 0 4.266 2.114 1.312 5.124.06A.752.752 0 0 1 6 .278z"
          />
        </svg>
        <svg v-else width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <!-- 自动图标 -->
          <path
            d="M8 0a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 0zM3.732 1.732a.5.5 0 0 1 .707 0l1.415 1.415a.5.5 0 1 1-.708.707L3.732 2.439a.5.5 0 0 1 0-.707zM0 8a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 0 1h-2A.5.5 0 0 1 0 8zm13 0a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 0 1h-2a.5.5 0 0 1-.5-.5z"
          />
          <path d="M8 16a.5.5 0 0 1-.5-.5v-1.5a.5.5 0 0 1 1 0v1.5a.5.5 0 0 1-.5.5z" />
        </svg>
      </button>

      <button
        @click="minimizeWindow"
        class="vscode-window-control"
        :data-prism-tooltip="$t('titlebar.minimize')"
        :aria-label="$t('titlebar.minimize')"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
          <path d="M0 5h10v1H0z" />
        </svg>
      </button>
      <button
        @click="maximizeWindow"
        class="vscode-window-control"
        :data-prism-tooltip="$t('titlebar.maximize')"
        :aria-label="$t('titlebar.maximize')"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
          <path d="M0 0v10h10V0H0zm1 1h8v8H1V1z" />
        </svg>
      </button>
      <button
        @click="closeWindow"
        class="vscode-window-control vscode-window-control-close"
        :data-prism-tooltip="$t('titlebar.close')"
        :aria-label="$t('titlebar.close')"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
          <path
            d="M1.414 0L5 3.586L8.586 0L10 1.414L6.414 5L10 8.586L8.586 10L5 6.414L1.414 10L0 8.586L3.586 5L0 1.414L1.414 0z"
          />
        </svg>
      </button>
    </div>

    <Teleport to="body">
      <Transition name="shortcuts-dialog">
        <div
          v-if="shortcutsVisible"
          class="shortcuts-overlay prism-dialog-overlay"
          @click.self="closeShortcuts"
        >
          <LiquidSurface
            class="shortcuts-dialog"
            :radius="24"
            :strength="28"
            :blur="10"
            :interactive="false"
            role="dialog"
            aria-modal="true"
            :aria-labelledby="shortcutsTitleId"
          >
            <div
              ref="shortcutsContent"
              class="shortcuts-content"
              tabindex="-1"
              @keydown="handleShortcutsKeydown"
            >
              <div class="shortcuts-header">
                <div class="shortcuts-heading">
                  <i class="bi bi-keyboard" aria-hidden="true"></i>
                  <h3 :id="shortcutsTitleId">{{ $t('titlebar.shortcuts') }}</h3>
                </div>
                <button
                  type="button"
                  class="shortcuts-close prism-button prism-button--quiet"
                  :aria-label="$t('titlebar.close')"
                  @click="closeShortcuts"
                >
                  <i class="bi bi-x-lg" aria-hidden="true"></i>
                </button>
              </div>
              <dl class="shortcuts-list">
                <div v-for="shortcut in keyboardShortcuts" :key="shortcut.keys">
                  <dt>{{ shortcut.label }}</dt>
                  <dd>
                    <kbd>{{ shortcut.keys }}</kbd>
                  </dd>
                </div>
              </dl>
            </div>
          </LiquidSurface>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick, useId } from 'vue'
import AppIcon from '@/components/common/AppIcon.vue'
import LiquidSurface from '@/components/common/LiquidSurface.vue'
import { useI18n } from 'vue-i18n'
import { themeService } from '../../services/theme.service'
import { revealThemeFrom } from '../../utils/theme-reveal'
import '../../assets/styles/theme-reveal.css'
const { t: $t, locale } = useI18n()

// 响应式数据
const currentFilePath = computed(() => $t('titlebar.appWelcome'))

const shortcutsVisible = ref(false)
const shortcutsContent = ref<HTMLElement>()
const shortcutsTitleId = `shortcuts-${useId()}`
let shortcutsTrigger: HTMLElement | null = null
const keyboardShortcuts = computed(() => [
  { keys: 'Ctrl + N', label: locale.value === 'en-US' ? 'New connection' : '新建连接' },
  { keys: 'Ctrl + B', label: locale.value === 'en-US' ? 'Toggle sidebar' : '切换侧边栏' },
  { keys: 'F11', label: $t('titlebar.fullscreen') },
  { keys: 'Ctrl + K, Ctrl + T', label: $t('titlebar.toggleTheme') },
  { keys: 'Ctrl + =', label: $t('titlebar.zoomIn') },
  { keys: 'Ctrl + -', label: $t('titlebar.zoomOut') }
])
const closeShortcuts = () => {
  shortcutsVisible.value = false
  if (shortcutsTrigger?.isConnected) shortcutsTrigger.focus({ preventScroll: true })
  shortcutsTrigger = null
}
const handleShortcutsKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    closeShortcuts()
  } else if (event.key === 'Tab') {
    event.preventDefault()
    shortcutsContent.value?.querySelector<HTMLButtonElement>('button')?.focus()
  }
}
// 监听主题变化
const handleThemeChange = (event: Event) => {
  const customEvent = event as CustomEvent
  currentNewTheme.value = customEvent.detail.theme
}

onMounted(() => {
  document.addEventListener('keydown', handleShortcutsKey)
  window.addEventListener('theme-changed', handleThemeChange)
})

onBeforeUnmount(() => {
  window.removeEventListener('theme-changed', handleThemeChange)
  document.removeEventListener('keydown', handleShortcutsKey)
})

// 主题状态
const currentNewTheme = ref(themeService.getCurrentTheme())
const currentNewThemeLabel = computed(() => {
  const themes = themeService.getAvailableThemes()
  const theme = themes.find(t => t.value === currentNewTheme.value)
  return theme?.label || currentNewTheme.value
})

// 快捷主题切换
const handleQuickThemeToggle = (event: MouseEvent) => {
  const targetTheme = currentNewTheme.value.includes('dark') ? 'light-modern' : 'dark-modern'
  currentNewTheme.value = targetTheme
  void revealThemeFrom(event.currentTarget as HTMLElement | null, () => {
    themeService.applyTheme(targetTheme)
  })
}

// Open immediately; focus does not wait for the entrance motion.
const showShortcutsModal = async () => {
  shortcutsTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
  shortcutsVisible.value = true
  await nextTick()
  shortcutsContent.value?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
}

const minimizeWindow = () => {
  if (window.electronAPI?.minimizeWindow) {
    window.electronAPI.minimizeWindow()
  }
}

const maximizeWindow = () => {
  if (window.electronAPI?.maximizeWindow) {
    window.electronAPI.maximizeWindow()
  }
}

const closeWindow = () => {
  if (window.electronAPI?.closeWindow) {
    window.electronAPI.closeWindow()
  }
}

// Keep the shortcuts reference available after removing its old Help-menu entry.
const handleShortcutsKey = (event: KeyboardEvent) => {
  if (!(event.ctrlKey || event.metaKey) || event.key !== '/') return
  event.preventDefault()
  if (shortcutsVisible.value) closeShortcuts()
  else void showShortcutsModal()
}
</script>

<style scoped>
.vscode-titlebar {
  position: relative;
  min-width: 0;
  color: var(--prism-text);
  font-family: var(--prism-font);
  background: var(--liquid-window-tint);
  border-bottom: 1px solid var(--prism-border);
  -webkit-app-region: drag;
  z-index: 100;
}
.titlebar-leading {
  min-width: 0;
  flex-shrink: 0;
}
.titlebar-brand {
  white-space: nowrap;
}
.titlebar-path {
  min-width: 0;
  padding-inline: 12px;
}
.vscode-titlebar > div:last-child {
  margin-left: auto;
  margin-right: 0;
}
.vscode-window-control {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 46px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--prism-text);
  cursor: pointer;
  touch-action: manipulation;
  transition:
    background-color 120ms var(--prism-ease),
    color 120ms var(--prism-ease);
  -webkit-app-region: no-drag;
}
.vscode-window-control:focus-visible {
  outline: 2px solid var(--vscode-accent);
  outline-offset: -3px;
}
.vscode-window-control svg {
  flex-shrink: 0;
  opacity: 0.9;
}
.shortcuts-overlay {
  z-index: 10010;
}
.shortcuts-dialog {
  --liquid-tint: var(--liquid-dialog-tint, color-mix(in srgb, var(--vscode-bg) 80%, transparent));
  width: min(460px, calc(100vw - 40px));
  max-height: calc(100dvh - 40px);
  color: var(--prism-text);
  box-shadow: var(--prism-shadow);
}
.shortcuts-content {
  max-height: inherit;
  overflow-y: auto;
  outline: none;
  font-family: var(--prism-font);
}
.shortcuts-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 22px 24px 16px;
  border-bottom: 1px solid var(--prism-border);
}
.shortcuts-heading {
  display: flex;
  align-items: center;
  gap: 10px;
}
.shortcuts-heading > i {
  color: var(--vscode-accent);
  font-size: var(--prism-font-21);
}
.shortcuts-header h3 {
  margin: 0;
  font-size: var(--prism-font-17);
  font-weight: 600;
}
.shortcuts-close {
  width: 32px;
  height: 32px;
  min-height: 32px;
  padding: 0;
  border-radius: var(--prism-radius-small);
}
.shortcuts-list {
  margin: 0;
  padding: 14px 24px 20px;
}
.shortcuts-list > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  min-height: 44px;
}
.shortcuts-list dt {
  font-size: var(--prism-font-13);
  font-weight: 400;
}
.shortcuts-list dd {
  margin: 0;
  flex-shrink: 0;
}
.shortcuts-list kbd {
  display: inline-flex;
  padding: 4px 7px;
  border: 1px solid var(--prism-border);
  border-radius: var(--prism-radius-small);
  background: var(--prism-control);
  color: var(--prism-muted);
  font: var(--prism-font-11) var(--prism-font);
}
.shortcuts-dialog-enter-active,
.shortcuts-dialog-leave-active {
  transition: opacity 180ms var(--prism-ease);
}
.shortcuts-dialog-enter-active .shortcuts-dialog,
.shortcuts-dialog-leave-active .shortcuts-dialog {
  transition: transform 180ms var(--prism-ease);
}
.shortcuts-dialog-enter-from,
.shortcuts-dialog-leave-to {
  opacity: 0;
}
.shortcuts-dialog-enter-from .shortcuts-dialog,
.shortcuts-dialog-leave-to .shortcuts-dialog {
  transform: translateY(6px) scale(0.985);
}
@media (hover: hover) and (pointer: fine) {
  .vscode-window-control:hover {
    background: var(--vscode-list-hoverBackground);
  }
  .vscode-window-control-close:hover {
    background: var(--prism-danger);
    color: var(--prism-surface-raised);
  }
}
@media (max-width: 1000px) {
  .titlebar-path {
    display: none;
  }
}
@media (max-width: 680px) {
  .titlebar-brand span {
    display: none;
  }
  .titlebar-leading {
    padding-left: 10px;
    gap: 8px;
  }
}
@media (max-width: 500px) {
  .titlebar-leading > div + div {
    margin-left: 0;
  }
  .titlebar-leading {
    gap: 0;
  }
  .vscode-window-control {
    width: 30px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .shortcuts-dialog-enter-active .shortcuts-dialog,
  .shortcuts-dialog-leave-active .shortcuts-dialog {
    transition: none;
  }
  .shortcuts-dialog-enter-from .shortcuts-dialog,
  .shortcuts-dialog-leave-to .shortcuts-dialog {
    transform: none;
  }
}
html[data-motion='off'] .shortcuts-dialog,
html[data-motion='off'] .shortcuts-overlay,
html[data-transitions='off'] .shortcuts-dialog,
html[data-transitions='off'] .shortcuts-overlay {
  transition: none !important;
  transform: none !important;
}
</style>
