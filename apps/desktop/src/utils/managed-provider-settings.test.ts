import test from 'node:test'
import assert from 'node:assert/strict'

import { mergeProviderForSave } from './managed-provider-settings'
import type { AIModel, AIProvider, ModelReasoningConfig } from '../types/ai-providers.types'

test('mergeProviderForSave preserves isCustom for unmanaged provider models', () => {
  const provider = {
    id: 'custom-openai',
    name: 'Custom OpenAI',
    endpoint: 'http://example.com/v1',
    enabled: true,
    models: [
      {
        id: 'custom-model',
        name: 'Custom Model',
        providerId: 'custom-openai',
        contextWindow: 8192,
        capabilities: { text: true, image: false, functionCall: true, vision: false },
        enabled: true,
        isCustom: true
      }
    ]
  }

  const merged = mergeProviderForSave(provider as any)

  assert.equal(merged.models?.[0]?.isCustom, true)
})

function providerWithReasoning(reasoning: AIModel['reasoning']): AIProvider {
  return {
    id: 'openrouter',
    name: 'OpenRouter',
    description: '',
    icon: '',
    website: '',
    endpoint: 'https://openrouter.ai/api/v1',
    apiKey: '',
    enabled: true,
    isDefault: false,
    models: [
      {
        id: 'google/gemini-3-pro-preview',
        name: 'Gemini 3 Pro',
        providerId: 'openrouter',
        contextWindow: 1000000,
        capabilities: { text: true, image: false, functionCall: true, vision: true },
        reasoning
      }
    ]
  }
}

test('unmanaged provider reasoning metadata survives the settings JSON save', () => {
  const reasoning: ModelReasoningConfig = {
    protocol: 'openrouter',
    supportedEfforts: ['low', 'high'],
    mandatory: true
  }
  const saved = JSON.parse(JSON.stringify(mergeProviderForSave(providerWithReasoning(reasoning))))
  assert.deepEqual(saved.models[0].reasoning, reasoning)
})

test('unmanaged provider explicit unsupported reasoning flag survives saving', () => {
  const saved = JSON.parse(JSON.stringify(mergeProviderForSave(providerWithReasoning(false))))
  assert.equal(saved.models[0].reasoning, false)
})

test('model capability metadata and user generation defaults survive a settings round trip', () => {
  const provider = providerWithReasoning(false)
  provider.models[0].parameters = { maxOutputTokens: 64000, temperature: false }
  provider.models[0].requestConfig = { maxTokens: 8192, reasoning: 'high' }
  const saved = JSON.parse(JSON.stringify(mergeProviderForSave(provider)))
  assert.deepEqual(saved.models[0].parameters, provider.models[0].parameters)
  assert.deepEqual(saved.models[0].requestConfig, provider.models[0].requestConfig)
})

test('manual reasoning configuration survives unmanaged and managed saves independently of service metadata', () => {
  const overrides: AIModel['reasoningOverride'][] = [{ protocol: 'openai', supportedEfforts: ['high'] }, false, undefined]
  for (const managedByApp of [false, true]) {
    for (const override of overrides) {
      const provider = providerWithReasoning(false)
      provider.config = { managedByApp }
      provider.models[0].reasoningOverride = override
      provider.models[0].requestConfig = { maxTokens: 1200 }
      const latest = structuredClone(provider)
      latest.models[0].reasoning = { protocol: 'openrouter', supportedEfforts: ['low', 'high'] }
      latest.models[0].reasoningOverride = false
      const saved = JSON.parse(JSON.stringify(mergeProviderForSave(provider, latest)))
      assert.deepEqual(saved.models[0].reasoningOverride, override)
      assert.deepEqual(saved.models[0].reasoning, managedByApp ? latest.models[0].reasoning : false)
      assert.deepEqual(saved.models[0].requestConfig, { maxTokens: 1200 })
    }
  }
})
