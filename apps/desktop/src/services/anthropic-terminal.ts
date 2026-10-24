import type { ChatMessage, StreamChunk } from './llm'

const NATIVE_BLOCKS = new Set(['text', 'thinking', 'redacted_thinking', 'tool_use'])

/** Keep signed thinking blocks intact when returning tool results to Claude. */
export function toAnthropicMessages(messages: ChatMessage[]) {
  const result: Array<{ role: 'user' | 'assistant'; content: Array<Record<string, unknown>> }> = []
  const system: string[] = []
  for (const message of messages) {
    if (message.role === 'system') {
      if (typeof message.content === 'string') system.push(message.content)
      continue
    }
    const role = message.role === 'tool' ? 'user' : message.role
    let content: Array<Record<string, unknown>> = []
    if (message.role === 'tool') {
      if (!message.tool_call_id) throw new Error('Claude tool result is missing its call ID')
      content = [{ type: 'tool_result', tool_use_id: message.tool_call_id, content: message.content }]
    } else if (message.role === 'assistant' && message.responseItems?.length &&
      message.responseItems.every(block => NATIVE_BLOCKS.has(String(block.type)))) {
      content = message.responseItems
    } else {
      if (typeof message.content === 'string') {
        if (message.content) content.push({ type: 'text', text: message.content })
      } else {
        content.push(...message.content.map(part => {
          if (part.type !== 'image_url') return part
          const url = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url
          const data = typeof url === 'string' ? url.match(/^data:([^;]+);base64,(.+)$/s) : null
          return { type: 'image', source: data
            ? { type: 'base64', media_type: data[1], data: data[2] }
            : { type: 'url', url } }
        }))
      }
      for (const tool of message.tool_calls || []) {
        content.push({ type: 'tool_use', id: tool.id, name: tool.function.name,
          input: parseArguments(tool.function.arguments) })
      }
    }
    if (!content.length) continue
    const previous = result.at(-1)
    if (previous?.role === role) previous.content.push(...content)
    else result.push({ role, content: [...content] })
  }
  return { messages: result, ...(system.length ? { system: system.join('\n\n') } : {}) }
}

function parseArguments(input: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(input || '{}')
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Claude returned invalid tool arguments')
  return parsed as Record<string, unknown>
}

interface AnthropicEvent {
  type?: string
  index?: number
  content_block?: Record<string, unknown>
  delta?: { type?: string; text?: string; thinking?: string; signature?: string; partial_json?: string; stop_reason?: string }
  error?: { message?: string; type?: string }
}

/** Tool calls are emitted only after a complete message, including all thinking signatures. */
export async function* parseAnthropicTerminalStream(events: AsyncIterable<unknown>): AsyncGenerator<StreamChunk> {
  const blocks = new Map<number, { value: Record<string, unknown>; json: string; complete: boolean }>()
  let stopReason: string | undefined
  for await (const raw of events) {
    if (!raw || typeof raw !== 'object') continue
    const event = raw as AnthropicEvent
    if (event.type === 'error') throw new Error(event.error?.message || event.error?.type || 'Claude request failed')
    if (event.type === 'content_block_start') {
      if (!Number.isInteger(event.index) || blocks.has(event.index!) || !event.content_block ||
        !NATIVE_BLOCKS.has(String(event.content_block.type))) throw new Error('Claude returned an invalid content block')
      blocks.set(event.index!, { value: { ...event.content_block }, json: '', complete: false })
      continue
    }
    if (event.type === 'content_block_delta' || event.type === 'content_block_stop') {
      const block = blocks.get(event.index!)
      if (!block || block.complete) throw new Error('Claude stream contains an incomplete content block')
      const delta = event.delta
      if (event.type === 'content_block_stop') {
        if (block.value.type === 'tool_use' && block.json) block.value.input = parseArguments(block.json)
        if (block.value.type === 'thinking' && (typeof block.value.signature !== 'string' || !block.value.signature)) {
          throw new Error('Claude thinking block is missing its signature')
        }
        block.complete = true
      } else if (delta?.type === 'text_delta' && block.value.type === 'text') {
        block.value.text = String(block.value.text || '') + (delta.text || '')
        if (delta.text) yield { type: 'text', content: delta.text }
      } else if (delta?.type === 'thinking_delta' && block.value.type === 'thinking') {
        block.value.thinking = String(block.value.thinking || '') + (delta.thinking || '')
        if (delta.thinking) yield { type: 'reasoning', content: delta.thinking }
      } else if (delta?.type === 'signature_delta' && block.value.type === 'thinking') {
        block.value.signature = String(block.value.signature || '') + (delta.signature || '')
      } else if (delta?.type === 'input_json_delta' && block.value.type === 'tool_use') {
        block.json += delta.partial_json || ''
      } else if (delta?.type) throw new Error(`Unsupported Claude stream delta: ${delta.type}`)
      continue
    }
    if (event.type === 'message_delta') stopReason = event.delta?.stop_reason ?? stopReason
    if (event.type !== 'message_stop') continue
    if (!['end_turn', 'stop_sequence', 'tool_use'].includes(stopReason || '')) {
      throw new Error(`Claude response ended: ${stopReason || 'missing stop reason'}`)
    }
    const complete = [...blocks].sort(([a], [b]) => a - b).map(([, block]) => {
      if (!block.complete) throw new Error('Claude message ended before completing its content blocks')
      return block.value
    })
    const tools = complete.filter(block => block.type === 'tool_use')
    if ((stopReason === 'tool_use') !== !!tools.length) throw new Error('Claude returned an inconsistent tool result')
    // Validate the whole response before exposing any executable tool call.
    for (const tool of tools) {
      if (typeof tool.id !== 'string' || !tool.id || typeof tool.name !== 'string' || !tool.name ||
        !tool.input || typeof tool.input !== 'object' || Array.isArray(tool.input)) throw new Error('Claude returned an incomplete tool call')
    }
    for (const responseItem of complete) yield { type: 'response-item', responseItem }
    for (const tool of tools) yield { type: 'tool-call', toolCallId: tool.id as string, toolName: tool.name as string, toolInput: tool.input }
    yield { type: 'done', done: true, finish: tools.length ? 'tool-calls' : 'stop' }
    return
  }
  throw new Error('Claude stream ended before completing the response')
}
