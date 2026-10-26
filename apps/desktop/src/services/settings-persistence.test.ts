import test from 'node:test'
import assert from 'node:assert/strict'
import { ProtectedSettingsPersistence, selectedModelReference, type SettingsBridge, type SettingsCache, type SettingsDocument } from './settings-persistence'

function cache(initial: Record<string, string> = {}): SettingsCache {
  const values = new Map(Object.entries(initial))
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value) }, removeItem: key => { values.delete(key) } }
}

function fixture(initial: SettingsDocument = {}, caches: SettingsCache[] = []) {
  let saved = structuredClone(initial)
  const writes: SettingsDocument[] = []
  const bridge: SettingsBridge = {
    get: async () => structuredClone(saved),
    save: async (_user, value) => { writes.push(structuredClone(value)); saved = structuredClone(value); return { success: true } },
    reset: async () => { saved = { aiProviders: [] }; return { success: true } },
    export: async () => ({ success: true }),
    import: async () => ({ success: true })
  }
  const persistence = new ProtectedSettingsPersistence(() => bridge, () => caches)
  return { bridge, writes, persistence, read: () => saved }
}

const provider = (id: string, apiKey: string) => ({ id, name: id, apiKey, enabled: true, models: [{ id: `${id}-model` }] })

test('legacy credentials migrate through verified desktop storage before clearing every browser copy', async () => {
  const current = provider('openai', 'local-current-fixture')
  const local = cache({ 'app-settings': JSON.stringify({ language: 'en-US', theme: 'light', terminal: { fontSize: 18 }, aiProviders: [current] }), selectedAIModel: JSON.stringify({ provider: current, model: current.models[0] }) })
  const session = cache({ appSettings: JSON.stringify({ terminal: { fontSize: 18 } }), aiProviderConfigs: JSON.stringify([provider('anthropic', 'session-fixture')]) })
  const { persistence, read } = fixture({ aiProviders: [] }, [local, session])
  const migrated = await persistence.get()
  assert.deepEqual(migrated.aiProviders, [current, provider('anthropic', 'session-fixture')])
  assert.equal(migrated.language, 'en-US')
  assert.equal(migrated.theme, 'light')
  assert.deepEqual(migrated.terminal, { fontSize: 18 })
  assert.equal(read().credentialStorageVersion, 1)
  for (const storage of [local, session]) for (const key of ['app-settings', 'appSettings', 'aiProviderConfigs']) assert.equal(storage.getItem(key), null)
  assert.deepEqual(JSON.parse(local.getItem('selectedAIModel') || 'null'), { source: 'local', providerId: 'openai', modelId: 'openai-model' })
})

test('existing desktop provider settings beat old keys, removed models and stale enabled flags', async () => {
  const current = { ...provider('openai', 'new-fixture'), enabled: false, models: [] }
  const local = cache({ 'app-settings': JSON.stringify({ aiProviders: [provider('openai', 'old-fixture')] }) })
  const { persistence } = fixture({ aiProviders: [current] }, [local])
  assert.deepEqual((await persistence.get()).aiProviders, [current])
})

test('retired providers are removed inside the verified migration without losing the user provider', async () => {
  const own = provider('openai', 'own-fixture')
  const local = cache({ 'app-settings': JSON.stringify({ aiProviders: [provider('official', 'retired-fixture'), own] }) })
  const { persistence, writes } = fixture({ aiProviders: [] }, [local])
  assert.deepEqual((await persistence.get()).aiProviders, [own])
  assert.deepEqual(writes[0].aiProviders, [own])
  assert.equal(local.getItem('app-settings'), null)
})

test('local current settings beat session and older settings caches', async () => {
  const local = cache({ 'app-settings': JSON.stringify({ aiProviders: [provider('openai', 'new-fixture')] }), aiProviderConfigs: JSON.stringify([provider('openai', 'old-fixture')]) })
  const session = cache({ 'app-settings': JSON.stringify({ aiProviders: [provider('openai', 'session-fixture')] }) })
  const { persistence } = fixture({}, [local, session])
  assert.deepEqual((await persistence.get()).aiProviders, [provider('openai', 'new-fixture')])
})

test('storage encryption failure preserves all old credentials and selected model snapshots', async () => {
  const raw = JSON.stringify({ aiProviders: [provider('openai', 'retained-fixture')] })
  const local = cache({ 'app-settings': raw, selectedAIModel: raw })
  const { persistence, bridge } = fixture({}, [local])
  bridge.save = async () => { throw new Error('System credential storage unavailable') }
  await assert.rejects(persistence.get(), /unavailable/)
  assert.equal(local.getItem('app-settings'), raw)
  assert.equal(local.getItem('selectedAIModel'), raw)
})

test('readback mismatch leaves old data available for recovery', async () => {
  const raw = JSON.stringify({ aiProviders: [provider('openai', 'fixture')] })
  const local = cache({ 'app-settings': raw })
  const { persistence, bridge } = fixture({}, [local])
  bridge.save = async () => ({ success: true })
  await assert.rejects(persistence.get(), /完整保存/)
  assert.equal(local.getItem('app-settings'), raw)
})

test('malformed legacy settings never trigger a destructive save or cache deletion', async () => {
  const local = cache({ 'app-settings': '{broken' })
  const { persistence, writes } = fixture({}, [local])
  await assert.rejects(persistence.get(), /原有配置已保留/)
  assert.equal(writes.length, 0)
  assert.equal(local.getItem('app-settings'), '{broken')
})

test('migrated desktop settings never resurrect providers removed after migration', async () => {
  const local = cache({ 'app-settings': JSON.stringify({ aiProviders: [provider('openai', 'stale-fixture')] }) })
  const { persistence } = fixture({ credentialStorageVersion: 1, aiProviders: [], language: 'en-US' }, [local])
  assert.deepEqual((await persistence.get()).aiProviders, [])
  assert.equal(local.getItem('app-settings'), null)
})

test('get, save and export are serialized so a slow migration cannot overwrite a new key', async () => {
  const local = cache({ 'app-settings': JSON.stringify({ aiProviders: [provider('openai', 'old-fixture')] }) })
  const { persistence, bridge, read } = fixture({}, [local])
  const save = bridge.save
  bridge.save = async (user, value) => { await new Promise(resolve => setTimeout(resolve, 5)); return save(user, value) }
  const order: string[] = []
  bridge.export = async (_user, filename) => { order.push(filename); assert.deepEqual(read().aiProviders, [provider('openai', 'new-fixture')]); return { success: true } }
  const first = persistence.get()
  const next = persistence.save({ aiProviders: [provider('openai', 'new-fixture')] })
  const exported = persistence.export('settings.json')
  await Promise.all([first, next, exported])
  assert.deepEqual(read().aiProviders, [provider('openai', 'new-fixture')])
  assert.deepEqual(order, ['settings.json'])
  assert.equal(local.getItem('app-settings'), null)
})

test('a failed save does not poison the operation queue', async () => {
  const { persistence, bridge } = fixture({ credentialStorageVersion: 1 })
  const save = bridge.save
  bridge.save = async () => { throw new Error('locked') }
  await assert.rejects(persistence.save({ language: 'en-US' }), /locked/)
  bridge.save = save
  await persistence.save({ language: 'zh-CN' })
  assert.equal((await persistence.get()).language, 'zh-CN')
})

test('selection persistence discards embedded credentials and accepts only model IDs', () => {
  assert.deepEqual(selectedModelReference({ provider: provider('openai', 'secret-fixture'), model: { id: 'model', apiKey: 'other-fixture' } }), { source: 'local', providerId: 'openai', modelId: 'model' })
  assert.equal(selectedModelReference({ providerId: 'official', modelId: 'retired' }), null)
  assert.equal(selectedModelReference({ providerId: 'openai' }), null)
})
