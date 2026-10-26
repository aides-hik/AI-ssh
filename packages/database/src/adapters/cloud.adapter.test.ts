import test from 'node:test'
import assert from 'node:assert/strict'
import { CloudStorageAdapter } from './cloud.adapter.js'

test('cloud transaction callbacks retain adapter methods and use only the scoped Prisma client', async () => {
  const calls: string[] = []
  const record = { id: 'scoped-record', userId: 'transaction-user', data: { theme: 'dark' } }
  const scopedClient = {
    userSettings: {
      create: async () => { calls.push('create'); return record },
      findUnique: async () => { calls.push('findUnique'); return record },
      update: async () => { calls.push('update'); return { ...record, data: { theme: 'light' } } }
    }
  }
  const adapter = Object.create(CloudStorageAdapter.prototype) as CloudStorageAdapter
  Object.assign(adapter, {
    cloudOptions: { retryAttempts: 1, timeout: 1234 },
    prisma: {
      userSettings: new Proxy({}, {
        get: () => assert.fail('transaction operation escaped to the parent Prisma client')
      }),
      $transaction: async (
        callback: (client: typeof scopedClient) => Promise<unknown>,
        options: { timeout: number }
      ) => {
        assert.equal(options.timeout, 1234)
        return callback(scopedClient)
      }
    }
  })

  const result = await adapter.transaction(async tx => {
    assert.ok(tx instanceof CloudStorageAdapter)
    assert.notEqual(tx, adapter)
    assert.equal(tx.type, 'cloud')
    assert.equal((await tx.create('userSettings', record)).id, record.id)
    assert.equal((await tx.findUnique('userSettings', { where: { id: record.id } })).id, record.id)
    return tx.update('userSettings', {
      where: { id: record.id },
      data: { data: { theme: 'light' } }
    })
  })

  assert.deepEqual(calls, ['create', 'findUnique', 'update'])
  assert.deepEqual(result.data, { theme: 'light' })
})
