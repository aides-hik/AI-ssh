/** A model returned its internal tool syntax instead of an API tool call. */
export class ToolCallProtocolError extends Error {
  constructor() {
    super('模型或接口把工具调用作为普通文本返回，本轮工具未执行。请检查所选模型和接口是否支持工具调用，或切换模型服务后重试。')
    this.name = 'ToolCallProtocolError'
  }
}

const toolMarkers = ['<|DSML|', '</|DSML|']

/**
 * Reject leaked tool syntax before it reaches the conversation. This never
 * interprets text as executable calls. Only a possible marker prefix is held;
 * Markdown delimiter runs are counted rather than buffered.
 */
export class ToolCallTextGuard {
  private pending = ''
  private failure?: ToolCallProtocolError
  private inlineTicks = 0
  private fence?: { marker: string; length: number }
  private fenceClosing = false
  private lineIndent: number | null = 0
  private runMarker = ''
  private runLength = 0
  private runAtLineStart = false
  private backslashes = 0
  private lineBlank = true

  push(delta: string): string {
    if (this.failure) throw this.failure
    let text = ''
    for (const char of delta) {
      if (this.runMarker && char !== this.runMarker) this.finishDelimiterRun()

      if (this.fenceClosing) {
        if (char === '\n') {
          this.fence = undefined
          this.fenceClosing = false
        } else if (!/[ \t\r]/.test(char)) {
          this.fenceClosing = false
        }
      }

      const atLineStart = this.lineIndent !== null && this.lineIndent <= 3
      const startsRun = char === '`'
        ? (!this.fence && (this.inlineTicks > 0 || this.backslashes % 2 === 0)) || (this.fence?.marker === char && atLineStart)
        : char === '~' && !this.inlineTicks && atLineStart && (!this.fence || this.fence.marker === char)
      if (this.runMarker || startsRun) {
        if (!this.runMarker) {
          this.runMarker = char
          this.runAtLineStart = atLineStart
        }
        this.runLength++
      }

      text += this.fence || this.inlineTicks ? char : this.readTextCharacter(char)
      if (char === '\n') {
        // Inline code cannot continue into another Markdown paragraph. Keep
        // fenced blocks separate: their blank lines remain inside the fence.
        if (this.lineBlank) this.inlineTicks = 0
        this.lineBlank = true
        this.lineIndent = 0
      }
      else if (char === ' ' && this.lineIndent !== null) this.lineIndent++
      else if (char !== '\r') this.lineIndent = null
      if (!/[ \t\r\n]/.test(char)) this.lineBlank = false
      this.backslashes = char === '\\' ? this.backslashes + 1 : 0
    }
    return text
  }

  finish(): string {
    if (this.failure) throw this.failure
    this.finishDelimiterRun()
    // An interrupted DSML name is still a protocol failure, rather than a
    // successful answer ending with a fragment of an internal tool marker.
    if (/^<\/?[|｜]D(?:S(?:M(?:L)?)?)?$/.test(this.pending)) this.reject()
    const text = this.pending
    this.pending = ''
    return text
  }

  private readTextCharacter(char: string): string {
    const candidate = this.pending + char
    const normalized = candidate.replace(/｜/g, '|')
    if (toolMarkers.includes(normalized) || /^<\/?\|DSML\s$/.test(normalized)) this.reject()
    if (toolMarkers.some(marker => marker.startsWith(normalized))) {
      this.pending = candidate
      return ''
    }
    const text = this.pending
    this.pending = char === '<' ? char : ''
    return text + (this.pending ? '' : char)
  }

  private finishDelimiterRun(): void {
    if (!this.runMarker) return
    if (this.fence) {
      if (this.runAtLineStart && this.runMarker === this.fence.marker && this.runLength >= this.fence.length) {
        this.fenceClosing = true
      }
    } else if (this.inlineTicks) {
      if (this.runMarker === '`' && this.runLength === this.inlineTicks) this.inlineTicks = 0
    } else if (this.runAtLineStart && this.runLength >= 3) {
      this.fence = { marker: this.runMarker, length: this.runLength }
    } else if (this.runMarker === '`') {
      this.inlineTicks = this.runLength
    }
    this.runMarker = ''
    this.runLength = 0
  }

  private reject(): never {
    this.failure = new ToolCallProtocolError()
    throw this.failure
  }
}
