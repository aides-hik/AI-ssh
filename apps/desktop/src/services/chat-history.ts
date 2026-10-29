import type { Message, MessagePart } from './messages/message'

const PREFIX = 'prism.chat-history.v1:'
export interface HistorySettings { enableChatHistory?: boolean; maxHistoryMessages?: number }

export function historyLimit(value: unknown): number {
  const count = Number(value)
  return Number.isFinite(count) && count > 0 ? Math.min(200, Math.max(1, Math.floor(count))) : 50
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** Persist displayable conversation state only; provider reasoning stays in memory. */
function cleanMessages(value: unknown): Message[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((message: unknown): Message[] => {
    if (!record(message) || !record(message.info) || !Array.isArray(message.parts)) return []
    const info = message.info
    if (typeof info.id !== 'string' || (info.role !== 'user' && info.role !== 'assistant' && info.role !== 'system')) return []
    const parts: MessagePart[] = message.parts.flatMap((part: unknown): MessagePart[] => {
      if (!record(part)) return []
      if (part.type === 'text' && typeof part.text === 'string') return [{ type: 'text', text: part.text, ...(part.kind === 'summary' ? { kind: 'summary' } : {}) }]
      if (part.type !== 'tool' || typeof part.tool !== 'string' || typeof part.callID !== 'string') return []
      const state = record(part.state) ? part.state : {}
      return [{ type: 'tool', tool: part.tool, callID: part.callID, state: {
        status: state.status === 'completed' || state.status === 'error' ? state.status : 'aborted',
        ...(record(state.input) ? { input: state.input } : {}),
        ...(typeof state.output === 'string' ? { output: state.output } : {}),
        ...(typeof state.error === 'string' ? { error: state.error } : {})
      } }]
    })
    const targets = Array.isArray(info.targets) ? info.targets.flatMap((target: unknown) => record(target) && typeof target.id === 'string' && typeof target.name === 'string' && typeof target.host === 'string'
      ? [{ id: target.id, name: target.name, host: target.host }] : []) : undefined
    return [{ info: { id: info.id, role: info.role, createdAt: typeof info.createdAt === 'number' && Number.isFinite(info.createdAt) ? info.createdAt : 0,
      finish: info.finish === 'stop' || info.finish === 'tool-calls' || info.finish === 'step-limit' ? info.finish : 'unknown',
      ...(typeof info.summary === 'string' ? { summary: info.summary } : {}),
      ...(info.compacted === true ? { compacted: true } : {}),
      ...(targets ? { targets } : {})
    }, parts }]
  })
}

function retained(messages: Message[], settings: HistorySettings): Message[] {
  const selected = cleanMessages(messages).slice(-historyLimit(settings.maxHistoryMessages))
  // Never restore an assistant result whose user request was removed by retention.
  const firstUser = selected.findIndex(message => message.info.role === 'user')
  return firstUser < 0 ? [] : selected.slice(firstUser)
}

export class ChatHistoryStore {
  constructor(private storage: Storage) {}

  applySettings(settings: HistorySettings): void {
    for (const key of Object.keys(this.storage)) {
      if (!key.startsWith(PREFIX)) continue
      if (settings.enableChatHistory === false) this.storage.removeItem(key)
      else {
        try { this.storage.setItem(key, JSON.stringify(retained(JSON.parse(this.storage.getItem(key) || '[]'), settings))) }
        catch { this.storage.removeItem(key) }
      }
    }
  }

  load(identity: string, settings: HistorySettings): Message[] {
    if (settings.enableChatHistory === false) { this.applySettings(settings); return [] }
    if (!identity) return []
    try { return retained(JSON.parse(this.storage.getItem(PREFIX + identity) || '[]'), settings) }
    catch { return [] }
  }

  save(identity: string, messages: Message[], settings: HistorySettings): void {
    if (settings.enableChatHistory === false) { this.applySettings(settings); return }
    if (identity) this.storage.setItem(PREFIX + identity, JSON.stringify(retained(messages, settings)))
  }
}
