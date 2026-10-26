<template>
  <div class="liquid-wallpaper" :data-wallpaper="visiblePreset" aria-hidden="true">
    <img
      v-if="visiblePreset === 'custom'"
      class="wallpaper-custom"
      :src="imageUrl"
      :style="customStyle"
      alt=""
      decoding="async"
      draggable="false"
      @error="imageFailed = true"
    />
    <svg v-else-if="visiblePreset === 'flow'" viewBox="0 0 1400 800" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id="app-flow-blue" x1="0" x2="1" y1="0" y2="1">
          <stop stop-color="#d3e0f4" />
          <stop offset=".48" stop-color="#649be8" />
          <stop offset="1" stop-color="#dcf7f5" />
        </linearGradient>
        <linearGradient id="app-flow-pink" x1="0" x2="1">
          <stop stop-color="#bdd2f0" />
          <stop offset="1" stop-color="#f2dae7" />
        </linearGradient>
      </defs>
      <path d="M-140 710C125 810 168 370 478 445S882 971 1588 499" fill="none" stroke="url(#app-flow-blue)" stroke-width="160" />
      <path d="M-120 585C128 691 170 293 474 370S884 890 1580 419" fill="none" stroke="#fff" stroke-opacity=".68" stroke-width="3" />
      <path d="M522-230C1155-162 617 226 1009 268S1390 66 1635 176" fill="none" stroke="url(#app-flow-pink)" stroke-width="145" />
      <path d="M553-165C1152-90 667 174 1007 205S1386 9 1616 113" fill="none" stroke="#fff" stroke-opacity=".75" stroke-width="2" />
      <path d="M-55 743C222 834 211 410 490 494S916 1010 1512 601" fill="none" stroke="#effaff" stroke-opacity=".7" stroke-width="2" />
    </svg>
    <div
      v-else-if="visiblePreset === 'aurora' || visiblePreset === 'sunset'"
      class="wallpaper-scene"
      :class="`wallpaper-scene--${visiblePreset}`"
    ></div>
    <div
      v-if="visiblePreset === 'custom'"
      class="wallpaper-shade"
      :style="{ opacity: preferences.dim / 100 }"
    ></div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useWallpaper } from '@/composables/useWallpaper'

const { preferences, imageUrl, initialize } = useWallpaper()
const imageFailed = ref(false)
watch(imageUrl, () => { imageFailed.value = false })
const visiblePreset = computed(() => preferences.value.preset === 'custom' && (!imageUrl.value || imageFailed.value)
  ? 'flow' : preferences.value.preset)
const customStyle = computed(() => ({
  objectFit: preferences.value.fit,
  filter: preferences.value.blur ? `blur(${preferences.value.blur}px)` : undefined,
  // Overscan just enough to keep blurred image edges off the viewport.
  inset: `${-preferences.value.blur * 2}px`,
  width: `calc(100% + ${preferences.value.blur * 4}px)`,
  height: `calc(100% + ${preferences.value.blur * 4}px)`
}))
onMounted(() => { void initialize() })
</script>

<style scoped>
.liquid-wallpaper[data-wallpaper='none'] {
  background: none;
}
.wallpaper-custom,
.wallpaper-scene,
.wallpaper-shade {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.wallpaper-custom {
  object-position: center;
}
.wallpaper-shade {
  background: #080f1d;
}
.wallpaper-scene {
  opacity: var(--liquid-wallpaper-opacity);
}
.wallpaper-scene--aurora {
  background:
    radial-gradient(ellipse at 12% 10%, #d0f4ed 0%, transparent 48%),
    radial-gradient(ellipse at 82% 30%, #aaa6f0 0%, transparent 52%),
    radial-gradient(ellipse at 25% 100%, #63bfc9 0%, transparent 58%),
    linear-gradient(135deg, #d2e8ef, #809bcc);
}
.wallpaper-scene--sunset {
  background:
    radial-gradient(ellipse at 85% 5%, #ffe5bd 0%, transparent 52%),
    radial-gradient(ellipse at 30% 65%, #e2b6ca 0%, transparent 55%),
    radial-gradient(ellipse at 85% 100%, #8f9bc9 0%, transparent 52%),
    linear-gradient(140deg, #d3c9e8, #f0c7b0);
}
</style>
