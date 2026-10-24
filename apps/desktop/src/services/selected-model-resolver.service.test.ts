import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveSelectedModel } from './selected-model-resolver.service.ts'

test('retired managed models cannot be restored from either persisted selection format', () => {
  for (const selection of [
    { source: 'official', providerId: 'official', modelId: 'retired' },
    { provider: { id: 'official' }, model: { id: 'retired' } },
    { provider: { id: 'old-alias', config: { runtimeProviderId: 'official' } }, model: { id: 'retired' } },
    { provider: { id: 'openai', endpoint: 'https://api.tx07.cn/v1' }, model: { id: 'retired' } }
  ]) {
    assert.equal(resolveSelectedModel(JSON.stringify(selection), []), null)
  }
})

test('custom endpoint and API key remain usable in a full local model selection', () => {
  const provider = {
    id: 'custom-openai',
    name: 'Own model server',
    endpoint: 'http://127.0.0.1:8080/v1',
    apiKey: 'own-key',
    enabled: true
  }
  const model = { id: 'own-model', name: 'Own model' }
  const selected = resolveSelectedModel(JSON.stringify({ source: 'local', provider, model }), [])
  assert.equal(selected?.source, 'local')
  assert.deepEqual(selected?.provider, provider)
  assert.deepEqual(selected?.model, model)
})

test('ID-only model selections preserve the current user-supplied endpoint', () => {
  const model = {
    id: 'custom-model', name: 'Custom model', providerId: 'openai', contextWindow: 4096,
    capabilities: { text: true, image: false, functionCall: true, vision: false }
  }
  const selected = resolveSelectedModel(JSON.stringify({ providerId: 'openai', modelId: model.id }), [{
    id: 'openai', name: 'Own OpenAI compatible server', enabled: true,
    endpoint: 'http://127.0.0.1:8080/v1', apiKey: 'own-key', models: [model]
  }])
  assert.equal(selected?.provider?.endpoint, 'http://127.0.0.1:8080/v1')
  assert.equal(selected?.provider?.apiKey, 'own-key')
})

test('full snapshots resolve current settings and cannot restore stale credentials or sampling defaults', () => {
  const model = {
    id: 'my-model', name: 'Current', providerId: 'custom-openai', contextWindow: 4096,
    capabilities: { text: true, image: false, functionCall: true, vision: false },
    requestConfig: { maxTokens: 2048 }
  }
  const current = { id: 'custom-openai', name: 'Own', enabled: true, apiKey: 'new-fixture', endpoint: 'https://new.fixture.invalid/v1', models: [model] }
  const snapshot = { provider: { ...current, apiKey: 'old-fixture' }, model: { ...model, requestConfig: { maxTokens: 100 } } }
  const selected = resolveSelectedModel(JSON.stringify(snapshot), [current])
  assert.equal(selected?.provider?.apiKey, 'new-fixture')
  assert.equal(selected?.model?.requestConfig?.maxTokens, 2048)
  assert.equal(resolveSelectedModel(JSON.stringify(snapshot), [{ ...current, enabled: false }]), null)
  assert.equal(resolveSelectedModel(JSON.stringify(snapshot), [{ ...current, models: [] }]), null)
})
