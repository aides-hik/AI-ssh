import { StringDecoder } from 'node:string_decoder'
import type { SSHExecuteOutputEvent } from '../../src/services/ssh/ssh-execution'

type Chunk = Pick<SSHExecuteOutputEvent, 'stream' | 'data' | 'truncated'>

/** Decode once and batch a bounded prefix without delaying SSH stream draining. */
export class SSHExecLiveOutput {
  private readonly decoders = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') }
  private queue: Chunk[] = []
  private timer: ReturnType<typeof setTimeout> | undefined
  private bytes = 0
  private truncated = false
  private disposed = false

  constructor(
    private readonly requestId: string,
    private readonly connectionId: string,
    private readonly publish: (event: SSHExecuteOutputEvent) => void,
    private readonly maxBytes = 128 * 1024,
    private readonly intervalMs = 50
  ) {}

  append(stream: 'stdout' | 'stderr', data: Buffer): void {
    if (this.disposed) return
    const retained = Math.min(data.length, Math.max(0, this.maxBytes - this.bytes))
    this.bytes += retained
    const decoded = retained ? this.decoders[stream].write(data.subarray(0, retained)) : ''
    const newlyTruncated = retained < data.length && !this.truncated
    if (newlyTruncated) this.truncated = true
    if (decoded || newlyTruncated) {
      const last = this.queue.at(-1)
      if (last?.stream === stream) {
        last.data += decoded
        if (newlyTruncated) last.truncated = true
      } else this.queue.push({ stream, data: decoded, ...(newlyTruncated ? { truncated: true } : {}) })
      this.schedule()
    }
  }

  private schedule(): void {
    if (this.timer !== undefined || this.disposed) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.flush()
    }, this.intervalMs)
  }

  private flush(): void {
    if (this.disposed) return
    const chunks = this.queue
    this.queue = []
    for (const chunk of chunks) {
      if (this.disposed) return
      try { this.publish({ requestId: this.requestId, connectionId: this.connectionId, ...chunk }) }
      catch { /* A closed renderer must not interrupt a remote operation. */ }
    }
  }

  finish(): void {
    if (this.disposed) return
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    // If the byte budget cut a character, omit its incomplete tail.
    if (!this.truncated) for (const stream of ['stdout', 'stderr'] as const) {
      const data = this.decoders[stream].end()
      if (data) this.queue.push({ stream, data })
    }
    this.flush()
    this.dispose()
  }

  dispose(): void {
    this.disposed = true
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    this.queue = []
  }
}
