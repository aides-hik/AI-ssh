import test from 'node:test'
import assert from 'node:assert/strict'
import { useUpdateClient, type UpdateClientState } from './update-client'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => {
    resolve = done
  })
  return { promise, resolve }
}

test('cancel and retry ignore late IPC snapshots from the cancelled check and cancellation', async context => {
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  context.after(() => {
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  })
  const oldCheck = deferred<UpdateClientState>()
  const oldCancellation = deferred<UpdateClientState>()
  let checkCalls = 0
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      electronAPI: {
        updater: {
          startBackgroundCheck: () =>
            ++checkCalls === 1
              ? oldCheck.promise
              : Promise.resolve({
                  enabled: true,
                  currentVersion: '1.9.7',
                  status: 'downloaded',
                  availableVersion: '1.9.8'
                }),
          cancelBackgroundCheck: () => oldCancellation.promise
        }
      }
    }
  })
  const client = useUpdateClient()
  const first = client.startBackgroundCheck()
  const cancellation = client.cancelBackgroundCheck()
  const retry = await client.startBackgroundCheck()
  assert.equal(retry.status, 'downloaded')
  oldCheck.resolve({
    enabled: true,
    currentVersion: '1.9.7',
    status: 'error',
    error: 'old cancelled check'
  })
  oldCancellation.resolve({ enabled: true, currentVersion: '1.9.7', status: 'idle' })
  await Promise.all([first, cancellation])
  assert.equal(client.state.value.status, 'downloaded')
  assert.equal(client.state.value.error, undefined)
  assert.equal(client.state.value.availableVersion, '1.9.8')
})

test('initialization cannot replace a newer pushed state with an older getState result', async context => {
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  context.after(() => {
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  })
  const snapshot = deferred<UpdateClientState>()
  let pushed: ((state: UpdateClientState) => void) | undefined
  let checks = 0
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      electronAPI: {
        updater: {
          getState: () => snapshot.promise,
          startBackgroundCheck: async () => {
            checks++
            throw new Error('must not start a stale check')
          }
        },
        onUpdaterStateChange: (callback: (state: UpdateClientState) => void) => {
          pushed = callback
        }
      }
    }
  })
  const client = useUpdateClient()
  const initial = client.initialize()
  assert(pushed)
  pushed({
    enabled: true,
    currentVersion: '1.9.7',
    status: 'downloaded',
    availableVersion: '1.9.9'
  })
  snapshot.resolve({ enabled: true, currentVersion: '1.9.7', status: 'idle' })
  assert.equal((await initial).availableVersion, '1.9.9')
  assert.equal(client.state.value.status, 'downloaded')
  assert.equal(checks, 0)
})
