import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, stat, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  UpdateService,
  createNodeUpdateFileStore,
  buildManifestUrls,
  compareVersions,
  selectFastestSource,
  type PlatformUpdateManifest,
  type UpdateState
} from './update-service.ts'

type Dependencies = ConstructorParameters<typeof UpdateService>[0]
const payload = Buffer.from('verified update payload')
function manifest(data = payload): PlatformUpdateManifest {
  return {
    version: '1.9.8',
    releaseDate: '',
    notes: '',
    platform: 'win32-x64',
    artifact: {
      version: '1.9.8',
      releaseDate: '',
      notes: '',
      fileName: 'setup.exe',
      size: data.length,
      sha512: createHash('sha512').update(data).digest('base64'),
      sources: [{ id: 'primary', url: 'https://download.invalid/setup.exe' }]
    }
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => {
    resolve = done
  })
  return { promise, resolve }
}
async function fixture(context: TestContext, overrides: Partial<Dependencies> = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'prism-updater-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const states: UpdateState[] = []
  const deps: Dependencies = {
    currentVersion: '1.9.7',
    platform: 'win32',
    arch: 'x64',
    manifestUrls: ['https://manifest.invalid/latest.json'],
    getUserDataPath: () => directory,
    fetch: async (input, init) =>
      String(input).includes('manifest.invalid')
        ? Response.json(manifest())
        : init?.method === 'HEAD'
          ? new Response(null)
          : new Response(payload),
    openPath: async () => '',
    launchInstaller: async () => {},
    emitState: state => states.push(state),
    ...overrides
  }
  return {
    service: new UpdateService(deps),
    directory,
    states,
    target: path.join(directory, '1.9.8', 'setup.exe')
  }
}
async function waitFor(check: () => Promise<boolean>) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await check()) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  assert.fail('Expected updater cleanup did not finish')
}

test('versions, manifest URLs and successful source selection retain their behavior', () => {
  assert.equal(compareVersions('1.9.8', '1.9.7'), 1)
  assert.equal(compareVersions('1.9.7', '1.9.7'), 0)
  assert.equal(compareVersions('1.9.6', '1.9.7'), -1)
  assert.deepEqual(
    buildManifestUrls({ repository: 'owner/repository', platform: 'darwin', arch: 'arm64' }),
    [
      'https://github.com/owner/repository/releases/latest/download/update-manifest-darwin-arm64.json'
    ]
  )
  assert.deepEqual(buildManifestUrls({ platform: 'win32', arch: 'x64' }), [])
  assert.deepEqual(buildManifestUrls({ repository: 'invalid', platform: 'win32', arch: 'x64' }), [])
  assert.deepEqual(
    buildManifestUrls({
      manifestUrl: 'https://updates.invalid/{platform}/{arch}.json',
      platform: 'linux',
      arch: 'x64'
    }),
    ['https://updates.invalid/linux/x64.json']
  )
  assert.equal(
    selectFastestSource([
      { sourceId: 'failed', url: '', ok: false, durationMs: 1 },
      { sourceId: 'good', url: '', ok: true, durationMs: 10 }
    ])?.sourceId,
    'good'
  )
})

test('unconfigured updater never fetches', async context => {
  const { service } = await fixture(context, {
    manifestUrls: [],
    fetch: async () => {
      throw new Error('must not fetch')
    }
  })
  assert.equal((await service.startBackgroundCheck()).enabled, false)
})

test('cache validation streams real files and skips downloading a valid package', async context => {
  let networkCalls = 0
  const { service, target } = await fixture(context, {
    fetch: async () => {
      networkCalls++
      return Response.json(manifest())
    }
  })
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, payload)
  const state = await service.startBackgroundCheck()
  assert.equal(state.status, 'downloaded')
  assert.equal(state.downloadedFilePath, target)
  assert.equal(networkCalls, 1)
})

test('download writes chunks to a real exclusive temporary file and commits only after size and hash verification', async context => {
  const first = Buffer.alloc(64 * 1024, 'a')
  const second = Buffer.alloc(64 * 1024, 'b')
  const data = Buffer.concat([first, second])
  const continueDownload = deferred<void>()
  const wroteChunk = deferred<void>()
  const { service, target } = await fixture(context, {
    fetch: async (input, init) => {
      if (String(input).includes('manifest.invalid')) return Response.json(manifest(data))
      if (init?.method === 'HEAD') return new Response(null)
      const response = new Response(
        new ReadableStream({
          async start(controller) {
            controller.enqueue(first)
            await continueDownload.promise
            controller.enqueue(second)
            controller.close()
          }
        })
      )
      response.arrayBuffer = async () => {
        throw new Error('Download must not buffer the response')
      }
      return response
    },
    emitState: state => {
      if ((state.progress || 0) > 0 && state.status === 'downloading') wroteChunk.resolve()
    }
  })
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, 'original package')
  const pending = service.startBackgroundCheck()
  await wroteChunk.promise
  assert.equal((await readFile(target)).toString(), 'original package')
  const partial = (await readdir(path.dirname(target))).find(file => file.endsWith('.part'))
  assert(partial)
  assert.equal((await stat(path.join(path.dirname(target), partial))).size, first.length)
  continueDownload.resolve()
  assert.equal((await pending).status, 'downloaded')
  assert.deepEqual(await readFile(target), data)
  assert.deepEqual(await readdir(path.dirname(target)), ['setup.exe'])
})

test('a hash mismatch leaves an existing package intact and removes the temporary download', async context => {
  const { service, target } = await fixture(context, {
    fetch: async (input, init) =>
      String(input).includes('manifest.invalid')
        ? Response.json(manifest())
        : init?.method === 'HEAD'
          ? new Response(null)
          : new Response(Buffer.alloc(payload.length, 'x'))
  })
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, 'old cache')
  const state = await service.startBackgroundCheck()
  assert.equal(state.status, 'error')
  assert.match(state.error || '', /hash mismatch/)
  assert.equal((await readFile(target)).toString(), 'old cache')
  assert.deepEqual(await readdir(path.dirname(target)), ['setup.exe'])
})

test('filesystem preparation failures cancel the acquired response body', async context => {
  for (const failure of ['mkdir', 'createWriteStream'] as const) {
    let cancelled = false
    const files = createNodeUpdateFileStore()
    const { service } = await fixture(context, {
      fileStore: {
        ...files,
        [failure]: () => {
          throw new Error('disk preparation failed')
        }
      },
      fetch: async (input, init) =>
        String(input).includes('manifest.invalid')
          ? Response.json(manifest())
          : init?.method === 'HEAD'
            ? new Response(null)
            : new Response(
                new ReadableStream({
                  cancel() {
                    cancelled = true
                  }
                })
              )
    })
    assert.equal((await service.startBackgroundCheck()).status, 'error')
    assert.equal(cancelled, true)
  }
})

test('manifest transport deadlines settle even when fetch ignores abort and a retry starts a new request', async context => {
  let calls = 0
  let firstSignal: AbortSignal | null | undefined
  const { service } = await fixture(context, {
    timeouts: { manifestMs: 30 },
    fetch: async (_input, init) => {
      calls++
      if (calls === 1) {
        firstSignal = init?.signal
        return new Promise<Response>(() => {})
      }
      const latest = manifest()
      latest.artifact.version = '1.9.7'
      return Response.json(latest)
    }
  })
  const first = service.startBackgroundCheck()
  assert.equal(service.startBackgroundCheck(), first)
  const failed = await first
  assert.equal(failed.status, 'error')
  assert.match(failed.error || '', /超时/)
  assert.equal(firstSignal?.aborted, true)
  assert.equal((await service.startBackgroundCheck()).status, 'up-to-date')
  assert.equal(calls, 2)
})

test('a manifest body that never finishes times out and falls back to another manifest', async context => {
  let bodyCancelled = false
  const { service } = await fixture(context, {
    manifestUrls: ['https://manifest.invalid/hanging', 'https://manifest.invalid/fallback'],
    timeouts: { manifestMs: 30 },
    fetch: async input => {
      if (String(input).endsWith('hanging'))
        return new Response(
          new ReadableStream({
            cancel() {
              bodyCancelled = true
            }
          })
        )
      const latest = manifest()
      latest.artifact.version = '1.9.7'
      return Response.json(latest)
    }
  })
  assert.equal((await service.startBackgroundCheck()).status, 'up-to-date')
  assert.equal(bodyCancelled, true)
})

test('source probing has a deadline, cancels range response bodies and chooses a working source', async context => {
  let rangeCancelled = false
  const { service } = await fixture(context, {
    timeouts: { probeMs: 30 },
    fetch: async (input, init) => {
      const url = String(input)
      if (url.includes('manifest.invalid')) {
        const data = manifest()
        data.artifact.sources = [
          { id: 'hanging', url: 'https://hanging.invalid/file' },
          { id: 'working', url: 'https://working.invalid/file' }
        ]
        return Response.json(data)
      }
      if (url.includes('hanging')) return new Promise<Response>(() => {})
      if (init?.method === 'HEAD') return new Response(null, { status: 405 })
      if (init?.headers && 'Range' in init.headers)
        return new Response(
          new ReadableStream({
            cancel() {
              rangeCancelled = true
            }
          })
        )
      return new Response(payload)
    }
  })
  const state = await service.startBackgroundCheck()
  assert.equal(state.status, 'downloaded')
  assert.equal(state.selectedSourceId, 'working')
  assert.equal(rangeCancelled, true)
})

test('download header and idle timeouts settle and do not expose an installer path', async context => {
  for (const stage of ['headers', 'body'] as const) {
    const { service, target } = await fixture(context, {
      timeouts: { responseMs: 40, idleMs: 30 },
      fetch: async (input, init) => {
        if (String(input).includes('manifest.invalid')) return Response.json(manifest())
        if (init?.method === 'HEAD') return new Response(null)
        return stage === 'headers'
          ? new Promise<Response>(() => {})
          : new Response(new ReadableStream())
      }
    })
    const state = await service.startBackgroundCheck()
    assert.equal(state.status, 'error')
    assert.match(state.error || '', /超时/)
    assert.equal(state.downloadedFilePath, undefined)
    await waitFor(async () => {
      try {
        return (await readdir(path.dirname(target))).length === 0
      } catch {
        return true
      }
    })
  }
})

test('cancelled stale checks cannot overwrite a retry after their ignored fetch eventually resolves', async context => {
  const oldResponse = deferred<Response>()
  let calls = 0
  const { service, states } = await fixture(context, {
    fetch: async () => {
      calls++
      if (calls === 1) return oldResponse.promise
      const latest = manifest()
      latest.artifact.version = '1.9.7'
      return Response.json(latest)
    }
  })
  const old = service.startBackgroundCheck()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(service.cancelBackgroundCheck().status, 'idle')
  assert.equal((await service.startBackgroundCheck()).status, 'up-to-date')
  const count = states.length
  oldResponse.resolve(Response.json(manifest()))
  await old
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(service.getState().status, 'up-to-date')
  assert.equal(states.length, count)
})

test('cancelling a stalled download settles immediately, clears partial files and allows retry', async context => {
  const downloading = deferred<void>()
  let attempts = 0
  const { service, target } = await fixture(context, {
    emitState: state => {
      if (state.status === 'downloading') downloading.resolve()
    },
    fetch: async (input, init) => {
      if (String(input).includes('manifest.invalid')) return Response.json(manifest())
      if (init?.method === 'HEAD') return new Response(null)
      attempts++
      return attempts === 1 ? new Response(new ReadableStream()) : new Response(payload)
    }
  })
  const pending = service.startBackgroundCheck()
  await downloading.promise
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(service.cancelBackgroundCheck().status, 'idle')
  await pending
  assert.equal((await service.startBackgroundCheck()).status, 'downloaded')
  assert.deepEqual(await readFile(target), payload)
  await waitFor(async () =>
    (await readdir(path.dirname(target))).every(file => !file.endsWith('.part'))
  )
})

test('installer launch and openPath errors restore downloaded state and permit installation retry', async context => {
  for (const platform of ['win32', 'darwin', 'linux'] as const) {
    let attempts = 0
    const { service } = await fixture(context, {
      platform,
      launchInstaller: async () => {
        if (++attempts === 1) throw new Error('spawn failed')
      },
      openPath: async () => (++attempts === 1 ? 'no associated application' : '')
    })
    const file =
      platform === 'darwin' ? 'update.dmg' : platform === 'linux' ? 'update.AppImage' : 'setup.exe'
    service.setStateForTest({
      enabled: true,
      status: 'downloaded',
      currentVersion: '1.9.7',
      downloadedFilePath: file
    })
    await assert.rejects(service.installDownloadedUpdate())
    assert.equal(service.getState().status, 'downloaded')
    assert(service.getState().error)
    assert.equal(service.getState().downloadedFilePath, file)
    await service.installDownloadedUpdate()
    assert.equal(service.getState().status, 'installing')
    assert.equal(service.getState().error, undefined)
    assert.equal(attempts, 2)
  }
})

test('a submitted atomic commit finishes before cancellation or another check can start', async context => {
  const commit = deferred<void>()
  const committing = deferred<void>()
  const files = createNodeUpdateFileStore()
  const { service, target } = await fixture(context, {
    fileStore: {
      ...files,
      rename: async (from, to) => {
        committing.resolve()
        await commit.promise
        await files.rename(from, to)
      }
    }
  })
  const pending = service.startBackgroundCheck()
  await committing.promise
  assert.equal(service.cancelBackgroundCheck().status, 'downloading')
  assert.equal(service.startBackgroundCheck(), pending)
  commit.resolve()
  assert.equal((await pending).status, 'downloaded')
  assert.deepEqual(await readFile(target), payload)
})
