<script setup lang="ts">
import { computed } from 'vue'
import { updateDownloadDisplay, type UpdateDownloadState } from './update-download-progress'

const props = defineProps<{ state: UpdateDownloadState }>()
const download = computed(() => updateDownloadDisplay(props.state))
</script>

<template>
  <section v-if="download.visible" class="update-download-progress" aria-label="更新下载">
    <div class="update-download-heading">
      <span class="update-download-title">{{ download.title }}</span>
      <span class="update-download-percent">{{ download.percentText }}</span>
    </div>
    <div
      class="update-download-track"
      :class="{ 'is-indeterminate': download.percent === null, 'is-complete': download.complete }"
      role="progressbar"
      aria-label="更新安装包下载进度"
      :aria-valuemin="download.percent === null ? undefined : 0"
      :aria-valuemax="download.percent === null ? undefined : 100"
      :aria-valuenow="download.percent === null ? undefined : download.percent"
      :aria-valuetext="download.accessibleText"
    >
      <span class="update-download-fill" :style="download.percent === null ? undefined : { width: `${download.percent}%` }"></span>
    </div>
    <div class="update-download-details">
      <span class="update-download-size">{{ download.sizeText }}</span>
      <span v-if="download.speedText" class="update-download-speed">{{ download.speedText }}</span>
    </div>
  </section>
</template>

<style scoped>
.update-download-progress {
  display: grid;
  gap: 9px;
  min-width: 0;
  margin-top: 14px;
  padding: 13px 14px 12px;
  border: 1px solid var(--liquid-rim);
  border-radius: var(--prism-radius-control, 10px);
  background: var(--prism-surface, var(--liquid-panel));
  box-shadow: inset 0 1px 0 var(--liquid-inner-light);
  color: var(--prism-text);
  font-family: var(--prism-font);
  text-align: left;
}
.update-download-heading,
.update-download-details {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 4px 14px;
  min-width: 0;
}
.update-download-heading {
  font-size: var(--prism-font-12);
  line-height: 1.5;
}
.update-download-title { font-weight: 550; }
.update-download-percent {
  color: var(--vscode-accent);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.update-download-track {
  height: 8px;
  overflow: hidden;
  border: 1px solid var(--prism-border);
  border-radius: 999px;
  background: color-mix(in srgb, var(--liquid-selected) 65%, var(--prism-surface-raised));
  box-shadow: inset 0 1px 3px color-mix(in srgb, var(--liquid-shadow) 16%, transparent);
}
.update-download-fill {
  display: block;
  width: 0;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(180deg, color-mix(in srgb, var(--vscode-accent) 72%, white), var(--vscode-accent));
  box-shadow: inset 0 1px 0 var(--liquid-inner-light);
}
.is-indeterminate .update-download-fill {
  width: 35%;
  margin-left: 32.5%;
  opacity: 0.65;
}
.update-download-details {
  color: var(--prism-muted);
  font-size: var(--prism-font-11);
  line-height: 1.6;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.update-download-speed { margin-left: auto; }
@media (max-width: 360px) {
  .update-download-progress { padding: 11px 12px; }
  .update-download-details { display: grid; gap: 2px; }
  .update-download-speed { margin-left: 0; }
}
@media (forced-colors: active) {
  .update-download-track { border-color: CanvasText; }
  .update-download-fill { background: Highlight; forced-color-adjust: none; }
}
</style>
