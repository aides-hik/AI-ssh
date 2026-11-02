import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { ref, computed, watch, effectScope } from 'vue'
import type { UpdateClientState } from '../services/update-client'
import type { AIModel, AIProvider } from '../types/ai-providers.types'

const currentDir = dirname(fileURLToPath(import.meta.url))
const settingsViewPath = join(currentDir, 'SettingsView.vue')
const providerSettingsPath = join(
  currentDir,
  '..',
  'components',
  'settings',
  'SettingsAiProviders.vue'
)
const platformProvidersPath = join(currentDir, '..', 'types', 'ai-providers.platforms.ts')

test('settings view only shows delete action for custom models and marks added models', async () => {
  const source = await readFile(settingsViewPath, 'utf8')
  const providerSettings = await readFile(providerSettingsPath, 'utf8')

  assert.match(
    providerSettings,
    /v-if="model\.isCustom === true \|\| selected\.id === 'custom-openai'"/
  )
  assert.match(providerSettings, /@click="emit\('remove', selected\.id, model\.id\)"/)
  assert.match(source, /@remove="removeCustomModel"/)
  assert.match(source, /isCustom: true/)
  assert.match(source, /provider\.id !== 'custom-openai' && model\.isCustom !== true/)
  assert.match(source, /const removeCustomModel = async \(providerId: string, modelId: string\) =>/)
})

test('custom-openai provider ships without default models', async () => {
  const source = await readFile(platformProvidersPath, 'utf8')

  assert.match(source, /id: 'custom-openai'[\s\S]*models: \[\]/)
  assert.doesNotMatch(source, /id: 'custom-openai'[\s\S]*gpt-4/)
})

async function updaterActions() {
  const source = await readFile(settingsViewPath, 'utf8')
  const script = source.match(/<script setup[^>]*>([\s\S]*?)<\/script>/)?.[1]
  assert(script)
  const parsed = ts.createSourceFile('settings.ts', script, ts.ScriptTarget.Latest, true)
  const names = ['updaterActionError', 'updaterActionPending', 'updaterCancelling', 'updaterActionGeneration',
    'updaterBusy', 'updaterCancellable', 'updaterStatusText', 'refreshUpdateState', 'cancelUpdateCheck', 'installDownloadedUpdate']
  const declarations = names.map(name => {
    const node = parsed.statements.find(statement => ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.some(declaration => declaration.name.getText(parsed) === name))
    assert(node)
    return node.getText(parsed)
  })
  const clearErrorWatch = parsed.statements.find(statement => ts.isExpressionStatement(statement) &&
    ts.isCallExpression(statement.expression) && statement.expression.expression.getText(parsed) === 'watch' &&
    statement.expression.arguments[0]?.getText(parsed).startsWith('[() => updaterState.value.status'))
  assert(clearErrorWatch)
  declarations.push(clearErrorWatch.getText(parsed))
  const javascript = ts.transpileModule(declarations.join('\n'), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS
  } }).outputText
  const updaterState = ref<UpdateClientState>({ enabled: true, status: 'idle', currentVersion: '1' })
  const updater = {
    startBackgroundCheck: async () => {}, cancelBackgroundCheck: async () => {}, installDownloadedUpdate: async () => {}
  }
  const scope = effectScope()
  const handlers = scope.run(() => new Function('ref', 'computed', 'watch', 'updaterState', 'updater', 'window',
    `${javascript}\nreturn { ${names.filter(name => name !== 'updaterActionGeneration').join(', ')} }`)(
    ref, computed, watch, updaterState, updater, { electronAPI: { updater: {} } }
  )) as { updaterActionError: { value: string }; updaterBusy: { value: boolean }; updaterCancelling: { value: boolean };
    refreshUpdateState: () => Promise<void>; cancelUpdateCheck: () => Promise<void>; installDownloadedUpdate: () => Promise<void> }
  return { ...handlers, updater, updaterState, dispose: () => scope.stop() }
}

test('settings cancellation serializes user actions and a retry clears the previous failure', async context => {
  const ui = await updaterActions()
  context.after(ui.dispose)
  ui.updaterState.value.status = 'downloading'
  let reject!: (error: Error) => void
  let cancellations = 0
  let checks = 0
  ui.updater.cancelBackgroundCheck = () => { cancellations++; return new Promise((_resolve, fail) => { reject = fail }) }
  ui.updater.startBackgroundCheck = async () => { checks++ }
  const cancellation = ui.cancelUpdateCheck()
  await ui.cancelUpdateCheck()
  await ui.refreshUpdateState()
  assert.equal(cancellations, 1)
  assert.equal(checks, 0)
  assert.equal(ui.updaterCancelling.value, true)
  reject(new Error('cancel IPC failed'))
  await cancellation
  assert.match(ui.updaterActionError.value, /cancel IPC failed/)
  assert.equal(ui.updaterCancelling.value, false)
  ui.updaterState.value.status = 'error'
  await ui.refreshUpdateState()
  assert.equal(checks, 1)
  assert.equal(ui.updaterActionError.value, '')
})

test('settings installation requires a verified package, prevents double clicks and permits retry', async context => {
  const ui = await updaterActions()
  context.after(ui.dispose)
  let installs = 0
  let reject!: (error: Error) => void
  ui.updater.installDownloadedUpdate = () => { installs++; return new Promise((_resolve, fail) => { reject = fail }) }
  for (const status of ['idle', 'checking', 'downloading', 'error', 'installing']) {
    ui.updaterState.value.status = status
    await ui.installDownloadedUpdate()
  }
  assert.equal(installs, 0)
  ui.updaterState.value.status = 'downloaded'
  const first = ui.installDownloadedUpdate()
  await ui.installDownloadedUpdate()
  assert.equal(installs, 1)
  reject(new Error('launch failed'))
  await first
  assert.match(ui.updaterActionError.value, /launch failed/)
  ui.updater.installDownloadedUpdate = async () => { installs++ }
  await ui.installDownloadedUpdate()
  assert.equal(installs, 2)
  assert.equal(ui.updaterActionError.value, '')
})

test('a shared update started from another view clears stale settings action feedback', async context => {
  const ui = await updaterActions()
  context.after(ui.dispose)
  ui.updaterActionError.value = 'old installation failure'
  ui.updaterState.value.status = 'checking'
  assert.equal(ui.updaterActionError.value, '')
  ui.updaterActionError.value = 'old version failure'
  ui.updaterState.value.availableVersion = '2'
  assert.equal(ui.updaterActionError.value, '')
})

function reasoningProvider(): AIProvider {
  return {
    id: 'custom', name: 'Custom', description: '', website: '', icon: '', apiKey: 'fixture-only',
    endpoint: 'https://fixture.invalid/v1', enabled: true, isDefault: false,
    models: [{
      id: 'alias', name: 'Alias', providerId: 'custom', contextWindow: 8192,
      capabilities: { text: true, image: false, vision: false, functionCall: true }, enabled: true,
      reasoning: { protocol: 'openai', supportedEfforts: ['low'] },
      reasoningOverride: { protocol: 'openai', supportedEfforts: ['high'] },
      requestConfig: { maxTokens: 1500, reasoning: 'high' }
    }]
  }
}

async function extractDeclarations(filename: string, names: string[]) {
  const source = await readFile(filename, 'utf8')
  const script = source.match(/<script setup[^>]*>([\s\S]*?)<\/script>/)?.[1]
  assert(script)
  const parsed = ts.createSourceFile('settings.ts', script, ts.ScriptTarget.Latest, true)
  const statements = names.map(name => {
    const statement = parsed.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === name ||
      ts.isVariableStatement(item) && item.declarationList.declarations.some(declaration => declaration.name.getText(parsed) === name))
    assert(statement, `Missing declaration ${name}`)
    return statement.getText(parsed)
  })
  return ts.transpileModule(statements.join('\n'), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS
  } }).outputText
}

test('refreshing model metadata preserves manual reasoning capability and request defaults', async () => {
  const javascript = await extractDeclarations(settingsViewPath, ['refreshModelList'])
  const current = reasoningProvider()
  const expectedRequest = structuredClone(current.models[0].requestConfig)
  const providers = ref([current])
  const fetched: AIModel = { ...current.models[0], reasoning: { protocol: 'openai', supportedEfforts: ['low', 'medium'] }, reasoningOverride: false, requestConfig: undefined }
  let saves = 0
  const refresh = new Function('fetchingModels', 'getRuntimeProviderId', 'showNotification', 'fetchModelsForProvider', 'aiProviders', 'saveAIProviderConfigs',
    `${javascript}\nreturn refreshModelList`)(
      ref({}), (provider: AIProvider) => provider.id, () => {}, async () => ({ success: true, models: [fetched] }),
      providers, async () => { saves++; return true }
    ) as (provider: AIProvider) => Promise<void>
  const overrides: AIModel['reasoningOverride'][] = [{ protocol: 'openai', supportedEfforts: ['high'] }, false, undefined]
  for (const override of overrides) {
    providers.value[0].models[0].reasoningOverride = override
    await refresh(providers.value[0])
    const savedModel = providers.value[0].models[0]
    assert.deepEqual(savedModel.reasoning, fetched.reasoning)
    assert.deepEqual(savedModel.reasoningOverride, override)
    assert.deepEqual(savedModel.requestConfig, expectedRequest)
    assert.equal(savedModel.enabled, true)
  }
  assert.equal(saves, 3)
})

test('the model override event changes only the selected model and automatic mode leaves API metadata intact', async () => {
  const javascript = await extractDeclarations(providerSettingsPath, ['patchProvider', 'patchModel'])
  const current = reasoningProvider()
  const other = { ...reasoningProvider(), id: 'other' }
  const providers = ref([current, other])
  const selectedId = ref('custom')
  const selected = computed(() => providers.value.find(provider => provider.id === selectedId.value))
  const patch = new Function('providers', 'selectedId', 'selected', `${javascript}\nreturn patchModel`)(providers, selectedId, selected) as (id: string, patch: Partial<AIModel>) => void
  patch('alias', { reasoningOverride: false })
  assert.equal(providers.value[0].models[0].reasoningOverride, false)
  assert.deepEqual(providers.value[1].models[0].reasoningOverride, other.models[0].reasoningOverride)
  patch('alias', { reasoningOverride: undefined })
  assert.equal(providers.value[0].models[0].reasoningOverride, undefined)
  assert.deepEqual(providers.value[0].models[0].reasoning, current.models[0].reasoning)
  assert.deepEqual(providers.value[0].models[0].requestConfig, current.models[0].requestConfig)
  const source = await readFile(providerSettingsPath, 'utf8')
  assert.match(source, /@reasoning-override="reasoningOverride => patchModel\(model\.id, \{ reasoningOverride \}\)"/)
})
