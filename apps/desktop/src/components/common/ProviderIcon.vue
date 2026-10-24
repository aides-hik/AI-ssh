<template>
  <ProviderIconSvg :provider-id="providerId" :title="title" :size="size" />
</template>

<script setup lang="ts">
import ProviderIconSvg from './ProviderIconSvg.vue'

withDefaults(defineProps<{ providerId: string; title?: string; size?: number }>(), {
  size: 16,
  title: ''
})
</script>
