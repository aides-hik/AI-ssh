import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { SFTPWrapper, Stats } from 'ssh2'

export interface AtomicFileTransferOptions {
  sftp: SFTPWrapper
  direction: 'upload' | 'download'
  localPath: string
  remotePath: string
  signal: AbortSignal
  approveOverwrite: (target: string) => Promise<boolean>
  /** From this point a cancellation cannot promise that the target was unchanged. */
  beginCommit: () => void
  onProgress: (transferred: number, total: number) => void
}

const CHUNK_SIZE = 256 * 1024
const REQUEST_TIMEOUT_MS = 30000
const CLEANUP_TIMEOUT_MS = 1000

function abortError(): Error {
  const error = new Error('TRANSFER_CANCELLED: 文件传输已取消，原目标文件保持不变。')
  error.name = 'AbortError'
  return error
}

function checkLive(signal: AbortSignal) {
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : abortError()
}

/** Bound each SFTP wait, including cleanup after a lost connection. */
function request<T>(
  start: (done: (error: Error | undefined | null, value: T) => void) => void,
  signal?: AbortSignal,
  timeoutMs = REQUEST_TIMEOUT_MS,
  lateResult?: (value: T) => void
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error?: unknown, value?: T) => {
      if (settled) {
        if (!error && value !== undefined) lateResult?.(value)
        return
      }
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve(value as T)
    }
    const onAbort = () => finish(signal?.reason instanceof Error ? signal.reason : abortError())
    const timer = setTimeout(() => finish(new Error('SFTP 请求超时；原目标未被替换，请检查连接后重试。')), timeoutMs)
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) { onAbort(); return }
    try { start((error, value) => finish(error, value)) } catch (error) { finish(error) }
  })
}

function missing(error: unknown) {
  const code = (error as { code?: unknown })?.code
  return code === 2 || code === 'ENOENT'
}

async function remoteStat(sftp: SFTPWrapper, target: string, signal: AbortSignal): Promise<Stats | null> {
  try {
    return await request<Stats>(done => sftp.lstat(target, done), signal)
  } catch (error) {
    if (missing(error)) return null
    throw error
  }
}

async function localStat(target: string) {
  try { return await fs.lstat(target) } catch (error) {
    if (missing(error)) return null
    throw error
  }
}

function unchanged(before: { size: number; mtime: number; mode: number } | null, after: Stats | null) {
  return before === null ? after === null : after !== null &&
    before.size === after.size && before.mtime === after.mtime && before.mode === after.mode
}

function assertSize(actual: number, expected: number) {
  if (actual !== expected) throw new Error('传输文件大小不一致，原目标未被替换。')
}

function reportProgress(options: AtomicFileTransferOptions, transferred: number, total: number) {
  // Losing a renderer/progress listener cannot undo or relabel a committed copy.
  try { options.onProgress(transferred, total) } catch { /* Progress is an observer. */ }
}

/**
 * Copies through an exclusively created file next to the destination. Only the
 * final rename/link can affect the target; a failed copy never truncates it.
 */
export async function atomicFileTransfer(options: AtomicFileTransferOptions): Promise<void> {
  const { signal, direction } = options
  checkLive(signal)
  if (direction === 'upload') await upload(options)
  else await download(options)
}

async function upload(options: AtomicFileTransferOptions) {
  const { sftp, signal, localPath, remotePath } = options
  const target = await remoteStat(sftp, remotePath, signal)
  checkLive(signal)
  if (target && !target.isFile()) throw new Error('远端目标不是普通文件，未进行覆盖。')
  const supportsAtomicReplace = (sftp as unknown as { _extensions?: Record<string, string> })._extensions?.['posix-rename@openssh.com'] === '1'
  if (target) {
    if (!supportsAtomicReplace) throw new Error('此服务器不支持安全的原子覆盖，原文件已保留。请更换文件名后上传。')
    if (!(await options.approveOverwrite(remotePath))) throw abortError()
  }
  checkLive(signal)
  const source = await fs.open(localPath, 'r')
  const temporary = path.posix.join(path.posix.dirname(remotePath), `.prism-transfer-${randomUUID()}.part`)
  let remoteHandle: Buffer | undefined
  let temporaryOwned = false
  let committed = false
  try {
    const original = await source.stat()
    if (!original.isFile()) throw new Error('上传源不是普通文件。')
    checkLive(signal)
    remoteHandle = await request<Buffer>(
      done => sftp.open(temporary, 'wx', { mode: target ? target.mode & 0o777 : 0o600 }, done),
      signal,
      REQUEST_TIMEOUT_MS,
      handle => {
        // An OPEN reply may arrive after cancellation; remove only the file we
        // successfully created, never a colliding name that we do not own.
        void request<void>(done => sftp.close(handle, done), undefined, CLEANUP_TIMEOUT_MS)
          .catch(() => {})
          .then(() => request<void>(done => sftp.unlink(temporary, done), undefined, CLEANUP_TIMEOUT_MS))
          .catch(() => {})
      }
    )
    temporaryOwned = true
    const openedHandle = remoteHandle
    const buffer = Buffer.allocUnsafe(CHUNK_SIZE)
    let transferred = 0
    reportProgress(options, 0, original.size)
    while (transferred < original.size) {
      checkLive(signal)
      const { bytesRead } = await source.read(buffer, 0, Math.min(buffer.length, original.size - transferred), transferred)
      if (!bytesRead) throw new Error('上传源在传输期间缩短，原目标未被替换。')
      checkLive(signal)
      await request<void>(done => sftp.write(openedHandle, buffer, 0, bytesRead, transferred, done), signal)
      transferred += bytesRead
      reportProgress(options, transferred, original.size)
    }
    const current = await source.stat()
    if (current.size !== original.size || current.mtimeMs !== original.mtimeMs) throw new Error('上传源在传输期间发生变化，原目标未被替换。')
    const copied = await request<Stats>(done => sftp.fstat(openedHandle, done), signal)
    assertSize(copied.size, original.size)
    await request<void>(done => sftp.close(openedHandle, done), signal)
    remoteHandle = undefined
    const currentTarget = await remoteStat(sftp, remotePath, signal)
    if (!unchanged(target, currentTarget)) throw new Error('远端目标在传输期间发生变化，已停止替换。请刷新目录后重试。')
    checkLive(signal)
    options.beginCommit()
    // SFTP v3 RENAME refuses an existing target. Only the OpenSSH extension is
    // allowed to replace an explicitly approved target; never unlink it first.
    try {
      await request<void>(done => target
        ? sftp.ext_openssh_rename(temporary, remotePath, done)
        : sftp.rename(temporary, remotePath, done))
    } catch (error) {
      throw new Error('无法确认远端文件替换结果，请刷新目录核对后再重试。', { cause: error })
    }
    committed = true
    reportProgress(options, original.size, original.size)
  } finally {
    await source.close().catch(() => {})
    const handle = remoteHandle
    if (handle) await request<void>(done => sftp.close(handle, done), undefined, CLEANUP_TIMEOUT_MS).catch(() => {})
    if (temporaryOwned && !committed) await request<void>(done => sftp.unlink(temporary, done), undefined, CLEANUP_TIMEOUT_MS).catch(() => {})
  }
}

async function download(options: AtomicFileTransferOptions) {
  const { sftp, signal, localPath, remotePath } = options
  const target = await localStat(localPath)
  checkLive(signal)
  if (target && !target.isFile()) throw new Error('本地目标不是普通文件，未进行覆盖。')
  if (target && !(await options.approveOverwrite(localPath))) throw abortError()
  checkLive(signal)
  await fs.mkdir(path.dirname(localPath), { recursive: true })
  const temporary = path.join(path.dirname(localPath), `.prism-transfer-${randomUUID()}.part`)
  let remoteHandle: Buffer | undefined
  let localHandle: Awaited<ReturnType<typeof fs.open>> | undefined
  let temporaryOwned = false
  let committed = false
  try {
    remoteHandle = await request<Buffer>(done => sftp.open(remotePath, 'r', done), signal, REQUEST_TIMEOUT_MS, handle => {
      void request<void>(done => sftp.close(handle, done), undefined, CLEANUP_TIMEOUT_MS).catch(() => {})
    })
    const openedHandle = remoteHandle
    const original = await request<Stats>(done => sftp.fstat(openedHandle, done), signal)
    if (!original.isFile()) throw new Error('远端下载源不是普通文件。')
    checkLive(signal)
    localHandle = await fs.open(temporary, 'wx', target ? target.mode & 0o777 : 0o600)
    temporaryOwned = true
    checkLive(signal)
    const buffer = Buffer.allocUnsafe(CHUNK_SIZE)
    let transferred = 0
    reportProgress(options, 0, original.size)
    while (transferred < original.size) {
      checkLive(signal)
      const bytesRead = await request<number>(done => sftp.read(openedHandle, buffer, 0, Math.min(buffer.length, original.size - transferred), transferred, done), signal)
      if (!bytesRead) throw new Error('远端源在下载期间缩短，原目标未被替换。')
      checkLive(signal)
      let written = 0
      while (written < bytesRead) {
        const result = await localHandle.write(buffer, written, bytesRead - written, transferred + written)
        if (!result.bytesWritten) throw new Error('无法继续写入下载临时文件，原目标未被替换。')
        written += result.bytesWritten
        checkLive(signal)
      }
      transferred += bytesRead
      reportProgress(options, transferred, original.size)
    }
    const current = await request<Stats>(done => sftp.fstat(openedHandle, done), signal)
    if (current.size !== original.size || current.mtime !== original.mtime) throw new Error('远端源在下载期间发生变化，原目标未被替换。')
    assertSize((await localHandle.stat()).size, original.size)
    await localHandle.sync()
    await localHandle.close()
    localHandle = undefined
    const currentTarget = await localStat(localPath)
    if (target ? !currentTarget || currentTarget.ino !== target.ino || currentTarget.dev !== target.dev ||
      currentTarget.size !== target.size || currentTarget.mtimeMs !== target.mtimeMs ||
      currentTarget.ctimeMs !== target.ctimeMs || currentTarget.mode !== target.mode : currentTarget !== null) {
      throw new Error('本地目标在下载期间发生变化，已停止替换。请检查后重试。')
    }
    checkLive(signal)
    options.beginCommit()
    if (target) await fs.rename(temporary, localPath)
    else {
      // link is atomic and refuses a target created while the copy was running.
      try {
        await fs.link(temporary, localPath)
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code === 'EEXIST') throw new Error('本地目标在下载期间发生变化，已停止替换。请检查后重试。', { cause: error })
        if (['ENOTSUP', 'EOPNOTSUPP', 'EXDEV', 'EPERM'].includes(code || '')) {
          throw new Error('目标存储不支持安全保存，请选择其他本地磁盘目录后重试。原文件未被替换。', { cause: error })
        }
        throw error
      }
      await fs.unlink(temporary).catch(() => {})
    }
    committed = true
    reportProgress(options, original.size, original.size)
  } finally {
    await localHandle?.close().catch(() => {})
    const handle = remoteHandle
    if (handle) await request<void>(done => sftp.close(handle, done), undefined, CLEANUP_TIMEOUT_MS).catch(() => {})
    if (temporaryOwned && !committed) await fs.unlink(temporary).catch(() => {})
  }
}
