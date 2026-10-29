import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { access, mkdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { finished } from 'node:stream/promises'

export interface UpdateSource {
  id: string
  url: string
}

export interface UpdateArtifact {
  version: string
  releaseDate: string
  notes: string
  fileName: string
  size: number
  sha512: string
  sources: UpdateSource[]
}

export interface PlatformUpdateManifest {
  version: string
  releaseDate: string
  notes: string
  platform: string
  artifact: UpdateArtifact
}

export interface UpdateSourceProbeResult {
  sourceId: string
  url: string
  ok: boolean
  durationMs: number
  status?: number
}

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'update-available'
  | 'probing-sources'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'error'

export interface UpdateState {
  enabled: boolean
  status: UpdateStatus
  currentVersion: string
  availableVersion?: string
  progress?: number
  statusText?: string
  downloadedFilePath?: string
  selectedSourceId?: string
  lastCheckedAt?: string
  error?: string
}

export interface UpdateFileStore {
  mkdir: (dirPath: string) => Promise<void>
  exists: (filePath: string) => Promise<boolean>
  createReadStream: (filePath: string) => Readable
  createWriteStream: (filePath: string) => Writable
  rename: (from: string, to: string) => Promise<void>
  remove: (filePath: string) => Promise<void>
}

export function createNodeUpdateFileStore(): UpdateFileStore {
  return {
    mkdir: async directory => {
      await mkdir(directory, { recursive: true })
    },
    exists: async filePath => {
      try {
        await access(filePath)
        return true
      } catch {
        return false
      }
    },
    createReadStream,
    createWriteStream: filePath => createWriteStream(filePath, { flags: 'wx' }),
    rename,
    remove: filePath => rm(filePath, { force: true })
  }
}

interface UpdateTimeouts {
  manifestMs: number
  probeMs: number
  responseMs: number
  idleMs: number
  downloadMs: number
}

interface UpdateOperation {
  controller: AbortController
  committing: boolean
  promise: Promise<UpdateState>
}

interface UpdateServiceDeps {
  currentVersion: string
  platform: NodeJS.Platform
  arch: string
  manifestUrls: string[]
  fetch: typeof fetch
  getUserDataPath: () => string
  fileStore?: UpdateFileStore
  timeouts?: Partial<UpdateTimeouts>
  openPath: (filePath: string) => Promise<string>
  launchInstaller: (filePath: string) => Promise<void>
  emitState: (state: UpdateState) => void
  logger?: {
    info: (message: string, data?: Record<string, unknown>) => void
    warn: (message: string, data?: Record<string, unknown>) => void
    error: (message: string, data?: Record<string, unknown>) => void
  }
}

function abortError() {
  const error = new Error('更新已取消')
  error.name = 'AbortError'
  return error
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : abortError()
}

function withSignal<T>(promise: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const aborted = () => reject(abortReason(signal))
    if (signal.aborted) {
      void Promise.resolve(promise).catch(() => {})
      reject(abortReason(signal))
      return
    }
    signal.addEventListener('abort', aborted, { once: true })
    Promise.resolve(promise)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', aborted))
  })
}

async function withDeadline<T>(
  parent: AbortSignal,
  milliseconds: number,
  label: string,
  work: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController()
  const cancelled = () => controller.abort(abortReason(parent))
  parent.addEventListener('abort', cancelled, { once: true })
  if (parent.aborted) cancelled()
  const timer = setTimeout(() => {
    const error = new Error(`${label}超时，请重试`)
    error.name = 'TimeoutError'
    controller.abort(error)
  }, milliseconds)
  try {
    return await withSignal(
      Promise.resolve().then(() => {
        if (controller.signal.aborted) throw abortReason(controller.signal)
        return work(controller.signal)
      }),
      controller.signal
    )
  } finally {
    clearTimeout(timer)
    parent.removeEventListener('abort', cancelled)
  }
}

export function compareVersions(left: string, right: string) {
  const leftParts = left.split('.').map(value => Number.parseInt(value, 10) || 0)
  const rightParts = right.split('.').map(value => Number.parseInt(value, 10) || 0)
  const length = Math.max(leftParts.length, rightParts.length)

  for (let index = 0; index < length; index += 1) {
    const leftValue = leftParts[index] || 0
    const rightValue = rightParts[index] || 0
    if (leftValue > rightValue) return 1
    if (leftValue < rightValue) return -1
  }

  return 0
}

export function selectFastestSource(results: UpdateSourceProbeResult[]) {
  return [...results]
    .filter(result => result.ok)
    .sort((left, right) => left.durationMs - right.durationMs)[0]
}

export function buildManifestUrls({
  repository,
  githubOwner,
  githubRepo,
  manifestUrl,
  platform,
  arch
}: {
  repository?: string
  githubOwner?: string
  githubRepo?: string
  manifestUrl?: string
  platform: string
  arch: string
}) {
  if (manifestUrl?.trim()) {
    return [manifestUrl.trim().replaceAll('{platform}', platform).replaceAll('{arch}', arch)]
  }

  const configuredRepository =
    repository?.trim() || (githubOwner && githubRepo ? `${githubOwner}/${githubRepo}` : '')
  if (!/^[\w.-]+\/[\w.-]+$/.test(configuredRepository)) return []

  const fileName = `update-manifest-${platform}-${arch}.json`
  const githubUrl = `https://github.com/${configuredRepository}/releases/latest/download/${fileName}`

  return [githubUrl]
}

export class UpdateService {
  private state: UpdateState
  private active: UpdateOperation | null = null
  private readonly files: UpdateFileStore
  private readonly timeouts: UpdateTimeouts

  constructor(private readonly deps: UpdateServiceDeps) {
    this.files = deps.fileStore ?? createNodeUpdateFileStore()
    this.timeouts = {
      manifestMs: 15000,
      probeMs: 8000,
      responseMs: 30000,
      idleMs: 30000,
      downloadMs: 30 * 60 * 1000,
      ...deps.timeouts
    }
    for (const value of Object.values(this.timeouts)) {
      if (!Number.isFinite(value) || value <= 0)
        throw new Error('Update timeouts must be positive finite values')
    }
    this.state = {
      enabled: deps.manifestUrls.length > 0,
      status: 'idle',
      currentVersion: deps.currentVersion,
      ...(deps.manifestUrls.length ? {} : { statusText: '未配置更新源' })
    }
  }

  private log(level: 'info' | 'warn' | 'error', message: string, data?: Record<string, unknown>) {
    this.deps.logger?.[level](message, data)
  }

  getState() {
    return { ...this.state }
  }
  setStateForTest(nextState: UpdateState) {
    this.state = nextState
  }

  startBackgroundCheck(): Promise<UpdateState> {
    if (!this.deps.manifestUrls.length || this.state.status === 'installing')
      return Promise.resolve(this.getState())
    if (this.active) return this.active.promise
    const operation: UpdateOperation = {
      controller: new AbortController(),
      committing: false,
      promise: Promise.resolve(this.getState())
    }
    this.active = operation
    operation.promise = this.runBackgroundCheck(operation).finally(() => {
      if (this.active === operation) this.active = null
    })
    return operation.promise
  }

  cancelBackgroundCheck(): UpdateState {
    const operation = this.active
    if (!operation) return this.getState()
    // A rename already submitted to the filesystem cannot be rolled back safely.
    if (operation.committing) return this.getState()
    this.active = null
    operation.controller.abort(abortError())
    this.updateState({
      status: 'idle',
      statusText: '更新已取消，可重新检查',
      error: undefined,
      progress: undefined
    })
    return this.getState()
  }

  async installDownloadedUpdate() {
    const filePath = this.state.downloadedFilePath
    if (!filePath) throw new Error('No downloaded update available')
    if (this.state.status === 'installing') return
    const direct =
      this.deps.platform === 'win32' ||
      (this.deps.platform === 'linux' && filePath.toLowerCase().endsWith('.appimage'))
    this.updateState({
      status: 'installing',
      statusText: direct ? '正在启动安装程序' : '正在打开安装包',
      error: undefined
    })
    try {
      if (direct) {
        this.log('info', 'Launching cached installer directly', {
          filePath,
          platform: this.deps.platform
        })
        await this.deps.launchInstaller(filePath)
      } else {
        this.log('info', 'Opening cached update package with system handler', {
          filePath,
          platform: this.deps.platform
        })
        const error = await this.deps.openPath(filePath)
        if (error) throw new Error(error)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.updateState({
        status: 'downloaded',
        statusText: '安装程序启动失败，可重试',
        error: message
      })
      throw error
    }
  }

  private assertCurrent(operation: UpdateOperation) {
    if (this.active !== operation || operation.controller.signal.aborted)
      throw abortReason(operation.controller.signal)
  }

  private updateOperation(operation: UpdateOperation, patch: Partial<UpdateState>) {
    this.assertCurrent(operation)
    this.updateState(patch)
  }

  private updateState(patch: Partial<UpdateState>) {
    this.state = { ...this.state, ...patch }
    this.deps.emitState(this.getState())
  }

  private async fetchResponse(
    url: string,
    signal: AbortSignal,
    init?: RequestInit
  ): Promise<Response> {
    const pending = Promise.resolve().then(() => this.deps.fetch(url, { ...init, signal }))
    // Dispose late responses even when a transport ignores cancellation.
    void pending.then(
      response => {
        if (signal.aborted) void response.body?.cancel().catch(() => {})
      },
      () => {}
    )
    return withSignal(pending, signal)
  }

  private async runBackgroundCheck(operation: UpdateOperation): Promise<UpdateState> {
    const signal = operation.controller.signal
    try {
      this.updateOperation(operation, {
        status: 'checking',
        statusText: '正在检查更新',
        error: undefined,
        progress: undefined,
        downloadedFilePath: undefined,
        selectedSourceId: undefined,
        lastCheckedAt: new Date().toISOString()
      })
      const manifest = await this.fetchManifest(signal)
      this.assertCurrent(operation)
      const version = manifest.artifact.version || manifest.version
      if (compareVersions(version, this.state.currentVersion) <= 0) {
        this.updateOperation(operation, {
          status: 'up-to-date',
          availableVersion: version,
          statusText: '当前已是最新版本'
        })
        return this.getState()
      }
      if (
        !/^[\w.-]+$/.test(version) ||
        version === '.' ||
        version === '..' ||
        path.basename(manifest.artifact.fileName) !== manifest.artifact.fileName ||
        /[\\/]/.test(manifest.artifact.fileName) ||
        !manifest.artifact.fileName
      ) {
        throw new Error('Invalid update artifact path')
      }
      const target = path.join(this.deps.getUserDataPath(), version, manifest.artifact.fileName)
      this.updateOperation(operation, {
        status: 'update-available',
        availableVersion: version,
        statusText: `发现新版本 ${version}`
      })
      if (await this.isCachedArtifactValid(target, manifest.artifact, signal)) {
        this.assertCurrent(operation)
        this.log('info', 'Using cached update package', { filePath: target })
      } else {
        this.updateOperation(operation, {
          status: 'probing-sources',
          statusText: '正在检测最快下载源'
        })
        const source = await this.pickBestSource(manifest.artifact.sources, signal)
        this.assertCurrent(operation)
        if (!source) throw new Error('No available update source')
        this.updateOperation(operation, {
          status: 'downloading',
          selectedSourceId: source.sourceId,
          progress: 0,
          statusText: `正在后台下载更新（${source.sourceId}）`
        })
        await this.downloadArtifact(source.url, target, manifest.artifact, operation)
      }
      this.updateOperation(operation, {
        status: 'downloaded',
        availableVersion: version,
        downloadedFilePath: target,
        progress: 100,
        statusText: `新版本 ${version} 已准备完成，可直接安装`
      })
    } catch (error) {
      if (this.active !== operation || signal.aborted) return this.getState()
      const message = error instanceof Error ? error.message : String(error)
      this.log('error', 'Background update check failed', { error: message })
      this.updateOperation(operation, {
        status: 'error',
        error: message,
        statusText: `更新失败：${message}`,
        progress: undefined
      })
    }
    return this.getState()
  }

  private async fetchManifest(signal: AbortSignal): Promise<PlatformUpdateManifest> {
    let lastError: unknown
    for (const url of this.deps.manifestUrls) {
      try {
        return await withDeadline(
          signal,
          this.timeouts.manifestMs,
          '更新检查',
          async requestSignal => {
            const response = await this.fetchResponse(url, requestSignal)
            try {
              if (!response.ok) throw new Error(`Manifest request failed with ${response.status}`)
              if (!response.body) throw new Error('Empty update manifest')
              const reader = response.body.getReader()
              const chunks: Uint8Array[] = []
              let size = 0
              let manifest: PlatformUpdateManifest
              const cancelled = () => {
                void reader.cancel(abortReason(requestSignal)).catch(() => {})
              }
              requestSignal.addEventListener('abort', cancelled, { once: true })
              try {
                while (true) {
                  const item = await withSignal(reader.read(), requestSignal)
                  if (item.done) break
                  size += item.value.byteLength
                  if (size > 4 * 1024 * 1024) throw new Error('Update manifest is too large')
                  chunks.push(item.value)
                }
                manifest = JSON.parse(
                  Buffer.concat(chunks).toString('utf8')
                ) as PlatformUpdateManifest
              } finally {
                requestSignal.removeEventListener('abort', cancelled)
                void reader.cancel().catch(() => {})
              }
              if (
                !manifest?.artifact ||
                !Array.isArray(manifest.artifact.sources) ||
                !Number.isSafeInteger(manifest.artifact.size) ||
                manifest.artifact.size <= 0 ||
                typeof manifest.artifact.sha512 !== 'string'
              )
                throw new Error('Invalid update manifest')
              return manifest
            } finally {
              void response.body?.cancel().catch(() => {})
            }
          }
        )
      } catch (error) {
        if (signal.aborted) throw abortReason(signal)
        this.log('warn', 'Manifest request failed', {
          manifestUrl: url,
          error: error instanceof Error ? error.message : String(error)
        })
        lastError = error
      }
    }
    throw lastError || new Error('Unable to fetch update manifest')
  }

  private async isCachedArtifactValid(
    filePath: string,
    artifact: UpdateArtifact,
    signal: AbortSignal
  ): Promise<boolean> {
    return withDeadline(signal, this.timeouts.responseMs, '更新缓存校验', async readSignal => {
      if (!(await withSignal(this.files.exists(filePath), readSignal))) return false
      const stream = this.files.createReadStream(filePath)
      const hash = createHash('sha512')
      let bytes = 0
      const cancel = () => stream.destroy(abortReason(readSignal))
      readSignal.addEventListener('abort', cancel, { once: true })
      try {
        for await (const chunk of stream) {
          if (readSignal.aborted) throw abortReason(readSignal)
          bytes += chunk.length
          if (bytes > artifact.size) return false
          hash.update(chunk)
        }
        return bytes === artifact.size && hash.digest('base64') === artifact.sha512
      } finally {
        readSignal.removeEventListener('abort', cancel)
        stream.destroy()
      }
    })
  }

  private async pickBestSource(sources: UpdateSource[], signal: AbortSignal) {
    const results = await Promise.all(sources.map(source => this.probeSource(source, signal)))
    return selectFastestSource(results)
  }

  private async probeSource(
    source: UpdateSource,
    signal: AbortSignal
  ): Promise<UpdateSourceProbeResult> {
    const start = Date.now()
    try {
      return await withDeadline(signal, this.timeouts.probeMs, '更新源测速', async probeSignal => {
        let response = await this.fetchResponse(source.url, probeSignal, { method: 'HEAD' })
        if (!response.ok) {
          void response.body?.cancel().catch(() => {})
          response = await this.fetchResponse(source.url, probeSignal, {
            method: 'GET',
            headers: { Range: 'bytes=0-0' }
          })
        }
        void response.body?.cancel().catch(() => {})
        return {
          sourceId: source.id,
          url: source.url,
          ok: response.ok,
          status: response.status,
          durationMs: Date.now() - start
        }
      })
    } catch {
      if (signal.aborted) throw abortReason(signal)
      return { sourceId: source.id, url: source.url, ok: false, durationMs: Date.now() - start }
    }
  }

  private async downloadArtifact(
    url: string,
    target: string,
    artifact: UpdateArtifact,
    operation: UpdateOperation
  ) {
    const temporary = `${target}.${randomUUID()}.part`
    let verified = false
    try {
      await withDeadline(
        operation.controller.signal,
        this.timeouts.downloadMs,
        '更新下载',
        async signal => {
          const response = await withDeadline(
            signal,
            this.timeouts.responseMs,
            '更新下载响应',
            requestSignal => this.fetchResponse(url, requestSignal)
          )
          if (!response.ok || !response.body) {
            void response.body?.cancel().catch(() => {})
            throw new Error(`Download failed with ${response.status}`)
          }
          try {
            this.assertCurrent(operation)
            await withSignal(this.files.mkdir(path.dirname(target)), signal)
            if (signal.aborted) throw abortReason(signal)
            this.assertCurrent(operation)
            const writer = this.files.createWriteStream(temporary)
            const writeFinished = finished(writer)
            // Listen immediately: a disk open/write error may arrive while the network is idle.
            void writeFinished.catch(() => {})
            const reader = response.body.getReader()
            const transfer = new AbortController()
            const transferSignal = transfer.signal
            const parentCancelled = () => transfer.abort(abortReason(signal))
            signal.addEventListener('abort', parentCancelled, { once: true })
            if (signal.aborted) parentCancelled()
            void writeFinished.catch(error => transfer.abort(error))
            const hash = createHash('sha512')
            let received = 0
            const cancel = () => {
              writer.destroy(abortReason(transferSignal))
              void reader.cancel(abortReason(transferSignal)).catch(() => {})
            }
            transferSignal.addEventListener('abort', cancel, { once: true })
            if (transferSignal.aborted) cancel()
            try {
              while (true) {
                const item = await withDeadline(
                  transferSignal,
                  this.timeouts.idleMs,
                  '更新下载等待',
                  readSignal => withSignal(reader.read(), readSignal)
                )
                if (item.done) break
                if (!item.value) continue
                received += item.value.byteLength
                if (received > artifact.size) throw new Error('Downloaded artifact size mismatch')
                hash.update(item.value)
                await withDeadline(
                  transferSignal,
                  this.timeouts.idleMs,
                  '更新文件写入',
                  writeSignal =>
                    withSignal(
                      new Promise<void>((resolve, reject) => {
                        writer.write(item.value, error => (error ? reject(error) : resolve()))
                      }),
                      writeSignal
                    )
                )
                this.updateOperation(operation, {
                  progress: Math.min(99, Math.round((received / artifact.size) * 100))
                })
              }
              if (received !== artifact.size) throw new Error('Downloaded artifact size mismatch')
              if (hash.digest('base64') !== artifact.sha512)
                throw new Error('Downloaded artifact hash mismatch')
              writer.end()
              await withSignal(writeFinished, signal)
              if (signal.aborted) throw abortReason(signal)
              this.assertCurrent(operation)
              verified = true
            } finally {
              signal.removeEventListener('abort', parentCancelled)
              transferSignal.removeEventListener('abort', cancel)
              writer.destroy()
              void reader.cancel().catch(() => {})
              await writeFinished.catch(() => {})
              if (!verified) await this.files.remove(temporary).catch(() => {})
            }
          } finally {
            void response.body.cancel().catch(() => {})
          }
        }
      )
      this.assertCurrent(operation)
      operation.committing = true
      await this.files.rename(temporary, target)
    } catch (error) {
      await this.files.remove(temporary).catch(() => {})
      throw error
    } finally {
      operation.committing = false
    }
  }
}
