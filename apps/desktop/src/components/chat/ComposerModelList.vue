<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import ProviderLogo from '@/components/common/ProviderLogo.vue'
import { settingsService, type AIProviderConfig } from '@/services/settings.service'
import { resolveSelectedModel } from '@/services/selected-model-resolver.service'
import {
  buildTitleBarModels,
  resolveSelectedTitleBarModel,
  type TitleBarModelOption
} from '@/utils/titlebar-models'
import { registerModelSelectionSyncListeners } from '@/utils/model-sync-events'

const props = defineProps<{ providerId?: string; modelId?: string; disabled?: boolean }>()
const emit = defineEmits<{ configure: [] }>()
const { locale } = useI18n()
const chinese = computed(() => locale.value.startsWith('zh'))
const providers = ref<Array<AIProviderConfig & { icon?: string }>>([])
const providerIcons = computed(
  () => new Map(providers.value.map(provider => [provider.id, provider.icon]))
)
const search = ref('')
const loading = ref(true)
const error = ref('')
const list = ref<HTMLElement>()
const models = computed(() => buildTitleBarModels(providers.value))
const filtered = computed(() => {
  const term = search.value.trim().toLocaleLowerCase()
  return models.value.filter(
    model =>
      !term || `${model.name} ${model.id} ${model.providerName}`.toLocaleLowerCase().includes(term)
  )
})
let cleanup: (() => void) | undefined
let disposed = false

async function reload() {
  try {
    const settings = await settingsService.getSettings()
    if (disposed) return
    providers.value = settings.aiProviders || []
    const saved = localStorage.getItem('selectedAIModel')
    if (resolveSelectedTitleBarModel(models.value, saved).shouldClear) {
      localStorage.removeItem('selectedAIModel')
      window.dispatchEvent(new CustomEvent('ai-model-changed', { detail: null }))
    }
  } catch {
    if (!disposed)
      error.value = chinese.value
        ? '无法读取模型配置，请重试。'
        : 'Could not load models. Please try again.'
  } finally {
    if (!disposed) loading.value = false
  }
}

async function select(model: TitleBarModelOption) {
  if (props.disabled) return
  error.value = ''
  try {
    const settings = await settingsService.getSettings()
    const selection = resolveSelectedModel(
      JSON.stringify({ providerId: model.providerId, modelId: model.id }),
      settings.aiProviders || []
    )
    if (!selection?.provider || !selection.model) {
      await reload()
      error.value = chinese.value
        ? '模型配置已变化，请重新选择。'
        : 'Model settings changed. Choose a model again.'
      return
    }
    const saved = { source: 'local', providerId: selection.providerId, modelId: selection.modelId }
    localStorage.setItem('selectedAIModel', JSON.stringify(saved))
    window.dispatchEvent(new CustomEvent('ai-model-changed', { detail: saved }))
  } catch {
    error.value = chinese.value
      ? '模型选择未能保存，请重试。'
      : 'Could not save your model selection. Please try again.'
  }
}

function focusOption(event: KeyboardEvent) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  const options = Array.from(
    list.value?.querySelectorAll<HTMLButtonElement>('.composer-model-option:not(:disabled)') || []
  )
  if (!options.length) return
  event.preventDefault()
  const index = options.indexOf(document.activeElement as HTMLButtonElement)
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? options.length - 1
        : index < 0
          ? event.key === 'ArrowUp'
            ? options.length - 1
            : 0
          : (index + (event.key === 'ArrowUp' ? -1 : 1) + options.length) % options.length
  options[next]?.focus()
}

function onStorage(event: StorageEvent) {
  if (event.key === 'app-settings' || event.key === null) void reload()
}

onMounted(() => {
  void reload()
  cleanup = registerModelSelectionSyncListeners(window, () => {
    void reload()
  })
  window.addEventListener('storage', onStorage)
})
onUnmounted(() => {
  disposed = true
  cleanup?.()
  window.removeEventListener('storage', onStorage)
})
</script>

<template>
  <section class="composer-models" :aria-label="chinese ? '模型选择' : 'Model selection'">
    <div class="composer-model-heading">
      <h3>{{ chinese ? '模型' : 'Model' }}</h3>
      <button type="button" class="composer-model-configure" @click="emit('configure')">
        <i class="bi bi-sliders2" aria-hidden="true" />{{
          chinese ? '配置模型' : 'Configure models'
        }}
      </button>
    </div>
    <label class="composer-model-search">
      <i class="bi bi-search" aria-hidden="true" />
      <input
        v-model="search"
        type="search"
        :placeholder="chinese ? '搜索模型或服务商' : 'Search models or providers'"
        :aria-label="chinese ? '搜索模型或服务商' : 'Search models or providers'"
        @keydown.down.prevent="focusOption"
        @keydown.up.prevent="focusOption"
      />
    </label>
    <div ref="list" class="composer-model-options" @keydown="focusOption">
      <p v-if="loading" class="composer-model-empty" role="status">
        {{ chinese ? '正在读取模型…' : 'Loading models…' }}
      </p>
      <p v-else-if="!filtered.length" class="composer-model-empty" role="status">
        {{
          models.length
            ? chinese
              ? '没有匹配的模型'
              : 'No matching models'
            : chinese
              ? '还没有可用模型，请先配置模型服务。'
              : 'No models available. Configure a model service first.'
        }}
      </p>
      <button
        v-for="model in filtered"
        :key="`${model.providerId}:${model.id}`"
        type="button"
        class="composer-model-option"
        :data-provider-id="model.providerId"
        :data-model-id="model.id"
        :disabled="disabled"
        :aria-pressed="providerId === model.providerId && modelId === model.id"
        @click="select(model)"
      >
        <span class="composer-model-glyph">
          <ProviderLogo
            :provider-id="model.providerId"
            :fallback-icon="providerIcons.get(model.providerId)"
          />
        </span>
        <span class="composer-model-name"
          ><span>{{ model.name }}</span
          ><small>{{ model.providerName }}</small></span
        >
        <i
          v-if="providerId === model.providerId && modelId === model.id"
          class="bi bi-check2"
          aria-hidden="true"
        />
      </button>
    </div>
    <p v-if="error" class="composer-model-error" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped>
.composer-models {
  min-width: 0;
}
.composer-model-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}
.composer-model-heading h3 {
  margin: 0;
  font-size: var(--prism-font-12);
  font-weight: 600;
  color: var(--vscode-fg);
}
.composer-model-configure {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 0;
  border: 0;
  background: transparent;
  color: var(--vscode-fg-muted);
  font: inherit;
  font-size: var(--prism-font-11);
  touch-action: manipulation;
}
.composer-model-search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  margin-bottom: 8px;
  border: 1px solid var(--prism-border);
  border-radius: 10px;
  background: var(--prism-control);
  color: var(--vscode-fg-muted);
}
.composer-model-search input {
  min-width: 0;
  width: 100%;
  height: 34px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--vscode-fg);
  font: inherit;
  font-size: var(--prism-font-12);
  outline: 0;
}
.composer-model-search:focus-within {
  outline: 2px solid var(--vscode-accent);
  outline-offset: 2px;
}
.composer-model-options {
  max-height: 168px;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
}
.composer-model-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  min-height: 44px;
  padding: 7px 9px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  text-align: start;
  color: var(--vscode-fg);
  font: inherit;
  touch-action: manipulation;
  transition: background-color 100ms ease-out;
}
.composer-model-option[aria-pressed='true'] {
  background: var(--vscode-list-activeSelectionBackground);
  color: var(--vscode-accent);
}
.composer-model-glyph {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  flex: none;
  border-radius: 10px;
  background: color-mix(in srgb, var(--vscode-accent) 9%, transparent);
  color: var(--vscode-accent);
  font-size: var(--prism-font-16);
}
.composer-model-name {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}
.composer-model-name > span,
.composer-model-name small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.composer-model-name > span {
  font-size: var(--prism-font-12);
}
.composer-model-name small {
  color: var(--vscode-fg-muted);
  font-size: var(--prism-font-10);
  line-height: 1.5;
}
.composer-model-option > i {
  flex: none;
}
.composer-model-empty {
  padding: 12px 6px;
  margin: 0;
  color: var(--vscode-fg-muted);
  font-size: var(--prism-font-12);
  line-height: 1.6;
}
.composer-model-error {
  margin: 8px 0 0;
  color: var(--prism-danger);
  font-size: var(--prism-font-11);
}
.composer-model-option:focus-visible,
.composer-model-configure:focus-visible {
  outline: 2px solid var(--vscode-accent);
  outline-offset: -2px;
}
@media (hover: hover) and (pointer: fine) {
  .composer-model-option:hover {
    background: var(--vscode-list-hoverBackground);
  }
  .composer-model-configure:hover {
    color: var(--vscode-accent);
  }
}
</style>
