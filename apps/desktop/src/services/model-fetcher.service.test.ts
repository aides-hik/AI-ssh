import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import {
  fetchDeepSeekModels,
  fetchOpenAICompatibleModels,
  fetchOpenAIModels,
  fetchOpenRouterModels
} from './model-fetcher.service.ts'

function mockModels(context: TestContext, models: unknown[]) {
  return context.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(JSON.stringify({ data: models }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
  )
}

test('OpenRouter model discovery retains only declared valid reasoning efforts', async context => {
  mockModels(context, [
    {
      id: 'google/gemini-3-pro-preview',
      reasoning: { supported_efforts: ['high', 'invented', 'low'], mandatory: true },
      supported_parameters: ['tools']
    },
    { id: 'openrouter/auto' },
    { id: 'unknown-model', reasoning: { supported_efforts: ['invented'] } }
  ])

  const result = await fetchOpenRouterModels('test-key')
  assert.equal(result.success, true)
  assert.deepEqual(result.models?.[0].reasoning, {
    protocol: 'openrouter',
    supportedEfforts: ['low', 'high'],
    mandatory: true
  })
  assert.equal(result.models?.[0].capabilities.functionCall, true)
  assert.equal(result.models?.[1].reasoning, undefined)
  assert.equal(result.models?.[2].reasoning, false)
})

test('DeepSeek model discovery retains reasoning levels and accepts legacy model payloads', async context => {
  mockModels(context, [
    { id: 'deepseek-flash', effort: { supported_levels: ['max', 'high', 'low', 'invalid'] } },
    { id: 'deepseek-reasoner' },
    { id: 'deepseek-chat' },
    { id: 'unsupported', effort: { supported_levels: ['invalid'] } }
  ])

  const result = await fetchDeepSeekModels('test-key')
  assert.equal(result.success, true)
  assert.deepEqual(result.models?.[0].reasoning, {
    protocol: 'deepseek',
    supportedEfforts: ['none', 'low', 'high', 'max'],
    mandatory: false
  })
  assert.equal(result.models?.[0].capabilities.functionCall, true)
  assert.equal(result.models?.[1].reasoning, undefined)
  assert.equal(result.models?.[2].reasoning, undefined)
  assert.equal(result.models?.[2].capabilities.functionCall, true)
  assert.equal(result.models?.[3].reasoning, false)
})

test('compatible discovery selects reasoning metadata by provider or exact official host', async context => {
  mockModels(context, [
    {
      id: 'o3-mini',
      reasoning: { supported_efforts: ['low', 'high', 'invalid'] },
      effort: { supported_levels: ['high', 'max'] }
    }
  ])

  for (const [providerId, endpoint, protocol, efforts] of [
    ['openrouter', 'https://proxy.example/v1', 'openrouter', ['low', 'high']],
    ['custom', 'https://openrouter.ai/api/v1', 'openrouter', ['low', 'high']],
    ['deepseek', 'https://proxy.example/v1', 'deepseek', ['none', 'high', 'max']],
    ['custom', 'https://api.deepseek.com/v1', 'deepseek', ['none', 'high', 'max']]
  ] as const) {
    const result = await fetchOpenAICompatibleModels(providerId, 'test-key', endpoint)
    assert.equal(result.success, true)
    assert.deepEqual(result.models?.[0].reasoning, {
      protocol,
      supportedEfforts: [...efforts],
      mandatory: false
    })
    assert.equal(result.models?.[0].capabilities.functionCall, true)
  }

  for (const endpoint of [
    'https://openrouter.ai.example/v1',
    'https://example.com/v1',
    'invalid-url'
  ]) {
    const result = await fetchOpenAICompatibleModels('custom', 'test-key', endpoint)
    assert.equal(result.success, true)
    assert.equal(result.models?.[0].reasoning, undefined)
  }
})

test('legacy compatible discovery does not invent reasoning metadata', async context => {
  mockModels(context, [{ id: 'o4-mini' }, { id: 'deepseek-v4-pro' }, { id: 'own-model' }])

  const result = await fetchOpenAICompatibleModels(
    'openrouter',
    'test-key',
    'https://proxy.example/v1'
  )
  assert.equal(result.success, true)
  assert.deepEqual(
    result.models?.map(model => model.reasoning),
    [undefined, undefined, undefined]
  )
  assert.deepEqual(
    result.models?.map(model => model.capabilities.functionCall),
    [true, true, false]
  )
})

test('OpenAI discovery includes o3 and o4 reasoning text models with tools', async context => {
  mockModels(context, [
    { id: 'o3' },
    { id: 'o3-mini-2025-01-31' },
    { id: 'o4-mini' },
    { id: 'gpt-5.2' },
    { id: 'gpt-5.6-sol' },
    { id: 'gpt-5.5-pro' },
    { id: 'o3-deep-research' },
    { id: 'text-embedding-3-large' }
  ])

  const result = await fetchOpenAIModels('test-key')
  assert.equal(result.success, true)
  assert.deepEqual(
    result.models?.map(model => model.id),
    ['o3', 'o3-mini-2025-01-31', 'o4-mini', 'gpt-5.2', 'gpt-5.6-sol', 'gpt-5.5-pro', 'o3-deep-research']
  )
  assert.deepEqual(
    result.models?.map(model => model.capabilities.functionCall),
    [true, true, true, true, true, true, false]
  )
})

test('model discovery surfaces HTTP failures without interpreting a response body', async context => {
  context.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 401 }))
  const result = await fetchOpenRouterModels('test-key')
  assert.deepEqual(result, { success: false, error: 'HTTP error! status: 401' })
})
