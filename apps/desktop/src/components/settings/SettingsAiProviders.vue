<template>
  <section
    id="section-ai-providers"
    class="ai-settings setting-section prism-settings-section"
    data-testid="ai-provider-settings"
  >
    <header class="ai-settings-heading">
      <div>
        <h2 class="section-title">
          <AiProvidersIcon />{{ t('settings.aiProvidersTitle') }}
        </h2>
        <p class="section-description">{{ copy.description }}</p>
      </div>
      <span class="saved-note"
        ><i class="bi bi-check2-circle" aria-hidden="true"></i>{{ copy.autosave }}</span
      >
    </header>
    <div class="provider-workspace">
      <aside class="provider-directory" :aria-label="copy.directory">
        <label class="directory-search">
          <i class="bi bi-search" aria-hidden="true"></i>
          <input
            v-model="search"
            type="search"
            :placeholder="copy.search"
            :aria-label="copy.search"
            data-testid="provider-search"
          />
        </label>
        <div class="directory-filters">
          <select v-model="category" :aria-label="copy.category" data-testid="provider-category">
            <option v-for="item in categories" :key="item.id" :value="item.id">
              {{ item.label }}
            </option>
          </select>
          <select
            v-model="capability"
            :aria-label="copy.capability"
            data-testid="provider-capability"
          >
            <option value="all">{{ copy.allCapabilities }}</option>
            <option value="functionCall">{{ copy.tools }}</option>
            <option value="vision">{{ copy.vision }}</option>
            <option value="reasoning">{{ copy.reasoning }}</option>
          </select>
        </div>
        <div class="directory-summary">
          <span>{{ copy.directory }}</span
          ><span>{{ filteredProviders.length }} / {{ providers.length }}</span>
        </div>
        <div class="provider-directory-list" data-testid="provider-directory">
          <button
            v-for="provider in filteredProviders"
            :key="provider.id"
            type="button"
            class="provider-choice"
            :class="{ selected: selected?.id === provider.id }"
            :aria-pressed="selected?.id === provider.id"
            :data-provider-id="provider.id"
            @click="selectProvider(provider.id)"
          >
            <span class="provider-glyph"><ProviderLogo :provider-id="provider.id" :fallback-icon="provider.icon" /></span>
            <span class="provider-choice-name"
              >{{ provider.name
              }}<small>{{ provider.models.length }} {{ copy.modelsCount }}</small></span
            >
            <span
              v-if="provider.enabled && isConfigured(provider)"
              class="connection-dot"
              :data-prism-tooltip="copy.enabled"
              :aria-label="copy.enabled"
            ></span>
            <i
              v-else-if="isConfigured(provider)"
              class="bi bi-check2 configured-icon"
              :data-prism-tooltip="copy.configured"
              :aria-label="copy.configured"
            ></i>
          </button>
          <div v-if="!filteredProviders.length" class="directory-empty">
            <i class="bi bi-search" aria-hidden="true"></i>
            <p>{{ copy.noProviders }}</p>
            <button type="button" class="text-action" @click="resetFilters">
              {{ copy.resetFilters }}
            </button>
          </div>
        </div>
        <p class="directory-footnote">{{ copy.directoryHint }}</p>
      </aside>
      <div class="provider-detail-stage" :data-direction="panelDirection">
        <Transition
          name="provider-panel"
          @before-enter="activateDetail"
          @before-leave="deactivateDetail"
          @leave-cancelled="activateDetail"
        >
          <div
            v-if="selected"
            :key="selected.id"
            class="provider-detail"
            :data-provider-id="selected.id"
            data-testid="provider-detail"
          >
            <header class="provider-detail-heading">
              <span class="provider-emblem"><ProviderLogo :provider-id="selected.id" :fallback-icon="selected.icon" /></span>
              <div class="provider-title">
                <h3>{{ selected.name }}</h3>
                <p>{{ selected.description }}</p>
              </div>
              <label class="glass-switch provider-enable"
                ><input
                  type="checkbox"
                  :checked="selected.enabled"
                  :disabled="isManaged(selected) || isUnsupported(selected)"
                  :aria-label="`${copy.enableProvider} ${selected.name}`"
                  data-testid="provider-enabled"
                  @change="
                    patchProvider({ enabled: ($event.target as HTMLInputElement).checked })
                  " /><span aria-hidden="true"></span
              ></label>
            </header>
            <div class="provider-meta">
              <span class="catalog-badge" :class="selected.config?.catalogStatus || 'dynamic'"
                ><i :class="catalogIcon(selected)" aria-hidden="true"></i
                >{{ catalogLabel(selected) }}</span
              >
              <span v-if="selected.config?.verifiedAt" class="verified-date"
                >{{ copy.verifiedOn }} {{ selected.config.verifiedAt }}</span
              >
              <a
                v-if="selected.config?.docsUrl || selected.website"
                :href="selected.config?.docsUrl || selected.website"
                target="_blank"
                rel="noopener noreferrer"
                class="provider-docs"
                >{{ copy.documentation }}<i class="bi bi-arrow-up-right" aria-hidden="true"></i
              ></a>
            </div>
            <p v-if="isUnsupported(selected)" class="provider-notice" role="note">
              <i class="bi bi-info-circle" aria-hidden="true"></i>{{ copy.unsupported }}
            </p>
            <p
              v-else-if="selected.config?.catalogStatus === 'unverified'"
              class="provider-notice"
              role="note"
            >
              <i class="bi bi-info-circle" aria-hidden="true"></i>{{ copy.unverified }}
            </p>
            <div class="connection-settings">
              <div class="field-heading">
                <h4>{{ copy.connection }}</h4>
                <span v-if="isManaged(selected)">{{ copy.managed }}</span>
              </div>
              <label class="connection-field" :for="`endpoint-${selected.id}`"
                ><span>{{ copy.endpoint }}</span
                ><input
                  :id="`endpoint-${selected.id}`"
                  :value="selected.endpoint"
                  type="url"
                  inputmode="url"
                  spellcheck="false"
                  :readonly="
                    isManaged(selected) ||
                    testingProviders[selected.id] ||
                    fetchingModels[selected.id]
                  "
                  :placeholder="
                    selected.config?.endpointPlaceholder || 'https://api.example.com/v1'
                  "
                  data-testid="provider-endpoint"
                  @input="patchProvider({ endpoint: ($event.target as HTMLInputElement).value })"
              /></label>
              <p class="field-hint">{{ copy.endpointHint }}</p>
              <label class="connection-field" :for="`key-${selected.id}`"
                ><span
                  >API Key <small v-if="isLocal(selected)">{{ copy.optional }}</small></span
                ><span class="key-input"
                  ><input
                    :id="`key-${selected.id}`"
                    :value="selected.apiKey"
                    :type="showKey ? 'text' : 'password'"
                    autocomplete="off"
                    spellcheck="false"
                    :readonly="
                      isManaged(selected) ||
                      testingProviders[selected.id] ||
                      fetchingModels[selected.id]
                    "
                    :placeholder="
                      isManaged(selected)
                        ? copy.managed
                        : isLocal(selected)
                          ? copy.localKey
                          : copy.keyPlaceholder
                    "
                    data-testid="provider-api-key"
                    @input="
                      patchProvider({ apiKey: ($event.target as HTMLInputElement).value })
                    " /><button
                    type="button"
                    :aria-label="showKey ? copy.hideKey : copy.showKey"
                    :aria-pressed="showKey"
                    @click="showKey = !showKey"
                  >
                    <i
                      :class="showKey ? 'bi bi-eye-slash' : 'bi bi-eye'"
                      aria-hidden="true"
                    ></i></button></span
              ></label>
              <div class="connection-actions">
                <a
                  v-if="!isLocal(selected) && !isManaged(selected) && selected.website"
                  :href="selected.website"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-action"
                  >{{ copy.getKey }}<i class="bi bi-arrow-up-right" aria-hidden="true"></i></a
                ><button
                  v-if="!isManaged(selected)"
                  type="button"
                  class="text-action muted-action"
                  :disabled="
                    (!selected.apiKey && !selected.enabled) ||
                    testingProviders[selected.id] ||
                    fetchingModels[selected.id]
                  "
                  @click="emit('clear', selected.id)"
                >
                  {{ copy.clear }}
                </button>
              </div>
            </div>
            <section class="provider-models" :aria-label="copy.models">
              <div class="models-heading">
                <div>
                  <h4>
                    {{ copy.models }}<span class="model-count">{{ selected.models.length }}</span>
                  </h4>
                  <p>{{ enabledCount }} {{ copy.modelsEnabled }} · {{ copy.parametersHint }}</p>
                </div>
                <div class="model-heading-actions">
                  <button
                    type="button"
                    class="icon-action"
                    :data-prism-tooltip="copy.addModel"
                    :aria-label="copy.addModel"
                    :disabled="isManaged(selected) || isUnsupported(selected)"
                    data-testid="add-model"
                    @click="emit('add', selected)"
                  >
                    <i class="bi bi-plus-lg" aria-hidden="true"></i></button
                  ><button
                    type="button"
                    class="icon-action"
                    :data-prism-tooltip="copy.refresh"
                    :aria-label="copy.refresh"
                    :disabled="
                      !canConnect(selected) ||
                      fetchingModels[selected.id] ||
                      isManaged(selected) ||
                      isUnsupported(selected)
                    "
                    data-testid="refresh-models"
                    @click="emit('refresh', selected)"
                  >
                    <i
                      class="bi bi-arrow-repeat"
                      :class="{ spinning: fetchingModels[selected.id] }"
                      aria-hidden="true"
                    ></i>
                  </button>
                </div>
              </div>
              <div v-if="selected.models.length" class="model-search-row">
                <label class="model-search"
                  ><i class="bi bi-search" aria-hidden="true"></i
                  ><input
                    v-model="modelSearch"
                    type="search"
                    :placeholder="copy.searchModels"
                    :aria-label="copy.searchModels"
                    data-testid="model-search" /></label
                ><select v-model="priceFilter" :aria-label="copy.priceFilter">
                  <option value="all">{{ t('settings.priceFilterAll') }}</option>
                  <option value="free">{{ t('settings.priceFilterFree') }}</option>
                  <option value="low">{{ t('settings.priceFilterLow') }}</option>
                  <option value="medium">{{ t('settings.priceFilterMedium') }}</option>
                  <option value="high">{{ t('settings.priceFilterHigh') }}</option>
                </select>
              </div>
              <div class="models-list" data-testid="provider-model-list">
                <article
                  v-for="model in filteredModels"
                  :key="model.id"
                  class="model-entry"
                  :class="{
                    'model-disabled': model.enabled === false,
                    'parameters-open': expandedModel === model.id
                  }"
                  :data-model-id="model.id"
                >
                  <div class="model-main-row">
                    <div class="model-identity">
                      <div class="model-name">
                        <span>{{ model.name }}</span
                        ><i
                          v-if="model.recommended"
                          class="bi bi-star-fill"
                          :data-prism-tooltip="copy.recommended"
                          :aria-label="copy.recommended"
                        ></i>
                      </div>
                      <code>{{ model.id }}</code>
                      <div class="model-capabilities">
                        <span v-if="model.contextWindow > 0" :data-prism-tooltip="copy.contextWindow"
                          >{{ formatTokens(model.contextWindow) }} {{ copy.context }}</span
                        ><span v-if="model.capabilities.functionCall"
                          ><i class="bi bi-tools" aria-hidden="true"></i>{{ copy.tools }}</span
                        ><span v-if="model.capabilities.vision"
                          ><i class="bi bi-eye" aria-hidden="true"></i>{{ copy.vision }}</span
                        ><span
                          v-if="getModelCapabilities(selected, model).reasoning.options.length > 1"
                          ><i class="bi bi-stars" aria-hidden="true"></i>{{ copy.reasoning }}</span
                        ><span v-if="model.price" :data-prism-tooltip="copy.priceHint"
                          >${{ model.price.input }}/{{ model.price.output }}</span
                        >
                      </div>
                    </div>
                    <div class="model-actions">
                      <button
                        type="button"
                        class="model-parameter-button"
                        :aria-label="`${copy.parameters}: ${model.name}`"
                        :aria-expanded="expandedModel === model.id"
                        :aria-controls="`parameters-${selected.id}-${model.id}`"
                        data-testid="model-parameters-toggle"
                        @click="expandedModel = expandedModel === model.id ? '' : model.id"
                      >
                        <i class="bi bi-sliders2" aria-hidden="true"></i
                        ><span>{{ copy.parameters }}</span></button
                      ><button
                        v-if="model.isCustom === true || selected.id === 'custom-openai'"
                        type="button"
                        class="icon-action delete-model"
                        data-testid="remove-model"
                        :data-prism-tooltip="copy.deleteModel"
                        :aria-label="`${copy.deleteModel}: ${model.name}`"
                        @click="emit('remove', selected.id, model.id)"
                      >
                        <i class="bi bi-trash3" aria-hidden="true"></i></button
                      ><label class="glass-switch"
                        ><input
                          type="checkbox"
                          :checked="model.enabled !== false"
                          :disabled="isUnsupported(selected)"
                          :aria-label="`${copy.enableModel} ${model.name}`"
                          data-testid="model-enabled"
                          @change="
                            patchModel(model.id, {
                              enabled: ($event.target as HTMLInputElement).checked
                            })
                          " /><span aria-hidden="true"></span
                      ></label>
                    </div>
                  </div>
                  <Transition
                    name="model-disclosure"
                    @before-enter="activateDetail"
                    @before-leave="deactivateDisclosure"
                    @leave-cancelled="activateDetail"
                  >
                    <div v-if="expandedModel === model.id" class="model-parameters-reveal">
                      <ModelParameters
                        :id="`parameters-${selected.id}-${model.id}`"
                        :provider="selected"
                        :model="model"
                        :disabled="isUnsupported(selected)"
                        @change="requestConfig => patchModel(model.id, { requestConfig })"
                      />
                    </div>
                  </Transition>
                  <Transition name="model-result">
                    <div
                      v-if="modelTestResults[selected.id]?.[model.id]"
                      class="model-test-result"
                      :class="
                        modelTestResults[selected.id][model.id].success
                          ? 'test-success'
                          : 'test-error'
                      "
                      role="status"
                    >
                      <i
                        :class="
                          modelTestResults[selected.id][model.id].success
                            ? 'bi bi-check-circle'
                            : 'bi bi-exclamation-circle'
                        "
                        aria-hidden="true"
                      ></i
                      ><span>{{
                        modelTestResults[selected.id][model.id].success
                          ? modelTestResults[selected.id][model.id].message
                          : modelTestResults[selected.id][model.id].error ||
                            modelTestResults[selected.id][model.id].message
                      }}</span>
                    </div>
                  </Transition>
                </article>
                <div v-if="!filteredModels.length" class="models-empty">
                  <i class="bi bi-cpu" aria-hidden="true"></i>
                  <p>{{ selected.models.length ? copy.noModels : copy.emptyModels }}</p>
                  <span v-if="!selected.models.length">{{
                    isUnsupported(selected) ? copy.unsupportedEmpty : copy.emptyHint
                  }}</span
                  ><button
                    v-if="modelSearch || priceFilter !== 'all'"
                    type="button"
                    class="text-action"
                    @click="resetModelFilters"
                  >
                    {{ copy.resetFilters }}
                  </button>
                </div>
              </div>
            </section>
            <footer class="provider-footer">
              <p><i class="bi bi-shield-lock" aria-hidden="true"></i>{{ copy.privateKey }}</p>
              <button
                type="button"
                class="test-connection"
                :disabled="
                  !canConnect(selected) ||
                  !enabledCount ||
                  testingProviders[selected.id] ||
                  isUnsupported(selected)
                "
                data-testid="test-provider"
                @click="emit('test', selected)"
              >
                <i
                  :class="
                    testingProviders[selected.id]
                      ? 'bi bi-arrow-repeat spinning'
                      : 'bi bi-lightning-charge'
                  "
                  aria-hidden="true"
                ></i
                >{{ testingProviders[selected.id] ? copy.testing : copy.test
                }}<span v-if="enabledCount && !testingProviders[selected.id]">{{
                  enabledCount
                }}</span>
              </button>
            </footer>
          </div>
          <div v-else class="provider-panel-empty">
            <i class="bi bi-hdd-network" aria-hidden="true"></i>
            <p>{{ copy.selectProvider }}</p>
          </div>
        </Transition>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  INTERNATIONAL_PROVIDERS,
  CHINESE_PROVIDERS,
  CHINESE_EXTENDED_PROVIDERS,
  PLATFORM_PROVIDERS,
  CLOUD_PROVIDERS,
  OPENSOURCE_PROVIDERS,
  SPECIALIZED_PROVIDERS,
  type AIModel,
  type AIProvider
} from '@/types/ai-providers'
import type { TestResult } from '@/services/ai-test.service'
import { getModelCapabilities } from '@/utils/model-capabilities'
import ModelParameters from './ModelParameters.vue'
import AiProvidersIcon from '@/components/common/AiProvidersIcon.vue'
import ProviderLogo from '@/components/common/ProviderLogo.vue'

const providers = defineModel<AIProvider[]>('providers', { required: true })
defineProps<{
  testingProviders: Record<string, boolean>
  fetchingModels: Record<string, boolean>
  modelTestResults: Record<string, Record<string, TestResult>>
}>()
const emit = defineEmits<{
  test: [provider: AIProvider]
  refresh: [provider: AIProvider]
  add: [provider: AIProvider]
  remove: [providerId: string, modelId: string]
  clear: [providerId: string]
}>()
const { t, locale } = useI18n()
const copy = computed(() =>
  locale.value.startsWith('zh')
    ? {
        description: '连接自己的模型服务，为每个模型保留合适的参数。',
        autosave: '自动保存',
        directory: '服务商',
        search: '搜索服务商或模型',
        category: '服务商分类',
        capability: '模型能力',
        allCapabilities: '所有能力',
        tools: '工具调用',
        vision: '视觉',
        reasoning: '思考',
        modelsCount: '个模型',
        enabled: '已启用',
        configured: '已配置',
        noProviders: '没有匹配的服务商',
        resetFilters: '重置筛选',
        directoryHint: '已配置的服务商优先显示',
        enableProvider: '启用服务商',
        documentation: '官方文档',
        verifiedOn: '核对于',
        unsupported:
          '此服务的原生接口或业务类型暂未接入，不能直接用于终端对话。若有 OpenAI 兼容接口，请使用自定义服务。',
        unverified: '此服务暂未取得可靠的官方模型资料。请按官方文档填写地址并刷新账户可用模型。',
        connection: '连接配置',
        managed: '由应用管理',
        endpoint: '服务地址',
        endpointHint: '填写 API 基础地址，模型会自动使用适合的请求接口。',
        optional: '可选',
        localKey: '本地服务通常无需密钥',
        keyPlaceholder: '输入自己的 API Key',
        hideKey: '隐藏 API Key',
        showKey: '显示 API Key',
        getKey: '获取 API Key',
        clear: '清除配置',
        models: '模型',
        modelsEnabled: '个已启用',
        parametersHint: '参数按模型单独保存',
        addModel: '手动添加模型',
        refresh: '从服务刷新模型',
        searchModels: '搜索模型名称或 ID',
        priceFilter: '模型价格',
        parameters: '参数',
        deleteModel: '删除模型',
        enableModel: '启用模型',
        recommended: '推荐',
        contextWindow: '上下文窗口',
        context: '上下文',
        priceHint: '参考价格：输入/输出，美元每百万 token，以服务商计费为准',
        noModels: '没有匹配的模型',
        emptyModels: '尚未配置模型',
        emptyHint: '填入服务地址与密钥后刷新，或手动添加账户可用的模型 ID。',
        unsupportedEmpty: '请使用已支持的聊天服务或自定义兼容接口。',
        privateKey: '密钥仅用于你配置的服务',
        testing: '测试中',
        test: '测试已启用模型',
        selectProvider: '选择左侧服务商，开始配置',
        verified: '官方资料已核对',
        dynamic: '从账户获取模型',
        unsupportedLabel: '暂未接入',
        unverifiedLabel: '需核实配置',
        all: '全部服务商',
        international: '国际服务商',
        chinese: '中国服务商',
        platforms: '聚合平台',
        cloud: '云服务',
        opensource: '本地与开源',
        specialized: '专业服务'
      }
    : {
        description: 'Connect your model services and keep the right parameters for each model.',
        autosave: 'Saved automatically',
        directory: 'Providers',
        search: 'Search providers or models',
        category: 'Provider category',
        capability: 'Model capabilities',
        allCapabilities: 'All capabilities',
        tools: 'Tools',
        vision: 'Vision',
        reasoning: 'Reasoning',
        modelsCount: 'models',
        enabled: 'Enabled',
        configured: 'Configured',
        noProviders: 'No matching providers',
        resetFilters: 'Reset filters',
        directoryHint: 'Configured providers appear first',
        enableProvider: 'Enable provider',
        documentation: 'Official docs',
        verifiedOn: 'Checked',
        unsupported:
          'This native API or service type is not supported in terminal chat yet. If an OpenAI-compatible API is available, configure a custom service.',
        unverified:
          'Reliable official model information is not available. Follow the provider documentation and refresh the models available to your account.',
        connection: 'Connection',
        managed: 'Managed by the app',
        endpoint: 'Service address',
        endpointHint: 'Enter the API base URL. Each model uses the appropriate request interface.',
        optional: 'optional',
        localKey: 'Local services usually need no key',
        keyPlaceholder: 'Enter your API Key',
        hideKey: 'Hide API Key',
        showKey: 'Show API Key',
        getKey: 'Get API Key',
        clear: 'Clear configuration',
        models: 'Models',
        modelsEnabled: 'enabled',
        parametersHint: 'Parameters are saved per model',
        addModel: 'Add model manually',
        refresh: 'Refresh models from service',
        searchModels: 'Search model name or ID',
        priceFilter: 'Model price',
        parameters: 'Parameters',
        deleteModel: 'Delete model',
        enableModel: 'Enable model',
        recommended: 'Recommended',
        contextWindow: 'Context window',
        context: 'context',
        priceHint:
          'Reference input/output price in USD per million tokens; provider billing applies',
        noModels: 'No matching models',
        emptyModels: 'No models configured',
        emptyHint:
          'Enter the service URL and key, then refresh or manually add an available model ID.',
        unsupportedEmpty: 'Choose a supported chat provider or a custom compatible API.',
        privateKey: 'Keys are only sent to your configured service',
        testing: 'Testing',
        test: 'Test enabled models',
        selectProvider: 'Choose a provider to configure',
        verified: 'Official information checked',
        dynamic: 'Fetch account models',
        unsupportedLabel: 'Not integrated',
        unverifiedLabel: 'Verify configuration',
        all: 'All providers',
        international: 'International',
        chinese: 'China',
        platforms: 'Aggregators',
        cloud: 'Cloud services',
        opensource: 'Local and open source',
        specialized: 'Specialized'
      }
)
const search = ref(''),
  category = ref('all'),
  capability = ref('all'),
  selectedId = ref(''),
  showKey = ref(false),
  modelSearch = ref(''),
  priceFilter = ref('all'),
  expandedModel = ref(''),
  panelDirection = ref('forward')
const categories = computed(() => [
  { id: 'all', label: copy.value.all, providers: [] },
  { id: 'international', label: copy.value.international, providers: INTERNATIONAL_PROVIDERS },
  {
    id: 'chinese',
    label: copy.value.chinese,
    providers: [...CHINESE_PROVIDERS, ...CHINESE_EXTENDED_PROVIDERS]
  },
  { id: 'platforms', label: copy.value.platforms, providers: PLATFORM_PROVIDERS },
  { id: 'cloud', label: copy.value.cloud, providers: CLOUD_PROVIDERS },
  { id: 'opensource', label: copy.value.opensource, providers: OPENSOURCE_PROVIDERS },
  { id: 'specialized', label: copy.value.specialized, providers: SPECIALIZED_PROVIDERS }
])
const isLocal = (provider: AIProvider) =>
  (provider.config?.runtimeProviderId || provider.id) === 'ollama'
const isManaged = (provider: AIProvider) => !!provider.config?.managedByApp
const isConfigured = (provider: AIProvider) =>
  !!provider.apiKey || isLocal(provider) || isManaged(provider)
const isUnsupported = (provider: AIProvider) => provider.config?.catalogStatus === 'unsupported'
const canConnect = (provider: AIProvider) => isConfigured(provider) && !!provider.endpoint.trim()
const filteredProviders = computed(() => {
  const query = search.value.trim().toLowerCase()
  const ids = new Set(
    categories.value.find(item => item.id === category.value)?.providers.map(item => item.id)
  )
  return providers.value
    .filter(provider => {
      if (category.value !== 'all' && !ids.has(provider.id)) return false
      if (
        query &&
        ![
          provider.name,
          provider.id,
          provider.description,
          ...provider.models.flatMap(model => [model.name, model.id])
        ].some(text => text.toLowerCase().includes(query))
      )
        return false
      if (capability.value === 'reasoning')
        return provider.models.some(
          model => getModelCapabilities(provider, model).reasoning.options.length > 1
        )
      if (capability.value === 'functionCall' || capability.value === 'vision')
        return provider.models.some(
          model => model.capabilities[capability.value as 'functionCall' | 'vision']
        )
      return true
    })
    .sort((a, b) => Number(isConfigured(b)) - Number(isConfigured(a)))
})
const selected = computed(() => providers.value.find(provider => provider.id === selectedId.value))
watch(selectedId, (id, previousId) => {
  const order = filteredProviders.value.map(provider => provider.id)
  panelDirection.value = order.indexOf(id) < order.indexOf(previousId) ? 'backward' : 'forward'
  showKey.value = false
  modelSearch.value = ''
  priceFilter.value = 'all'
  expandedModel.value = ''
})
watch(
  filteredProviders,
  list => {
    if (!list.some(provider => provider.id === selectedId.value))
      selectedId.value = list.find(provider => isConfigured(provider))?.id || list[0]?.id || ''
  },
  { immediate: true }
)
const enabledCount = computed(
  () => selected.value?.models.filter(model => model.enabled !== false).length || 0
)
const filteredModels = computed(() =>
  (selected.value?.models || [])
    .filter(model => {
      const query = modelSearch.value.trim().toLowerCase()
      if (
        query &&
        ![model.id, model.name, model.description || ''].some(value =>
          value.toLowerCase().includes(query)
        )
      )
        return false
      if (priceFilter.value === 'all') return true
      if (!model.price) return false
      const avg = (model.price.input + model.price.output) / 2
      return priceFilter.value === 'free'
        ? avg === 0
        : priceFilter.value === 'low'
          ? avg > 0 && avg <= 1
          : priceFilter.value === 'medium'
            ? avg > 1 && avg <= 10
            : avg > 10
    })
    .sort((a, b) => Number(b.enabled !== false) - Number(a.enabled !== false))
)
function selectProvider(id: string) {
  selectedId.value = id
  showKey.value = false
  modelSearch.value = ''
  priceFilter.value = 'all'
  expandedModel.value = ''
}
function activateDetail(element: Element) {
  element.removeAttribute('inert')
  element.removeAttribute('aria-hidden')
}
function deactivateDetail(element: Element) {
  // The replacement is already interactive; a fading view must leave the tab order immediately.
  element.setAttribute('inert', '')
  element.setAttribute('aria-hidden', 'true')
}
function deactivateDisclosure(element: Element) {
  if (element.contains(document.activeElement)) {
    element
      .closest('.model-entry')
      ?.querySelector<HTMLButtonElement>('.model-parameter-button')
      ?.focus({ preventScroll: true })
  }
  deactivateDetail(element)
}
function resetFilters() {
  search.value = ''
  category.value = 'all'
  capability.value = 'all'
}
function resetModelFilters() {
  modelSearch.value = ''
  priceFilter.value = 'all'
}
function patchProvider(patch: Partial<AIProvider>) {
  providers.value = providers.value.map(provider =>
    provider.id === selectedId.value ? { ...provider, ...patch } : provider
  )
}
function patchModel(id: string, patch: Partial<AIModel>) {
  if (selected.value)
    patchProvider({
      models: selected.value.models.map(model => (model.id === id ? { ...model, ...patch } : model))
    })
}
function formatTokens(tokens: number) {
  return tokens >= 1_000_000
    ? `${Number((tokens / 1_000_000).toFixed(1))}M`
    : tokens >= 1000
      ? `${Number((tokens / 1000).toFixed(1))}K`
      : String(tokens)
}
function catalogLabel(provider: AIProvider) {
  return provider.config?.catalogStatus === 'verified'
    ? copy.value.verified
    : provider.config?.catalogStatus === 'unsupported'
      ? copy.value.unsupportedLabel
      : provider.config?.catalogStatus === 'unverified'
        ? copy.value.unverifiedLabel
        : copy.value.dynamic
}
function catalogIcon(provider: AIProvider) {
  return provider.config?.catalogStatus === 'verified'
    ? 'bi bi-patch-check'
    : provider.config?.catalogStatus === 'unsupported'
      ? 'bi bi-dash-circle'
      : 'bi bi-cloud-arrow-down'
}
</script>

<style scoped>
.ai-settings {
  container-type: inline-size;
  color: var(--vscode-fg);
  --provider-enter-ease: cubic-bezier(0.22, 1, 0.36, 1);
}
.ai-settings-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 22px;
}
.section-title {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 0 8px;
  font-size: var(--prism-font-23);
  font-weight: 620;
  letter-spacing: -0.5px;
}
.section-title > .ai-providers-icon {
  font-size: var(--prism-font-20);
  color: var(--vscode-accent);
}
.section-description {
  margin: 0;
  color: var(--vscode-fg-muted);
  font-size: var(--prism-font-13);
  line-height: 1.7;
}
.saved-note {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
  color: var(--vscode-fg-muted);
  font-size: var(--prism-font-11);
  padding-top: 7px;
}
.saved-note > i {
  color: var(--vscode-accent);
}
.provider-workspace {
  display: grid;
  grid-template-columns: minmax(180px, 230px) minmax(0, 1fr);
  min-height: 660px;
  border: 1px solid var(--liquid-rim, var(--vscode-border));
  border-radius: 24px;
  background: var(--liquid-panel);
  box-shadow:
    inset 0 1px 0 var(--liquid-inner-light),
    0 20px 60px -42px var(--liquid-shadow);
  overflow: hidden;
  backdrop-filter: blur(24px) saturate(135%);
}
.provider-directory {
  min-width: 0;
  padding: 18px 12px 12px;
  border-right: 1px solid var(--vscode-border-subtle);
  background: color-mix(in srgb, var(--liquid-tint) 65%, transparent);
}
.directory-search,
.model-search {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 0 10px;
  height: 36px;
  background: var(--vscode-bg-input);
  border: 1px solid var(--vscode-border);
  border-radius: 11px;
  color: var(--vscode-fg-muted);
}
.directory-search input,
.model-search input {
  width: 100%;
  min-width: 0;
  border: 0;
  outline: 0;
  color: var(--vscode-fg);
  background: transparent;
  font: inherit;
  font-size: var(--prism-font-12);
}
input::placeholder {
  color: var(--vscode-fg-muted);
  opacity: 0.8;
}
.directory-search:focus-within,
.model-search:focus-within,
.key-input:focus-within {
  outline: 2px solid var(--vscode-accent);
  outline-offset: 2px;
}
.directory-filters {
  display: flex;
  gap: 5px;
  margin-top: 9px;
}
select {
  color: var(--vscode-fg-muted);
  border: 1px solid var(--vscode-border);
  background: var(--vscode-bg-input);
  border-radius: var(--prism-radius-control);
  padding: 6px 4px;
  min-width: 0;
  font: inherit;
  font-size: var(--prism-font-11);
}
.directory-filters select {
  width: 50%;
}
.directory-summary {
  display: flex;
  justify-content: space-between;
  padding: 22px 7px 10px;
  color: var(--vscode-fg-muted);
  font-size: var(--prism-font-11);
}
.provider-directory-list {
  overflow-y: auto;
  max-height: 595px;
  scrollbar-width: thin;
  scrollbar-color: var(--vscode-border) transparent;
}
.provider-choice {
  position: relative;
  display: flex;
  width: 100%;
  align-items: center;
  gap: 10px;
  padding: 11px 9px;
  border: 1px solid transparent;
  border-radius: 13px;
  background: transparent;
  color: var(--vscode-fg);
  text-align: left;
  cursor: pointer;
  margin-bottom: 3px;
  transition:
    background-color 140ms ease-out,
    border-color 140ms ease-out,
    transform 140ms var(--provider-enter-ease);
}
.provider-choice::after {
  content: '';
  position: absolute;
  inset: 17px auto 17px 0;
  width: 2px;
  border-radius: 2px;
  background: var(--vscode-accent);
  opacity: 0;
  transform: scaleY(0.4);
  transition:
    transform 180ms var(--provider-enter-ease),
    opacity 100ms ease-out;
  pointer-events: none;
}
.provider-choice.selected {
  background: var(--liquid-selected);
  border-color: var(--liquid-rim);
  box-shadow:
    inset 0 1px 0 var(--liquid-inner-light),
    0 3px 10px -7px var(--liquid-shadow);
}
.provider-choice.selected::after {
  transform: scaleY(1);
  opacity: 1;
}
.provider-glyph {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  border-radius: 10px;
  background: color-mix(in srgb, var(--vscode-accent) 9%, transparent);
  color: var(--vscode-accent);
  font-size: var(--prism-font-16);
}
.provider-choice-name {
  flex: 1;
  min-width: 0;
  font-size: var(--prism-font-12);
  font-weight: 550;
  overflow-wrap: anywhere;
}
.provider-choice-name small {
  display: block;
  margin-top: 3px;
  font-size: var(--prism-font-10);
  font-weight: 400;
  color: var(--vscode-fg-muted);
}
.connection-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--prism-success);
  box-shadow: 0 0 0 3px var(--prism-success-bg);
  flex-shrink: 0;
}
.configured-icon {
  color: var(--vscode-accent);
  font-size: var(--prism-font-15);
}
.directory-footnote {
  color: var(--vscode-fg-muted);
  font-size: var(--prism-font-10);
  text-align: center;
  margin: 14px 2px 0;
}
.provider-detail-stage {
  position: relative;
  display: grid;
  min-width: 0;
  align-content: start;
  --provider-panel-offset: 6px;
}
.provider-detail-stage[data-direction='backward'] {
  --provider-panel-offset: -6px;
}
.provider-detail,
.provider-panel-empty {
  grid-area: 1 / 1;
}
.provider-detail {
  min-width: 0;
  padding: 25px 26px 0;
  background: linear-gradient(145deg, var(--liquid-highlight), transparent 35%);
}
.provider-panel-enter-active {
  transition:
    opacity 160ms ease-out,
    transform 180ms var(--provider-enter-ease);
}
.provider-panel-leave-active {
  position: absolute;
  inset: 0 0 auto;
  pointer-events: none;
  transition:
    opacity 100ms ease-out,
    transform 140ms var(--provider-enter-ease);
}
.provider-panel-enter-from {
  opacity: 0;
  transform: translateY(var(--provider-panel-offset));
}
.provider-panel-leave-to {
  opacity: 0;
  transform: translateY(calc(-1 * var(--provider-panel-offset)));
}
.model-parameters-reveal {
  /* A deliberate accordion resize: native auto-size interpolation also retargets on interruption. */
  interpolate-size: allow-keywords;
  height: auto;
  overflow: clip;
}
.model-disclosure-enter-active,
.model-disclosure-leave-active {
  transition:
    height 220ms var(--provider-enter-ease),
    opacity 140ms ease-out;
}
.model-disclosure-enter-from,
.model-disclosure-leave-to {
  height: 0;
  opacity: 0;
}
.model-result-enter-active,
.model-result-leave-active {
  transition:
    opacity 140ms ease-out,
    transform 140ms var(--provider-enter-ease);
}
.model-result-enter-from,
.model-result-leave-to {
  opacity: 0;
  transform: translateY(-3px);
}
.provider-detail-heading {
  display: flex;
  align-items: center;
  gap: 13px;
}
.provider-emblem {
  display: grid;
  place-items: center;
  width: 46px;
  height: 46px;
  flex-shrink: 0;
  border-radius: 15px;
  border: 1px solid var(--liquid-rim);
  background: var(--liquid-selected);
  box-shadow: inset 0 1px 0 var(--liquid-inner-light);
  color: var(--vscode-accent);
  font-size: var(--prism-font-23);
}
.provider-title {
  flex: 1;
  min-width: 0;
}
.provider-title h3 {
  font-size: var(--prism-font-21);
  letter-spacing: -0.4px;
  font-weight: 650;
  margin: 0 0 4px;
  overflow-wrap: anywhere;
}
.provider-title p {
  margin: 0;
  color: var(--vscode-fg-muted);
  line-height: 1.6;
  font-size: var(--prism-font-11);
}
.glass-switch {
  position: relative;
  display: inline-flex;
  flex-shrink: 0;
  width: 32px;
  height: 19px;
}
.glass-switch input {
  position: absolute;
  opacity: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  cursor: pointer;
  z-index: 1;
}
.glass-switch > span {
  width: 100%;
  border-radius: 12px;
  background: color-mix(in srgb, var(--vscode-fg-muted) 26%, transparent);
  border: 1px solid var(--vscode-border);
  box-shadow: inset 0 1px 3px #0000000c;
  transition: background-color 160ms ease-out;
}
.glass-switch > span::after {
  content: '';
  display: block;
  width: 13px;
  height: 13px;
  margin: 2px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px #162c492a;
  transition: transform 180ms var(--provider-enter-ease);
}
.glass-switch input:checked + span {
  background: var(--vscode-accent);
  border-color: transparent;
}
.glass-switch input:checked + span::after {
  transform: translateX(13px);
}
.glass-switch input:focus-visible + span {
  outline: 2px solid var(--vscode-accent);
  outline-offset: 3px;
}
.glass-switch:has(input:disabled) {
  opacity: 0.45;
}
.glass-switch input:disabled {
  cursor: not-allowed;
}
.provider-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 11px;
  padding: 17px 0 20px;
}
.catalog-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 7px;
  border-radius: 6px;
  font-size: var(--prism-font-10);
  color: var(--vscode-fg-muted);
  background: var(--vscode-list-hoverBackground);
}
.catalog-badge.verified {
  color: var(--vscode-accent);
}
.verified-date {
  font-size: var(--prism-font-10);
  color: var(--vscode-fg-muted);
}
.provider-docs {
  margin-left: auto;
  display: inline-flex;
  gap: 4px;
  color: var(--vscode-accent);
  font-size: var(--prism-font-11);
  text-decoration: none;
}
.provider-notice {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0 0 20px;
  padding: 11px 12px;
  border-radius: 11px;
  background: var(--vscode-list-hoverBackground);
  border: 1px solid var(--vscode-border);
  color: var(--vscode-fg-muted);
  font-size: var(--prism-font-12);
  line-height: 1.7;
}
.provider-notice > i {
  flex-shrink: 0;
  margin-top: 1px;
}
.connection-settings {
  padding: 20px 0 18px;
  border-top: 1px solid var(--vscode-border-subtle);
}
.field-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 17px;
}
.field-heading h4,
.models-heading h4 {
  margin: 0;
  color: var(--vscode-fg);
  font-size: var(--prism-font-13);
  font-weight: 600;
}
.field-heading > span {
  font-size: var(--prism-font-11);
  color: var(--vscode-fg-muted);
}
.connection-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: var(--prism-font-11);
  color: var(--vscode-fg-muted);
}
.connection-field small {
  margin-left: 6px;
  font-size: var(--prism-font-10);
  font-weight: 400;
}
.connection-field > input,
.key-input {
  width: 100%;
  border: 1px solid var(--vscode-border);
  border-radius: 10px;
  background: var(--vscode-bg-input);
  color: var(--vscode-fg);
  font-size: var(--prism-font-12);
  box-sizing: border-box;
}
.connection-field > input {
  padding: 10px 12px;
  min-width: 0;
  font: inherit;
  font-size: var(--prism-font-12);
}
.key-input {
  display: flex;
  align-items: center;
}
.key-input input {
  flex: 1;
  width: 100%;
  min-width: 0;
  background: transparent;
  border: 0;
  outline: 0;
  padding: 10px 12px;
  color: var(--vscode-fg);
  font: inherit;
  font-size: var(--prism-font-12);
}
.key-input button {
  align-self: stretch;
  padding: 0 12px;
  border: 0;
  background: transparent;
  color: var(--vscode-fg-muted);
  cursor: pointer;
  border-radius: 0 9px 9px 0;
}
.field-hint {
  font-size: var(--prism-font-10);
  line-height: 1.6;
  color: var(--vscode-fg-muted);
  margin: 7px 0 16px;
}
.connection-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 10px;
}
.text-action {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font: inherit;
  font-size: var(--prism-font-11);
  color: var(--vscode-accent);
  border: 0;
  padding: 2px 0;
  background: transparent;
  cursor: pointer;
  text-decoration: none;
}
.muted-action {
  color: var(--vscode-fg-muted);
  margin-left: auto;
}
button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.provider-models {
  padding: 20px 0;
  border-top: 1px solid var(--vscode-border-subtle);
}
.models-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 15px;
}
.model-count {
  display: inline-block;
  font-size: var(--prism-font-10);
  padding: 1px 6px;
  margin-left: 7px;
  border-radius: 6px;
  background: var(--vscode-list-hoverBackground);
  color: var(--vscode-fg-muted);
}
.models-heading p {
  margin: 5px 0 0;
  font-size: var(--prism-font-10);
  color: var(--vscode-fg-muted);
}
.model-heading-actions {
  display: flex;
  gap: 6px;
}
.icon-action {
  display: inline-grid;
  place-items: center;
  width: 29px;
  height: 29px;
  border: 1px solid var(--vscode-border);
  background: var(--vscode-bg-input);
  border-radius: 9px;
  color: var(--vscode-fg-muted);
  cursor: pointer;
}
.model-search-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 9px;
}
.model-search {
  flex: 1;
  height: 33px;
  border-radius: 9px;
}
.model-search-row select {
  max-width: 130px;
  height: 33px;
}
.models-list {
  max-height: 445px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--vscode-border) transparent;
}
.model-entry {
  padding: 14px 0;
  border-bottom: 1px solid var(--vscode-border-subtle);
}
.model-entry:last-child {
  border-bottom: 0;
}
.model-main-row {
  display: flex;
  align-items: center;
  gap: 14px;
}
.model-identity {
  flex: 1;
  min-width: 0;
}
.model-name {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: var(--prism-font-12);
  font-weight: 600;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.model-name > i {
  color: var(--prism-warning);
  font-size: var(--prism-font-9);
  flex-shrink: 0;
}
.model-identity code {
  display: block;
  margin-top: 2px;
  font:
    var(--prism-font-10)/1.6 'Cascadia Code',
    Consolas,
    monospace;
  color: var(--vscode-fg-muted);
  overflow-wrap: anywhere;
  user-select: text;
}
.model-capabilities {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 10px;
  margin-top: 6px;
  color: var(--vscode-fg-muted);
  font-size: var(--prism-font-10);
}
.model-capabilities span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.model-capabilities > span:first-child {
  color: var(--vscode-accent);
}
.model-actions {
  display: flex;
  align-items: center;
  gap: 9px;
  flex-shrink: 0;
}
.model-parameter-button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--vscode-fg-muted);
  font: inherit;
  font-size: var(--prism-font-10);
  padding: 6px;
  cursor: pointer;
}
.model-parameter-button[aria-expanded='true'] {
  background: var(--vscode-list-hoverBackground);
  color: var(--vscode-accent);
}
.delete-model {
  background: transparent;
  border: 0;
  width: 23px;
  height: 26px;
  font-size: var(--prism-font-11);
}
.model-disabled .model-name,
.model-disabled .model-capabilities,
.model-disabled code {
  opacity: 0.58;
}
.model-test-result {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: var(--prism-font-11);
  line-height: 1.5;
  margin-top: 9px;
  overflow-wrap: anywhere;
  user-select: text;
}
.test-success {
  color: var(--prism-success);
}
.test-error {
  color: var(--vscode-errorForeground, #cb5b70);
}
.models-empty,
.directory-empty,
.provider-panel-empty {
  text-align: center;
  padding: 30px 12px;
  color: var(--vscode-fg-muted);
}
.models-empty > i,
.directory-empty > i,
.provider-panel-empty > i {
  font-size: var(--prism-font-25);
  opacity: 0.55;
}
.models-empty p,
.directory-empty p,
.provider-panel-empty p {
  margin: 11px 0 7px;
  font-size: var(--prism-font-12);
}
.models-empty > span {
  display: block;
  max-width: 310px;
  margin: auto;
  font-size: var(--prism-font-11);
  line-height: 1.8;
}
.provider-panel-empty {
  align-self: center;
}
.provider-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  border-top: 1px solid var(--vscode-border-subtle);
  padding: 16px 0 20px;
}
.provider-footer p {
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 0;
  color: var(--vscode-fg-muted);
  font-size: var(--prism-font-10);
  line-height: 1.6;
}
.test-connection {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  flex-shrink: 0;
  padding: 9px 12px;
  border: 1px solid color-mix(in srgb, var(--vscode-accent) 45%, transparent);
  border-radius: 11px;
  background: color-mix(in srgb, var(--vscode-accent) 11%, var(--liquid-selected));
  box-shadow: inset 0 1px 0 var(--liquid-inner-light);
  color: var(--vscode-accent);
  font: inherit;
  font-size: var(--prism-font-11);
  font-weight: 550;
  cursor: pointer;
}
.test-connection > span {
  display: inline-grid;
  place-items: center;
  min-width: 16px;
  height: 16px;
  border-radius: 5px;
  background: color-mix(in srgb, var(--vscode-accent) 10%, transparent);
  font-size: var(--prism-font-10);
}
.icon-action,
.model-parameter-button,
.test-connection,
.text-action {
  touch-action: manipulation;
  transition:
    transform 140ms var(--provider-enter-ease),
    background-color 140ms ease-out,
    color 140ms ease-out,
    border-color 140ms ease-out;
}
.provider-choice:not(:disabled):active,
.icon-action:not(:disabled):active,
.model-parameter-button:not(:disabled):active,
.test-connection:not(:disabled):active,
.text-action:not(:disabled):active {
  transform: scale(0.98);
  transition-duration: 0s;
}
@media (hover: hover) and (pointer: fine) {
  .provider-choice:not(.selected):hover {
    background: var(--vscode-list-hoverBackground);
  }
  .test-connection:not(:disabled):hover {
    transform: translateY(-1px);
  }
  .test-connection:not(:disabled):active {
    transform: scale(0.98);
  }
  .icon-action:hover:not(:disabled) {
    color: var(--vscode-accent);
    border-color: var(--vscode-accent);
  }
  .model-parameter-button:hover {
    background: var(--vscode-list-hoverBackground);
    color: var(--vscode-accent);
  }
}
button:focus-visible,
a:focus-visible,
select:focus-visible,
.connection-field > input:focus-visible {
  outline: 2px solid var(--vscode-accent);
  outline-offset: 3px;
}
.spinning {
  animation: provider-spin 1s linear infinite;
}
@keyframes provider-spin {
  to {
    transform: rotate(360deg);
  }
}
@container (max-width: 760px) {
  .provider-workspace {
    grid-template-columns: 180px minmax(0, 1fr);
  }
  .provider-detail {
    padding: 20px 18px 0;
  }
  .provider-footer {
    align-items: flex-start;
    flex-direction: column;
  }
  .provider-footer .test-connection {
    align-self: flex-end;
  }
  .model-parameter-button span {
    display: none;
  }
  .model-actions {
    gap: 5px;
  }
  .provider-emblem {
    width: 36px;
    height: 36px;
    border-radius: 12px;
    font-size: var(--prism-font-19);
  }
  .verified-date {
    display: none;
  }
}
@container (max-width: 560px) {
  .ai-settings-heading {
    gap: 10px;
  }
  .saved-note {
    font-size: 0;
  }
  .saved-note i {
    font-size: var(--prism-font-14);
  }
  .provider-workspace {
    display: flex;
    flex-direction: column;
    border-radius: 18px;
    min-height: 0;
  }
  .provider-directory {
    border-right: 0;
    border-bottom: 1px solid var(--vscode-border-subtle);
    padding: 14px;
  }
  .provider-directory-list {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    overflow-y: hidden;
    max-height: 90px;
  }
  .provider-choice {
    min-width: 180px;
    width: 180px;
    margin-bottom: 0;
  }
  .provider-directory .directory-summary {
    padding-top: 14px;
  }
  .directory-footnote {
    display: none;
  }
  .provider-detail {
    padding: 20px 16px 0;
  }
  .provider-title h3 {
    font-size: var(--prism-font-19);
  }
  .provider-title p {
    font-size: var(--prism-font-11);
  }
  .provider-footer {
    flex-direction: row;
    align-items: center;
  }
  .provider-footer p {
    max-width: 130px;
  }
  .model-main-row {
    gap: 7px;
  }
  .model-search-row select {
    max-width: 110px;
  }
}
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    transition-property: opacity, background-color, color, border-color !important;
    transition-duration: 80ms !important;
  }
  .provider-panel-enter-from,
  .provider-panel-leave-to,
  .model-result-enter-from,
  .model-result-leave-to,
  button:not(:disabled):is(:active, :hover) {
    transform: none !important;
  }
  .spinning {
    animation-play-state: paused;
  }
}
html[data-motion='off'] .ai-settings *,
html[data-motion='off'] .ai-settings *::before,
html[data-motion='off'] .ai-settings *::after,
html[data-transitions='off'] .ai-settings *,
html[data-transitions='off'] .ai-settings *::before,
html[data-transitions='off'] .ai-settings *::after {
  transition: none !important;
}
html[data-motion='off'] .ai-settings .spinning,
html[data-transitions='off'] .ai-settings .spinning {
  animation-play-state: paused;
}
html[data-motion='off'] .ai-settings button:not(:disabled):is(:active, :hover),
html[data-transitions='off'] .ai-settings button:not(:disabled):is(:active, :hover) {
  transform: none;
}
html[data-motion='off'] .provider-panel-enter-from,
html[data-motion='off'] .model-result-enter-from,
html[data-transitions='off'] .provider-panel-enter-from,
html[data-transitions='off'] .model-result-enter-from {
  opacity: 1;
  transform: none;
}
html[data-motion='off'] .model-disclosure-enter-from,
html[data-transitions='off'] .model-disclosure-enter-from {
  height: auto;
  opacity: 1;
}
html[data-motion='off'] .provider-panel-leave-active,
html[data-transitions='off'] .provider-panel-leave-active {
  opacity: 0;
  transform: none;
}
@supports not (backdrop-filter: blur(1px)) {
  .provider-workspace {
    background: var(--liquid-panel-solid, var(--vscode-bg));
  }
}
</style>
