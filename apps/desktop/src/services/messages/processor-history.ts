import { toModelMessages as convertMessages, type ModelMessage } from './convert'
import type { Message } from './message'

const MAX_ASSISTANT_TURNS = 10
const MAX_JSON_CHARACTERS = 256000

interface CachedTurn {
  messages: ModelMessage[]
  characters: number
}

/** Keeps provider state outside persisted messages and the visible Vue message tree. */
export class ProcessorHistory {
  #scope: string | undefined
  #turns = new Map<string, CachedTurn>()
  #characters = 0
  #lastUserContent: string | null | undefined

  clear(): void {
    this.#scope = undefined
    this.#turns.clear()
    this.#characters = 0
    this.#lastUserContent = undefined
  }

  toModelMessages(messages: Message[], scope: string, requireOpaqueState = false): ModelMessage[] {
    if (scope !== this.#scope) {
      this.#turns.clear()
      this.#characters = 0
      this.#scope = scope
    }

    const retainedIds = new Set(
      messages.filter(message => message.info.role === 'assistant').map(message => message.info.id)
    )
    for (const id of this.#turns.keys()) {
      if (!retainedIds.has(id)) this.#forget(id)
    }

    const result: ModelMessage[] = []
    const coveredToolIds = new Set<string>()
    let visibleMessages: Message[] = []
    const flushVisible = () => {
      result.push(...convertMessages(visibleMessages, !requireOpaqueState))
      visibleMessages = []
    }

    for (const message of messages) {
      if (message.info.role !== 'tool') coveredToolIds.clear()
      const cached =
        message.info.role === 'assistant' ? this.#turns.get(message.info.id) : undefined
      if (cached) {
        flushVisible()
        // A caller may mutate processor input; never give it ownership of our cached state.
        result.push(...structuredClone(cached.messages))
        for (const raw of cached.messages) {
          if (raw.role === 'tool' && raw.tool_call_id) coveredToolIds.add(raw.tool_call_id)
        }
      } else {
        visibleMessages.push(message.info.role === 'tool' ? {
          ...message,
          parts: message.parts.filter(part => part.type !== 'tool' || !coveredToolIds.has(part.callID))
        } : message)
      }
    }
    flushVisible()
    this.#lastUserContent = result.findLast(message => message.role === 'user')?.content
    return result
  }

  /** Accept the completed processor history and retain only its newly generated turn. */
  remember(assistantId: string, messages: ModelMessage[]): void {
    if (this.#scope === undefined || !assistantId) return
    const lastUserIndex = messages.findLastIndex(message => message.role === 'user')
    if (lastUserIndex < 0 || messages[lastUserIndex].content !== this.#lastUserContent) return
    const suffix = messages.slice(lastUserIndex + 1)
    if (!isCompletedTurn(suffix)) return

    // Counting and cloning JSON here never writes it to settings, logs or browser storage.
    let serialized: string
    try {
      serialized = JSON.stringify(suffix)
    } catch {
      return
    }
    const characters = serialized.length + assistantId.length
    this.#forget(assistantId)
    if (characters > MAX_JSON_CHARACTERS) return

    this.#turns.set(assistantId, {
      messages: JSON.parse(serialized) as ModelMessage[],
      characters
    })
    this.#characters += characters
    while (this.#turns.size > MAX_ASSISTANT_TURNS || this.#characters > MAX_JSON_CHARACTERS) {
      const oldestId = this.#turns.keys().next().value
      if (oldestId === undefined) break
      this.#forget(oldestId)
    }
  }

  #forget(id: string): void {
    const turn = this.#turns.get(id)
    if (!turn) return
    this.#characters -= turn.characters
    this.#turns.delete(id)
  }
}

function isCompletedTurn(messages: ModelMessage[]): boolean {
  if (!messages.length || messages.at(-1)?.role !== 'assistant') return false
  const pendingToolIds = new Set<string>()
  for (const message of messages) {
    if (message.role === 'assistant') {
      if (pendingToolIds.size) return false
      for (const call of message.tool_calls || []) {
        if (!call.id || !call.function?.name || pendingToolIds.has(call.id)) return false
        pendingToolIds.add(call.id)
      }
    } else if (message.role === 'tool') {
      if (!message.tool_call_id || !pendingToolIds.delete(message.tool_call_id)) return false
    } else {
      return false
    }
  }
  return pendingToolIds.size === 0
}
