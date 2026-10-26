import test from 'node:test'
import assert from 'node:assert/strict'
import { StorageManager } from './storage-manager.js'

test('local manager transactions retain adapter methods and commit create, read and update operations', async t => {
  const storage = new StorageManager({ mode: 'local', localOptions: { connectionString: ':memory:' } })
  await storage.connect()
  t.after(() => storage.disconnect())

  const result = await storage.transaction(async tx => {
    const created = await tx.create('UserSettings', {
      userId: 'local-user',
      data: { appearance: { theme: 'dark' } }
    })
    const loaded = await tx.findUnique('UserSettings', { where: { userId: 'local-user' } })
    assert.equal(loaded.id, created.id)
    assert.deepEqual(loaded.data, { appearance: { theme: 'dark' } })

    const updated = await tx.update('UserSettings', {
      where: { userId: 'local-user' },
      data: { data: { appearance: { theme: 'light' } } }
    })
    assert.deepEqual((await tx.findMany('UserSettings')).map(row => row.data), [updated.data])
    return updated
  })

  assert.deepEqual(
    (await storage.findUnique('UserSettings', { where: { userId: 'local-user' } })).data,
    { appearance: { theme: 'light' } }
  )
  assert.equal(result.userId, 'local-user')
})

test('a rejected local manager transaction rolls back new records and changes to existing records', async t => {
  const storage = new StorageManager({ mode: 'local', localOptions: { connectionString: ':memory:' } })
  await storage.connect()
  t.after(() => storage.disconnect())
  const original = await storage.create('UserSettings', { userId: 'local-user', data: { intact: true } })
  const failure = new Error('abort credential migration')

  await assert.rejects(storage.transaction(async tx => {
    await tx.update('UserSettings', {
      where: { userId: 'local-user' },
      data: { data: { intact: false } }
    })
    const temporary = await tx.create('SSHFolder', { name: 'temporary-folder', userId: 'local-user' })
    assert.equal((await tx.findUnique('SSHFolder', { where: { id: temporary.id } })).name, 'temporary-folder')
    throw failure
  }), error => error === failure)

  const remaining = await storage.findMany('UserSettings')
  assert.equal(remaining.length, 1)
  assert.equal(remaining[0].id, original.id)
  assert.deepEqual(remaining[0].data, { intact: true })
  assert.deepEqual(await storage.findMany('SSHFolder'), [])
})
