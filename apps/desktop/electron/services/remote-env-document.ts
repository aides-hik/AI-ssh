import { randomUUID } from 'node:crypto'
import type { Client, SFTPWrapper } from 'ssh2'

const REQUEST_TIMEOUT_MS = 30000
const CLEANUP_TIMEOUT_MS = 1000

function request<T>(
  start: (done: (error: Error | null | undefined, value: T) => void) => void,
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
    const onAbort = () => finish(signal?.reason)
    const timer = setTimeout(() => finish(new Error('服务器环境文档请求超时，请检查连接后重试。')), timeoutMs)
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) { onAbort(); return }
    try { start((error, value) => finish(error, value)) } catch (error) { finish(error) }
  })
}

/** Each operation owns a channel; cancellation never closes another request's SFTP session. */
export async function remoteEnvDocument(options: {
  client: Client
  home: string
  content?: string
  signal: AbortSignal
  beginCommit: () => void
}): Promise<{ content: string; fullPath: string } | null> {
  const { content } = options
  options.signal.throwIfAborted()
  const fullPath = `${options.home.replace(/\/$/, '')}/env.md`
  const sftp = await request<SFTPWrapper>(
    done => options.client.sftp(done), options.signal, REQUEST_TIMEOUT_MS, channel => channel.end()
  )
  const channelFailure = new AbortController()
  const signal = AbortSignal.any([options.signal, channelFailure.signal])
  sftp.on('error', (error: Error) => channelFailure.abort(error))
  sftp.once('close', () => channelFailure.abort(new Error('环境文档 SFTP 通道已关闭，请检查连接后重试。')))
  let handle: Buffer | undefined
  let temporaryOwned = false
  let committed = false
  let opening = false
  let lateOpenCleanup = false
  let awaitingLateOpen = false
  let lateOpenTimeout: ReturnType<typeof setTimeout> | undefined
  const tempPath = `${fullPath}.tmp-${randomUUID()}`
  const cleanTemporary = async () => {
    await request<void>(done => sftp.unlink(tempPath, done), undefined, CLEANUP_TIMEOUT_MS).catch(() => {})
  }
  try {
    signal.throwIfAborted()
    if (content === undefined) {
      try {
        const bytes = await request<Buffer>(done => sftp.readFile(fullPath, done), signal)
        signal.throwIfAborted()
        return { content: bytes.toString('utf8'), fullPath }
      } catch (error) {
        signal.throwIfAborted()
        const code = (error as { code?: string | number }).code
        if (code === 2 || code === 'ENOENT') return null
        throw error
      }
    }

    // Explicit chunks allow cancellation to prevent every subsequent write.
    // An exclusive temporary file cannot overwrite a concurrent operation.
    opening = true
    handle = await request<Buffer>(
      done => sftp.open(tempPath, 'wx', { mode: 0o600 }, (error, openedHandle) => {
        opening = false
        clearTimeout(lateOpenTimeout)
        done(error, openedHandle)
        if (error && awaitingLateOpen) sftp.end()
      }), signal,
      REQUEST_TIMEOUT_MS, lateHandle => {
        lateOpenCleanup = true
        void request<void>(done => sftp.close(lateHandle, done), undefined, CLEANUP_TIMEOUT_MS)
          .catch(() => {}).then(cleanTemporary).finally(() => sftp.end())
      }
    )
    temporaryOwned = true
    signal.throwIfAborted()
    const bytes = Buffer.from(content, 'utf8')
    const openedHandle = handle
    for (let offset = 0; offset < bytes.length; offset += 64 * 1024) {
      signal.throwIfAborted()
      await request<void>(done => sftp.write(
        openedHandle, bytes, offset, Math.min(64 * 1024, bytes.length - offset), offset, done
      ), signal)
      signal.throwIfAborted()
    }
    await request<void>(done => sftp.close(openedHandle, done), signal)
    handle = undefined
    signal.throwIfAborted()
    options.beginCommit()
    // Do not observe cancellation after this point: rename may already have
    // replaced env.md, and the actual callback determines the reported result.
    const supportsPosixRename =
      (sftp as unknown as { _extensions?: Record<string, string> })._extensions?.['posix-rename@openssh.com'] === '1'
    const rename = supportsPosixRename ? sftp.ext_openssh_rename.bind(sftp) : sftp.rename.bind(sftp)
    await request<void>(done => rename(tempPath, fullPath, done))
    committed = true
    return { content, fullPath }
  } finally {
    if (handle) {
      const openedHandle = handle
      await request<void>(done => sftp.close(openedHandle, done), undefined, CLEANUP_TIMEOUT_MS).catch(() => {})
    }
    if (temporaryOwned && !committed) await cleanTemporary()
    // A cancelled OPEN may still create its temporary file. Keep the channel
    // available for the late handle cleanup, with a finite fallback close.
    if (opening) {
      awaitingLateOpen = true
      lateOpenTimeout = setTimeout(() => sftp.end(), REQUEST_TIMEOUT_MS)
    } else if (!lateOpenCleanup) sftp.end()
  }
}
