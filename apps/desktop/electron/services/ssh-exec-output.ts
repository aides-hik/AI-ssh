import { StringDecoder } from 'node:string_decoder'

/** Retain a bounded prefix while continuing to drain both SSH output streams. */
export class SSHExecOutput {
  private stdoutChunks: Buffer[] = []
  private stderrChunks: Buffer[] = []
  private retainedBytes = 0
  truncated = false

  constructor(private readonly maxBytes = 128 * 1024) {}

  append(channel: 'stdout' | 'stderr', data: Buffer): void {
    const available = Math.max(0, this.maxBytes - this.retainedBytes)
    const retained = Math.min(available, data.length)
    if (retained < data.length) this.truncated = true
    if (!retained) return
    // Copy the retained prefix so a small slice cannot keep a huge packet alive.
    const chunk = Buffer.from(data.subarray(0, retained))
    this.retainedBytes += retained
    const chunks = channel === 'stdout' ? this.stdoutChunks : this.stderrChunks
    chunks.push(chunk)
  }

  private decode(chunks: Buffer[]): string {
    const decoder = new StringDecoder('utf8')
    const text = decoder.write(Buffer.concat(chunks))
    // A byte limit may cut a UTF-8 character in half. Omit that incomplete tail.
    return this.truncated ? text : text + decoder.end()
  }

  snapshot(): { stdout: string; stderr: string; truncated: boolean } {
    return {
      stdout: this.decode(this.stdoutChunks),
      stderr: this.decode(this.stderrChunks),
      truncated: this.truncated
    }
  }
}
