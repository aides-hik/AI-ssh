<script setup lang="ts">
import iconUrl from '../../../resources/icons/prism.png?url'

withDefaults(defineProps<{ size?: number }>(), { size: 20 })
</script>

<template>
  <img
    class="prism-app-icon"
    :src="iconUrl"
    :width="size"
    :height="size"
    :style="{ width: `${size}px`, height: `${size}px` }"
    alt=""
    aria-hidden="true"
    draggable="false"
  />
</template>

<style scoped>
.prism-app-icon {
  display: block;
  flex-shrink: 0;
  object-fit: contain;
  border-radius: 18%;
  user-select: none;
}
</style>
