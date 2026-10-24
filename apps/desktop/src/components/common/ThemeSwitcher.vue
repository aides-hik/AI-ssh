<template>
  <div class="theme-switcher">
    <button
      type="button"
      class="theme-toggle-btn"
      :aria-label="`切换主题，当前主题: ${currentThemeLabel}`"
      :data-prism-tooltip="`当前主题: ${currentThemeLabel}`"
      @click="toggleTheme"
    >
      <i :class="themeIcon"></i>
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { themeService, type ThemeMode } from '@/services/theme.service'

const currentTheme = ref<ThemeMode>(themeService.getCurrentTheme())

const themeIcon = computed(() => {
  if (currentTheme.value.includes('dark')) {
    return 'bi bi-moon-stars-fill'
  }
  return 'bi bi-sun-fill'
})

const currentThemeLabel = computed(() => {
  const themes = themeService.getAvailableThemes()
  const theme = themes.find(t => t.value === currentTheme.value)
  return theme?.label || currentTheme.value
})

const toggleTheme = () => {
  themeService.toggleTheme()
  currentTheme.value = themeService.getCurrentTheme()
}

const handleThemeChange = (event: Event) => {
  const customEvent = event as CustomEvent
  currentTheme.value = customEvent.detail.theme
}

onMounted(() => {
  window.addEventListener('theme-changed', handleThemeChange)
})

onBeforeUnmount(() => {
  window.removeEventListener('theme-changed', handleThemeChange)
})
</script>

<style scoped>
.theme-switcher {
  display: flex;
  align-items: center;
  justify-content: center;
}
.theme-toggle-btn {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  padding: 0;
  border: 1px solid var(--prism-border);
  border-radius: var(--prism-radius-control);
  background: var(--prism-control);
  color: var(--prism-text);
  cursor: pointer;
  font-size: 16px;
  touch-action: manipulation;
  transition:
    background-color var(--prism-duration) var(--prism-ease),
    border-color var(--prism-duration) var(--prism-ease),
    color var(--prism-duration) var(--prism-ease);
}
.theme-toggle-btn:focus-visible {
  outline: 2px solid var(--vscode-accent);
  outline-offset: 3px;
}
.theme-toggle-btn:active {
  opacity: 0.7;
}
@media (hover: hover) and (pointer: fine) {
  .theme-toggle-btn:hover {
    background: var(--vscode-list-hoverBackground);
    border-color: var(--vscode-accent);
  }
}
</style>
