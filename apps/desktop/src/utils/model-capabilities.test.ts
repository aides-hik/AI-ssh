import test from 'node:test'
import assert from 'node:assert/strict'
import type { AIProvider, AIModel } from '../types/ai-providers.types'
import { buildModelParameterBody, getModelCapabilities, getModelAPIStyle, getModelRequestSettings } from './model-capabilities'
import { DEFAULT_PROVIDERS } from '../types/ai-providers'

const provider: AIProvider = { id: 'custom', name: '', description: '', icon: '', website: '', endpoint: 'https://fixture.invalid/v1/', apiKey: '', enabled: true, isDefault: false, models: [] }
const model = (id: string, extra: Partial<AIModel> = {}): AIModel => ({ id, name: id, providerId: provider.id, contextWindow: 0, capabilities: { text: true, image: false, vision: false, functionCall: true }, ...extra })

test('unknown models use service defaults and only explicitly configured parameters', () => {
  assert.deepEqual(buildModelParameterBody(provider, model('my-deployment')), {})
  assert.deepEqual(buildModelParameterBody(provider, model('my-deployment'), { temperature: 0, maxTokens: 200, topP: 0.8, reasoningSelection: 'max' }), { temperature: 0, max_tokens: 200, top_p: 0.8 })
  assert.equal(getModelCapabilities(provider, model('own')).maxOutputTokens, undefined)
})

test('per-request settings override per-model settings and legacy provider defaults, including zero', () => {
  const configuredProvider = { ...provider, config: { temperature: 1.3, maxTokens: 8000, topP: 0.9 } }
  const configured = model('fixture', { requestConfig: { temperature: 0.4, maxTokens: 900, reasoning: 'high' } })
  assert.deepEqual(getModelRequestSettings(configuredProvider, configured, { temperature: 0 }), { temperature: 0, maxTokens: 900, topP: 0.9, reasoning: 'high' })
  assert.deepEqual(buildModelParameterBody(configuredProvider, configured, { temperature: 0, maxTokens: 1200 }), { temperature: 0, max_tokens: 1200, top_p: 0.9 })
})

test('OpenAI reasoning rejects sampling and uses protocol-specific output limits', () => {
  const current = model('gpt-6-astra', { parameters: { maxOutputTokens: 65536 } })
  assert.equal(getModelAPIStyle(provider, current), 'responses')
  assert.deepEqual(buildModelParameterBody(provider, current, { temperature: 0.1, topP: 0.8, maxTokens: 999999, reasoningSelection: 'max' }), { reasoning: { effort: 'max' }, max_output_tokens: 65536 })
  assert.deepEqual(buildModelParameterBody(provider, model('o3'), { maxTokens: 8192, topP: 0.9, temperature: 1 }), { max_completion_tokens: 8192 })
  assert.deepEqual(buildModelParameterBody(provider, model('gpt-5.2'), { reasoningSelection: 'none', temperature: 0.2, topP: 0.9 }), { reasoning_effort: 'none', temperature: 0.2, top_p: 0.9 })
})

test('Gemini native and compatibility transport produce different reasoning and output fields', () => {
  const google = { ...provider, id: 'google' }
  const current = model('gemini-3.8-flash')
  assert.deepEqual(buildModelParameterBody(google, current, { reasoningSelection: 'high', maxTokens: 500, temperature: 0.1, topP: 0.7 }), { generationConfig: { maxOutputTokens: 500, thinkingConfig: { thinkingLevel: 'high' } } })
  assert.deepEqual(buildModelParameterBody(google, current, { apiStyle: 'chat-completions', reasoningSelection: 'low', maxTokens: 500, topP: 0.7 }), { reasoning_effort: 'low', max_tokens: 500 })
  assert.deepEqual(buildModelParameterBody(google, model('gemini-2.5-flash'), { reasoningSelection: 'none' }), { generationConfig: { thinkingConfig: { thinkingBudget: 0 } } })
})

test('Claude recent models omit sampling, native tokens required, and compatible layer never gets thinking', () => {
  const anthropic = { ...provider, id: 'anthropic' }
  const current = model('claude-opus-5-5')
  assert.deepEqual(buildModelParameterBody(anthropic, current, { reasoningSelection: 'xhigh', temperature: 0.4, topP: 0.7 }), { output_config: { effort: 'xhigh' }, max_tokens: 4096 })
  assert.deepEqual(buildModelParameterBody(anthropic, current, { apiStyle: 'chat-completions', reasoningSelection: 'high', maxTokens: 6000 }), { max_tokens: 6000 })
  assert.deepEqual(buildModelParameterBody(anthropic, model('claude-3-haiku'), { temperature: 3, topP: 0.5 }), { temperature: 1, max_tokens: 4096 })
})

test('discovered support flags filter parameters and output caps without guessing context from max_tokens', () => {
  const router = { ...provider, id: 'openrouter' }
  const current = model('openai/gpt-6-astra', { parameters: { temperature: false, topP: true, maxOutputTokens: 4096, apiStyle: 'chat-completions', maxTokensParameter: 'max_tokens' } })
  assert.deepEqual(buildModelParameterBody(router, current, { temperature: 0.2, topP: 0.8, maxTokens: 8000 }), { top_p: 0.8, max_tokens: 4096 })
  const invalid = model('own', { requestConfig: { temperature: NaN, maxTokens: -2, topP: -1 } })
  assert.deepEqual(buildModelParameterBody(provider, invalid), {})
})

test('Ollama options stay in their native container', () => {
  const ollama = { ...provider, id: 'ollama', endpoint: 'http://127.0.0.1:11434' }
  assert.deepEqual(buildModelParameterBody(ollama, model('local'), { temperature: 0.2, maxTokens: 1000, topP: 0.7 }), { options: { temperature: 0.2, num_predict: 1000, top_p: 0.7 } })
})

test('verified non-OpenAI effort models keep their documented sampling and token fields', () => {
  for (const [providerId, modelId] of [
    ['groq', 'openai/gpt-oss-120b'], ['zhipu', 'glm-5.3-flash'], ['zhipu', 'glm-5.3-flashx'], ['upstage', 'solar-pro4']
  ]) {
    const preset = DEFAULT_PROVIDERS.find(p => p.id === providerId)!
    const current = preset.models.find(m => m.id === modelId)!
    assert.ok(current, modelId)
    const body = buildModelParameterBody({ ...preset, apiKey: '', enabled: true, isDefault: false }, current,
      { temperature: 0.6, topP: 0.85, reasoningSelection: 'high', maxTokens: 5000 })
    assert.equal(body.temperature, 0.6, modelId)
    assert.equal(body.top_p, 0.85, modelId)
    assert.equal(body.reasoning_effort, 'high', modelId)
  }
  const kimi = DEFAULT_PROVIDERS.find(p => p.id === 'moonshot')!
  const k3 = kimi.models.find(m => m.id === 'kimi-k3')!
  const body = buildModelParameterBody({ ...kimi, apiKey: '', enabled: true, isDefault: false }, k3,
    { maxTokens: 5000, temperature: 0.6, topP: 0.85, reasoningSelection: 'max' })
  assert.equal(body.max_completion_tokens, 5000)
  assert.equal(body.max_tokens, undefined)
  assert.equal(body.temperature, undefined)
})
