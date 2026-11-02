<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type {
  AIModel,
  AIProvider,
  ModelReasoningConfig,
  ReasoningEffort
} from '@/types/ai-providers'
import { getModelAPIStyle } from '@/utils/model-capabilities'

const props = defineProps<{
  id: string
  provider: AIProvider
  model: AIModel
  disabled?: boolean
}>()
const emit = defineEmits<{ change: [value: ModelReasoningConfig | false | undefined] }>()
const { locale } = useI18n()
const chinese = computed(() => locale.value.startsWith('zh'))
const mode = ref<'auto' | 'disabled' | 'manual'>('auto')
const protocol = ref<ModelReasoningConfig['protocol']>('openai')
const efforts = ref<ReasoningEffort[]>([])
const supportsToggle = ref(false)
const mandatory = ref(false)
const thinkingMode = ref<NonNullable<ModelReasoningConfig['thinkingMode']>>('adaptive')
const apiStyle = computed(() => getModelAPIStyle(props.provider, props.model))
const protocols = computed<ModelReasoningConfig['protocol'][]>(() =>
  apiStyle.value === 'anthropic'
    ? ['anthropic']
    : apiStyle.value === 'ollama'
      ? ['ollama']
      : apiStyle.value === 'gemini'
        ? ['gemini']
        : apiStyle.value === 'responses'
          ? ['openai']
          : (props.provider.config?.runtimeProviderId || props.provider.id) === 'ollama'
            ? ['ollama']
            : ['openai', 'openrouter', 'deepseek', 'qwen', 'gemini']
)
const toggleAvailable = computed(() =>
  ['openrouter', 'deepseek', 'qwen', 'ollama'].includes(protocol.value)
)
const availableEfforts = computed<ReasoningEffort[]>(() => {
  if (protocol.value === 'qwen') return ['low', 'medium', 'high']
  if (protocol.value === 'gemini') {
    const budgetBased = /(?:^|\/)gemini-2\.5(?:[.-]|$)/i.test(props.model.id)
    return apiStyle.value === 'gemini' && !budgetBased
      ? ['minimal', 'low', 'medium', 'high']
      : ['none', 'minimal', 'low', 'medium', 'high']
  }
  if (protocol.value === 'anthropic')
    return thinkingMode.value === 'budget'
      ? ['none', 'low', 'medium', 'high']
      : ['low', 'medium', 'high', 'xhigh', 'max']
  return ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
})
const valid = computed(
  () =>
    protocols.value.includes(protocol.value) &&
    (efforts.value.some(
      effort => availableEfforts.value.includes(effort) && !(mandatory.value && effort === 'none')
    ) ||
      (toggleAvailable.value && supportsToggle.value))
)
const copy = computed(() =>
  chinese.value
    ? {
        title: '思考能力',
        auto: '自动识别',
        disabled: '不提供调整',
        manual: '手动配置',
        hint: '自动读取模型资料。自定义名称或中转别名未被识别时，可按服务商文档手动配置。',
        disabledHint: '不发送思考控制参数，思考行为由模型服务决定。',
        protocol: '思考参数格式',
        levels: '服务支持的档位',
        toggle: '支持开启 / 关闭思考',
        mandatory: '必须开启思考',
        thinkingMode: 'Claude 思考模式',
        adaptive: '自适应',
        budget: '预算',
        always: '始终开启',
        apply: '应用思考能力',
        empty: '请至少选择一个服务支持的档位，或声明支持思考开关。',
        manualHint:
          '只勾选服务明确支持的档位，点击“应用思考能力”后生效；仅影响当前模型。切回自动识别可恢复模型资料。',
        incompatible: '当前接口不接受已保存的思考参数格式，请切回自动识别或重新配置。'
      }
    : {
        title: 'Reasoning capability',
        auto: 'Detect automatically',
        disabled: 'No adjustment',
        manual: 'Configure manually',
        hint: 'Use model metadata by default. Configure custom names or gateway aliases using the service documentation.',
        disabledHint:
          'No reasoning controls are sent. The model service determines thinking behavior.',
        protocol: 'Reasoning parameter format',
        levels: 'Levels supported by the service',
        toggle: 'Supports thinking on / off',
        mandatory: 'Thinking is required',
        thinkingMode: 'Claude thinking mode',
        adaptive: 'Adaptive',
        budget: 'Budget',
        always: 'Always on',
        apply: 'Apply reasoning capability',
        empty: 'Select at least one supported level or declare a thinking toggle.',
        manualHint:
          'Select documented levels, then apply. This affects only this model. Automatic detection restores model metadata.',
        incompatible:
          'This API cannot use the saved reasoning format. Detect automatically or configure it again.'
      }
)
function effortLabel(effort: ReasoningEffort) {
  const labels: Record<ReasoningEffort, [string, string]> = {
    none: ['关闭', 'Off'],
    minimal: ['极低', 'Minimal'],
    low: ['低', 'Low'],
    medium: ['中', 'Medium'],
    high: ['高', 'High'],
    xhigh: ['极高', 'Extra high'],
    max: ['最高', 'Maximum']
  }
  return labels[effort][chinese.value ? 0 : 1]
}
function syncDraft() {
  const saved = props.model.reasoningOverride
  mode.value = saved === false ? 'disabled' : saved ? 'manual' : 'auto'
  protocol.value = saved ? saved.protocol : protocols.value[0] || 'openai'
  efforts.value = saved && saved.supportedEfforts ? [...saved.supportedEfforts] : []
  supportsToggle.value = !!saved && saved.supportsToggle === true
  mandatory.value = !!saved && saved.mandatory === true
  thinkingMode.value = (saved && saved.thinkingMode) || 'adaptive'
}
watch(
  () => [
    props.id,
    props.model.id,
    props.provider.id,
    props.model.reasoningOverride,
    apiStyle.value
  ],
  syncDraft,
  { immediate: true }
)
function changeMode(event: Event) {
  if (props.disabled) return
  const selected = (event.target as HTMLSelectElement).value
  if (!['auto', 'disabled', 'manual'].includes(selected)) return
  mode.value = selected as typeof mode.value
  if (selected === 'auto') emit('change', undefined)
  else if (selected === 'disabled') emit('change', false)
}
function changeProtocol(event: Event) {
  if (props.disabled) return
  const selected = (event.target as HTMLSelectElement).value as ModelReasoningConfig['protocol']
  if (!protocols.value.includes(selected)) return
  protocol.value = selected
  // A different request format has no implied support for the previous format's levels.
  efforts.value = []
  supportsToggle.value = false
  mandatory.value = false
  thinkingMode.value = 'adaptive'
}
function toggleEffort(effort: ReasoningEffort, event: Event) {
  if (props.disabled || !availableEfforts.value.includes(effort)) return
  efforts.value = (event.target as HTMLInputElement).checked
    ? [...new Set([...efforts.value, effort])]
    : efforts.value.filter(value => value !== effort)
}
function applyOverride() {
  if (props.disabled || mode.value !== 'manual' || !valid.value) return
  const selected = availableEfforts.value.filter(
    effort => efforts.value.includes(effort) && !(mandatory.value && effort === 'none')
  )
  emit('change', {
    protocol: protocol.value,
    ...(selected.length ? { supportedEfforts: selected } : {}),
    ...(toggleAvailable.value && supportsToggle.value ? { supportsToggle: true } : {}),
    ...(mandatory.value ? { mandatory: true } : {}),
    ...(protocol.value === 'anthropic' ? { thinkingMode: thinkingMode.value } : {})
  })
}
</script>

<template>
  <div class="reasoning-override" data-testid="reasoning-override">
    <label :for="`${id}-capability`">{{ copy.title }}</label>
    <select
      :id="`${id}-capability`"
      :value="mode"
      :disabled="disabled"
      :aria-describedby="`${id}-capability-hint`"
      data-testid="reasoning-capability-mode"
      @change="changeMode"
    >
      <option value="auto">{{ copy.auto }}</option>
      <option value="disabled">{{ copy.disabled }}</option>
      <option value="manual">{{ copy.manual }}</option>
    </select>
    <p :id="`${id}-capability-hint`" class="override-hint">
      {{ mode === 'disabled' ? copy.disabledHint : copy.hint }}
    </p>
    <div v-if="mode === 'manual'" class="override-fields">
      <label :for="`${id}-protocol`">{{ copy.protocol }}</label>
      <select
        :id="`${id}-protocol`"
        :value="protocol"
        :disabled="disabled"
        data-testid="reasoning-override-protocol"
        @change="changeProtocol"
      >
        <option v-if="!protocols.includes(protocol)" :value="protocol" disabled>
          {{ protocol }}
        </option>
        <option v-for="format in protocols" :key="format" :value="format">
          {{
            {
              openai: 'OpenAI reasoning_effort',
              openrouter: 'OpenRouter reasoning',
              deepseek: 'DeepSeek thinking',
              qwen: 'Qwen enable_thinking',
              gemini: 'Gemini thinking',
              anthropic: 'Claude Messages',
              ollama: 'Ollama think'
            }[format]
          }}
        </option>
      </select>
      <template v-if="protocol === 'anthropic'">
        <label :for="`${id}-thinking-mode`">{{ copy.thinkingMode }}</label>
        <select
          :id="`${id}-thinking-mode`"
          v-model="thinkingMode"
          :disabled="disabled"
          data-testid="reasoning-override-thinking-mode"
        >
          <option value="adaptive">{{ copy.adaptive }}</option>
          <option value="budget">{{ copy.budget }}</option>
          <option value="always">{{ copy.always }}</option>
        </select>
      </template>
      <fieldset :disabled="disabled">
        <legend>{{ copy.levels }}</legend>
        <div class="override-levels">
          <label v-for="effort in availableEfforts" :key="effort" class="override-checkbox"
            ><input
              type="checkbox"
              :value="effort"
              :checked="efforts.includes(effort)"
              :disabled="disabled || (mandatory && effort === 'none')"
              data-testid="reasoning-override-effort"
              @change="toggleEffort(effort, $event)"
            />{{ effortLabel(effort) }}</label
          >
        </div>
      </fieldset>
      <label v-if="toggleAvailable" class="override-checkbox"
        ><input
          v-model="supportsToggle"
          type="checkbox"
          :disabled="disabled"
          data-testid="reasoning-override-toggle"
        />{{ copy.toggle }}</label
      >
      <label v-if="protocol !== 'anthropic' || thinkingMode !== 'always'" class="override-checkbox"
        ><input
          v-model="mandatory"
          type="checkbox"
          :disabled="disabled"
          data-testid="reasoning-override-mandatory"
        />{{ copy.mandatory }}</label
      >
      <p class="override-hint">{{ copy.manualHint }}</p>
      <p v-if="!protocols.includes(protocol)" class="override-hint" role="status">
        {{ copy.incompatible }}
      </p>
      <p v-else-if="!valid" class="override-hint" role="status">{{ copy.empty }}</p>
      <button
        type="button"
        class="override-apply"
        :disabled="disabled || !valid"
        data-testid="apply-reasoning-override"
        @click="applyOverride"
      >
        {{ copy.apply }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.reasoning-override {
  display: grid;
  gap: 7px;
  margin-top: 14px;
  font-size: var(--prism-font-11);
}
.override-fields {
  display: grid;
  gap: 9px;
  margin-top: 4px;
}
.reasoning-override select {
  min-width: 0;
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  border: 1px solid var(--vscode-border);
  border-radius: 8px;
  background: var(--vscode-bg-input);
  color: var(--vscode-fg);
  font: inherit;
}
.reasoning-override select:focus-visible,
.override-checkbox input:focus-visible,
.override-apply:focus-visible {
  outline: 2px solid var(--vscode-accent);
  outline-offset: 2px;
}
.override-hint {
  margin: 0;
  color: var(--vscode-fg-muted);
  font-size: var(--prism-font-10);
  line-height: 1.7;
}
.override-fields fieldset {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
.override-fields legend {
  padding: 0;
  margin-bottom: 7px;
  font-size: inherit;
}
.override-levels {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
}
.override-checkbox {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  cursor: pointer;
}
.override-checkbox input {
  accent-color: var(--vscode-accent);
}
.override-apply {
  justify-self: start;
  padding: 7px 11px;
  border: 1px solid var(--vscode-border);
  border-radius: 8px;
  background: var(--vscode-bg-input);
  color: var(--vscode-fg);
  font: inherit;
  cursor: pointer;
}
.override-apply:not(:disabled):hover {
  background: var(--liquid-selected);
}
.reasoning-override select:disabled,
.override-apply:disabled,
.override-checkbox:has(input:disabled) {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
