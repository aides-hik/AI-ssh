import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import {
  fetchDeepSeekModels,
  fetchOpenAICompatibleModels,
  fetchOpenAIModels,
  fetchOpenRouterModels,
  fetchAnthropicModels,
  fetchGoogleModels,
  fetchModelsForProvider,
  fetchOllamaModels
} from './model-fetcher.service.ts'
import { DEFAULT_PROVIDERS } from '../types/ai-providers'
import type { ModelReasoningConfig } from '../types/ai-providers.types'

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

test('DeepSeek V4.1 Flash discovery recognizes verified tool support while preserving explicit metadata', async context => {
  for (const [metadata, expected] of [
    [{}, true],
    [{ function_calling: false }, false],
    [{ supported_parameters: [] }, false],
    [{ supported_parameters: ['tools'] }, true]
  ] as const) {
    mockModels(context, [{ id: 'deepseek-v4.1-flash', ...metadata }])
    const result = await fetchDeepSeekModels('fixture-key', 'https://fixture.invalid/v1')
    assert.equal(result.success, true)
    assert.equal(result.models?.[0].capabilities.functionCall, expected)
  }
  mockModels(context, [
    { id: 'deepseek-v4.1-flash-unverified' },
    { id: 'deepseek-v4.1-pro' }
  ])
  const variants = await fetchDeepSeekModels('fixture-key', 'https://fixture.invalid/v1')
  assert.deepEqual(variants.models?.map(model => model.capabilities.functionCall), [false, false])
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
    assert.deepEqual(result.models?.[0].reasoning, {
      protocol: 'openai', supportedEfforts: ['low', 'high'], mandatory: false
    })
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

test('custom aliases retain declared OpenAI reasoning metadata and explicit rejection without guessing missing declarations', async context => {
  mockModels(context, [
    { id: 'deployment-alias', reasoning: { supported_efforts: ['high', 'invalid', 'low', 'high'], mandatory: true } },
    { id: 'disabled-alias', reasoning: false },
    { id: 'empty-levels', reasoning: { supported_efforts: [] } },
    { id: 'unknown-alias' },
    { id: 'incomplete-alias', reasoning: {} },
    { id: 'null-levels', reasoning: { supported_efforts: null } },
    { id: 'gpt-5.6', reasoning: false }
  ])
  const fetched = await fetchModelsForProvider('custom-instance-a', '', 'https://proxy.invalid/v1', 'custom-openai')
  assert.equal(fetched.success, true)
  assert.deepEqual(fetched.models?.map(model => model.reasoning), [
    { protocol: 'openai', supportedEfforts: ['low', 'high'], mandatory: true },
    false, false, undefined, undefined, undefined, false
  ])
  assert(fetched.models?.every(model => model.providerId === 'custom-instance-a'))
})

test('compatible instances use their runtime catalogue without replacing their configured identity', async context => {
  const known = DEFAULT_PROVIDERS.find(provider => provider.id === 'openai')?.models[0]
  assert(known)
  mockModels(context, [{ id: known.id }])
  const fetched = await fetchOpenAICompatibleModels('openai-instance-a', '', 'https://proxy.invalid/v1', 'openai')
  assert.equal(fetched.success, true)
  assert.equal(fetched.models?.[0].providerId, 'openai-instance-a')
  assert.equal(fetched.models?.[0].name, known.name)
  assert.equal(fetched.models?.[0].contextWindow, known.contextWindow)
  assert.deepEqual(fetched.models?.[0].parameters, known.parameters || {})
  assert.equal(known.providerId, 'openai')
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

test('Ollama show discovery preserves named levels, boolean controls and explicit unsupported declarations', async context => {
  const cases: Array<{ id: string; details: Record<string, unknown>; reasoning: ModelReasoningConfig | false | undefined }> = [
    { id: 'level-alias', details: { thinking: { values: ['high', 'low', 'high', 'invented', 1] } },
      reasoning: { protocol: 'ollama', supportedEfforts: ['low', 'high'], supportsToggle: false, mandatory: true } },
    { id: 'toggle-alias', details: { thinking: { values: [true, false] } },
      reasoning: { protocol: 'ollama', supportsToggle: true, mandatory: false } },
    { id: 'always-thinking', details: { thinking: { values: [true] } },
      reasoning: { protocol: 'ollama', supportsToggle: true, mandatory: true } },
    { id: 'levels-and-off', details: { thinking: { values: ['medium', false, 'high'] } },
      reasoning: { protocol: 'ollama', supportedEfforts: ['medium', 'high'], supportsToggle: true, mandatory: false } },
    { id: 'disabled-thinking', details: { capabilities: ['completion', 'thinking'], thinking: { values: [false] } }, reasoning: false },
    { id: 'empty-thinking', details: { capabilities: ['completion', 'thinking'], thinking: { values: [] } }, reasoning: false },
    { id: 'unknown-thinking', details: {}, reasoning: undefined },
    { id: 'incomplete-thinking', details: { capabilities: ['completion', 'thinking'], thinking: {} }, reasoning: undefined },
    { id: 'invalid-thinking', details: { capabilities: ['completion', 'thinking'], thinking: { values: ['false', 'turbo', 1] } }, reasoning: undefined }
  ]
  const requests: string[] = []
  context.mock.method(globalThis, 'fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
    requests.push(String(url))
    if (String(url).endsWith('/api/tags')) return Response.json({ models: cases.map(item => ({ name: item.id })) })
    assert.equal(init?.method, 'POST')
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer fixture-key')
    const { model } = JSON.parse(String(init?.body))
    const item = cases.find(item => item.id === model)
    assert(item)
    return Response.json(item.details)
  })
  const fetched = await fetchOllamaModels('http://127.0.0.1:11434/v1/', 'fixture-key')
  assert.equal(fetched.success, true)
  assert.deepEqual(fetched.models?.map(model => model.reasoning), cases.map(item => item.reasoning))
  assert(fetched.models?.every(model => model.parameters?.apiStyle === 'ollama'))
  assert.equal(requests.length, cases.length + 1)
  assert(requests.every(url => !url.includes('fixture-key')))
})

test('legacy Ollama thinking capabilities use only verified exact-family levels and otherwise a boolean control', async context => {
  const ids = ['gpt-oss', 'gpt-oss:20b', 'library/gpt-oss:120b', 'own-gpt-oss:20b', 'gpt-oss-unverified:20b', 'qwen3:8b', 'gpt-oss:unknown-no-metadata']
  context.mock.method(globalThis, 'fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).endsWith('/api/tags')) return Response.json({ models: ids.map(name => ({ name })) })
    const { model } = JSON.parse(String(init?.body))
    return Response.json({ capabilities: model === ids.at(-1) ? ['completion'] : ['completion', 'thinking'] })
  })
  const fetched = await fetchOllamaModels()
  assert.equal(fetched.success, true)
  const levels = { protocol: 'ollama', supportedEfforts: ['low', 'medium', 'high'], mandatory: true }
  const toggle = { protocol: 'ollama', supportsToggle: true, mandatory: false }
  assert.deepEqual(fetched.models?.map(model => model.reasoning), [levels, levels, levels, toggle, toggle, toggle, undefined])
})

test('an old or unavailable Ollama show endpoint preserves the installed list without fabricating reasoning controls', async context => {
  for (const response of [() => new Response(null, { status: 404 }), () => Response.json(null), () => Response.json([]), () => { throw new Error('show unavailable') }]) {
    context.mock.method(globalThis, 'fetch', async (url: RequestInfo | URL) => String(url).endsWith('/api/tags')
      ? Response.json({ models: [{ name: 'gpt-oss:20b' }] }) : response())
    const fetched = await fetchOllamaModels()
    assert.equal(fetched.success, true)
    assert.equal(fetched.models?.[0].id, 'gpt-oss:20b')
    assert.equal(fetched.models?.[0].reasoning, undefined)
  }
})

test('native runtime discovery retains separate provider instance identities across all supported protocols', async context => {
  for (const runtime of ['openai', 'anthropic', 'google', 'deepseek', 'openrouter', 'ollama']) {
    context.mock.method(globalThis, 'fetch', async (url: RequestInfo | URL) => {
      if (String(url).endsWith('/api/tags')) return Response.json({ models: [{ name: 'alias:latest' }] })
      if (String(url).endsWith('/api/show')) return Response.json({ thinking: { values: [true, false] } })
      if (runtime === 'anthropic') return Response.json({ data: [{ id: 'claude-alias' }] })
      if (runtime === 'google') return Response.json({ models: [{ name: 'models/gemini-alias', supportedGenerationMethods: ['generateContent'] }] })
      return Response.json({ data: [{ id: 'gpt-5.6', reasoning: { supported_efforts: ['low', 'high'] }, effort: { supported_levels: ['high'] } }] })
    })
    for (const instance of ['instance-a', 'instance-b']) {
      const fetched = await fetchModelsForProvider(instance, '', 'http://127.0.0.1:11434/v1', runtime)
      assert.equal(fetched.success, true, runtime)
      assert.equal(fetched.models?.length, 1, runtime)
      assert.equal(fetched.models?.[0].providerId, instance, runtime)
      if (runtime === 'openai' || runtime === 'deepseek' || runtime === 'openrouter' || runtime === 'ollama') {
        assert.equal(fetched.models?.[0].reasoning && fetched.models[0].reasoning.protocol, runtime)
      }
    }
  }
})

test('malformed and looping API payloads are surfaced as failures instead of a fabricated list', async context => {
  context.mock.method(globalThis, 'fetch', async () => Response.json({ data: 'invalid' }))
  assert.equal((await fetchOpenAIModels('fixture-key')).success, false)
  context.mock.method(globalThis, 'fetch', async () => Response.json({ data: [{ id: 'claude-fixture' }], has_more: true, last_id: 'same' }))
  assert.equal((await fetchAnthropicModels('fixture-key')).success, false)
})
