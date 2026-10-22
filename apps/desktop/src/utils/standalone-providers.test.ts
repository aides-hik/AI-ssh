import test from 'node:test'
import assert from 'node:assert/strict'
import {
  clearRetiredAccountSession,
  isRetiredManagedProvider,
  isRetiredServiceUrl,
  pruneRetiredProviders
} from './standalone-providers.ts'

function storage(initial: Record<string, string>) {
  const values = new Map(Object.entries(initial))
  return {
    get length() { return values.size },
    clear: () => { values.clear() },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) }
  } satisfies Storage
}

test('account migration removes retired sessions and model selections while preserving local data', () => {
  const settings = JSON.stringify({
    aiProviders: [{ id: 'custom-openai', apiKey: 'own-key', endpoint: 'http://127.0.0.1:8080/v1' }]
  })
  const local = storage({
    userToken: 'retired-token',
    refreshToken: 'retired-refresh-token',
    userInfo: '{"id":"retired-account"}',
    selectedAIModel: '{"source":"official","providerId":"official","modelId":"old-model"}',
    'app-settings': settings,
    'ssh-tree': '[{"id":"my-server"}]'
  })
  const ownProvider = { id: 'custom-openai', endpoint: 'http://localhost:8080/v1', apiKey: 'own-key' }
  const retiredProvider = { id: 'official', apiKey: 'retired-managed-key' }
  local.setItem('aiProviderConfigs', JSON.stringify([retiredProvider, ownProvider]))
  local.setItem('appSettings', JSON.stringify({ theme: 'dark', aiProviders: [retiredProvider, ownProvider] }))
  const session = storage({ userToken: 'retired-session-token', refreshToken: 'session-refresh', userInfo: '{}' })
  const previousLocal = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const previousSession = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: local })
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: session })
  try {
    clearRetiredAccountSession()
    for (const store of [local, session]) {
      assert.equal(store.getItem('userToken'), null)
      assert.equal(store.getItem('userInfo'), null)
      assert.equal(store.getItem('refreshToken'), null)
    }
    assert.equal(local.getItem('selectedAIModel'), null)
    assert.equal(local.getItem('app-settings'), settings)
    assert.equal(local.getItem('ssh-tree'), '[{"id":"my-server"}]')
    assert.deepEqual(JSON.parse(local.getItem('aiProviderConfigs')!), [ownProvider])
    assert.deepEqual(JSON.parse(local.getItem('appSettings')!), { theme: 'dark', aiProviders: [ownProvider] })

    const ownSelection = '{"source":"local","providerId":"custom-openai","modelId":"mine"}'
    local.setItem('selectedAIModel', ownSelection)
    clearRetiredAccountSession()
    assert.equal(local.getItem('selectedAIModel'), ownSelection)
  } finally {
    if (previousLocal) Object.defineProperty(globalThis, 'localStorage', previousLocal)
    else delete (globalThis as any).localStorage
    if (previousSession) Object.defineProperty(globalThis, 'sessionStorage', previousSession)
    else delete (globalThis as any).sessionStorage
  }
})

test('provider cleanup preserves user credentials, endpoints and unrelated settings', () => {
  const own = { id: 'openai', apiKey: 'own-key', endpoint: 'https://my-server.example/v1' }
  const retired = { id: 'old-alias', config: { runtimeProviderId: 'official' }, apiKey: 'retired' }
  assert.deepEqual(pruneRetiredProviders({ theme: 'dark', aiProviders: [retired, own] }), {
    theme: 'dark', aiProviders: [own]
  })
  assert.deepEqual(own, { id: 'openai', apiKey: 'own-key', endpoint: 'https://my-server.example/v1' })
})

test('legacy service URLs are rejected without matching unrelated user hosts', () => {
  for (const endpoint of [
    'https://api.tx07.cn/ai-ssh', 'https://aifuqiang.win/v1',
    'http://151.245.90.96:3000/v1', 'http://110.42.111.221/v1',
    'https://ai-ssh-assistant.app/v1'
  ]) {
    assert.equal(isRetiredServiceUrl(endpoint), true)
    assert.equal(isRetiredManagedProvider({ id: 'openai', endpoint }), true)
    assert.equal(isRetiredManagedProvider({ id: 'openai', config: { baseURL: endpoint } }), true)
    assert.deepEqual(pruneRetiredProviders([{ id: 'openai', endpoint }]), [])
  }
  for (const endpoint of ['http://localhost:11434', 'https://my-model.example/v1', 'https://tx07.cn.example/v1']) {
    assert.equal(isRetiredServiceUrl(endpoint), false)
    assert.equal(isRetiredManagedProvider({ id: 'openai', endpoint }), false)
  }
})
