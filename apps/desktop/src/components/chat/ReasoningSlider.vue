<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ReasoningCapability, ReasoningSelection } from '@/utils/model-reasoning'
import { normalizeReasoningSelection } from '@/utils/model-reasoning'

const props = defineProps<{
  capability: ReasoningCapability
  modelValue: ReasoningSelection
  modelName?: string
  disabled?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: ReasoningSelection] }>()
const { locale } = useI18n()
const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const slider = ref<HTMLInputElement | null>(null)
const open = ref(false)
const id = `reasoning-${useId()}`
const chinese = computed(() => locale.value.startsWith('zh'))
const labels = computed<Record<ReasoningSelection, string>>(() => chinese.value ? {
  default: '默认', none: '关闭', enabled: '开启', minimal: '极低', low: '低', medium: '中', high: '高', xhigh: '极高', max: '最高'
} : {
  default: 'Default', none: 'Off', enabled: 'On', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max'
})
const title = computed(() => chinese.value ? '思考程度' : 'Reasoning effort')
const adjustable = computed(() => props.capability.options.length > 1)
const selected = computed(() => normalizeReasoningSelection(props.capability, props.modelValue))
const index = computed(() => Math.max(0, props.capability.options.indexOf(selected.value)))
const currentLabel = computed(() => labels.value[selected.value])
const modelLabel = computed(() => props.modelName || (chinese.value ? '当前模型' : 'Current model'))
const showHint = computed(() => !adjustable.value || (props.capability.kind === 'budget' && ['low', 'medium', 'high'].includes(selected.value)))
const stars = [
  [7, 36, 2, .7], [10, 46, 2.5, .45], [13, 50, 2, .65], [18, 67, 1.5, .5],
  [28, 24, 2, .65], [32, 70, 2.5, .35], [40, 43, 1.5, .5], [44, 64, 3, .8],
  [48, 53, 2, .65], [52, 69, 2, .5], [56, 44, 2.5, .7], [58, 68, 3, .65],
  [62, 54, 2, .6], [67, 72, 2.5, .4], [73, 41, 3, .7], [79, 62, 2, .5],
  [84, 29, 1.5, .5], [90, 58, 2, .7]
]
const hint = computed(() => {
  if (!adjustable.value) {
    if (props.capability.reason === 'unconfigured') return chinese.value ? '选择模型后显示可用档位。' : 'Choose a model to see available levels.'
    if (props.capability.reason === 'interface') return chinese.value ? '当前服务接口不支持调整，使用模型默认设置。' : 'This API does not support adjustment. Model defaults apply.'
    if (props.capability.reason === 'unsupported') return chinese.value ? '此模型不支持调整思考程度。' : 'This model does not support reasoning adjustment.'
    return chinese.value ? '此模型未提供可用档位，使用默认设置。可刷新模型列表获取能力。' : 'No supported levels are available. Model defaults apply; refresh the model list to check capabilities.'
  }
  if (selected.value === 'default') return chinese.value ? '遵循模型服务的默认设置。' : 'Use the model service’s default settings.'
  if (props.capability.kind === 'budget' && ['low', 'medium', 'high'].includes(selected.value)) {
    const budget = { low: 1024, medium: 4096, high: 8192 }[selected.value as 'low' | 'medium' | 'high']
    return chinese.value ? `思考预算上限 ${budget.toLocaleString()} tokens。` : `Thinking budget up to ${budget.toLocaleString()} tokens.`
  }
  if (selected.value === 'none') return chinese.value ? '关闭可选思考，优先响应速度。' : 'Turn off optional thinking for faster responses.'
  if (props.capability.kind === 'toggle') return chinese.value ? '开启此模型的思考模式。' : 'Enable this model’s thinking mode.'
  return chinese.value ? '更高的档位通常需要更多时间和 token。' : 'Higher effort usually takes more time and tokens.'
})

async function toggle() {
  if (props.disabled) return
  open.value = !open.value
  if (open.value && adjustable.value) {
    await nextTick()
    slider.value?.focus({ preventScroll: true })
  }
}
function close(restoreFocus = false) {
  open.value = false
  if (restoreFocus) trigger.value?.focus({ preventScroll: true })
}
function update(event: Event) {
  if (props.disabled || !adjustable.value) return
  const value = props.capability.options[Number((event.target as HTMLInputElement).value)]
  if (value) emit('update:modelValue', value)
}
async function reset() {
  if (props.disabled || !adjustable.value) return
  emit('update:modelValue', 'default')
  await nextTick()
  slider.value?.focus({ preventScroll: true })
}
function outside(event: PointerEvent) {
  if (!root.value?.contains(event.target as Node)) close()
}
watch(() => [props.capability, props.disabled], () => close())
onMounted(() => document.addEventListener('pointerdown', outside))
onUnmounted(() => document.removeEventListener('pointerdown', outside))
</script>

<template>
  <div ref="root" class="oc-reasoning" @keydown.esc.stop.prevent="close(true)">
    <button
      ref="trigger"
      type="button"
      class="oc-reasoning-trigger"
      :class="{ 'is-default': selected === 'default', 'is-unavailable': !adjustable }"
      :disabled="disabled"
      :aria-expanded="open"
      :aria-controls="id"
      :aria-label="`${title}：${currentLabel}`"
      :title="adjustable ? title : hint"
      @click="toggle"
    >
      <span>{{ chinese ? '选择推理强度' : 'Reasoning effort' }}</span>
      <svg class="oc-reasoning-chevron" width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
    </button>
    <Transition name="oc-reasoning-float">
    <div v-if="open" :id="id" class="oc-reasoning-popover" role="group" :aria-label="title">
      <div class="oc-reasoning-heading">
        <span class="oc-reasoning-current" aria-live="polite">{{ currentLabel }}</span>
        <span class="oc-reasoning-model" :title="modelLabel">{{ modelLabel }}</span>
      </div>
      <button
        class="oc-reasoning-reset"
        type="button"
        :disabled="disabled || !adjustable || selected === 'default'"
        :aria-label="chinese ? '恢复默认推理强度' : 'Reset reasoning effort to default'"
        :title="chinese ? '恢复默认' : 'Reset to default'"
        @click="reset"
      >
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4.5 9a8 8 0 1 1-.2 5M4.5 4.5V9H9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </button>
      <div v-if="adjustable" class="oc-reasoning-control">
        <div class="oc-reasoning-track" aria-hidden="true">
          <span v-for="(star, i) in stars" :key="i" class="oc-reasoning-star" :style="{ left: `${star[0]}%`, top: `${star[1]}%`, width: `${star[2]}px`, height: `${star[2]}px`, opacity: star[3] }"></span>
        </div>
        <input
          ref="slider"
          class="oc-reasoning-range"
          type="range"
          min="0"
          :max="Math.max(1, capability.options.length - 1)"
          step="1"
          :value="index"
          :disabled="disabled || !adjustable"
          :aria-label="title"
          :aria-valuetext="currentLabel"
          :aria-describedby="`${id}-hint`"
          :title="hint"
          @input="update"
        >
      </div>
      <p :id="`${id}-hint`" class="oc-reasoning-description" :class="{ 'is-visually-hidden': !showHint }">{{ hint }}</p>
    </div>
    </Transition>
  </div>
</template>

<style>
.oc-chat .oc-reasoning {
  display: inline-flex;
  flex: none;
  --reasoning-accent: light-dark(#8b45e6, #b78aff);
}
.oc-chat .oc-reasoning-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 30px;
  padding: 0 11px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: color-mix(in srgb, var(--vscode-fg) 5%, transparent);
  color: var(--vscode-fg-muted);
  font: 11px/1.4 var(--font-family-sans);
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 120ms, color 120ms;
  touch-action: manipulation;
}
.oc-chat .oc-reasoning-trigger.is-default,
.oc-chat .oc-reasoning-trigger.is-unavailable {
  color: var(--vscode-fg-muted);
}
.oc-chat .oc-reasoning-trigger:disabled {
  opacity: 0.5;
  cursor: default;
}
.oc-chat .oc-reasoning-chevron {
  flex: none;
}
.oc-chat .oc-reasoning-trigger[aria-expanded='true'] {
  color: var(--vscode-fg);
  background: color-mix(in srgb, var(--vscode-fg) 9%, transparent);
}
.oc-chat .oc-reasoning-popover {
  position: absolute;
  z-index: 10;
  bottom: calc(100% + 10px);
  inset-inline-end: 0;
  width: min(384px, 100%);
  box-sizing: border-box;
  padding: 17px 18px 16px;
  border: 1px solid var(--chat-border);
  border-radius: 22px;
  background: color-mix(in srgb, var(--background-base) 96%, transparent);
  backdrop-filter: blur(18px);
  color: var(--vscode-fg);
  box-shadow: 0 10px 24px #0000000d, 0 2px 5px #00000003;
  font-size: 12px;
  transform-origin: bottom right;
}
.oc-chat .oc-reasoning-heading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  margin: 0 32px 16px;
  min-width: 0;
}
.oc-chat .oc-reasoning-current {
  color: var(--reasoning-accent);
  font-size: 19px;
  font-weight: 650;
  line-height: 26px;
  text-align: center;
}
.oc-chat .oc-reasoning-model {
  display: block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--vscode-fg-muted);
  font-size: 13px;
  line-height: 21px;
}
.oc-chat .oc-reasoning-reset {
  position: absolute;
  inset-inline-end: 12px;
  top: 12px;
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--vscode-fg-muted);
  cursor: pointer;
  transition: color 100ms, background-color 100ms;
  touch-action: manipulation;
}
.oc-chat .oc-reasoning-reset:disabled {
  opacity: .35;
  cursor: default;
}
.oc-chat .oc-reasoning-control {
  position: relative;
  height: 42px;
  isolation: isolate;
}
.oc-chat .oc-reasoning-track {
  position: absolute;
  inset: 3px 1px;
  overflow: hidden;
  border-radius: 999px;
  background:
    radial-gradient(ellipse at 49% 48%, #d7c1ff80, transparent 53%),
    linear-gradient(100deg, #1e43d7 0%, #5c42ef 35%, #935bff 67%, #744aff 100%);
  pointer-events: none;
}
.oc-chat .oc-reasoning-star {
  position: absolute;
  display: block;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 0 4px #ffffff70;
}
.oc-chat .oc-reasoning-range {
  position: relative;
  display: block;
  appearance: none;
  width: 100%;
  height: 42px;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  touch-action: pan-y;
}
.oc-chat .oc-reasoning-range::-webkit-slider-runnable-track {
  height: 36px;
  border-radius: 999px;
  background: transparent;
}
.oc-chat .oc-reasoning-range::-webkit-slider-thumb {
  appearance: none;
  height: 40px;
  width: 40px;
  margin-top: -2px;
  border: 1px solid #dedee3;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px #0000000d;
}
.oc-chat .oc-reasoning-range::-moz-range-track {
  height: 36px;
  border-radius: 999px;
  background: transparent;
}
.oc-chat .oc-reasoning-range::-moz-range-progress {
  background: transparent;
}
.oc-chat .oc-reasoning-range::-moz-range-thumb {
  height: 38px;
  width: 38px;
  border: 1px solid #dedee3;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px #0000000d;
}
.oc-chat .oc-reasoning-range:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--reasoning-accent) 50%, transparent);
  outline-offset: 4px;
  border-radius: 999px;
}
.oc-chat .oc-reasoning-trigger:focus-visible,
.oc-chat .oc-reasoning-reset:focus-visible {
  outline: 2px solid var(--reasoning-accent);
  outline-offset: 2px;
}
.oc-chat .oc-reasoning-description {
  margin: 9px 2px 0;
  color: var(--vscode-fg-muted);
  font-size: 11px;
  line-height: 1.6;
  text-align: center;
}
.oc-chat .oc-reasoning-description.is-visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.oc-chat .oc-reasoning-float-leave-active {
  transition: opacity 100ms ease-out, transform 100ms ease-out;
  pointer-events: none;
}
.oc-chat .oc-reasoning-float-leave-to {
  opacity: 0;
  transform: translateY(2px) scale(.99);
}
@media (hover: hover) and (pointer: fine) {
  .oc-chat .oc-reasoning-trigger:hover:not(:disabled) {
    color: var(--vscode-fg);
    background: color-mix(in srgb, var(--vscode-fg) 9%, transparent);
  }
  .oc-chat .oc-reasoning-reset:hover:not(:disabled) {
    color: var(--vscode-fg);
    background: color-mix(in srgb, var(--vscode-fg) 6%, transparent);
  }
}
@media (prefers-reduced-motion: reduce) {
  .oc-chat .oc-reasoning-float-leave-active {
    transition: opacity 80ms ease-out;
  }
  .oc-chat .oc-reasoning-float-leave-to {
    transform: none;
  }
}
</style>
