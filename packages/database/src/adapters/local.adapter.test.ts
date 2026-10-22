import test from 'node:test'
import assert from 'node:assert/strict'
import { LocalStorageAdapter } from './local.adapter.js'

test('settings can be read, updated and deleted using their unique userId', async t => {
  const storage = new LocalStorageAdapter({ connectionString: ':memory:' })
  await storage.connect()
  t.after(() => storage.disconnect())

  const firstSettings = { appearance: { theme: 'dark' }, aiProviders: { custom: { enabled: true } } }
  const created = await storage.create('UserSettings', { userId: 'local-user', data: firstSettings })
  assert.notEqual(created.id, 'local-user')

  const loaded = await storage.findUnique('UserSettings', { where: { userId: 'local-user' } })
  assert.deepEqual(loaded.data, firstSettings)
  assert.equal(loaded.id, created.id)

  const nextSettings = { ...firstSettings, terminal: { fontSize: 18 } }
  const updated = await storage.update('UserSettings', {
    where: { userId: 'local-user' },
    data: { data: nextSettings }
  })
  assert.equal(updated.id, created.id)
  assert.deepEqual(updated.data, nextSettings)
  assert.deepEqual(
    (await storage.findUnique('UserSettings', { where: { userId: 'local-user' } })).data,
    nextSettings
  )
  assert.equal((await storage.findMany('UserSettings')).length, 1)

  assert.equal(await storage.findUnique('UserSettings', { where: { userId: 'missing-user' } }), null)
  assert.equal(await storage.update('UserSettings', {
    where: { userId: 'missing-user' },
    data: { data: { unexpected: true } }
  }), null)
  assert.deepEqual((await storage.findUnique('UserSettings', { where: { id: created.id } })).data, nextSettings)

  await storage.delete('UserSettings', { where: { userId: 'local-user' } })
  assert.equal(await storage.findUnique('UserSettings', { where: { id: created.id } }), null)
})

test('id-based SSH updates still work and missing unique selectors cannot change records', async t => {
  const storage = new LocalStorageAdapter({ connectionString: ':memory:' })
  await storage.connect()
  t.after(() => storage.disconnect())

  const folder = await storage.create('SSHFolder', { name: 'before', userId: 'local-user' })
  const updated = await storage.update('SSHFolder', {
    where: { id: folder.id },
    data: { name: 'after' }
  })
  assert.equal(updated.name, 'after')
  assert.equal(updated.id, folder.id)

  await assert.rejects(storage.update('SSHFolder', { where: {}, data: { name: 'wrong' } }), /unique selector/)
  await assert.rejects(storage.delete('SSHFolder', { where: { id: undefined } }), /unique selector/)
  assert.equal((await storage.findUnique('SSHFolder', { where: { id: folder.id } })).name, 'after')
})
