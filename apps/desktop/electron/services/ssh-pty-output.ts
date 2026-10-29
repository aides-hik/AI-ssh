import { StringDecoder } from 'node:string_decoder'

type OutputStream = 'stdout' | 'stderr'

/** PTY data events may split a UTF-8 character at any byte boundary. */
export class SSHPTYOutput {
  private decoders = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') }
  private ended = new Set<OutputStream>()

  constructor(private emit: (stream: OutputStream, text: string) => void) {}

  write(stream: OutputStream, data: Buffer): void {
    if (this.ended.has(stream)) return
    const text = this.decoders[stream].write(data)
    if (text) this.emit(stream, text)
  }

  end(stream: OutputStream): void {
    if (this.ended.has(stream)) return
    this.ended.add(stream)
    const text = this.decoders[stream].end()
    if (text) this.emit(stream, text)
  }
}
