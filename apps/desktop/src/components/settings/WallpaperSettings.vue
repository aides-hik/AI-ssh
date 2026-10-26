<template>
  <div class="wallpaper-settings" :aria-busy="loading || saving" data-testid="wallpaper-settings">
    <div class="wallpaper-heading">
      <div>
        <h3 class="wallpaper-title">{{ copy.title }}</h3>
        <p class="setting-hint">{{ copy.description }}</p>
      </div>
      <button
        type="button"
        class="wallpaper-reset"
        :disabled="loading || saving || (preferences.preset === 'flow' && !error)"
        @click="perform(restoreDefault)"
      >
        {{ copy.restore }}
      </button>
    </div>

    <div class="wallpaper-gallery" role="group" :aria-label="copy.choose">
      <button
        v-for="preset in presets"
        :key="preset.id"
        type="button"
        class="wallpaper-choice"
        :class="{ selected: preferences.preset === preset.id }"
        :data-wallpaper-id="preset.id"
        :aria-pressed="preferences.preset === preset.id"
        :disabled="loading || saving"
        @click="perform(() => selectPreset(preset.id))"
      >
        <span class="wallpaper-swatch" :class="`wallpaper-swatch--${preset.id}`" aria-hidden="true">
          <svg v-if="preset.id === 'flow'" viewBox="0 0 140 80" preserveAspectRatio="xMidYMid slice">
            <path d="M-15 62C22 90 18 20 57 48S113 100 157 32" />
            <path d="M55-18C116-15 65 25 106 24S139 5 164 15" />
          </svg>
          <span v-if="preferences.preset === preset.id" class="wallpaper-selected-mark">
            <i class="bi bi-check-lg"></i>
          </span>
        </span>
        <span class="wallpaper-choice-label">{{ preset.name }}</span>
      </button>
      <button
        type="button"
        class="wallpaper-choice wallpaper-choice--custom"
        :class="{ selected: preferences.preset === 'custom' }"
        data-wallpaper-id="custom"
        :aria-pressed="preferences.preset === 'custom'"
        :aria-label="imageUrl ? copy.custom : copy.upload"
        :disabled="loading || saving"
        @click="chooseCustom"
      >
        <span class="wallpaper-swatch wallpaper-swatch--custom" aria-hidden="true">
          <img v-if="imageUrl" :src="imageUrl" alt="" />
          <i v-else class="bi bi-image wallpaper-placeholder"></i>
          <span v-if="preferences.preset === 'custom'" class="wallpaper-selected-mark">
            <i class="bi bi-check-lg"></i>
          </span>
        </span>
        <span class="wallpaper-choice-label">{{ copy.custom }}</span>
      </button>
    </div>

    <div class="wallpaper-file-row">
      <input
        ref="fileInput"
        type="file"
        class="wallpaper-file-input"
        accept="image/png,image/jpeg,image/webp"
        :aria-label="copy.upload"
        :disabled="loading || saving"
        tabindex="-1"
        @change="uploadFile"
      />
      <button
        type="button"
        class="prism-button wallpaper-upload"
        data-testid="wallpaper-upload"
        :disabled="loading || saving"
        @click="fileInput?.click()"
      >
        <i class="bi bi-upload" aria-hidden="true"></i>
        {{ saving ? copy.saving : imageUrl ? copy.replace : copy.upload }}
      </button>
      <div class="wallpaper-file-info">
        <span v-if="imageName" class="wallpaper-file-name" :title="imageName">{{ imageName }}</span>
        <span class="wallpaper-file-hint">{{ copy.formats }}</span>
      </div>
      <button
        v-if="imageUrl"
        type="button"
        class="wallpaper-remove"
        data-testid="wallpaper-remove"
        :disabled="loading || saving"
        @click="perform(removeCustom)"
      >
        {{ copy.remove }}
      </button>
    </div>

    <div v-if="preferences.preset === 'custom'" class="wallpaper-adjustments">
      <label class="wallpaper-control wallpaper-fit">
        <span>{{ copy.fit }}</span>
        <select
          class="form-select"
          :value="preferences.fit"
          :disabled="loading || saving"
          data-testid="wallpaper-fit"
          @change="changeFit"
        >
          <option value="cover">{{ copy.cover }}</option>
          <option value="contain">{{ copy.contain }}</option>
        </select>
      </label>
      <label class="wallpaper-control">
        <span class="wallpaper-control-caption">{{ copy.dim }}<output>{{ dim }}%</output></span>
        <input
          v-model.number="dim"
          type="range"
          min="0"
          max="70"
          step="1"
          :aria-label="copy.dim"
          :aria-valuetext="`${dim}%`"
          :disabled="loading || saving"
          data-testid="wallpaper-dim"
          @change="perform(() => updatePreferences({ dim }))"
        />
      </label>
      <label class="wallpaper-control">
        <span class="wallpaper-control-caption">{{ copy.blur }}<output>{{ blur }}px</output></span>
        <input
          v-model.number="blur"
          type="range"
          min="0"
          max="20"
          step="1"
          :aria-label="copy.blur"
          :aria-valuetext="`${blur}px`"
          :disabled="loading || saving"
          data-testid="wallpaper-blur"
          @change="perform(() => updatePreferences({ blur }))"
        />
      </label>
    </div>
    <p v-if="error || actionError" class="wallpaper-error" role="alert">{{ error || actionError }}</p>
    <p v-else-if="loading" class="wallpaper-message" role="status">{{ copy.loading }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWallpaper } from '@/composables/useWallpaper'

const { locale } = useI18n()
const {
  preferences, imageUrl, imageName, loading, saving, error,
  initialize, selectPreset, upload, updatePreferences, removeCustom, restoreDefault
} = useWallpaper()
const fileInput = ref<HTMLInputElement>()
const actionError = ref('')
const dim = ref(preferences.value.dim)
const blur = ref(preferences.value.blur)
watch(() => preferences.value.dim, value => { dim.value = value })
watch(() => preferences.value.blur, value => { blur.value = value })

const copy = computed(() => locale.value.startsWith('zh') ? {
  title: '壁纸', description: '为玻璃界面选择背景，也可以使用自己的图片。',
  restore: '恢复默认', choose: '选择壁纸', flow: '流线', aurora: '极光', sunset: '暮光',
  none: '纯色', custom: '自定义', upload: '上传图片', replace: '更换图片',
  formats: 'JPG、PNG、WebP · 最大 20 MB', remove: '移除图片', saving: '保存中…',
  fit: '显示方式', cover: '铺满', contain: '完整显示', dim: '暗化', blur: '模糊',
  loading: '正在读取壁纸…', failure: '壁纸未能保存，请重试。'
} : {
  title: 'Wallpaper', description: 'Choose a background for the glass interface, or use your own image.',
  restore: 'Restore default', choose: 'Choose wallpaper', flow: 'Flow', aurora: 'Aurora', sunset: 'Dusk',
  none: 'Solid', custom: 'Custom', upload: 'Upload image', replace: 'Replace image',
  formats: 'JPG, PNG, WebP · Up to 20 MB', remove: 'Remove image', saving: 'Saving…',
  fit: 'Image fit', cover: 'Fill', contain: 'Fit entire image', dim: 'Dim', blur: 'Blur',
  loading: 'Loading wallpaper…', failure: 'Could not save wallpaper. Please try again.'
})
const presets = computed(() => [
  { id: 'flow' as const, name: copy.value.flow },
  { id: 'aurora' as const, name: copy.value.aurora },
  { id: 'sunset' as const, name: copy.value.sunset },
  { id: 'none' as const, name: copy.value.none }
])

async function perform(action: () => Promise<void>) {
  actionError.value = ''
  try { await action() }
  catch (cause) { actionError.value = cause instanceof Error ? cause.message : copy.value.failure }
  finally {
    dim.value = preferences.value.dim
    blur.value = preferences.value.blur
  }
}

function chooseCustom() {
  if (imageUrl.value) void perform(() => selectPreset('custom'))
  else fileInput.value?.click()
}

async function uploadFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) await perform(() => upload(file))
  // A failed selection can be retried with the same file.
  input.value = ''
}

function changeFit(event: Event) {
  const fit = (event.target as HTMLSelectElement).value === 'contain' ? 'contain' : 'cover'
  void perform(() => updatePreferences({ fit }))
}

onMounted(() => { void perform(initialize) })
</script>

<style scoped>
.wallpaper-settings {
  min-width: 0;
  padding: 20px 0;
  border-bottom: 1px solid var(--prism-border);
  container-type: inline-size;
}
.wallpaper-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}
.wallpaper-title {
  margin: 0 0 5px;
  color: var(--prism-text);
  font-size: var(--prism-font-13);
  font-weight: 500;
  line-height: 1.6;
}
.wallpaper-reset,
.wallpaper-remove {
  flex-shrink: 0;
  min-height: 32px;
  padding: 4px 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--vscode-accent);
  font: inherit;
  font-size: var(--prism-font-12);
  cursor: pointer;
}
.wallpaper-reset:disabled { color: var(--prism-muted); opacity: 0.6; cursor: default; }
.wallpaper-gallery {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 10px;
}
.wallpaper-choice {
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-width: 0;
  padding: 4px;
  border: 1px solid transparent;
  border-radius: 12px;
  background: transparent;
  color: var(--prism-muted);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color 120ms ease, background-color 120ms ease;
}
.wallpaper-choice:hover { background: var(--liquid-selected); }
.wallpaper-choice.selected {
  border-color: var(--vscode-accent);
  background: color-mix(in srgb, var(--vscode-accent) 7%, transparent);
  color: var(--prism-text);
}
.wallpaper-swatch {
  position: relative;
  display: grid;
  place-items: center;
  width: 100%;
  aspect-ratio: 1.5;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--prism-border) 70%, transparent);
  border-radius: 8px;
}
.wallpaper-swatch--flow { background: #e7eef7; }
.wallpaper-swatch--flow svg { width: 100%; height: 100%; fill: none; stroke-width: 15; }
.wallpaper-swatch--flow path:first-child { stroke: #80b1e7; }
.wallpaper-swatch--flow path:last-child { stroke: #c7bddd; }
.wallpaper-swatch--aurora {
  background:
    radial-gradient(ellipse at 12% 10%, #d0f4ed 0%, transparent 48%),
    radial-gradient(ellipse at 82% 30%, #aaa6f0 0%, transparent 52%),
    radial-gradient(ellipse at 25% 100%, #63bfc9 0%, transparent 58%),
    linear-gradient(135deg, #d2e8ef, #809bcc);
}
.wallpaper-swatch--sunset {
  background:
    radial-gradient(ellipse at 85% 5%, #ffe5bd 0%, transparent 52%),
    radial-gradient(ellipse at 30% 65%, #e2b6ca 0%, transparent 55%),
    radial-gradient(ellipse at 85% 100%, #8f9bc9 0%, transparent 52%),
    linear-gradient(140deg, #d3c9e8, #f0c7b0);
}
.wallpaper-swatch--none { background: var(--liquid-canvas); }
.wallpaper-swatch--custom { background: var(--prism-control); }
.wallpaper-swatch--custom img { width: 100%; height: 100%; object-fit: cover; }
.wallpaper-placeholder { color: var(--prism-muted); font-size: var(--prism-font-21); opacity: 0.75; }
.wallpaper-selected-mark {
  position: absolute;
  right: 5px;
  bottom: 5px;
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--vscode-accent);
  color: #fff;
  font-size: 12px;
  box-shadow: 0 1px 4px #132d5533;
}
.wallpaper-choice-label { padding: 0 2px 3px; font-size: var(--prism-font-12); line-height: 1.5; }
.wallpaper-file-row { display: flex; align-items: center; gap: 12px; margin-top: 16px; }
.wallpaper-file-input { display: none; }
.wallpaper-upload { flex-shrink: 0; white-space: nowrap; }
.wallpaper-file-info { display: flex; flex: 1; flex-direction: column; min-width: 0; gap: 3px; }
.wallpaper-file-name { overflow: hidden; color: var(--prism-text); font-size: var(--prism-font-12); text-overflow: ellipsis; white-space: nowrap; }
.wallpaper-file-hint { color: var(--prism-muted); font-size: var(--prism-font-11); line-height: 1.5; }
.wallpaper-adjustments {
  display: grid;
  grid-template-columns: 1.15fr 1fr 1fr;
  align-items: center;
  gap: 18px;
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px solid var(--prism-border);
}
.wallpaper-control { display: flex; flex-direction: column; min-width: 0; gap: 8px; color: var(--prism-muted); font-size: var(--prism-font-12); }
.wallpaper-control-caption { display: flex; justify-content: space-between; gap: 10px; }
.wallpaper-control output { font-variant-numeric: tabular-nums; }
.wallpaper-control input[type='range'] { width: 100%; min-width: 0; margin: 0; accent-color: var(--vscode-accent); cursor: pointer; }
.wallpaper-fit .form-select { min-height: 34px; padding: 5px 9px; font-size: var(--prism-font-12); }
.wallpaper-error,
.wallpaper-message { margin: 12px 0 0; color: var(--prism-danger); font-size: var(--prism-font-12); line-height: 1.6; overflow-wrap: anywhere; }
.wallpaper-message { color: var(--prism-muted); }
.wallpaper-settings :is(button, input, select):focus-visible { outline: 2px solid var(--vscode-accent); outline-offset: 3px; }
.wallpaper-settings :is(button, input, select):disabled { opacity: 0.55; cursor: not-allowed; }
@container (max-width: 430px) {
  .wallpaper-gallery { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .wallpaper-file-row { flex-wrap: wrap; gap: 9px; }
  .wallpaper-file-info { flex-basis: calc(100% - 140px); }
  .wallpaper-remove { margin-left: auto; }
  .wallpaper-adjustments { grid-template-columns: 1fr 1fr; gap: 16px; }
  .wallpaper-fit { grid-column: 1 / -1; }
  .wallpaper-fit .form-select { max-width: 220px; }
}
@media (prefers-reduced-motion: reduce) { .wallpaper-choice { transition: none; } }
</style>
