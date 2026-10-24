<template>
  <div class="model-parameters" data-testid="model-parameters">
    <header class="parameters-header">
      <span class="protocol-label"
        ><i class="bi bi-diagram-2" aria-hidden="true"></i>{{ capabilities.protocolLabel }}</span
      >
      <button
        type="button"
        class="reset-parameters"
        :disabled="disabled || !hasOverrides"
        data-testid="reset-model-parameters"
        @click="resetParameters"
      >
        <i class="bi bi-arrow-counterclockwise" aria-hidden="true"></i>{{ copy.reset }}
      </button>
    </header>
    <p v-if="model.description" class="model-description">{{ model.description }}</p>
    <div v-if="capabilities.reasoning.options.length > 1" class="reasoning-setting">
      <div class="parameter-label">
        <label :for="`${id}-reasoning`">{{ copy.reasoning }}</label
        ><output :for="`${id}-reasoning`" class="reasoning-value" aria-hidden="true">
          <Transition name="reasoning-value">
            <span :key="reasoningSelection">{{ reasoningLabel(reasoningSelection) }}</span>
          </Transition>
        </output>
      </div>
      <input
        :id="`${id}-reasoning`"
        ref="reasoningInput"
        class="reasoning-range"
        type="range"
        min="0"
        :max="capabilities.reasoning.options.length - 1"
        step="1"
        :value="reasoningIndex"
        :disabled="disabled"
        :aria-valuetext="reasoningLabel(reasoningSelection)"
        data-testid="model-reasoning"
        @input="changeReasoning"
      />
      <div class="reasoning-scale" aria-hidden="true">
        <span>{{ copy.default }}</span
        ><span>{{ reasoningLabel(capabilities.reasoning.options.at(-1) || 'default') }}</span>
      </div>
      <p class="parameter-hint">
        {{
          capabilities.reasoning.kind === 'budget'
            ? copy.budgetHint
            : capabilities.reasoning.kind === 'toggle'
              ? copy.toggleHint
              : copy.reasoningHint
        }}
      </p>
    </div>
    <p v-else class="reasoning-unavailable">
      <i class="bi bi-info-circle" aria-hidden="true"></i
      >{{ capabilities.reasoning.reason === 'unknown' ? copy.unknownReasoning : copy.noReasoning }}
    </p>
    <div class="parameter-fields">
      <label class="number-parameter" :for="`${id}-tokens`"
        ><span>{{ copy.maxTokens }}</span
        ><input
          :id="`${id}-tokens`"
          ref="maxTokensInput"
          type="number"
          min="1"
          :max="capabilities.maxOutputTokens"
          step="1"
          :value="model.requestConfig?.maxTokens ?? ''"
          :disabled="disabled"
          :placeholder="copy.default"
          data-testid="model-max-tokens"
          :aria-invalid="!!fieldErrors[`${id}-tokens`]"
          :aria-describedby="fieldErrors[`${id}-tokens`] ? `${id}-tokens-error` : undefined"
          @input="revalidateInput"
          @invalid.prevent
          @change="changeNumber('maxTokens', $event)"
        /><small>{{
          capabilities.maxOutputTokens
            ? `${copy.limit} ${capabilities.maxOutputTokens.toLocaleString()}`
            : copy.unknownLimit
        }}</small
        ><span
          v-if="fieldErrors[`${id}-tokens`]"
          :id="`${id}-tokens-error`"
          class="prism-field-error"
          role="alert"
          >{{ fieldErrors[`${id}-tokens`] }}</span
        ></label
      >
      <Transition
        name="parameter-field"
        @before-enter="restoreFieldInteraction"
        @before-leave="prepareFieldLeave"
      >
        <label
          v-if="capabilities.supportsTemperature"
          class="number-parameter"
          :for="`${id}-temperature`"
          ><span>{{ copy.temperature }}</span
          ><input
            :id="`${id}-temperature`"
            type="number"
            :min="capabilities.temperatureRange[0]"
            :max="capabilities.temperatureRange[1]"
            step="0.1"
            :value="model.requestConfig?.temperature ?? ''"
            :disabled="disabled"
            :placeholder="copy.default"
            data-testid="model-temperature"
            :aria-invalid="!!fieldErrors[`${id}-temperature`]"
            :aria-describedby="
              fieldErrors[`${id}-temperature`] ? `${id}-temperature-error` : undefined
            "
            @input="revalidateInput"
            @invalid.prevent
            @change="changeNumber('temperature', $event)"
          /><small
            >{{ capabilities.temperatureRange[0] }}–{{ capabilities.temperatureRange[1] }} ·
            {{ copy.temperatureHint }}</small
          ><span
            v-if="fieldErrors[`${id}-temperature`]"
            :id="`${id}-temperature-error`"
            class="prism-field-error"
            role="alert"
            >{{ fieldErrors[`${id}-temperature`] }}</span
          ></label
        >
      </Transition>
      <Transition
        name="parameter-field"
        @before-enter="restoreFieldInteraction"
        @before-leave="prepareFieldLeave"
      >
        <label v-if="capabilities.supportsTopP" class="number-parameter" :for="`${id}-top-p`"
          ><span>Top P</span
          ><input
            :id="`${id}-top-p`"
            type="number"
            min="0.01"
            max="1"
            step="0.01"
            :value="model.requestConfig?.topP ?? ''"
            :disabled="disabled"
            :placeholder="copy.default"
            data-testid="model-top-p"
            :aria-invalid="!!fieldErrors[`${id}-top-p`]"
            :aria-describedby="fieldErrors[`${id}-top-p`] ? `${id}-top-p-error` : undefined"
            @input="revalidateInput"
            @invalid.prevent
            @change="changeNumber('topP', $event)"
          /><small>{{ copy.topPHint }}</small
          ><span
            v-if="fieldErrors[`${id}-top-p`]"
            :id="`${id}-top-p-error`"
            class="prism-field-error"
            role="alert"
            >{{ fieldErrors[`${id}-top-p`] }}</span
          ></label
        >
      </Transition>
    </div>
    <p
      v-if="!capabilities.supportsTemperature || !capabilities.supportsTopP"
      class="parameter-hint sampling-hint"
    >
      <i class="bi bi-info-circle" aria-hidden="true"></i>{{ copy.samplingUnavailable }}
    </p>
    <p class="parameters-footnote">{{ copy.defaultHint }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AIModel, AIProvider, ModelRequestConfig } from '@/types/ai-providers'
import { getModelCapabilities } from '@/utils/model-capabilities'
import { normalizeReasoningSelection, type ReasoningSelection } from '@/utils/model-reasoning'
import { useInlineValidation } from '@/composables/useInlineValidation'

const props = defineProps<{
  id: string
  provider: AIProvider
  model: AIModel
  disabled?: boolean
}>()
const emit = defineEmits<{ change: [config: ModelRequestConfig | undefined] }>()
const reasoningInput = ref<HTMLInputElement>()
const maxTokensInput = ref<HTMLInputElement>()
const { errors: fieldErrors, validateField, revalidateInput, clearErrors } = useInlineValidation()
watch(() => [props.id, props.model.id, props.disabled], clearErrors)
function resetParameters() {
  clearErrors()
  emit('change', undefined)
}
const { locale } = useI18n()
const chinese = computed(() => locale.value.startsWith('zh'))
const copy = computed(() =>
  chinese.value
    ? {
        reset: '恢复默认',
        reasoning: '思考程度',
        default: '默认',
        budgetHint: '各档位对应此模型支持的思考预算。',
        toggleHint: '此模型支持切换思考模式，不提供强度档位。',
        reasoningHint: '只显示此模型支持的档位，默认由服务商决定。',
        unknownReasoning: '尚无此模型的思考能力资料，保留服务默认。',
        noReasoning: '此模型或接口不提供可调节的思考程度。',
        maxTokens: '最大输出 token',
        limit: '上限',
        unknownLimit: '上限由模型服务决定',
        temperature: '温度',
        temperatureHint: '越高越多样',
        topPHint: '0.01–1 · 概率采样范围',
        samplingUnavailable: '当前模型或思考模式不接受的采样参数已隐藏。',
        defaultHint: '留空使用默认值。终端中的思考滑块可以临时覆盖这里的思考设置。'
      }
    : {
        reset: 'Reset defaults',
        reasoning: 'Reasoning effort',
        default: 'Default',
        budgetHint: 'Each level maps to a thinking budget supported by this model.',
        toggleHint: 'This model supports a thinking toggle rather than effort levels.',
        reasoningHint: 'Only supported levels are shown. Default delegates to the service.',
        unknownReasoning:
          'Reasoning capabilities are not verified; the service default is preserved.',
        noReasoning: 'This model or API does not expose adjustable reasoning.',
        maxTokens: 'Maximum output tokens',
        limit: 'Limit',
        unknownLimit: 'Limit determined by the model service',
        temperature: 'Temperature',
        temperatureHint: 'Higher is more varied',
        topPHint: '0.01–1 · Probability sampling range',
        samplingUnavailable:
          'Sampling parameters unsupported by this model or reasoning mode are hidden.',
        defaultHint:
          'Leave blank for defaults. The terminal reasoning slider can temporarily override this reasoning setting.'
      }
)
const capabilities = computed(() => getModelCapabilities(props.provider, props.model))
const reasoningSelection = computed(() =>
  normalizeReasoningSelection(capabilities.value.reasoning, props.model.requestConfig?.reasoning)
)
const reasoningIndex = computed(() =>
  Math.max(0, capabilities.value.reasoning.options.indexOf(reasoningSelection.value))
)
const hasOverrides = computed(() =>
  Object.values(props.model.requestConfig || {}).some(
    value => value !== undefined && value !== 'default'
  )
)
function reasoningLabel(value: ReasoningSelection) {
  const labels: Record<ReasoningSelection, [string, string]> = {
    default: ['默认', 'Default'],
    none: ['关闭', 'Off'],
    enabled: ['开启', 'On'],
    minimal: ['极低', 'Minimal'],
    low: ['低', 'Low'],
    medium: ['中', 'Medium'],
    high: ['高', 'High'],
    xhigh: ['极高', 'Extra high'],
    max: ['最高', 'Maximum']
  }
  return labels[value][chinese.value ? 0 : 1]
}
function changeReasoning(event: Event) {
  const value =
    capabilities.value.reasoning.options[Number((event.target as HTMLInputElement).value)] ||
    'default'
  const next = { ...props.model.requestConfig }
  if (value === 'default') delete next.reasoning
  else next.reasoning = value
  emit('change', Object.keys(next).length ? next : undefined)
}
function changeNumber(key: 'maxTokens' | 'temperature' | 'topP', event: Event) {
  const input = event.target as HTMLInputElement
  if (props.disabled || !validateField(input)) return
  const next = { ...props.model.requestConfig }
  if (!input.value.trim()) delete next[key]
  else if (Number.isFinite(input.valueAsNumber))
    next[key] = key === 'maxTokens' ? Math.floor(input.valueAsNumber) : input.valueAsNumber
  else {
    return
  }
  emit('change', Object.keys(next).length ? next : undefined)
}
function prepareFieldLeave(element: Element) {
  const field = element as HTMLElement
  // Unsupported inputs stop accepting focus as soon as their exit starts.
  if (field.contains(document.activeElement)) {
    const target = [reasoningInput.value, maxTokensInput.value].find(
      input => input && !input.disabled
    )
    target?.focus({ preventScroll: true })
  }
  field.inert = true
}
function restoreFieldInteraction(element: Element) {
  const field = element as HTMLElement
  field.inert = false
}
</script>

<style scoped>
.model-parameters {
  --parameter-motion-duration: 140ms;
  --parameter-exit-duration: 100ms;
  --parameter-motion-ease: cubic-bezier(0.22, 1, 0.36, 1);
  --parameter-label-shift: 3px;
  --parameter-hover-scale: 1.06;
  --parameter-press-scale: 0.96;
  --parameter-reset-turn: -28deg;
  padding: 14px;
  margin-top: 12px;
  border: 1px solid var(--vscode-border);
  border-radius: 13px;
  background: color-mix(in srgb, var(--liquid-selected) 65%, transparent);
  box-shadow: inset 0 1px 0 var(--liquid-inner-edge);
}
.parameters-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.protocol-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
  color: var(--vscode-fg-muted);
}
.reset-parameters {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 0;
  background: transparent;
  color: var(--vscode-accent);
  font: inherit;
  font-size: 10px;
  padding: 2px;
  cursor: pointer;
  border-radius: var(--prism-radius-small);
  touch-action: manipulation;
  transition:
    background-color var(--parameter-motion-duration) ease,
    opacity var(--parameter-motion-duration) ease;
}
.reset-parameters > i {
  display: inline-block;
  transition: transform var(--parameter-motion-duration) var(--parameter-motion-ease);
}
.reset-parameters:not(:disabled):active > i {
  transform: rotate(var(--parameter-reset-turn));
  transition-duration: 0ms;
}
.reset-parameters:focus-visible {
  background-color: var(--liquid-selected);
}
.reset-parameters:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.model-description {
  margin: 10px 0 0;
  color: var(--vscode-fg-muted);
  font-size: 11px;
  line-height: 1.7;
}
.reasoning-setting {
  margin-top: 17px;
}
.parameter-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 11px;
  color: var(--vscode-fg);
}
.parameter-label output {
  color: var(--vscode-accent);
  font-weight: 550;
}
.reasoning-value {
  display: inline-grid;
  justify-items: end;
  min-width: 5em;
}
.reasoning-value > span {
  grid-area: 1 / 1;
}
.reasoning-value-enter-active,
.reasoning-value-leave-active {
  transition:
    opacity var(--parameter-motion-duration) var(--parameter-motion-ease),
    transform var(--parameter-motion-duration) var(--parameter-motion-ease);
}
.reasoning-value-leave-active {
  transition-duration: var(--parameter-exit-duration);
}
.reasoning-value-enter-from {
  opacity: 0;
  transform: translateY(var(--parameter-label-shift));
}
.reasoning-value-leave-to {
  opacity: 0;
  transform: translateY(calc(-1 * var(--parameter-label-shift)));
}
.reasoning-range {
  display: block;
  appearance: none;
  width: 100%;
  height: 14px;
  margin: 15px 0 10px;
  border-radius: 20px;
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--vscode-accent) 65%, var(--prism-muted)),
    var(--vscode-accent)
  );
  box-shadow:
    inset 0 1px 3px color-mix(in srgb, var(--liquid-shadow) 35%, transparent),
    0 1px 0 var(--liquid-inner-light);
  cursor: pointer;
}
.reasoning-range::-webkit-slider-thumb {
  appearance: none;
  width: 24px;
  height: 24px;
  border: 1px solid #fff;
  border-radius: 50%;
  background: linear-gradient(#fff, #f5f8ff);
  box-shadow: 0 2px 7px color-mix(in srgb, var(--liquid-shadow) 45%, transparent);
  transition: transform var(--parameter-motion-duration) var(--parameter-motion-ease);
}
.reasoning-range:not(:disabled):active::-webkit-slider-thumb {
  transform: scale(var(--parameter-press-scale));
  transition-duration: 0ms;
}
.reasoning-range:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.reasoning-scale {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 9px;
  color: var(--vscode-fg-muted);
}
.parameter-hint,
.reasoning-unavailable,
.parameters-footnote {
  color: var(--vscode-fg-muted);
  font-size: 10px;
  line-height: 1.7;
}
.parameter-hint {
  margin: 9px 0 0;
}
.reasoning-unavailable {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 13px 0 0;
}
.parameter-fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 14px 12px;
  margin-top: 17px;
}
.number-parameter {
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-width: 0;
  font-size: 11px;
}
.number-parameter > span {
  color: var(--vscode-fg);
}
.number-parameter input {
  min-width: 0;
  width: 100%;
  padding: 8px 10px;
  box-sizing: border-box;
  border: 1px solid var(--vscode-border);
  border-radius: 8px;
  background: var(--vscode-bg-input);
  color: var(--vscode-fg);
  font: inherit;
  font-size: 11px;
  transition: border-color var(--parameter-motion-duration) ease;
}
.number-parameter input:focus-visible {
  border-color: var(--vscode-accent);
  transition-duration: 0ms;
}
.number-parameter input[aria-invalid='true'] {
  border-color: var(--prism-danger);
}
.number-parameter > .prism-field-error {
  color: var(--prism-danger);
}
.parameter-field-enter-active {
  transition: opacity var(--parameter-motion-duration) var(--parameter-motion-ease);
}
.parameter-field-leave-active {
  pointer-events: none;
  transition: opacity var(--parameter-exit-duration) ease;
}
.parameter-field-enter-from,
.parameter-field-leave-to {
  opacity: 0;
}
.number-parameter input::placeholder {
  color: var(--vscode-fg-muted);
}
.number-parameter input:disabled {
  opacity: 0.45;
}
.number-parameter small {
  color: var(--vscode-fg-muted);
  font-size: 9px;
  line-height: 1.6;
}
.sampling-hint {
  display: flex;
  gap: 5px;
}
.parameters-footnote {
  margin: 14px 0 0;
  padding-top: 10px;
  border-top: 1px solid var(--vscode-border-subtle);
  font-size: 9px;
}
button:focus-visible,
input:focus-visible {
  outline: 2px solid var(--vscode-accent);
  outline-offset: 3px;
}
@media (hover: hover) and (pointer: fine) {
  .reset-parameters:not(:disabled):hover {
    background-color: var(--liquid-selected);
    transition-duration: 0ms;
  }
  .reasoning-range:not(:disabled):hover:not(:active)::-webkit-slider-thumb {
    transform: scale(var(--parameter-hover-scale));
  }
  .number-parameter input:not(:disabled):hover {
    border-color: color-mix(in srgb, var(--vscode-accent) 50%, var(--vscode-border));
  }
}
@media (prefers-reduced-motion: reduce) {
  .model-parameters {
    --parameter-motion-duration: 80ms;
    --parameter-exit-duration: 80ms;
    --parameter-label-shift: 0px;
    --parameter-hover-scale: 1;
    --parameter-press-scale: 1;
    --parameter-reset-turn: 0deg;
  }
}
html[data-motion='off'] .model-parameters,
html[data-transitions='off'] .model-parameters {
  --parameter-motion-duration: 0ms;
  --parameter-exit-duration: 0ms;
  --parameter-label-shift: 0px;
  --parameter-hover-scale: 1;
  --parameter-press-scale: 1;
  --parameter-reset-turn: 0deg;
}
</style>
