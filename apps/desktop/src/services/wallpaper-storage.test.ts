import test from 'node:test'
import assert from 'node:assert/strict'
import { createWallpaperStorage, DEFAULT_WALLPAPER_PREFERENCES, validateWallpaperRecord, type WallpaperRecord } from './wallpaper-storage'

function databaseFixture(initial?: unknown) {
  let value = initial
  let failWrite = false
  let holdWrite = false
  let pendingCommit: (() => void) | undefined
  let closes = 0
  const factory = {
    open() {
      const request: any = {}
      const database = {
        objectStoreNames: { contains: () => true },
        close() { closes++ },
        transaction() {
          const transaction: any = {
            objectStore() {
              return {
                get() {
                  const get: any = {}
                  queueMicrotask(() => {
                    get.result = structuredClone(value)
                    get.onsuccess?.()
                    transaction.oncomplete?.()
                  })
                  return get
                },
                put(next: unknown) {
                  const snapshot = structuredClone(next)
                  const commit = () => {
                    if (failWrite) { failWrite = false; transaction.onabort?.(); return }
                    value = snapshot
                    transaction.oncomplete?.()
                  }
                  queueMicrotask(() => { if (holdWrite) pendingCommit = commit; else commit() })
                }
              }
            }
          }
          return transaction
        }
      }
      queueMicrotask(() => { request.result = database; request.onsuccess?.() })
      return request
    }
  } as unknown as IDBFactory
  return {
    factory, read: () => value, closes: () => closes,
    failNextWrite: () => { failWrite = true },
    holdNextWrite: () => { holdWrite = true },
    releaseWrite: () => { holdWrite = false; pendingCommit?.(); pendingCommit = undefined }
  }
}

const basic = (): WallpaperRecord => ({ preferences: { ...DEFAULT_WALLPAPER_PREFERENCES } })
const custom = (): WallpaperRecord => ({ preferences: { ...DEFAULT_WALLPAPER_PREFERENCES, preset: 'custom' }, image: new Blob(['fixture-image-copy'], { type: 'image/webp' }), imageName: '中文 壁纸.webp' })

test('wallpaper images and preferences survive reopening without retaining the original file path', async () => {
  const fixture = databaseFixture()
  const first = createWallpaperStorage(() => fixture.factory)
  assert.equal(await first.load(), null)
  await first.save(custom())
  const reopened = createWallpaperStorage(() => fixture.factory)
  const recovered = await reopened.load()
  assert.deepEqual(recovered?.preferences, custom().preferences)
  assert.equal(recovered?.imageName, '中文 壁纸.webp')
  assert.equal(await recovered?.image?.text(), 'fixture-image-copy')
  assert.equal(fixture.closes(), 3)
})

test('a failed image write preserves the previous complete record and the queue can retry', async () => {
  const fixture = databaseFixture(basic())
  const storage = createWallpaperStorage(() => fixture.factory)
  fixture.failNextWrite()
  await assert.rejects(storage.save(custom()), /原有壁纸已保留/)
  assert.deepEqual(fixture.read(), basic())
  await storage.save(custom())
  assert.equal((await storage.load())?.preferences.preset, 'custom')
})

test('writes resolve only after the transaction commits and serialize the following read', async () => {
  const fixture = databaseFixture(basic())
  const storage = createWallpaperStorage(() => fixture.factory)
  fixture.holdNextWrite()
  let finished = false
  const saving = storage.save(custom()).then(() => { finished = true })
  const reading = storage.load()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(finished, false)
  assert.deepEqual(fixture.read(), basic())
  fixture.releaseWrite()
  await saving
  assert.equal((await reading)?.imageName, '中文 壁纸.webp')
})

test('unavailable storage and damaged records report an error without replacing saved data', async () => {
  await assert.rejects(createWallpaperStorage(() => undefined).load(), /本地存储权限/)
  const bad = { preferences: { ...DEFAULT_WALLPAPER_PREFERENCES, preset: 'foreign' } }
  const fixture = databaseFixture(bad)
  await assert.rejects(createWallpaperStorage(() => fixture.factory).load(), /格式无效/)
  assert.deepEqual(fixture.read(), bad)
})

test('validation accepts existing image on built-in selection and rejects unsafe preferences or image types', () => {
  const record = custom()
  record.preferences.preset = 'flow'
  assert.equal(validateWallpaperRecord(record).image, record.image)
  for (const preferences of [
    { ...DEFAULT_WALLPAPER_PREFERENCES, dim: Number.NaN },
    { ...DEFAULT_WALLPAPER_PREFERENCES, dim: 71 },
    { ...DEFAULT_WALLPAPER_PREFERENCES, blur: -1 },
    { ...DEFAULT_WALLPAPER_PREFERENCES, fit: 'external-url' }
  ]) assert.throws(() => validateWallpaperRecord({ preferences }), /格式无效/)
  assert.throws(() => validateWallpaperRecord({ ...record, image: new Blob(['<svg/>'], { type: 'image/svg+xml' }) }), /图片无效/)
  assert.throws(() => validateWallpaperRecord({ preferences: { ...DEFAULT_WALLPAPER_PREFERENCES, preset: 'custom' } }), /找不到自定义壁纸/)
})
