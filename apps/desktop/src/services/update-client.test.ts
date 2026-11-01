import test from 'node:test'
import assert from 'node:assert/strict'
import { createUpdateClient, type UpdateClientState } from './update-client'

const snapshot = (status = 'idle', extra: Partial<UpdateClientState> = {}): UpdateClientState => ({
  enabled: true, currentVersion: '1.9.7', status, ...extra
})
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
function fixture(overrides: Partial<Window['electronAPI']['updater']> = {}) {
  let pushed: ((state: UpdateClientState) => void) | undefined
  let subscriptions = 0
  let removals = 0
  const bridge = {
    updater: {
      getState: async () => snapshot(),
      startBackgroundCheck: async () => snapshot('up-to-date'),
      cancelBackgroundCheck: async () => snapshot(),
      installDownloadedUpdate: async () => true,
      ...overrides
    },
    onUpdaterStateChange: (callback: (state: UpdateClientState) => void) => {
      subscriptions++
      pushed = callback
      return () => { removals++; if (pushed === callback) pushed = undefined }
    }
  }
  return { client: createUpdateClient(() => bridge), push: (state: UpdateClientState) => {
    assert(pushed); pushed(state)
  }, subscriptions: () => subscriptions, removals: () => removals }
}

test('initialization is shared, resolves before a background download and does not restart it', async () => {
  const initial = deferred<UpdateClientState>()
  const download = deferred<UpdateClientState>()
  let snapshots = 0
  let checks = 0
  const { client, subscriptions } = fixture({
    getState: () => { snapshots++; return initial.promise },
    startBackgroundCheck: () => { checks++; return download.promise }
  })
  const first = client.initialize()
  assert.equal(client.initialize(), first)
  assert.equal(subscriptions(), 1)
  initial.resolve(snapshot())
  assert.equal((await first).status, 'idle')
  assert.equal(checks, 1)
  await client.initialize()
  assert.equal(snapshots, 1)
  assert.equal(checks, 1)
  download.resolve(snapshot('downloaded'))
  await client.startBackgroundCheck()
  assert.equal(client.state.value.status, 'downloaded')
  client.dispose()
})

test('initialization preserves ready packages and checks already running in the main process', async () => {
  for (const status of ['downloaded', 'downloading', 'checking', 'installing', 'up-to-date']) {
    let checks = 0
    const { client } = fixture({ getState: async () => snapshot(status),
      startBackgroundCheck: async () => { checks++; return snapshot() } })
    assert.equal((await client.initialize()).status, status)
    assert.equal(checks, 0)
    client.dispose()
  }
})

test('initialization cannot replace a newer pushed state with an older snapshot', async () => {
  const initial = deferred<UpdateClientState>()
  let checks = 0
  const { client, push } = fixture({ getState: () => initial.promise,
    startBackgroundCheck: async () => { checks++; return snapshot() } })
  const pending = client.initialize()
  push(snapshot('downloading', { progress: 25, downloadedBytes: 50, totalBytes: 200, bytesPerSecond: 2 }))
  initial.resolve(snapshot())
  assert.equal((await pending).status, 'downloading')
  assert.equal(checks, 0)
  push(snapshot('downloaded', { availableVersion: '1.9.9' }))
  assert.equal(client.state.value.bytesPerSecond, undefined)
  assert.equal(client.state.value.downloadedBytes, undefined)
  client.dispose()
})

test('cancel and retry ignore late snapshots and errors from previous operations', async () => {
  const oldCheck = deferred<UpdateClientState>()
  const oldCancellation = deferred<UpdateClientState>()
  let checkCalls = 0
  const { client } = fixture({
    startBackgroundCheck: () => ++checkCalls === 1 ? oldCheck.promise : Promise.resolve(snapshot('downloaded', { availableVersion: '1.9.8' })),
    cancelBackgroundCheck: () => oldCancellation.promise
  })
  const first = client.startBackgroundCheck()
  assert.equal(client.startBackgroundCheck(), first)
  const cancellation = client.cancelBackgroundCheck()
  assert.equal(client.cancelBackgroundCheck(), cancellation)
  await client.startBackgroundCheck()
  oldCheck.resolve(snapshot('error', { error: 'old cancelled check' }))
  oldCancellation.resolve(snapshot())
  await Promise.all([first, cancellation])
  assert.equal(client.state.value.status, 'downloaded')
  assert.equal(client.state.value.error, undefined)
  assert.equal(checkCalls, 2)
  client.dispose()
})

test('install requires ready state, shares concurrent calls and allows retry after launch failure', async () => {
  const installation = deferred<boolean>()
  let calls = 0
  const { client } = fixture({ getState: async () => snapshot('downloaded'),
    installDownloadedUpdate: () => ++calls === 1 ? installation.promise : Promise.resolve(true) })
  await assert.rejects(client.installDownloadedUpdate(), /尚未就绪/)
  await client.initialize()
  const first = client.installDownloadedUpdate()
  assert.equal(client.installDownloadedUpdate(), first)
  assert.equal((await client.startBackgroundCheck()).status, 'downloaded')
  installation.reject(new Error('cannot launch'))
  await assert.rejects(first, /cannot launch/)
  assert.equal(await client.installDownloadedUpdate(), true)
  assert.equal(calls, 2)
  client.dispose()
})

test('an unsuccessful installer IPC result is reported instead of appearing successful', async () => {
  const { client } = fixture({ getState: async () => snapshot('downloaded'), installDownloadedUpdate: async () => false })
  await client.initialize()
  await assert.rejects(client.installDownloadedUpdate(), /无法启动安装程序/)
  client.dispose()
})

test('dispose removes the listener and invalidates pending initialization before a clean remount', async () => {
  const old = deferred<UpdateClientState>()
  let calls = 0
  let checks = 0
  const { client, subscriptions, removals } = fixture({ getState: () => ++calls === 1 ? old.promise : Promise.resolve(snapshot('downloaded')),
    startBackgroundCheck: async () => { checks++; return snapshot() } })
  const pending = client.initialize()
  client.dispose()
  await client.initialize()
  old.resolve(snapshot())
  await pending
  assert.equal(client.state.value.status, 'downloaded')
  assert.equal(checks, 0)
  assert.equal(subscriptions(), 2)
  assert.equal(removals(), 1)
  client.dispose()
  assert.equal(removals(), 2)
})

test('background IPC failures become retryable errors without rejecting successful initialization', async () => {
  const failed = deferred<UpdateClientState>()
  const { client } = fixture({ startBackgroundCheck: () => failed.promise })
  await client.initialize()
  failed.reject(new Error('IPC disconnected'))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(client.state.value.status, 'error')
  assert.match(client.state.value.error || '', /IPC disconnected/)
  client.dispose()
})

test('an initialization snapshot failure can retry without adding a second subscription', async () => {
  let snapshots = 0
  const { client, subscriptions } = fixture({ getState: async () => {
    if (++snapshots === 1) throw new Error('snapshot unavailable')
    return snapshot('downloaded')
  } })
  await assert.rejects(client.initialize(), /snapshot unavailable/)
  assert.equal((await client.initialize()).status, 'downloaded')
  assert.equal(snapshots, 2)
  assert.equal(subscriptions(), 1)
  client.dispose()
})

test('a rejected automatic check cannot overwrite a successful manual retry after cancellation', async () => {
  const old = deferred<UpdateClientState>()
  let checks = 0
  const { client } = fixture({ startBackgroundCheck: () => ++checks === 1 ? old.promise : Promise.resolve(snapshot('downloaded')) })
  await client.initialize()
  await client.cancelBackgroundCheck()
  await client.startBackgroundCheck()
  old.reject(new Error('late cancelled transport'))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(client.state.value.status, 'downloaded')
  assert.equal(client.state.value.error, undefined)
  client.dispose()
})
