export interface ExecutionLogEntry {
  stream: 'stdout' | 'stderr' | 'phase'
  text: string
}

export interface HostExecutionLog {
  targetId: string
  entries: ExecutionLogEntry[]
  truncated: boolean
}

/** Terminal controls can span packets. Retain parsing state, never their payload. */
class TerminalTextFilter {
  private sequence: 'text' | 'escape' | 'csi' | 'string' = 'text'
  private stringEscape = false
  private stringAllowsBell = false
  private previousCR = false

  write(data: string): string {
    const output: string[] = []
    for (const character of data) {
      const code = character.charCodeAt(0)
      if (this.sequence === 'string') {
        if (code === 0x9c || (this.stringAllowsBell && code === 7) || (this.stringEscape && character === '\\')) {
          this.sequence = 'text'
        }
        this.stringEscape = code === 27
        continue
      }
      if (this.sequence === 'csi') {
        if (code >= 0x40 && code <= 0x7e) { this.sequence = 'text'; continue }
        if (code >= 0x20 && code <= 0x3f) continue
        this.sequence = 'text'
      }
      if (this.sequence === 'escape') {
        if (character === '[') { this.sequence = 'csi'; continue }
        if (']PX^_'.includes(character)) {
          this.sequence = 'string'
          this.stringAllowsBell = character === ']'
          this.stringEscape = false
          continue
        }
        if (code >= 0x20 && code <= 0x2f) continue
        this.sequence = 'text'
        if (code >= 0x30 && code <= 0x7e) continue
      }

      if (this.previousCR) {
        this.previousCR = false
        if (code === 10) continue
      }
      if (code === 27) { this.sequence = 'escape'; continue }
      if (code === 0x9b) { this.sequence = 'csi'; continue }
      if ([0x90, 0x98, 0x9d, 0x9e, 0x9f].includes(code)) {
        this.sequence = 'string'
        this.stringAllowsBell = code === 0x9d
        this.stringEscape = false
        continue
      }
      if (code === 13) {
        output.push('\n')
        this.previousCR = true
      } else if (code === 9 || code === 10 || (code >= 32 && (code < 127 || code > 159))) {
        output.push(character)
      }
    }
    return output.join('')
  }
}

/** A bounded tail for the visible log. It never enters the model context or storage. */
export class ExecutionLogBuffer {
  private hosts = new Map<string, HostExecutionLog>()
  private filters = new Map<string, Record<ExecutionLogEntry['stream'], TerminalTextFilter>>()
  constructor(private readonly maxBytes = 64 * 1024) {}

  reset(targetIds: readonly string[]): void {
    this.hosts = new Map(targetIds.map(targetId => [targetId, { targetId, entries: [], truncated: false }]))
    this.filters = new Map(targetIds.map(targetId => [targetId, {
      stdout: new TerminalTextFilter(), stderr: new TerminalTextFilter(), phase: new TerminalTextFilter()
    }]))
  }

  append(targetId: string, stream: ExecutionLogEntry['stream'], data: string, truncated = false): void {
    const host = this.hosts.get(targetId)
    const filter = this.filters.get(targetId)?.[stream]
    if (!host || !filter) return
    const text = filter.write(data)
    host.truncated ||= truncated
    if (!text) return
    const last = host.entries.at(-1)
    if (last?.stream === stream) last.text += text
    else host.entries.push({ stream, text })
    const encoder = new TextEncoder()
    let bytes = host.entries.reduce((sum, entry) => sum + encoder.encode(entry.text).length, 0)
    while (bytes > this.maxBytes && host.entries.length) {
      host.truncated = true
      const first = host.entries[0]
      const content = encoder.encode(first.text)
      const excess = bytes - this.maxBytes
      if (content.length <= excess) {
        host.entries.shift()
        bytes -= content.length
      } else {
        let start = excess
        while (start < content.length && (content[start] & 0xc0) === 0x80) start++
        first.text = new TextDecoder().decode(content.subarray(start))
        bytes -= start
      }
    }
  }

  snapshot(): HostExecutionLog[] {
    return [...this.hosts.values()].map(host => ({ ...host, entries: host.entries.map(entry => ({ ...entry })) }))
  }
}
