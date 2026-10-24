import test from 'node:test'
import assert from 'node:assert/strict'

import { mergeSavedProviderWithDefault } from './provider-config-merge'
import type { AIModel, AIProvider, ProviderConfig } from '../types/ai-providers.types'

const makeModel = (id: string, extra: Partial<AIModel> = {}): AIModel => ({
  id, name: id, providerId: 'openai', contextWindow: 128000,
  capabilities: { text: true, vision: false, image: false, functionCall: true }, ...extra
})
const preset = (extra: Partial<ProviderConfig> = {}): ProviderConfig => ({
  id: 'openai', name: 'OpenAI', description: '', icon: '', website: '',
  endpoint: 'https://api.openai.com/v1', models: [makeModel('current-chat')], ...extra
})
const saved = (extra: Partial<AIProvider> = {}) => ({
  id: 'openai', name: 'OpenAI', enabled: true, apiKey: 'user-fixture',
  endpoint: 'https://api.openai.com/v1', models: [makeModel('gpt-4')], ...extra
})

test('catalog refresh removes old presets, updates capabilities, and keeps user request preferences', () => {
  const current = makeModel('current-chat', { parameters: { maxOutputTokens: 64000, temperature: false } })
  const result = mergeSavedProviderWithDefault(preset({ models: [current] }), saved({ models: [
    makeModel('gpt-4'), makeModel('current-chat', { enabled: false, requestConfig: { maxTokens: 12000 } }),
    makeModel('my-deployment', { isCustom: true }), makeModel('account-specific-model')
  ] }))
  assert.deepEqual(result.models.map(model => model.id), ['current-chat', 'my-deployment', 'account-specific-model'])
  assert.equal(result.apiKey, 'user-fixture')
  assert.equal(result.enabled, true)
  assert.equal(result.models[0].parameters?.temperature, false)
  assert.equal(result.models[0].enabled, false)
  assert.deepEqual(result.models[0].requestConfig, { maxTokens: 12000 })
})

test('custom endpoint and a manual model matching a legacy ID retain their metadata', () => {
  const model = makeModel('gpt-4', { contextWindow: 7777 })
  const result = mergeSavedProviderWithDefault(preset(), saved({ endpoint: 'https://my-fixture.invalid/v1', models: [model] }))
  assert.equal(result.endpoint, 'https://my-fixture.invalid/v1')
  assert.deepEqual(result.models, [model])
  const custom = mergeSavedProviderWithDefault(preset(), saved({ models: [{ ...model, isCustom: true }] }))
  assert.ok(custom.models.some(item => item.id === 'gpt-4' && item.isCustom))
})

test('empty and entirely disabled model lists remain disabled across catalog updates', () => {
  assert.deepEqual(mergeSavedProviderWithDefault(preset(), saved({ models: [] })).models, [])
  const disabled = mergeSavedProviderWithDefault(preset(), saved({ models: [makeModel('gpt-4', { enabled: false })] }))
  assert.equal(disabled.models[0].enabled, false)
})

test('known previous endpoints migrate while credentials and request defaults survive', () => {
  const config = { catalogStatus: 'verified', docsUrl: 'https://docs.fixture.invalid', verifiedAt: '2026-10-23' }
  const result = mergeSavedProviderWithDefault(preset({ endpoint: 'https://new.fixture.invalid/v1', config }), saved({
    endpoint: 'https://api.openai.com/v1/', config: { catalogStatus: 'stale', maxTokens: 1200 }
  }))
  assert.equal(result.endpoint, 'https://new.fixture.invalid/v1')
  assert.equal(result.config.catalogStatus, 'verified')
  assert.equal(result.config.maxTokens, 1200)
})

test('upgrades saved MiniMax M2.5 models to the current M2.7 defaults', () => {
  const defaultProvider = {
    id: 'minimax',
    name: 'MiniMax',
    models: [
      { id: 'MiniMax-M2.7', name: 'MiniMax-M2.7', providerId: 'minimax' },
      {
        id: 'MiniMax-M2.7-highspeed',
        name: 'MiniMax-M2.7-highspeed',
        providerId: 'minimax'
      }
    ]
  }

  const savedProvider = {
    id: 'minimax',
    apiKey: 'saved-key',
    models: [
      { id: 'MiniMax-M2.5', name: 'MiniMax-M2.5', providerId: 'minimax', enabled: true },
      {
        id: 'MiniMax-M2.5-highspeed',
        name: 'MiniMax-M2.5-highspeed',
        providerId: 'minimax',
        enabled: false
      }
    ]
  }

  const merged = mergeSavedProviderWithDefault(defaultProvider as any, savedProvider as any)

  assert.equal(merged.apiKey, 'saved-key')
  assert.deepEqual(
    merged.models.map((model: any) => ({ id: model.id, enabled: model.enabled })),
    [
      { id: 'MiniMax-M2.7', enabled: true },
      { id: 'MiniMax-M2.7-highspeed', enabled: false }
    ]
  )
})
