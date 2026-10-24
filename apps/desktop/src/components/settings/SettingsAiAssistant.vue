<template>
  <section :id="'section-ai-assistant'" class="setting-section prism-settings-section">
    <h2 class="section-title">
      <i class="bi bi-chat-dots"></i>
      {{ $t('settings.aiAssistantTitle') }}
    </h2>
    <p class="section-description">{{ $t('settings.aiAssistantDesc') }}</p>

    <!-- 默认模型 -->
    <div class="setting-row">
      <div class="setting-left">
        <label class="setting-label">{{ $t('settings.defaultModel') }}</label>
      </div>
      <div class="setting-right">
        <select
          :aria-label="$t('settings.defaultModel')"
          v-model="defaultModel"
          class="form-select"
        >
          <option value="gpt-4">{{ $t('settings.modelGpt4') }}</option>
          <option value="gpt-3.5">{{ $t('settings.modelGpt35') }}</option>
          <option value="claude">{{ $t('settings.modelClaude') }}</option>
        </select>
      </div>
    </div>

    <!-- 温度 -->
    <div class="setting-row">
      <div class="setting-left">
        <label class="setting-label">{{ $t('settings.temperature') }}</label>
        <p class="setting-hint">{{ $t('settings.temperatureHint') }}</p>
      </div>
      <div class="setting-right">
        <input
          :aria-label="$t('settings.temperature')"
          v-model.number="temperature"
          type="range"
          class="form-range"
          min="0"
          max="1"
          step="0.1"
        />
        <span>{{ temperature.toFixed(1) }}</span>
      </div>
    </div>

    <!-- 最大 Token 数 -->
    <div class="setting-row">
      <div class="setting-left">
        <label class="setting-label">{{ $t('settings.maxTokens') }}</label>
      </div>
      <div class="setting-right">
        <input
          :aria-label="$t('settings.maxTokens')"
          v-model.number="maxTokens"
          type="number"
          class="form-input"
          min="100"
          max="4000"
        />
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const defaultModel = ref<string>('gpt-3.5')
const temperature = ref<number>(0.7)
const maxTokens = ref<number>(2000)
</script>

<style scoped>
/* Section layout and controls are shared in settings-foundation.css. */
</style>
