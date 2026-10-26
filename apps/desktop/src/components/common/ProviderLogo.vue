<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import logoSources from '@/assets/provider-logos/sources.json'
import AiProvidersIcon from './AiProvidersIcon.vue'

const props = defineProps<{ providerId: string; fallbackIcon?: string }>()
const sources: Record<string, { file: string; source: string }> = logoSources
const assets = import.meta.glob('/src/assets/provider-logos/*.{svg,png,ico,webp}', {
  eager: true,
  query: '?url',
  import: 'default'
}) as Record<string, string>
const src = computed(() => {
  const file = sources[props.providerId]?.file
  return file ? assets[`/src/assets/provider-logos/${file}`] : undefined
})
const failed = ref(false)
watch(src, () => { failed.value = false })
</script>

<template>
  <span class="provider-logo" :class="{ 'is-official': src && !failed }" aria-hidden="true">
    <img v-if="src && !failed" :src="src" alt="" draggable="false" decoding="async" @error="failed = true" />
    <AiProvidersIcon v-else-if="providerId === 'custom-openai' || providerId === 'skylark' || !fallbackIcon" />
    <i v-else :class="fallbackIcon"></i>
  </span>
</template>

<style scoped>
.provider-logo {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  place-items: center;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  padding: 5px;
  border-radius: inherit;
  color: var(--vscode-accent);
}
.provider-logo.is-official {
  /* A neutral plate keeps each brand's original colors legible in both themes. */
  background: #fff;
  box-shadow: inset 0 0 0 1px rgb(25 42 65 / 7%);
}
.provider-logo img {
  display: block;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  object-fit: contain;
}
</style>
