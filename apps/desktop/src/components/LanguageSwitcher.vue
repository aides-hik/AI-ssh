<template>
  <div class="language-switcher">
    <select
      v-model="currentLocale"
      @change="handleChange"
      class="language-select prism-input"
      :data-prism-tooltip="$t('settings.language')"
      :aria-label="$t('settings.language')"
    >
      <option value="zh-CN">简体中文</option>
      <option value="en-US">English</option>
    </select>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { setLocale, getLocale } from '../locales'
import type { Locale } from '@ai-ssh/shared'

const currentLocale = ref<Locale>(getLocale())

// 监听语言切换
function handleChange() {
  setLocale(currentLocale.value)

  // 显示切换成功提示
}

onMounted(() => {
  currentLocale.value = getLocale()
})
</script>

<style scoped>
.language-switcher {
  display: inline-flex;
  min-width: 0;
  max-width: 100%;
}
.language-select {
  min-width: min(160px, 100%);
  max-width: 100%;
  min-height: 38px;
  padding: 8px 12px;
  border: 1px solid var(--prism-border);
  border-radius: var(--prism-radius-control);
  background-color: var(--prism-control);
  color: var(--prism-text);
  font: inherit;
  font-size: var(--prism-font-13);
  cursor: pointer;
}
.language-select:focus-visible {
  outline: 2px solid var(--vscode-accent);
  outline-offset: 2px;
}
</style>
