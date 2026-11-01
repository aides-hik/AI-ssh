import type { Message, MessagePart } from './messages/message'

const LEGACY_PREFIX = 'prism.chat-history.v1:'
const PREFIX = 'prism.chat-history.v2:'
export interface HistorySettings { enableChatHistory?: boolean; maxHistoryMessages?: number }

export interface ConversationSummary {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messageCount: number
}

interface Conversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: Message[]
}

interface ConversationDocument {
  version: 2
  activeId: string | null
  conversations: Conversation[]
}

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
        ...(typeof state.error === 'string' ? { error: state.error } : {}),
        ...(record(state.metadata) && typeof state.metadata.targetId === 'string' ? { metadata: {
          targetId: state.metadata.targetId,
          ...(typeof state.metadata.targetName === 'string' ? { targetName: state.metadata.targetName } : {})
        } } : {})
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

const emptyDocument = (): ConversationDocument => ({ version: 2, activeId: null, conversations: [] })
const ordered = (document: ConversationDocument) => [...document.conversations].sort((a, b) => b.updatedAt - a.updatedAt)
const summary = (conversation: Conversation): ConversationSummary => ({
  id: conversation.id, title: conversation.title, createdAt: conversation.createdAt,
  updatedAt: conversation.updatedAt, messageCount: conversation.messages.length
})
const timestamp = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback

function conversationTitle(messages: Message[]): string {
  const firstUser = messages.find(message => message.info.role === 'user')
  const text = firstUser?.parts.filter(part => part.type === 'text').map(part => part.text).join(' ').replace(/\s+/g, ' ').trim() || ''
  const characters = Array.from(text)
  return characters.length > 60 ? `${characters.slice(0, 60).join('')}…` : text
}

function normalizeDocument(value: unknown, settings: HistorySettings): ConversationDocument | null {
  if (!record(value) || value.version !== 2 || !Array.isArray(value.conversations)) return null
  const ids = new Set<string>()
  const conversations = value.conversations.flatMap((item: unknown): Conversation[] => {
    if (!record(item) || typeof item.id !== 'string' || !item.id || ids.has(item.id) || !Array.isArray(item.messages)) return []
    ids.add(item.id)
    const messages = retained(item.messages as Message[], settings)
    const createdAt = timestamp(item.createdAt, 0)
    return [{ id: item.id, title: typeof item.title === 'string' ? item.title : conversationTitle(messages),
      createdAt, updatedAt: Math.max(createdAt, timestamp(item.updatedAt, createdAt)), messages }]
  })
  const document: ConversationDocument = { version: 2, activeId: null, conversations }
  document.activeId = typeof value.activeId === 'string' && ids.has(value.activeId) ? value.activeId : ordered(document)[0]?.id || null
  return document
}

export class ChatHistoryStore {
  constructor(private storage: Storage) {}

  /** Keep each scope in one atomic storage record; failed writes preserve its previous history. */
  private write(scope: string, document: ConversationDocument): boolean {
    try {
      this.storage.setItem(PREFIX + scope, JSON.stringify(document))
    } catch { return false }
    // A readable v2 record always wins over a leftover v1 record if removal is blocked.
    try { this.storage.removeItem(LEGACY_PREFIX + scope) } catch { /* Retry cleanup when settings are applied. */ }
    return true
  }

  private read(scope: string, settings: HistorySettings): ConversationDocument | null {
    if (settings.enableChatHistory === false) { this.applySettings(settings); return null }
    if (!scope) return null
    let current: string | null
    let legacy: string | null
    try {
      current = this.storage.getItem(PREFIX + scope)
      legacy = this.storage.getItem(LEGACY_PREFIX + scope)
    } catch { return null }
    if (current) {
      try {
        const document = normalizeDocument(JSON.parse(current), settings)
        if (document) return document
      } catch { /* An older readable record can still recover a damaged index. */ }
    }
    if (legacy) {
      try {
        const messages = retained(JSON.parse(legacy), settings)
        if (messages.length) {
          const createdAt = timestamp(messages[0].info.createdAt, Date.now())
          const updatedAt = Math.max(createdAt, ...messages.map(message => timestamp(message.info.createdAt, createdAt)))
          const document: ConversationDocument = { version: 2, activeId: 'legacy', conversations: [{
            id: 'legacy', title: conversationTitle(messages), createdAt, updatedAt, messages
          }] }
          this.write(scope, document)
          return document
        }
      } catch { /* Corrupt history is ignored without deleting possible recovery data. */ }
    }
    return emptyDocument()
  }

  applySettings(settings: HistorySettings): boolean {
    let keys: string[]
    try { keys = Object.keys(this.storage) } catch { return false }
    let succeeded = true
    const scopes = new Set<string>()
    for (const key of keys) {
      const prefix = key.startsWith(PREFIX) ? PREFIX : key.startsWith(LEGACY_PREFIX) ? LEGACY_PREFIX : null
      if (!prefix) continue
      if (settings.enableChatHistory === false) {
        try { this.storage.removeItem(key) } catch { succeeded = false }
      } else scopes.add(key.slice(prefix.length))
    }
    for (const scope of scopes) {
      const document = this.read(scope, settings)
      if (!document || !this.write(scope, document)) succeeded = false
    }
    return succeeded
  }

  list(scope: string, settings: HistorySettings): ConversationSummary[] {
    const document = this.read(scope, settings)
    return document ? ordered(document).map(summary) : []
  }

  getActive(scope: string, settings: HistorySettings): ConversationSummary | null {
    const document = this.read(scope, settings)
    const active = document?.conversations.find(conversation => conversation.id === document.activeId)
    return active ? summary(active) : null
  }

  /** Distinguish deleted history from storage that cannot currently be read. */
  has(scope: string, conversationId: string, settings: HistorySettings): boolean | null {
    const document = this.read(scope, settings)
    return document ? document.conversations.some(conversation => conversation.id === conversationId) : null
  }

  create(scope: string, settings: HistorySettings, title = ''): ConversationSummary | null {
    const document = this.read(scope, settings)
    if (!document) return null
    const id = `conversation_${globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`}`
    const now = Date.now()
    const conversation: Conversation = { id, title, createdAt: now,
      updatedAt: Math.max(now, ...document.conversations.map(item => item.updatedAt + 1)), messages: [] }
    document.conversations.push(conversation)
    document.activeId = id
    return this.write(scope, document) ? summary(conversation) : null
  }

  select(scope: string, conversationId: string, settings: HistorySettings): boolean {
    const document = this.read(scope, settings)
    if (!document || !document.conversations.some(conversation => conversation.id === conversationId)) return false
    if (document.activeId === conversationId) return true
    document.activeId = conversationId
    return this.write(scope, document)
  }

  load(scope: string, settings: HistorySettings, conversationId?: string): Message[] {
    const document = this.read(scope, settings)
    return document?.conversations.find(conversation => conversation.id === (conversationId ?? document.activeId))?.messages || []
  }

  save(scope: string, messages: Message[], settings: HistorySettings, conversationId?: string): boolean {
    const document = this.read(scope, settings)
    if (!document) return false
    const cleaned = cleanMessages(messages)
    let conversation = document.conversations.find(item => item.id === (conversationId ?? document.activeId))
    if (!conversation) {
      // A delayed save must never recreate a conversation that the user deleted.
      if (conversationId !== undefined) return false
      if (!cleaned.length) return true
      const id = `conversation_${globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`}`
      conversation = { id, title: '', createdAt: Date.now(), updatedAt: 0, messages: [] }
      document.conversations.push(conversation)
      document.activeId = id
    }
    conversation.title ||= conversationTitle(cleaned)
    conversation.messages = retained(cleaned, settings)
    conversation.updatedAt = Math.max(Date.now(), ...document.conversations.map(item => item.updatedAt + 1))
    return this.write(scope, document)
  }

  delete(scope: string, conversationId: string, settings: HistorySettings): boolean {
    const document = this.read(scope, settings)
    if (!document || !document.conversations.some(conversation => conversation.id === conversationId)) return false
    document.conversations = document.conversations.filter(conversation => conversation.id !== conversationId)
    if (document.activeId === conversationId) document.activeId = ordered(document)[0]?.id || null
    return this.write(scope, document)
  }

  clear(scope: string): boolean {
    if (!scope) return false
    let succeeded = true
    for (const prefix of [PREFIX, LEGACY_PREFIX]) {
      try { this.storage.removeItem(prefix + scope) } catch { succeeded = false }
    }
    return succeeded
  }
}
