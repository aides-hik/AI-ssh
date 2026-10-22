import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildTitleBarModels,
  resolveSelectedTitleBarModel
} from './titlebar-models.ts'

test('buildTitleBarModels includes enabled configured providers', () => {
  const models = buildTitleBarModels([
    {
      id: 'openrouter',
      name: 'OpenRouter',
      enabled: true,
      apiKey: 'user-key',
      models: [{ id: 'openrouter/moe-256b', name: 'Qualified', enabled: true }]
    },
    {
      id: 'custom-openai',
      name: 'Custom',
      enabled: true,
      apiKey: 'user-key',
      models: [{ id: 'gpt-4', name: 'GPT-4', enabled: true }]
    }
  ])

  assert.deepEqual(
    models.map(model => ({ id: model.id, providerId: model.providerId })),
    [
      { id: 'openrouter/moe-256b', providerId: 'openrouter' },
      { id: 'gpt-4', providerId: 'custom-openai' }
    ]
  )
})

test('resolveSelectedTitleBarModel clears stale selection when model no longer exists', () => {
  const result = resolveSelectedTitleBarModel(
    [
      {
        id: 'gpt-4',
        name: 'GPT-4',
        shortName: 'GPT-4',
        providerId: 'custom-openai',
        providerName: 'Custom'
      }
    ],
    JSON.stringify({
      provider: { id: 'openrouter' },
      model: { id: 'openrouter/moe-256b' }
    })
  )

  assert.equal(result.model, null)
  assert.equal(result.shouldClear, true)
  assert.equal(result.shouldPersist, false)
})

test('retired provider configs never become available models', () => {
  const models = buildTitleBarModels([
    { id: 'official', name: 'Retired', enabled: true, apiKey: 'old-key', models: [{ id: 'old-model', name: 'Old' }] },
    { id: 'legacy-alias', name: 'Retired alias', enabled: true, apiKey: 'old-key', config: { runtimeProviderId: 'official' }, models: [{ id: 'old-model', name: 'Old' }] },
    { id: 'ollama', name: 'Local Ollama', enabled: true, models: [{ id: 'local-model', name: 'Local' }] }
  ])
  assert.deepEqual(models.map(model => model.providerId), ['ollama'])
})

test('cached retired model selections are cleared even when IDs match a local model', () => {
  const local = { id: 'same-model', name: 'Own model', shortName: 'Own', providerId: 'custom-openai', providerName: 'Own server' }
  for (const saved of [
    { source: 'official', providerId: 'custom-openai', modelId: 'same-model' },
    { providerId: 'official', modelId: 'same-model' },
    { provider: { id: 'custom-openai', config: { runtimeProviderId: 'official' } }, model: { id: 'same-model' } }
  ]) {
    const result = resolveSelectedTitleBarModel([local], JSON.stringify(saved))
    assert.equal(result.model, null)
    assert.equal(result.shouldClear, true)
  }
})
