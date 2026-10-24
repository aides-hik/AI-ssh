<template>
  <section :id="'section-advanced'" class="setting-section prism-settings-section">
    <h2 class="section-title">
      <i class="bi bi-gear-fill"></i>
      {{ $t('settings.advancedTitle') }}
    </h2>
    <p class="section-description">{{ $t('settings.advancedDesc') }}</p>

    <!-- 日志级别 -->
    <div class="setting-row">
      <div class="setting-left">
        <label class="setting-label">{{ $t('settings.logLevel') }}</label>
      </div>
      <div class="setting-right">
        <select :aria-label="$t('settings.logLevel')" v-model="logLevel" class="form-select">
          <option value="debug">{{ $t('settings.logDebug') }}</option>
          <option value="info">{{ $t('settings.logInfo') }}</option>
          <option value="warn">{{ $t('settings.logWarn') }}</option>
          <option value="error">{{ $t('settings.logError') }}</option>
        </select>
      </div>
    </div>

    <!-- 调试模式 -->
    <div class="setting-row">
      <div class="setting-left">
        <label class="setting-label">{{ $t('settings.enableDebugMode') }}</label>
      </div>
      <div class="setting-right">
        <label class="toggle-switch">
          <input :aria-label="$t('settings.enableDebugMode')" v-model="debugMode" type="checkbox" />
          <span class="toggle-slider"></span>
        </label>
      </div>
    </div>

    <!-- 启用动画 -->
    <div class="setting-row">
      <div class="setting-left">
        <label class="setting-label">{{ $t('settings.enableAnimation') }}</label>
      </div>
      <div class="setting-right">
        <label class="toggle-switch">
          <input
            :aria-label="$t('settings.enableAnimation')"
            v-model="enableAnimation"
            type="checkbox"
          />
          <span class="toggle-slider"></span>
        </label>
      </div>
    </div>

    <!-- 启用测试版功能 -->
    <div class="setting-row">
      <div class="setting-left">
        <label class="setting-label">{{ $t('settings.enableBeta') }}</label>
      </div>
      <div class="setting-right">
        <label class="toggle-switch">
          <input :aria-label="$t('settings.enableBeta')" v-model="enableBeta" type="checkbox" />
          <span class="toggle-slider"></span>
        </label>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const logLevel = ref<string>('info')
const debugMode = ref<boolean>(false)
const enableAnimation = ref<boolean>(true)
const enableBeta = ref<boolean>(false)
</script>

<style scoped>
/* Section layout and controls are shared in settings-foundation.css. */
</style>
