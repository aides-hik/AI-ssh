<template>
  <section id="section-about" class="setting-section prism-settings-section">
    <h2 class="section-title">
      <i class="bi bi-info-circle"></i>
      {{ $t('settings.aboutTitle') }}
    </h2>
    <div class="setting-row">
      <div class="setting-left">
        <label class="setting-label">{{ $t('settings.version') }}</label>
      </div>
      <div class="setting-right">
        <span class="badge">{{ appVersion }}</span>
      </div>
    </div>
    <p class="section-description">{{ $t('settings.appDescription') }}</p>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

const appVersion = ref('—')

onMounted(async () => {
  if (window.electronAPI?.getVersion) {
    appVersion.value = await window.electronAPI.getVersion()
  }
})
</script>
