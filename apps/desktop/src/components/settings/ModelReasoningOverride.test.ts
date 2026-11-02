import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { ref, reactive, computed, watch, nextTick, effectScope } from 'vue'
import { getModelAPIStyle } from '../../utils/model-capabilities'
import type {
  AIModel,
  AIProvider,
  ModelReasoningConfig,
  ReasoningEffort
} from '../../types/ai-providers.types'

type Override = ModelReasoningConfig | false | undefined
const model = (): AIModel => ({
  id: 'my-alias',
  name: 'My alias',
  providerId: 'custom',
  contextWindow: 8192,
  capabilities: { text: true, image: false, vision: false, functionCall: true }
})
const provider = (id = 'custom', endpoint = 'https://fixture.invalid/v1'): AIProvider => ({
  id,
  endpoint,
  name: id,
  description: '',
  icon: '',
  website: '',
  apiKey: '',
  enabled: true,
  isDefault: false,
  models: []
})
const event = (value: string, checked?: boolean) =>
  ({ target: { value, checked } }) as unknown as Event

async function editor(initial: Partial<AIModel> = {}, currentProvider = provider()) {
  const source = await readFile(new URL('./ModelReasoningOverride.vue', import.meta.url), 'utf8')
  const script = source.match(/<script setup[^>]*>([\s\S]*?)<\/script>/)?.[1]
  assert(script)
  const parsed = ts.createSourceFile('editor.ts', script, ts.ScriptTarget.Latest, true)
  const declarations = parsed.statements.filter(
    statement =>
      !ts.isImportDeclaration(statement) &&
      !(
        ts.isVariableStatement(statement) &&
        statement.declarationList.declarations.some(declaration =>
          ['props', 'emit'].includes(declaration.name.getText(parsed))
        )
      )
  )
  const javascript = ts.transpileModule(
    declarations.map(statement => statement.getText(parsed)).join('\n'),
    {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }
  ).outputText
  const props = reactive({
    id: 'parameters-custom-my-alias',
    provider: currentProvider,
    model: { ...model(), ...initial },
    disabled: false
  })
  const emitted: Override[] = []
  const scope = effectScope()
  const ui = scope.run(() =>
    new Function(
      'props',
      'emit',
      'ref',
      'computed',
      'watch',
      'useI18n',
      'getModelAPIStyle',
      `${javascript}
    return { mode, protocol, protocols, efforts, supportsToggle, mandatory, thinkingMode, valid, changeMode, changeProtocol, toggleEffort, applyOverride }`
    )(
      props,
      (_name: string, value: Override) => {
        emitted.push(value)
        props.model.reasoningOverride = value
      },
      ref,
      computed,
      watch,
      () => ({ locale: ref('zh-CN') }),
      getModelAPIStyle
    )
  ) as {
    mode: { value: string }
    protocol: { value: string }
    protocols: { value: string[] }
    efforts: { value: ReasoningEffort[] }
    supportsToggle: { value: boolean }
    mandatory: { value: boolean }
    thinkingMode: { value: string }
    valid: { value: boolean }
    changeMode: (event: Event) => void
    changeProtocol: (event: Event) => void
    toggleEffort: (effort: ReasoningEffort, event: Event) => void
    applyOverride: () => void
  }
  return { ...ui, props, emitted, dispose: () => scope.stop() }
}

test('an unknown alias starts automatic and manual drafts emit only explicitly selected levels on Apply', async context => {
  const ui = await editor()
  context.after(ui.dispose)
  assert.equal(ui.mode.value, 'auto')
  ui.changeMode(event('manual'))
  assert.equal(ui.valid.value, false)
  ui.applyOverride()
  assert.deepEqual(ui.emitted, [])
  ui.toggleEffort('high', event('high', true))
  assert.equal(ui.valid.value, true)
  assert.deepEqual(ui.emitted, [])
  ui.applyOverride()
  assert.deepEqual(ui.emitted, [{ protocol: 'openai', supportedEfforts: ['high'] }])
})

test('automatic and disabled preserve service metadata and generation defaults', async context => {
  const reasoning: ModelReasoningConfig = { protocol: 'openai', supportedEfforts: ['low', 'high'] }
  const ui = await editor({
    reasoning,
    reasoningOverride: { protocol: 'openai', supportedEfforts: ['high'] },
    requestConfig: { maxTokens: 1200, reasoning: 'high' }
  })
  context.after(ui.dispose)
  ui.changeMode(event('disabled'))
  assert.equal(ui.emitted.at(-1), false)
  await nextTick()
  ui.changeMode(event('auto'))
  assert.equal(ui.emitted.at(-1), undefined)
  assert.deepEqual(ui.props.model.reasoning, reasoning)
  assert.deepEqual(ui.props.model.requestConfig, { maxTokens: 1200, reasoning: 'high' })
})

test('switching request formats never silently inherits the previous format levels', async context => {
  const ui = await editor({ reasoningOverride: { protocol: 'openai', supportedEfforts: ['high'] } })
  context.after(ui.dispose)
  ui.changeProtocol(event('qwen'))
  assert.deepEqual(ui.efforts.value, [])
  assert.equal(ui.valid.value, false)
  ui.supportsToggle.value = true
  ui.applyOverride()
  assert.deepEqual(ui.emitted, [{ protocol: 'qwen', supportsToggle: true }])
})

test('required thinking cannot emit an off level and invalid manual drafts leave saved values intact', async context => {
  const saved: ModelReasoningConfig = { protocol: 'deepseek', supportedEfforts: ['high'] }
  const ui = await editor({ reasoningOverride: saved })
  context.after(ui.dispose)
  ui.efforts.value = ['none', 'low']
  ui.mandatory.value = true
  ui.applyOverride()
  assert.deepEqual(ui.emitted, [
    { protocol: 'deepseek', supportedEfforts: ['low'], mandatory: true }
  ])
  await nextTick()
  ui.efforts.value = []
  ui.applyOverride()
  assert.equal(ui.emitted.length, 1)
  assert.deepEqual(ui.props.model.reasoningOverride, ui.emitted[0])
})

test('Claude configuration is available only through native Claude Messages', async context => {
  const gateway = await editor()
  context.after(gateway.dispose)
  assert(!gateway.protocols.value.includes('anthropic'))
  gateway.changeMode(event('manual'))
  gateway.changeProtocol(event('anthropic'))
  assert.equal(gateway.protocol.value, 'openai')
  const native = await editor({}, provider('anthropic', 'https://api.anthropic.com/v1'))
  context.after(native.dispose)
  assert.deepEqual(native.protocols.value, ['anthropic'])
  native.changeMode(event('manual'))
  native.thinkingMode.value = 'budget'
  native.toggleEffort('low', event('low', true))
  native.applyOverride()
  assert.deepEqual(native.emitted, [
    { protocol: 'anthropic', supportedEfforts: ['low'], thinkingMode: 'budget' }
  ])
})

test('native and compatible Ollama models can declare their actual thinking toggle', async context => {
  for (const endpoint of ['http://127.0.0.1:11434', 'http://127.0.0.1:11434/v1']) {
    const ui = await editor({}, provider('ollama', endpoint))
    context.after(ui.dispose)
    assert.deepEqual(ui.protocols.value, ['ollama'])
    ui.changeMode(event('manual'))
    ui.supportsToggle.value = true
    ui.applyOverride()
    assert.deepEqual(ui.emitted, [{ protocol: 'ollama', supportsToggle: true }])
  }
})

test('disabled controls emit nothing and changing model resets unsaved drafts', async context => {
  const ui = await editor()
  context.after(ui.dispose)
  ui.props.disabled = true
  ui.changeMode(event('manual'))
  ui.changeProtocol(event('qwen'))
  ui.toggleEffort('high', event('high', true))
  ui.applyOverride()
  assert.deepEqual(ui.emitted, [])
  assert.equal(ui.mode.value, 'auto')
  ui.props.disabled = false
  ui.changeMode(event('manual'))
  ui.toggleEffort('high', event('high', true))
  ui.props.model = { ...model(), id: 'another-alias', reasoningOverride: false }
  await nextTick()
  assert.equal(ui.mode.value, 'disabled')
  assert.deepEqual(ui.efforts.value, [])
  assert.deepEqual(ui.emitted, [])
})

test('editing declared levels does not mutate saved override arrays before Apply', async context => {
  const initial: ModelReasoningConfig = { protocol: 'openai', supportedEfforts: ['low'] }
  const ui = await editor({ reasoningOverride: initial })
  context.after(ui.dispose)
  ui.toggleEffort('high', event('high', true))
  assert.deepEqual(initial.supportedEfforts, ['low'])
  assert.deepEqual(ui.props.model.reasoningOverride, initial)
  ui.applyOverride()
  assert.deepEqual(initial.supportedEfforts, ['low'])
  assert.deepEqual(ui.emitted[0], { protocol: 'openai', supportedEfforts: ['low', 'high'] })
})

test('Responses only offers its implemented OpenAI reasoning format', async context => {
  const ui = await editor({ parameters: { apiStyle: 'responses' } })
  context.after(ui.dispose)
  assert.deepEqual(ui.protocols.value, ['openai'])
  ui.changeMode(event('manual'))
  for (const format of ['deepseek', 'qwen', 'gemini', 'ollama', 'anthropic']) {
    ui.changeProtocol(event(format))
    assert.equal(ui.protocol.value, 'openai')
  }
  ui.toggleEffort('high', event('high', true))
  ui.applyOverride()
  assert.deepEqual(ui.emitted, [{ protocol: 'openai', supportedEfforts: ['high'] }])
})

test('native Gemini thinking levels exclude off and unsupported effort levels outside 2.5 budgets', async context => {
  for (const id of ['models/gemini-3-pro-preview', 'gemini-4-argon', 'deployment-alias']) {
    const ui = await editor(
      { id },
      provider('google', 'https://generativelanguage.googleapis.com/v1beta')
    )
    context.after(ui.dispose)
    ui.changeMode(event('manual'))
    assert.equal(ui.protocol.value, 'gemini')
    for (const level of ['none', 'xhigh', 'max'] as const)
      ui.toggleEffort(level, event(level, true))
    assert.deepEqual(ui.efforts.value, [])
    assert.equal(ui.valid.value, false)
    ui.toggleEffort('minimal', event('minimal', true))
    ui.applyOverride()
    assert.deepEqual(ui.emitted, [{ protocol: 'gemini', supportedEfforts: ['minimal'] }])
  }
})

test('Gemini 2.5 budget and compatibility requests can explicitly declare off without xhigh or max', async context => {
  for (const [id, currentProvider] of [
    [
      'models/gemini-2.5-flash',
      provider('google', 'https://generativelanguage.googleapis.com/v1beta')
    ],
    [
      'gemini-3-flash-preview',
      provider('google', 'https://generativelanguage.googleapis.com/v1beta/openai')
    ]
  ] as const) {
    const ui = await editor({ id }, currentProvider)
    context.after(ui.dispose)
    ui.changeMode(event('manual'))
    ui.changeProtocol(event('gemini'))
    for (const level of ['none', 'xhigh', 'max'] as const)
      ui.toggleEffort(level, event(level, true))
    ui.applyOverride()
    assert.deepEqual(ui.emitted, [{ protocol: 'gemini', supportedEfforts: ['none'] }])
  }
})
