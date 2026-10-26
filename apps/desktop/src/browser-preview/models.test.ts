import assert from 'node:assert/strict'
import test from 'node:test'
import { installPreviewModels, PREVIEW_PROVIDER } from './models'
import { resolveSelectedModel } from '../services/selected-model-resolver.service'
import { getReasoningCapability } from '../utils/model-reasoning'

function storage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    }
  }
}

function settingsFrom(saved: ReturnType<typeof storage>) {
  const raw = saved.getItem('app-settings')
  assert.ok(raw)
  return JSON.parse(raw)
}

test('preview model setup preserves existing providers, settings, selection and reasoning preferences', () => {
  const settings = {
    theme: 'light',
    language: 'en-US',
    aiProviders: [{ id: 'custom-openai', name: 'Existing', enabled: false, models: [] }]
  }
  const existingSelection = JSON.stringify({
    providerId: 'custom-openai',
    modelId: 'existing-model'
  })
  const initial = {
    'app-settings': JSON.stringify(settings),
    selectedAIModel: existingSelection,
    'prism.reasoning-preferences.v1': '{"existing":"high"}'
  }
  const saved = storage(initial)
  installPreviewModels(saved)
  const after = settingsFrom(saved)
  assert.deepEqual({ ...after, aiProviders: after.aiProviders.slice(0, -1) }, settings)
  assert.equal(after.aiProviders.at(-1).id, PREVIEW_PROVIDER.id)
  assert.equal(saved.getItem('selectedAIModel'), existingSelection)
  assert.equal(
    saved.getItem('prism.reasoning-preferences.v1'),
    initial['prism.reasoning-preferences.v1']
  )
  const first = saved.getItem('app-settings')
  installPreviewModels(saved)
  assert.equal(saved.getItem('app-settings'), first)
})

test('fresh preview selection resolves through the actual model resolver with distinct reasoning controls', () => {
  const saved = storage()
  installPreviewModels(saved)
  const { aiProviders } = settingsFrom(saved)
  const selected = resolveSelectedModel(saved.getItem('selectedAIModel'), aiProviders)
  assert.equal(selected?.modelId, 'preview-pro')
  const actual = PREVIEW_PROVIDER.models.map(model => {
    const selection = resolveSelectedModel(
      JSON.stringify({ providerId: PREVIEW_PROVIDER.id, modelId: model.id }),
      aiProviders
    )
    assert.ok(selection?.model)
    const capability = getReasoningCapability(selection.provider, selection.model)
    return { kind: capability.kind, options: capability.options }
  })
  assert.deepEqual(actual, [
    { kind: 'effort', options: ['default', 'none', 'low', 'medium', 'high', 'xhigh', 'max'] },
    { kind: 'effort', options: ['default', 'low', 'medium', 'high'] },
    { kind: 'toggle', options: ['none', 'enabled'] },
    { kind: 'unsupported', options: ['default'] }
  ])
  installPreviewModels(saved)
  assert.equal(settingsFrom(saved).aiProviders.length, 1)
})

test('preview seeding leaves malformed settings untouched', () => {
  for (const raw of ['{broken', 'null', '[]', '{"aiProviders":{}}']) {
    const saved = storage({ 'app-settings': raw })
    installPreviewModels(saved)
    assert.equal(saved.getItem('app-settings'), raw)
    assert.equal(saved.getItem('selectedAIModel'), null)
  }
})
