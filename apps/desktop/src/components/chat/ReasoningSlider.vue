<script setup lang="ts">
import { computed, nextTick, onDeactivated, onMounted, onUnmounted, ref, useId, watch } from 'vue'
import type { CSSProperties } from 'vue'
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
const popover = ref<HTMLElement | null>(null)
const slider = ref<HTMLInputElement | null>(null)
const control = ref<HTMLElement | null>(null)
const controlVisible = ref(false)
const open = ref(false)
const dragging = ref(false)
const dragProgress = ref(0)
const effectFading = ref(false)
const switchDuration = 240
let effectFadeTimer: ReturnType<typeof setTimeout> | undefined
let sliderPointer: { id: number; startX: number; grabOffset: number } | undefined
const popoverStyle = ref<CSSProperties>({})
let positionFrame = 0
let resizeObserver: ResizeObserver | undefined
let visibilityObserver: IntersectionObserver | undefined
const id = `reasoning-${useId()}`
const chinese = computed(() => locale.value.startsWith('zh'))
const labels = computed<Record<ReasoningSelection, string>>(() =>
  chinese.value
    ? {
        default: '默认',
        none: '关闭',
        enabled: '开启',
        minimal: '极低',
        low: '低',
        medium: '中',
        high: '高',
        xhigh: '极高',
        max: '最高'
      }
    : {
        default: 'Default',
        none: 'Off',
        enabled: 'On',
        minimal: 'Minimal',
        low: 'Low',
        medium: 'Medium',
        high: 'High',
        xhigh: 'Extra high',
        max: 'Max'
      }
)
const toggleOnly = computed(() => props.capability.kind === 'toggle')
const title = computed(() =>
  toggleOnly.value
    ? chinese.value
      ? '思考模式'
      : 'Thinking mode'
    : chinese.value
      ? '思考程度'
      : 'Reasoning effort'
)
const pickerTitle = computed(() => (chinese.value ? '模型与推理' : 'Model and reasoning'))
const adjustable = computed(() => props.capability.options.length > 1)
const selected = computed(() => normalizeReasoningSelection(props.capability, props.modelValue))
const index = computed(() => Math.max(0, props.capability.options.indexOf(selected.value)))
const progress = computed(() =>
  dragging.value
    ? dragProgress.value
    : index.value / Math.max(1, props.capability.options.length - 1)
)
const atMaximum = computed(
  () =>
    (toggleOnly.value && selected.value === 'enabled') ||
    (['effort', 'budget'].includes(props.capability.kind) &&
      !['default', 'none', 'enabled'].includes(selected.value) &&
      selected.value === props.capability.options.at(-1))
)
// Embedded previews can report a hidden document while the user is interacting.
// Use the open popover and actual slider intersection to control decorative work.
const sparkling = computed(
  () =>
    (atMaximum.value ||
      effectFading.value ||
      (toggleOnly.value && dragging.value && progress.value > 0)) &&
    open.value &&
    controlVisible.value
)
const currentLabel = computed(() => labels.value[selected.value])
const modelLabel = computed(() => props.modelName || (chinese.value ? '选择模型' : 'Choose model'))
const showHint = computed(
  () =>
    !adjustable.value ||
    (props.capability.kind === 'budget' && ['low', 'medium', 'high'].includes(selected.value))
)
const stars = [
  [7, 36, 2, 0.7],
  [10, 46, 2.5, 0.45],
  [13, 50, 2, 0.65],
  [18, 67, 1.5, 0.5],
  [28, 24, 2, 0.65],
  [32, 70, 2.5, 0.35],
  [40, 43, 1.5, 0.5],
  [44, 64, 3, 0.8],
  [48, 53, 2, 0.65],
  [52, 69, 2, 0.5],
  [56, 44, 2.5, 0.7],
  [58, 68, 3, 0.65],
  [62, 54, 2, 0.6],
  [67, 72, 2.5, 0.4],
  [73, 41, 3, 0.7],
  [79, 62, 2, 0.5],
  [84, 29, 1.5, 0.5],
  [90, 58, 2, 0.7]
]
const hint = computed(() => {
  if (!adjustable.value) {
    if (toggleOnly.value && selected.value === 'enabled')
      return chinese.value ? '此模型始终开启思考。' : 'Thinking is always enabled for this model.'
    if (props.capability.reason === 'unconfigured')
      return chinese.value ? '选择模型后显示可用档位。' : 'Choose a model to see available levels.'
    if (props.capability.reason === 'interface')
      return chinese.value
        ? '当前服务接口不支持调整，使用模型默认设置。'
        : 'This API does not support adjustment. Model defaults apply.'
    if (props.capability.reason === 'unsupported')
      return chinese.value
        ? '此模型不支持调整思考程度。'
        : 'This model does not support reasoning adjustment.'
    return chinese.value
      ? '此模型未提供可用档位，使用默认设置。可刷新模型列表获取能力。'
      : 'No supported levels are available. Model defaults apply; refresh the model list to check capabilities.'
  }
  if (selected.value === 'default')
    return chinese.value ? '遵循模型服务的默认设置。' : 'Use the model service’s default settings.'
  if (props.capability.kind === 'budget' && ['low', 'medium', 'high'].includes(selected.value)) {
    const budget = { low: 1024, medium: 4096, high: 8192 }[
      selected.value as 'low' | 'medium' | 'high'
    ]
    return chinese.value
      ? `思考预算上限 ${budget.toLocaleString()} tokens。`
      : `Thinking budget up to ${budget.toLocaleString()} tokens.`
  }
  if (selected.value === 'none')
    return chinese.value
      ? '关闭可选思考，优先响应速度。'
      : 'Turn off optional thinking for faster responses.'
  if (props.capability.kind === 'toggle')
    return chinese.value ? '开启此模型的思考模式。' : 'Enable this model’s thinking mode.'
  return chinese.value
    ? '更高的档位通常需要更多时间和 token。'
    : 'Higher effort usually takes more time and tokens.'
})

function positionPopover() {
  if (!open.value || !trigger.value || !popover.value) return
  const anchor = trigger.value.getBoundingClientRect()
  if (anchor.bottom <= 0 || anchor.top >= innerHeight || !anchor.width) {
    close()
    return
  }
  const gap = 8
  const margin = 12
  const width = Math.min(384, Math.max(0, innerWidth - margin * 2))
  const left = Math.max(margin, Math.min(anchor.right - width, innerWidth - width - margin))
  const above = Math.max(0, anchor.top - gap - margin)
  const below = Math.max(0, innerHeight - anchor.bottom - gap - margin)
  const preferAbove = above >= Math.min(popover.value.scrollHeight, 440) || above >= below
  const maxHeight = preferAbove ? above : below
  const height = Math.min(popover.value.scrollHeight, maxHeight)
  const top = preferAbove ? Math.max(margin, anchor.top - gap - height) : anchor.bottom + gap
  popoverStyle.value = {
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    maxHeight: `${maxHeight}px`,
    transformOrigin: `${Math.max(0, Math.min(width, anchor.left + anchor.width / 2 - left))}px ${preferAbove ? 'bottom' : 'top'}`
  }
}
function queuePosition() {
  if (!open.value || positionFrame) return
  positionFrame = requestAnimationFrame(() => {
    positionFrame = 0
    positionPopover()
  })
}
async function show() {
  if (props.disabled) return
  open.value = true
  await nextTick()
  if (!open.value) return
  positionPopover()
  const search = popover.value?.querySelector<HTMLInputElement>(
    'input[type="search"]:not(:disabled)'
  )
  const focus =
    search ||
    slider.value ||
    popover.value?.querySelector<HTMLElement>('button:not(:disabled)') ||
    popover.value
  focus?.focus({ preventScroll: true })
}
function toggle() {
  if (open.value) close()
  else void show()
}
function close(restoreFocus = false) {
  open.value = false
  finishSliderPointer()
  clearTimeout(effectFadeTimer)
  effectFading.value = false
  if (restoreFocus) trigger.value?.focus({ preventScroll: true })
}
function fadeEffectsOut() {
  clearTimeout(effectFadeTimer)
  effectFading.value = true
  effectFadeTimer = setTimeout(() => {
    effectFading.value = false
  }, switchDuration)
}
function beginSliderPointer(event: PointerEvent) {
  if (sliderPointer) return
  if (props.disabled || !adjustable.value || event.button !== 0) return
  const thumb = control.value?.querySelector('.oc-reasoning-thumb')?.getBoundingClientRect()
  sliderPointer = {
    id: event.pointerId,
    startX: event.clientX,
    grabOffset:
      thumb && event.clientX >= thumb.left && event.clientX <= thumb.right
        ? event.clientX - (thumb.left + thumb.width / 2)
        : 0
  }
  slider.value?.setPointerCapture(event.pointerId)
}
function moveSliderPointer(event: PointerEvent) {
  if (!sliderPointer || event.pointerId !== sliderPointer.id || !control.value) return
  if (!dragging.value && Math.abs(event.clientX - sliderPointer.startX) < 4) return
  const bounds = control.value.getBoundingClientRect()
  dragProgress.value = Math.max(
    0,
    Math.min(
      1,
      (event.clientX - bounds.left - 20 - sliderPointer.grabOffset) / Math.max(1, bounds.width - 40)
    )
  )
  dragging.value = true
  const value =
    props.capability.options[Math.round(dragProgress.value * (props.capability.options.length - 1))]
  if (value && value !== selected.value) emit('update:modelValue', value)
}
function finishSliderPointer(event?: PointerEvent) {
  if (!sliderPointer || (event && event.pointerId !== sliderPointer.id)) return
  const pointer = sliderPointer
  sliderPointer = undefined
  if (dragging.value) {
    const value =
      props.capability.options[
        Math.round(dragProgress.value * (props.capability.options.length - 1))
      ]
    if (value && !props.disabled) emit('update:modelValue', value)
    if (atMaximum.value || effectFading.value || (toggleOnly.value && dragProgress.value > 0))
      fadeEffectsOut()
    dragging.value = false
  }
  if (slider.value?.hasPointerCapture(pointer.id)) slider.value.releasePointerCapture(pointer.id)
}
function update(event: Event) {
  if (props.disabled || !adjustable.value) return
  const position = dragging.value
    ? Math.round(dragProgress.value * (props.capability.options.length - 1))
    : Number((event.target as HTMLInputElement).value)
  const value = props.capability.options[position]
  if (value) emit('update:modelValue', value)
}
async function reset() {
  if (props.disabled || !adjustable.value || toggleOnly.value) return
  emit('update:modelValue', 'default')
  await nextTick()
  slider.value?.focus({ preventScroll: true })
}
function outside(event: PointerEvent) {
  const target = event.target as Node
  if (!root.value?.contains(target) && !popover.value?.contains(target)) close()
}
function onFocusOut(event: FocusEvent) {
  const target = event.relatedTarget as Node | null
  if (target && !root.value?.contains(target) && !popover.value?.contains(target)) close()
}
function onPopoverKeydown(event: KeyboardEvent) {
  if (event.key !== 'Tab' || !popover.value) return
  const controls = Array.from(
    popover.value.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), [tabindex="0"]'
    )
  ).filter(element => element.getClientRects().length > 0)
  if (
    (event.shiftKey && document.activeElement === controls[0]) ||
    (!event.shiftKey && document.activeElement === controls.at(-1))
  ) {
    // Resume ordinary document tab order at the trigger, rather than trapping a nonmodal dialog.
    close(true)
  }
}
watch(atMaximum, maximum => {
  clearTimeout(effectFadeTimer)
  if (maximum) effectFading.value = false
  else if (open.value) fadeEffectsOut()
})
watch(
  () => props.disabled,
  disabled => {
    if (disabled) close()
  }
)
watch(popover, element => {
  resizeObserver?.disconnect()
  if (!element) return
  resizeObserver ??= new ResizeObserver(queuePosition)
  resizeObserver.observe(element)
})
watch(control, element => {
  visibilityObserver?.disconnect()
  controlVisible.value = false
  if (!element) return
  visibilityObserver ??= new IntersectionObserver(entries => {
    controlVisible.value = entries.some(entry => entry.isIntersecting)
  })
  visibilityObserver.observe(element)
})
onDeactivated(() => close())
onMounted(() => {
  document.addEventListener('pointerdown', outside)
  document.addEventListener('scroll', queuePosition, true)
  window.addEventListener('resize', queuePosition)
})
onUnmounted(() => {
  document.removeEventListener('pointerdown', outside)
  document.removeEventListener('scroll', queuePosition, true)
  window.removeEventListener('resize', queuePosition)
  resizeObserver?.disconnect()
  visibilityObserver?.disconnect()
  clearTimeout(effectFadeTimer)
  cancelAnimationFrame(positionFrame)
})
</script>

<template>
  <div
    ref="root"
    class="oc-reasoning"
    @keydown.esc.stop.prevent="close(true)"
    @focusout="onFocusOut"
  >
    <button
      ref="trigger"
      type="button"
      class="oc-reasoning-trigger"
      :class="{ 'is-default': selected === 'default', 'is-unavailable': !adjustable }"
      :disabled="disabled"
      :aria-expanded="open"
      :aria-controls="id"
      aria-haspopup="dialog"
      :aria-label="`${pickerTitle}：${modelLabel}${adjustable ? `，${currentLabel}` : ''}`"
      :data-prism-tooltip="pickerTitle"
      @click="toggle"
      @keydown.down.prevent="show"
    >
      <span class="oc-reasoning-trigger-model">{{ modelLabel }}</span>
      <span v-if="adjustable" class="oc-reasoning-trigger-effort">{{ currentLabel }}</span>
      <svg
        class="oc-reasoning-chevron"
        width="12"
        height="12"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="m4 6 4 4 4-4"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>
    <Teleport to="body">
      <Transition name="oc-reasoning-float">
        <div
          v-show="open"
          :inert="!open"
          :aria-hidden="!open || undefined"
          ref="popover"
          :id="id"
          :style="popoverStyle"
          class="oc-reasoning-popover"
          role="dialog"
          :aria-label="pickerTitle"
          tabindex="-1"
          @keydown.esc.stop.prevent="close(true)"
          @keydown="onPopoverKeydown"
          @focusout="onFocusOut"
        >
          <slot name="models" />
          <section
            class="oc-reasoning-section"
            :class="{ 'is-maximum': atMaximum, 'is-sparkling': sparkling, 'is-toggle': toggleOnly }"
            :style="{ '--reasoning-switch-duration': `${switchDuration}ms` }"
            :aria-label="title"
          >
            <div class="oc-reasoning-heading">
              <span class="oc-reasoning-section-title">{{ title }}</span>
              <span class="oc-reasoning-current" aria-live="polite">{{ currentLabel }}</span>
            </div>
            <button
              v-if="!toggleOnly"
              class="oc-reasoning-reset"
              type="button"
              :disabled="disabled || !adjustable || selected === 'default'"
              :aria-label="chinese ? '恢复默认推理强度' : 'Reset reasoning effort to default'"
              :data-prism-tooltip="chinese ? '恢复默认' : 'Reset to default'"
              @click="reset"
            >
              <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M4.5 9a8 8 0 1 1-.2 5M4.5 4.5V9H9"
                  stroke="currentColor"
                  stroke-width="1.6"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </button>
            <div
              v-if="adjustable"
              ref="control"
              class="oc-reasoning-control"
              :class="{ 'is-dragging': dragging }"
            >
              <div class="oc-reasoning-track" aria-hidden="true">
                <span
                  class="oc-reasoning-fill"
                  :style="{
                    transform: `scaleX(${progress})`
                  }"
                ></span>
                <div
                  class="oc-reasoning-maximum-effect"
                  :style="toggleOnly && dragging ? { opacity: progress } : undefined"
                >
                  <div class="oc-reasoning-flow"></div>
                  <div class="oc-reasoning-flow oc-reasoning-flow--echo"></div>
                  <span
                    v-for="(star, i) in stars"
                    :key="i"
                    class="oc-reasoning-star"
                    :style="{
                      left: `${star[0]}%`,
                      top: `${star[1]}%`,
                      width: `${star[2]}px`,
                      height: `${star[2]}px`,
                      '--star-brightness': star[3],
                      animationDelay: `${-i * 0.23}s`,
                      animationDuration: `${1.25 + (i % 5) * 0.17}s`
                    }"
                  ></span>
                </div>
              </div>
              <div v-if="!toggleOnly" class="oc-reasoning-ticks" aria-hidden="true">
                <span
                  v-for="(option, stepIndex) in capability.options"
                  :key="option"
                  class="oc-reasoning-tick"
                  :data-level="option"
                  :style="{ left: `${(stepIndex / (capability.options.length - 1)) * 100}%` }"
                ></span>
              </div>
              <div class="oc-reasoning-thumb-rail" aria-hidden="true">
                <div
                  class="oc-reasoning-thumb-position"
                  :style="{ transform: `translateX(${progress * 100}%)` }"
                >
                  <span class="oc-reasoning-thumb"></span>
                </div>
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
                :data-prism-tooltip="hint"
                @input="update"
                @pointerdown="beginSliderPointer"
                @pointermove="moveSliderPointer"
                @pointerup="finishSliderPointer"
                @pointercancel="finishSliderPointer"
                @lostpointercapture="finishSliderPointer"
              />
            </div>
            <p
              :id="`${id}-hint`"
              class="oc-reasoning-description"
              :class="{ 'is-visually-hidden': !showHint }"
            >
              {{ hint }}
            </p>
          </section>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style>
.oc-reasoning {
  display: inline-flex;
  flex: none;
  min-width: 0;
  --reasoning-accent: var(--vscode-focusBorder, #3b82f6);
}
.oc-reasoning-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-width: 0;
  max-width: 180px;
  min-height: 30px;
  padding: 0 11px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: color-mix(in srgb, var(--vscode-fg) 5%, transparent);
  color: var(--vscode-fg-muted);
  font: var(--prism-font-11)/1.4 var(--prism-font);
  white-space: nowrap;
  cursor: pointer;
  transition:
    background-color 120ms,
    color 120ms;
  touch-action: manipulation;
}
.oc-reasoning-trigger-model {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.oc-reasoning-trigger-effort {
  flex: none;
  color: var(--vscode-fg-muted);
}
.oc-reasoning-trigger.is-default,
.oc-reasoning-trigger.is-unavailable {
  color: var(--vscode-fg-muted);
}
.oc-reasoning-trigger:disabled {
  opacity: 0.5;
  cursor: default;
}
.oc-reasoning-chevron {
  flex: none;
}
.oc-reasoning-trigger[aria-expanded='true'] {
  color: var(--vscode-fg);
  background: color-mix(in srgb, var(--vscode-fg) 9%, transparent);
}
.oc-reasoning-popover {
  --reasoning-accent: var(--vscode-focusBorder, #3b82f6);
  position: fixed;
  z-index: 1100;
  overflow-y: auto;
  overscroll-behavior: contain;
  box-sizing: border-box;
  padding: 16px;
  border: 1px solid var(--liquid-rim);
  border-radius: var(--prism-radius-panel);
  background: color-mix(in srgb, var(--prism-surface-raised) 94%, transparent);
  backdrop-filter: blur(24px) saturate(1.3);
  color: var(--vscode-fg);
  box-shadow: var(--prism-shadow);
  font: var(--prism-font-12)/1.5 var(--prism-font);
  transform-origin: bottom right;
}
.oc-reasoning-section {
  --reasoning-state-duration: var(--reasoning-switch-duration);
  --reasoning-state-ease: cubic-bezier(0.22, 1, 0.36, 1);
  position: relative;
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--prism-border);
}
.oc-reasoning-section.is-maximum {
  --reasoning-accent: light-dark(#8b45e6, #b78aff);
}
.oc-reasoning-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 0 40px 14px 0;
  min-width: 0;
}
.is-toggle .oc-reasoning-heading {
  margin-right: 0;
}
.oc-reasoning-section-title {
  color: var(--vscode-fg-muted);
  font-size: var(--prism-font-12);
  font-weight: 500;
}
.oc-reasoning-current {
  color: var(--vscode-fg-muted);
  font-size: var(--prism-font-16);
  font-weight: 650;
  line-height: 26px;
  text-align: center;
  transition: color var(--reasoning-state-duration) var(--reasoning-state-ease);
}
.is-maximum .oc-reasoning-current {
  color: var(--reasoning-accent);
}
.oc-reasoning-reset {
  position: absolute;
  inset-inline-end: 0;
  top: 11px;
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
  transition:
    color 100ms,
    background-color 100ms;
  touch-action: manipulation;
}
.oc-reasoning-reset:disabled {
  opacity: 0.35;
  cursor: default;
}
.oc-reasoning-control {
  position: relative;
  height: 42px;
  isolation: isolate;
}
.oc-reasoning-track {
  position: absolute;
  inset: 3px 1px;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in srgb, var(--vscode-fg) 9%, var(--prism-surface-raised));
  pointer-events: none;
}
.oc-reasoning-fill {
  position: absolute;
  inset: 0;
  background: color-mix(in srgb, var(--vscode-focusBorder, #3b82f6) 28%, transparent);
  transform-origin: left center;
  transition: transform var(--reasoning-state-duration) var(--reasoning-state-ease);
}
.oc-reasoning-ticks {
  position: absolute;
  inset: 0 20px;
  pointer-events: none;
}
.oc-reasoning-tick {
  position: absolute;
  top: 50%;
  width: 2px;
  height: 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--vscode-fg) 48%, transparent);
  transform: translate(-50%, -50%);
  transition: background-color var(--reasoning-state-duration) var(--reasoning-state-ease);
}
.is-maximum .oc-reasoning-tick {
  background: #ffffffe6;
}
.oc-reasoning-thumb-rail {
  position: absolute;
  inset: 0;
  overflow: clip;
  border-radius: 999px;
  pointer-events: none;
}
.oc-reasoning-thumb-position {
  position: absolute;
  inset: 1px 40px 1px 0;
  pointer-events: none;
  transition: transform var(--reasoning-state-duration) var(--reasoning-state-ease);
}
.oc-reasoning-thumb {
  display: block;
  width: 40px;
  height: 40px;
  box-sizing: border-box;
  border: 1px solid #dedee3;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px #0000000d;
}
.oc-reasoning-maximum-effect {
  position: absolute;
  inset: 0;
  opacity: 0;
  background:
    radial-gradient(ellipse at 49% 48%, #d7c1ff80, transparent 53%),
    linear-gradient(100deg, #1e43d7 0%, #5c42ef 35%, #935bff 67%, #744aff 100%);
  transition: opacity var(--reasoning-state-duration) var(--reasoning-state-ease);
}
.is-dragging :is(.oc-reasoning-thumb-position, .oc-reasoning-fill),
.is-toggle .is-dragging .oc-reasoning-maximum-effect {
  transition: none;
}
.is-maximum .oc-reasoning-maximum-effect {
  opacity: 1;
}
.oc-reasoning-flow {
  --flow-opacity: 0.9;
  position: absolute;
  top: -40%;
  left: 0;
  width: 65%;
  height: 180%;
  background:
    linear-gradient(
      110deg,
      transparent 25%,
      #9d7aff00 35%,
      #b9a5ff66 47%,
      #eee5ff70 50%,
      #b9a5ff4d 54%,
      transparent 70%
    ),
    radial-gradient(ellipse at center, #cdbaff38, transparent 65%);
  animation: oc-reasoning-flow 1.5s linear infinite paused;
}
.oc-reasoning-flow--echo {
  --flow-opacity: 0.5;
  animation-delay: -0.75s;
}
.oc-reasoning-star {
  position: absolute;
  display: block;
  border-radius: 50%;
  background: #fff;
  box-shadow:
    0 0 4px #fff,
    0 0 9px #e4d1ffb3;
  animation: oc-reasoning-twinkle 1.6s ease-in-out infinite paused;
}
.oc-reasoning-star:nth-of-type(4n + 2)::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  width: 9px;
  height: 9px;
  background:
    linear-gradient(transparent, #fff, transparent) center / 1px 100% no-repeat,
    linear-gradient(90deg, transparent, #fff, transparent) center / 100% 1px no-repeat;
  transform: translate(-50%, -50%);
}
.is-sparkling :is(.oc-reasoning-star, .oc-reasoning-flow) {
  animation-play-state: running;
}
@keyframes oc-reasoning-flow {
  0% {
    opacity: 0;
    transform: translateX(175%);
  }
  15%,
  75% {
    opacity: var(--flow-opacity);
  }
  100% {
    opacity: 0;
    transform: translateX(-115%);
  }
}
@keyframes oc-reasoning-twinkle {
  0%,
  70%,
  100% {
    opacity: calc(var(--star-brightness) * 0.12);
    transform: scale(0.55);
  }
  30% {
    opacity: min(1, calc(var(--star-brightness) + 0.4));
    transform: scale(1.5);
  }
  48% {
    opacity: calc(var(--star-brightness) * 0.55);
    transform: scale(0.95);
  }
}
input.oc-reasoning-range {
  position: relative;
  display: block;
  appearance: none;
  width: 100%;
  height: 42px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  cursor: pointer;
  touch-action: pan-y;
}
/* Text-input focus/disabled fills must not cover the separate visual track. */
input.oc-reasoning-range:is(:focus, :disabled) {
  background: transparent;
  box-shadow: none;
}
.oc-reasoning-range::-webkit-slider-runnable-track {
  height: 36px;
  border-radius: 999px;
  background: transparent;
}
.oc-reasoning-range::-webkit-slider-thumb {
  opacity: 0;
  appearance: none;
  height: 40px;
  width: 40px;
  margin-top: -2px;
  border: 1px solid #dedee3;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px #0000000d;
}
.oc-reasoning-range::-moz-range-track {
  height: 36px;
  border-radius: 999px;
  background: transparent;
}
.oc-reasoning-range::-moz-range-progress {
  background: transparent;
}
.oc-reasoning-range::-moz-range-thumb {
  opacity: 0;
  height: 38px;
  width: 38px;
  border: 1px solid #dedee3;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px #0000000d;
}
input.oc-reasoning-range:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--reasoning-accent) 50%, transparent);
  outline-offset: 4px;
  border-radius: 999px;
}
.oc-reasoning-trigger:focus-visible,
.oc-reasoning-reset:focus-visible {
  outline: 2px solid var(--reasoning-accent);
  outline-offset: 2px;
}
.oc-reasoning-description {
  margin: 9px 2px 0;
  color: var(--vscode-fg-muted);
  font-size: var(--prism-font-11);
  line-height: 1.6;
  text-align: center;
}
.oc-reasoning-description.is-visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.oc-reasoning-float-enter-active {
  transition:
    opacity 180ms cubic-bezier(0.22, 1, 0.36, 1),
    transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.oc-reasoning-float-leave-active {
  transition:
    opacity 120ms ease-out,
    transform 120ms ease-out;
  pointer-events: none;
}
.oc-reasoning-float-enter-from,
.oc-reasoning-float-leave-to {
  opacity: 0;
  transform: translateY(5px) scale(0.97);
}
@media (hover: hover) and (pointer: fine) {
  .oc-reasoning-trigger:hover:not(:disabled) {
    color: var(--vscode-fg);
    background: color-mix(in srgb, var(--vscode-fg) 9%, transparent);
  }
  .oc-reasoning-reset:hover:not(:disabled) {
    color: var(--vscode-fg);
    background: color-mix(in srgb, var(--vscode-fg) 6%, transparent);
  }
}
@media (prefers-reduced-motion: reduce) {
  .oc-reasoning-star,
  .oc-reasoning-flow {
    animation-play-state: paused !important;
  }
  .oc-reasoning-maximum-effect,
  .oc-reasoning-current,
  .oc-reasoning-tick,
  .oc-reasoning-thumb-position,
  .oc-reasoning-fill {
    transition: none;
  }
  .oc-reasoning-float-enter-active,
  .oc-reasoning-float-leave-active {
    transition: opacity 80ms ease-out;
  }
  .oc-reasoning-float-enter-from,
  .oc-reasoning-float-leave-to {
    transform: none;
  }
}
html[data-motion='off'] .oc-reasoning-popover,
html[data-transitions='off'] .oc-reasoning-popover {
  transition: none !important;
  transform: none !important;
}
html:is([data-motion='off'], [data-transitions='off']) :is(.oc-reasoning-star, .oc-reasoning-flow) {
  animation-play-state: paused !important;
}
html:is([data-motion='off'], [data-transitions='off'])
  :is(
    .oc-reasoning-maximum-effect,
    .oc-reasoning-current,
    .oc-reasoning-tick,
    .oc-reasoning-thumb-position,
    .oc-reasoning-fill
  ) {
  transition: none !important;
}
</style>
