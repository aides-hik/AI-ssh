import test from 'node:test'
import assert from 'node:assert/strict'
import type { AIModel, AIProvider } from '../types/ai-providers.types'
import { buildReasoningRequest, getReasoningCapability, normalizeReasoningSelection, readReasoningPreferences, reasoningMetadataFromAPI, reasoningPreferenceKey } from './model-reasoning'

const provider: AIProvider = {
  id: 'custom-openai', name: 'Fixture', endpoint: 'https://fixture.invalid/v1', apiKey: '',
  enabled: true, isDefault: false, description: '', icon: '', website: '', models: []
}
const model = (id: string, extra: Partial<AIModel> = {}): AIModel => ({
  id, name: id, providerId: provider.id, contextWindow: 128000,
  capabilities: { text: true, image: false, vision: false, functionCall: true }, ...extra
})

test('OpenAI generations expose their supported effort subsets and dated snapshots', () => {
  for (const [id, expected] of [
    ['o3', ['default', 'low', 'medium', 'high']],
    ['gpt-5', ['default', 'minimal', 'low', 'medium', 'high']],
    ['gpt-5-mini', ['default', 'minimal', 'low', 'medium', 'high']],
    ['gpt-5.1', ['default', 'none', 'low', 'medium', 'high']],
    ['gpt-5.2-2025-12-11', ['default', 'none', 'low', 'medium', 'high', 'xhigh']],
    ['gpt-5.4-mini', ['default', 'none', 'low', 'medium', 'high', 'xhigh']],
    ['gpt-5.6-sol', ['default', 'none', 'low', 'medium', 'high', 'xhigh', 'max']],
    ['gpt-6-astra', ['default', 'low', 'medium', 'high', 'xhigh', 'max']],
    ['gpt-6.1-sol', ['default', 'low', 'medium', 'high', 'xhigh', 'max']],
    ['gpt-6-luna', ['default', 'none', 'low', 'medium', 'high', 'xhigh', 'max']],
    ['gpt-5.2-pro', ['default', 'medium', 'high', 'xhigh']]
  ] as const) assert.deepEqual(getReasoningCapability(provider, model(id)).options, expected, id)
})

test('nonreasoning and unrecognized variants keep service defaults without guessed parameters', () => {
  for (const id of ['gpt-4o', 'gpt-5-chat-latest', 'gpt-5.2-image', 'gpt-99', 'my-reasoner', 'claude-sonnet-4-7', 'o1-mini', 'gemini-3-pro-image-preview']) {
    assert.deepEqual(getReasoningCapability(provider, model(id)).options, ['default'], id)
    assert.deepEqual(buildReasoningRequest(provider, model(id), 'high').body, {}, id)
  }
  assert.equal(getReasoningCapability(null, null).reason, 'unconfigured')
})

test('default and incompatible selections omit reasoning fields while preserving protocol and sampling restrictions', () => {
  assert.deepEqual(buildReasoningRequest(provider, model('gpt-5.2'), 'default'), { body: {}, omitTemperature: true, protocol: 'chat-completions' })
  assert.deepEqual(buildReasoningRequest(provider, model('gpt-5'), 'none').body, {})
  assert.deepEqual(buildReasoningRequest(provider, model('gpt-5.2'), 'high').body, { reasoning_effort: 'high' })
  assert.deepEqual(buildReasoningRequest(provider, model('gpt-6-astra'), 'max'), { body: { reasoning: { effort: 'max' } }, omitTemperature: true, protocol: 'responses' })
  assert.equal(buildReasoningRequest(provider, model('gpt-6-astra'), 'default').protocol, 'responses')
  assert.equal(buildReasoningRequest(provider, model('o3', { reasoning: false }), 'high').omitTemperature, true)
  assert.equal(buildReasoningRequest(provider, model('gpt-6-astra', { reasoning: false }), 'high').protocol, 'responses')
  for (const reasoning of [{ protocol: 'openai' as const, supportedEfforts: [] }, JSON.parse('{"protocol":"invalid"}')]) {
    assert.deepEqual(buildReasoningRequest(provider, model('gpt-6-astra', { reasoning }), 'high'), { body: {}, omitTemperature: true, protocol: 'responses' })
    assert.deepEqual(buildReasoningRequest(provider, model('gpt-5.2', { reasoning }), 'high'), { body: {}, omitTemperature: true, protocol: 'chat-completions' })
  }
})

test('Gemini versions differ and Google image variants cannot inherit text effort levels', () => {
  assert.deepEqual(getReasoningCapability(provider, model('gemini-3-pro-preview')).options, ['default', 'low', 'high'])
  assert.deepEqual(buildReasoningRequest(provider, model('gemini-3-pro-preview'), 'medium').body, {})
  assert.deepEqual(getReasoningCapability(provider, model('gemini-2.5-flash')).options, ['default', 'none', 'low', 'medium', 'high'])
  assert.deepEqual(getReasoningCapability(provider, model('models/gemini-2.5-pro')).options, ['default', 'low', 'medium', 'high'])
  assert.deepEqual(buildReasoningRequest(provider, model('gemini-2.5-flash'), 'none').body, { reasoning_effort: 'none' })
})

test('DeepSeek uses thinking toggle and low high max rather than invented medium or OpenAI none', () => {
  const deepseek = { ...provider, id: 'deepseek' }
  const current = model('deepseek-v4-pro')
  assert.deepEqual(getReasoningCapability(deepseek, current).options, ['default', 'none', 'low', 'high', 'max'])
  assert.deepEqual(buildReasoningRequest(deepseek, current, 'none').body, { thinking: { type: 'disabled' } })
  assert.deepEqual(buildReasoningRequest(deepseek, current, 'high').body, { thinking: { type: 'enabled' }, reasoning_effort: 'high' })
  assert.deepEqual(buildReasoningRequest(deepseek, current, 'medium').body, {})
  assert.deepEqual(getReasoningCapability(provider, current).options, ['default'])
  assert.deepEqual(getReasoningCapability(deepseek, model('deepseek-reasoner')).options, ['default'])
  assert.deepEqual(getReasoningCapability(deepseek, model('deepseek-flash', { reasoning: { protocol: 'deepseek', supportedEfforts: ['low', 'high', 'max'], supportsToggle: true } })).options, ['default', 'none', 'low', 'high', 'max'])
})

test('Qwen budget presets only apply to confirmed models and eligible dated snapshots', () => {
  const qwen = { ...provider, id: 'qwen' }
  for (const id of ['qwen-plus', 'qwen-plus-latest', 'qwen-plus-2025-04-28', 'qwen-plus-20250428', 'qwen-flash-2025-07-28', 'qwen3-8b']) {
    assert.equal(getReasoningCapability(qwen, model(id)).kind, 'budget', id)
    assert.deepEqual(buildReasoningRequest(qwen, model(id), 'medium').body, { enable_thinking: true, thinking_budget: 4096 }, id)
  }
  for (const id of ['qwen-plus-2025-04-27', 'qwen-plus-20250427', 'qwen-flash-2025-07-27', 'qwen-max', 'qwen2.5-72b-instruct', 'qwen3-coder-plus']) {
    assert.deepEqual(buildReasoningRequest(qwen, model(id), 'high').body, {}, id)
  }
  assert.deepEqual(buildReasoningRequest(qwen, model('qwen-plus'), 'none').body, { enable_thinking: false })
})

test('OpenRouter consumes metadata, filters mandatory none, and uses its own request envelope', () => {
  const router = { ...provider, id: 'openrouter' }
  const current = model('openai/gpt-6-astra', { reasoning: { protocol: 'openrouter', supportedEfforts: ['none', 'low', 'high'], mandatory: true } })
  assert.deepEqual(getReasoningCapability(router, current).options, ['default', 'low', 'high'])
  assert.deepEqual(buildReasoningRequest(router, current, 'high'), { body: { reasoning: { effort: 'high' } }, omitTemperature: false, protocol: 'chat-completions' })
  assert.deepEqual(buildReasoningRequest(router, model('openai/gpt-5.2'), 'high').body, {})
  assert.deepEqual(buildReasoningRequest(router, current, 'default').body, {})
})

test('explicit toggle-only support works without inventing effort levels; malformed metadata stays safe', () => {
  const toggle = model('fixture-toggle', { reasoning: { protocol: 'qwen', supportsToggle: true } })
  assert.deepEqual(getReasoningCapability(provider, toggle).options, ['none', 'enabled'])
  assert.deepEqual(buildReasoningRequest(provider, toggle, 'enabled').body, { enable_thinking: true })
  assert.deepEqual(getReasoningCapability(provider, model('fixture', { reasoning: { protocol: 'qwen', supportedEfforts: ['max'] } })).options, ['default'])
  const malformed = model('fixture', { reasoning: JSON.parse('{"protocol":"openai","supportedEfforts":123}') })
  assert.deepEqual(buildReasoningRequest(provider, malformed, 'high').body, {})
  const nativeClaude = { ...provider, endpoint: 'https://api.anthropic.com/v1' }
  assert.equal(getReasoningCapability(nativeClaude, model('claude-opus-4-7')).adapter, 'anthropic')
})

test('binary reasoning migrates missing and legacy defaults to off and sends explicit selected states', () => {
  for (const [protocol, off, on] of [
    ['qwen', { enable_thinking: false }, { enable_thinking: true }],
    ['deepseek', { thinking: { type: 'disabled' } }, { thinking: { type: 'enabled' } }],
    ['openrouter', { reasoning: { effort: 'none' } }, { reasoning: { enabled: true } }]
  ] as const) {
    const toggle = model(`fixture-${protocol}`, { reasoning: { protocol, supportsToggle: true } })
    const capability = getReasoningCapability(provider, toggle)
    assert.deepEqual(capability.options, ['none', 'enabled'])
    for (const legacy of [undefined, null, 'default', 'high', 'invalid']) {
      assert.equal(normalizeReasoningSelection(capability, legacy), 'none', `${protocol}: ${legacy}`)
    }
    assert.equal(normalizeReasoningSelection(capability, 'none'), 'none')
    assert.equal(normalizeReasoningSelection(capability, 'enabled'), 'enabled')
    assert.deepEqual(buildReasoningRequest(provider, toggle).body, off)
    assert.deepEqual(buildReasoningRequest(provider, toggle, 'none').body, off)
    assert.deepEqual(buildReasoningRequest(provider, toggle, 'enabled').body, on)
    const key = reasoningPreferenceKey(provider, toggle)
    const saved = readReasoningPreferences(JSON.stringify({ [key]: 'enabled' }))
    assert.equal(normalizeReasoningSelection(capability, saved[key]), 'enabled')
  }
})

test('mandatory binary reasoning always resolves to on and cannot send an unsupported off state', () => {
  for (const [protocol, body] of [
    ['qwen', { enable_thinking: true }],
    ['deepseek', { thinking: { type: 'enabled' } }],
    ['openrouter', { reasoning: { enabled: true } }]
  ] as const) {
    const toggle = model(`fixture-${protocol}`, { reasoning: { protocol, supportsToggle: true, mandatory: true } })
    const capability = getReasoningCapability(provider, toggle)
    assert.deepEqual(capability.options, ['enabled'])
    for (const value of [undefined, 'default', 'none', 'enabled', 'high']) {
      assert.equal(normalizeReasoningSelection(capability, value), 'enabled')
    }
    assert.deepEqual(buildReasoningRequest(provider, toggle).body, body)
    assert.deepEqual(buildReasoningRequest(provider, toggle, 'none').body, body)
  }
})

test('native Claude adapts effort and budget by family without leaking native fields into gateways', () => {
  const nativeClaude = { ...provider, id: 'anthropic', endpoint: 'https://api.anthropic.com/v1' }
  assert.deepEqual(buildReasoningRequest(nativeClaude, model('claude-opus-5-5'), 'max').body, { output_config: { effort: 'max' } })
  assert.deepEqual(buildReasoningRequest(nativeClaude, model('claude-opus-4-7'), 'high').body, { output_config: { effort: 'high' }, thinking: { type: 'adaptive' } })
  assert.deepEqual(buildReasoningRequest(nativeClaude, model('claude-sonnet-4-5'), 'low').body, { thinking: { type: 'enabled', budget_tokens: 1024 } })
  assert.deepEqual(buildReasoningRequest(nativeClaude, model('claude-sonnet-4-5'), 'none').body, { thinking: { type: 'disabled' } })
  assert.deepEqual(buildReasoningRequest(provider, model('claude-sonnet-4-5'), 'high').body, {})
  assert.deepEqual(getReasoningCapability(nativeClaude, model('claude-opus-5-5')).options, ['default', 'low', 'medium', 'high', 'xhigh', 'max'])
})

test('API capability parsing keeps supported enums, deduplicates levels, and handles old responses', () => {
  assert.deepEqual(reasoningMetadataFromAPI({}, 'openrouter'), undefined)
  assert.deepEqual(reasoningMetadataFromAPI({ reasoning: { supported_efforts: ['high', 'turbo', 'low', 'high'] } }, 'openrouter'), { protocol: 'openrouter', supportedEfforts: ['low', 'high'], mandatory: false })
  const allEfforts = reasoningMetadataFromAPI({ reasoning: { supported_efforts: null, mandatory: true } }, 'openrouter')
  assert(allEfforts)
  assert.deepEqual(allEfforts.supportedEfforts, ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
  assert.deepEqual(reasoningMetadataFromAPI({ effort: { supported_levels: ['none', 'high', 'high', 'invalid'] } }, 'deepseek'), { protocol: 'deepseek', supportedEfforts: ['none', 'high'], mandatory: false })
  assert.equal(reasoningMetadataFromAPI({ effort: { supported_levels: ['none'] } }, 'deepseek'), false)
})

test('per-provider model preferences survive reload and stale unsupported levels reset to default', () => {
  const key = reasoningPreferenceKey(provider, model('gpt-5.2'))
  const other = reasoningPreferenceKey({ ...provider, id: 'another' }, model('gpt-5.2'))
  assert.notEqual(key, other)
  const saved = readReasoningPreferences(JSON.stringify({ [key]: 'xhigh', [other]: 'high', bad: 'max', '["bad"]': 'turbo' }))
  assert.deepEqual(saved, { [key]: 'xhigh', [other]: 'high' })
  assert.equal(normalizeReasoningSelection(getReasoningCapability(provider, model('gpt-5')), saved[key]), 'default')
  for (const raw of ['{', 'null', '[]', '3']) assert.deepEqual(readReasoningPreferences(raw), {})
})
