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
