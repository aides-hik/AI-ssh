import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import {
  fetchDeepSeekModels,
  fetchOpenAICompatibleModels,
  fetchOpenAIModels,
  fetchOpenRouterModels
  , fetchAnthropicModels, fetchGoogleModels, fetchModelsForProvider, fetchOllamaModels
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

test('discovery trusts explicit tool and modality declarations over model-name guesses', async context => {
  mockModels(context, [
    { id: 'claude-imaginary', supported_parameters: [], architecture: { input_modalities: ['text'], output_modalities: ['text'] }, top_provider: { max_completion_tokens: 5000 }, context_length: 1000000 },
    { id: 'my-custom-vision-name', max_tokens: 99999 },
    { id: 'free-model', pricing: { prompt: '0', completion: '0' }, function_calling: true },
    { id: 123 }, null
  ])
  const fetched = await fetchOpenRouterModels('test-key', 'https://fixture.invalid/v1///')
  assert.equal(fetched.success, true)
  assert.equal(fetched.models?.length, 3)
  assert.deepEqual(fetched.models?.[0].capabilities, { text: true, image: false, vision: false, functionCall: false })
  assert.deepEqual(fetched.models?.[0].parameters, { maxOutputTokens: 5000, temperature: false, topP: false, apiStyle: 'chat-completions', maxTokensParameter: 'max_tokens' })
  assert.equal(fetched.models?.[1].contextWindow, 0)
  assert.equal(fetched.models?.[1].capabilities.vision, false)
  assert.deepEqual(fetched.models?.[2].price, { input: 0, output: 0 })
})

test('Anthropic discovery authenticates, follows cursors, and retains live model limits and effort metadata', async context => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  context.mock.method(globalThis, 'fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    const payload = calls.length === 1 ? {
      data: [{ id: 'claude-fixture', display_name: 'Current Claude', max_input_tokens: 1000000, max_tokens: 64000, capabilities: { effort: { high: { supported: true }, low: { supported: true } }, image_input: { supported: true } } }], has_more: true, last_id: 'one/two'
    } : { data: [{ id: 'claude-retired', lifecycle: 'retired' }], has_more: false }
    return Response.json(payload)
  })
  const fetched = await fetchAnthropicModels('fixture-key', 'https://fixture.invalid/v1/')
  assert.equal(fetched.success, true)
  assert.equal(fetched.models?.length, 1)
  assert.equal(fetched.models?.[0].contextWindow, 1000000)
  assert.equal(fetched.models?.[0].parameters?.maxOutputTokens, 64000)
  assert.deepEqual(fetched.models?.[0].reasoning, { protocol: 'anthropic', supportedEfforts: ['low', 'high'], mandatory: true, thinkingMode: 'adaptive' })
  assert.equal(calls[1].url, 'https://fixture.invalid/v1/models?limit=100&after_id=one%2Ftwo')
  assert.equal((calls[0].init?.headers as Record<string, string>)['x-api-key'], 'fixture-key')
})

test('Google discovery follows page tokens, retains output limits, and does not duplicate API version or leak key in URL', async context => {
  const calls: string[] = []
  context.mock.method(globalThis, 'fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push(String(url))
    assert.equal((init?.headers as Record<string, string>)['x-goog-api-key'], 'fixture-key')
    return Response.json(calls.length === 1 ? {
      models: [{ name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'], inputTokenLimit: 1000000, outputTokenLimit: 32000 }], nextPageToken: 'next/one'
    } : { models: [{ name: 'models/embedding', supportedGenerationMethods: ['embedContent'] }] })
  })
  const fetched = await fetchGoogleModels('fixture-key', 'https://generativelanguage.googleapis.com/v1beta/openai/')
  assert.equal(fetched.success, true)
  assert.equal(fetched.models?.length, 1)
  assert.equal(fetched.models?.[0].parameters?.maxOutputTokens, 32000)
  assert.equal(calls[1], 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&pageToken=next%2Fone')
  assert(calls.every(url => !url.includes('fixture-key')))
})

test('Ollama and custom compatibility providers can discover models without fixed vendor IDs', async context => {
  const calls: string[] = []
  context.mock.method(globalThis, 'fetch', async (url: RequestInfo | URL) => {
    calls.push(String(url))
    return Response.json(String(url).endsWith('/api/tags') ? { models: [{ name: 'own:latest' }] } : String(url).endsWith('/api/show') ? { capabilities: ['completion', 'tools', 'vision'], model_info: { 'general.architecture': 'fixture', 'fixture.context_length': 131072 } } : { data: [{ id: 'own-model' }] })
  })
  const ollama = await fetchOllamaModels('http://127.0.0.1:11434/v1/')
  assert.equal(ollama.models?.[0].id, 'own:latest')
  assert.equal(ollama.models?.[0].capabilities.functionCall, true)
  assert.equal(ollama.models?.[0].capabilities.vision, true)
  assert.equal(ollama.models?.[0].contextWindow, 131072)
  const custom = await fetchModelsForProvider('custom-123', 'fixture-key', 'https://fixture.invalid/v1/')
  assert.equal(custom.models?.[0].providerId, 'custom-123')
  assert.deepEqual(calls, ['http://127.0.0.1:11434/api/tags', 'http://127.0.0.1:11434/api/show', 'https://fixture.invalid/v1/models'])
})

test('malformed and looping API payloads are surfaced as failures instead of a fabricated list', async context => {
  context.mock.method(globalThis, 'fetch', async () => Response.json({ data: 'invalid' }))
  assert.equal((await fetchOpenAIModels('fixture-key')).success, false)
  context.mock.method(globalThis, 'fetch', async () => Response.json({ data: [{ id: 'claude-fixture' }], has_more: true, last_id: 'same' }))
  assert.equal((await fetchAnthropicModels('fixture-key')).success, false)
})
