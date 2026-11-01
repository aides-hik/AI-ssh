
import type { AIProvider, AIModel } from '../types/ai-providers'
import { zodToOpenAIParameters } from './zod-schema'
import { isRetiredManagedProvider } from '../utils/standalone-providers'
import type { ReasoningSelection } from '../utils/model-reasoning'
import { buildModelParameterBody, getModelAPIStyle, normalizeAIEndpoint } from '../utils/model-capabilities'
import { parseAnthropicTerminalStream, toAnthropicMessages } from './anthropic-terminal'
import { ToolCallTextGuard } from './tool-call-protocol'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | Array<{ type: string; [key: string]: any }>
  name?: string
  tool_call_id?: string
  reasoning_content?: string
  reasoning_details?: Array<Record<string, unknown>>
  responseItems?: Array<Record<string, unknown>>
  tool_calls?: Array<{
    id: string
    type: 'function'
    extra_content?: Record<string, unknown>
    function: {
      name: string
      arguments: string
    }
  }>
}

export interface ToolCallMessageContent {
  type: 'tool-call'
  tool_call_id: string
  tool_name: string
  arguments: Record<string, any>
}

export interface ToolResultMessageContent {
  type: 'tool-result'
  tool_call_id: string
  result: string
}

export interface StreamChunk {
  type: 'text' | 'reasoning' | 'reasoning-details' | 'response-item' | 'tool-call' | 'tool-result' | 'done' | 'error'
  content?: string
  toolCallId?: string
  toolName?: string
  toolInput?: any
  toolExtraContent?: Record<string, unknown>
  toolOutput?: string
  error?: string
  done?: boolean
  finish?: 'stop' | 'tool-calls'
  responseItem?: Record<string, unknown>
  reasoningDetails?: Array<Record<string, unknown>>
}

export interface ToolResult {
  title: string
  metadata: Record<string, any>
  output: string
}

interface ToolInfo {
  id: string
  init: () => Promise<{
    description: string
    parameters: any
    execute: (args: any, ctx: any) => Promise<ToolResult>
  }>
}

export class LLMSession {
  private provider: AIProvider
  private model: AIModel
  private tools: ToolInfo[]

  constructor(
    provider: AIProvider,
    model: AIModel,
    tools: ToolInfo[],
    private connectionId: string,
    private onProgress?: (msg: string) => void,
    private serverEnvDocId?: string,
    private signal?: AbortSignal,
    private reasoning: ReasoningSelection = model.requestConfig?.reasoning ?? 'default'
  ) {
    this.provider = provider
    this.model = model
    this.tools = tools
  }

  async *stream(messages: ChatMessage[]): AsyncGenerator<StreamChunk, void, unknown> {
    const availableTools = new Set<string>()
    const toolDefinitions = await Promise.all(
      (this.model.capabilities.functionCall ? this.tools : []).map(async tool => {
        if (!tool.id.trim() || availableTools.has(tool.id)) throw new Error('Tool definitions must have unique non-empty names')
        availableTools.add(tool.id)
        const info = await tool.init()
        const parameters = info.parameters

        return {
          type: 'function' as const,
          function: {
            name: tool.id,
            description: info.description,
            parameters: zodToOpenAIParameters(parameters)
          }
        }
      })
    )

    if (isRetiredManagedProvider(this.provider)) {
      throw new Error('原托管模型已移除，请在设置中配置自己的模型服务')
    }

    const style = getModelAPIStyle(this.provider, this.model)
    const anthropic = style === 'anthropic'
    const responses = style === 'responses'
    let apiBase = normalizeAIEndpoint(this.provider.endpoint)
    if (style === 'ollama') apiBase = `${apiBase.replace(/\/v1$/, '')}/v1`
    let endpoint = `${apiBase}/${responses ? 'responses' : 'chat/completions'}`
    if (anthropic) endpoint = `${apiBase.replace(/\/messages$/, '')}/messages`
    let requestModelId = this.model.id
    if (!responses && !anthropic) {
      try {
        const googleEndpoint = new URL(apiBase)
        if (googleEndpoint.hostname === 'generativelanguage.googleapis.com') {
          if (googleEndpoint.pathname === '/') googleEndpoint.pathname = '/v1beta/openai'
          if (/^\/v1(?:beta)?$/.test(googleEndpoint.pathname)) googleEndpoint.pathname += '/openai'
          googleEndpoint.pathname += '/chat/completions'
          endpoint = googleEndpoint.toString()
          requestModelId = requestModelId.replace(/^models\//, '')
        }
      } catch {
        // Preserve custom endpoint handling; fetch reports invalid URLs with the normal request error.
      }
    }

    const body: Record<string, unknown> = {
      model: requestModelId,
      ...(anthropic ? {
        ...toAnthropicMessages(messages),
        tools: toolDefinitions.length ? toolDefinitions.map(tool => ({
          name: tool.function.name, description: tool.function.description, input_schema: tool.function.parameters
        })) : undefined
      } : responses
        ? {
            input: this.toResponsesInput(messages),
            store: false,
            include: ['reasoning.encrypted_content'],
            tools: toolDefinitions.length > 0
              ? toolDefinitions.map(tool => ({ type: 'function', ...tool.function, strict: false }))
              : undefined
          }
        : {
            messages: this.toModelMessages(messages),
            tools: toolDefinitions.length > 0 ? toolDefinitions : undefined
          }),
      stream: true,
      tool_choice: toolDefinitions.length > 0 ? anthropic ? { type: 'auto' } : 'auto' : undefined,
      ...buildModelParameterBody(this.provider, this.model, {
        reasoningSelection: this.reasoning,
        apiStyle: anthropic ? 'anthropic' : responses ? 'responses' : 'chat-completions'
      })
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        ...(anthropic ? {
          'x-api-key': this.provider.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        } : this.provider.apiKey ? { Authorization: `Bearer ${this.provider.apiKey}` } : {}),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: this.signal
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`)
    }

    if (!response.body) throw new Error('Response body is not readable')
    const chunks = anthropic ? parseAnthropicTerminalStream(readServerEvents(response.body, this.signal))
      : responses ? this.parseResponsesStream(response.body, this.signal)
        : this.parseStream(response.body, this.signal)
    const textGuard = new ToolCallTextGuard()
    const pendingTools: StreamChunk[] = []
    let hasVisibleText = false
    for await (const chunk of chunks) {
      if (chunk.type === 'text') {
        const content = textGuard.push(chunk.content || '')
        if (content.trim()) hasVisibleText = true
        if (content) yield { ...chunk, content }
      } else if (chunk.type === 'tool-call') {
        // Validate the entire response before exposing any executable calls. A provider
        // may mix native tool events and leaked protocol text in the same response.
        pendingTools.push(chunk)
      } else if (chunk.type === 'done') {
        const content = textGuard.finish()
        if (content.trim()) hasVisibleText = true
        if (content) yield { type: 'text', content }
        if ((chunk.finish === 'tool-calls') !== (pendingTools.length > 0)) {
          throw new Error('Model returned an inconsistent tool-call completion')
        }
        if (!pendingTools.length && !hasVisibleText) throw new Error('Model returned an empty response')
        const callIds = new Set<string>()
        for (const tool of pendingTools) {
          if (!tool.toolCallId?.trim() || !tool.toolName?.trim() || callIds.has(tool.toolCallId)) {
            throw new Error('Model returned an empty or duplicate tool call ID or name')
          }
          if (!availableTools.has(tool.toolName)) throw new Error(`Model returned an unavailable tool: ${tool.toolName}`)
          if (!tool.toolInput || typeof tool.toolInput !== 'object' || Array.isArray(tool.toolInput)) {
            throw new Error('Model returned invalid tool arguments')
          }
          callIds.add(tool.toolCallId)
        }
        yield* pendingTools
        yield chunk
        return
      } else {
        yield chunk
      }
    }
  }

  async *parseStream(
    body: ReadableStream,
    signal?: AbortSignal
  ): AsyncGenerator<StreamChunk, void, unknown> {
    const toolCalls = new Map<number, { id?: string; name: string; arguments: string; hasArguments: boolean; extraContent?: Record<string, unknown> }>()
    const fallbackId = `call_${crypto.randomUUID()}`
    for await (const parsed of readServerEvents(body, signal)) {
      if (parsed === '[DONE]') {
        throw new Error('Model stream ended before completing the response')
      }
      if (parsed.error) throw new Error(providerError(parsed.error))
      const choice = parsed.choices?.[0]
      if (!choice) continue
      const reasoning = choice.delta?.reasoning_content ?? choice.delta?.reasoning
      if (reasoning) yield { type: 'reasoning', content: reasoning }
      if (choice.delta?.reasoning_details?.length) {
        yield { type: 'reasoning-details', reasoningDetails: choice.delta.reasoning_details }
      }
      if (choice.delta?.content) yield { type: 'text', content: choice.delta.content }
      if (choice.delta?.refusal) yield { type: 'text', content: choice.delta.refusal }
      const incomingCalls = choice.delta?.tool_calls || []
      const eventIndexes = new Set<number>()
      for (const tc of incomingCalls) {
        if (tc.type !== undefined && tc.type !== 'function') throw new Error('Model returned an unsupported tool call type')
        if (tc.id !== undefined && (typeof tc.id !== 'string' || !tc.id.trim())) throw new Error('Model returned an empty tool call ID')
        let index = tc.index
        if (index === undefined) {
          // Some local OpenAI-compatible services omit indices. Match their IDs,
          // or the sole outstanding call, without merging ambiguous parallel calls.
          const matched = tc.id ? [...toolCalls].find(([, call]) => call.id === tc.id) : undefined
          if (matched) index = matched[0]
          else if (tc.id) index = Math.max(-1, ...toolCalls.keys()) + 1
          else if (incomingCalls.length === 1 && toolCalls.size <= 1) index = toolCalls.keys().next().value ?? 0
          else throw new Error('Model returned ambiguous tool call indices')
        }
        if (!Number.isSafeInteger(index) || index < 0 || eventIndexes.has(index)) throw new Error('Model returned invalid or duplicate tool call indices')
        eventIndexes.add(index)
        const current = toolCalls.get(index) || { name: '', arguments: '', hasArguments: false }
        if (tc.id) {
          if (current.id && current.id !== tc.id) throw new Error('Model changed a tool call ID while streaming')
          current.id = tc.id
        }
        if (tc.extra_content) current.extraContent = tc.extra_content
        if (tc.function?.name !== undefined) {
          if (typeof tc.function.name !== 'string') throw new Error('Model returned an invalid tool name')
          current.name += tc.function.name
        }
        if (tc.function?.arguments !== undefined) {
          if (typeof tc.function.arguments !== 'string') throw new Error('Model returned invalid tool arguments')
          current.arguments += tc.function.arguments
          current.hasArguments = true
        }
        toolCalls.set(index, current)
      }
      if (!choice.finish_reason) continue
      if (choice.finish_reason !== 'stop' && choice.finish_reason !== 'tool_calls') {
        throw new Error(`Model response ended: ${choice.finish_reason}`)
      }
      if (choice.finish_reason === 'tool_calls' && !toolCalls.size) throw new Error('Model completed tool calls without returning any calls')
      const callIds = new Set<string>()
      const completedCalls: StreamChunk[] = [...toolCalls].sort(([a], [b]) => a - b).map(([index, tc]) => {
        if (!tc.name.trim()) throw new Error('Model returned a tool call without a name')
        if (!tc.hasArguments) throw new Error('Model returned incomplete tool arguments')
        const id = tc.id || `${fallbackId}_${index}`
        if (callIds.has(id)) throw new Error('Model returned duplicate tool call IDs')
        callIds.add(id)
        return {
          type: 'tool-call', toolCallId: id, toolName: tc.name,
          toolInput: parseToolArguments(tc.arguments), toolExtraContent: tc.extraContent
        }
      })
      yield* completedCalls
      yield { type: 'done', finish: toolCalls.size > 0 ? 'tool-calls' : 'stop' }
      return
    }
    throw new Error('Model stream ended before completing the response')
  }

  private async *parseResponsesStream(
    body: ReadableStream,
    signal?: AbortSignal
  ): AsyncGenerator<StreamChunk, void, unknown> {
    const completedItems = new Map<number, Record<string, unknown>>()
    let streamedText = ''
    for await (const event of readServerEvents(body, signal)) {
      if (event === '[DONE]') continue
      if (event.type === 'error' || event.type === 'response.failed' || event.type === 'response.incomplete') {
        throw new Error(providerError(event.error || event.response?.error || event.response?.incomplete_details || event))
      }
      if (event.type === 'response.output_text.delta' || event.type === 'response.refusal.delta') {
        streamedText += event.delta || ''
        if (event.delta) yield { type: 'text', content: event.delta }
      }
      if (event.type === 'response.output_item.done' && event.item) {
        const index = event.output_index ?? completedItems.size
        if (!Number.isSafeInteger(index) || index < 0 || completedItems.has(index)) throw new Error('Model returned invalid or duplicate output item indices')
        completedItems.set(index, event.item)
      }
      if (event.type !== 'response.completed') continue
      if (!event.response || typeof event.response !== 'object' || Array.isArray(event.response)) throw new Error('Model completion is missing its response')
      if (event.response?.error) throw new Error(providerError(event.response.error))
      if (event.response?.status && event.response.status !== 'completed') {
        throw new Error(`Model response ended: ${event.response.status}`)
      }
      if (event.response?.output !== undefined && !Array.isArray(event.response.output)) throw new Error('Model returned invalid output items')
      const items: Array<Record<string, unknown>> = event.response?.output ??
        [...completedItems.entries()].sort(([a], [b]) => a - b).map(([, item]) => item)
      if (event.response?.output) {
        for (const [index, previous] of completedItems) {
          const current = items[index]
          if (!current || current.type !== previous.type || (previous.id && current.id !== previous.id) ||
            (previous.call_id && current.call_id !== previous.call_id)) throw new Error('Model completion omitted or changed a completed output item')
        }
      }
      // A completed response can still contain a truncated output item. Validate
      // the whole batch before making any function call available to execution.
      const callIds = new Set<string>()
      const itemIds = new Set<string>()
      const calls = new Map<Record<string, unknown>, StreamChunk>()
      for (const item of items) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Model returned an invalid output item')
        if (typeof item.type !== 'string' || !item.type.trim()) throw new Error('Model returned an output item without a type')
        if (item.status !== undefined && item.status !== 'completed') throw new Error(`Model output item ended: ${item.status}`)
        if (item.id !== undefined) {
          if (typeof item.id !== 'string' || !item.id.trim() || itemIds.has(item.id)) throw new Error('Model returned empty or duplicate output item IDs')
          itemIds.add(item.id)
        }
        if (item.type === 'message') {
          if ((item.role !== undefined && item.role !== 'assistant') || !Array.isArray(item.content)) throw new Error('Model returned an invalid output message')
          for (const part of item.content) {
            if (!part || typeof part !== 'object' || Array.isArray(part) || typeof part.type !== 'string' || !part.type.trim() ||
              (part.type === 'output_text' && typeof part.text !== 'string') ||
              (part.type === 'refusal' && typeof part.refusal !== 'string')) throw new Error('Model returned invalid output message content')
          }
        }
        if (['custom_tool_call', 'computer_call', 'local_shell_call', 'shell_call', 'apply_patch_call'].includes(item.type) ||
          (item.type === 'tool_search_call' && item.execution === 'client')) throw new Error(`Model returned an unsupported client tool call: ${item.type}`)
        if (item.type !== 'function_call') continue
        if (typeof item.call_id !== 'string' || !item.call_id.trim() || typeof item.name !== 'string' || !item.name.trim()) {
          throw new Error('Model returned an incomplete function call')
        }
        if (callIds.has(item.call_id)) throw new Error('Model returned duplicate tool call IDs')
        callIds.add(item.call_id)
        if (typeof item.arguments !== 'string' || !item.arguments.trim()) throw new Error('Model returned invalid tool arguments')
        calls.set(item, { type: 'tool-call', toolCallId: item.call_id, toolName: item.name,
          toolInput: parseToolArguments(item.arguments) })
      }
      const completedText = items.filter(item => item.type === 'message' && Array.isArray(item.content))
        .flatMap(item => item.content as Array<Record<string, unknown>>)
        .map(part => part.type === 'output_text' ? part.text : part.type === 'refusal' ? part.refusal : '')
        .filter((text): text is string => typeof text === 'string').join('')
      if (streamedText && completedText) {
        if (!completedText.startsWith(streamedText)) throw new Error('Model completion changed its streamed text')
        // Compatibility services may stream only a prefix. The final suffix must
        // still pass through the protocol guard before any native call can run.
        const suffix = completedText.slice(streamedText.length)
        if (suffix) yield { type: 'text', content: suffix }
      }
      let hasTools = false
      for (const item of items) {
        // Reuse complete output items, including encrypted reasoning, on the next tool round.
        yield { type: 'response-item', responseItem: item }
        const call = calls.get(item)
        if (call) {
          hasTools = true
          yield call
        } else if (item.type === 'message' && !streamedText && Array.isArray(item.content)) {
          for (const part of item.content) {
            if (part.type === 'output_text' && part.text) yield { type: 'text', content: part.text }
            if (part.type === 'refusal' && part.refusal) yield { type: 'text', content: part.refusal }
          }
        }
      }
      yield { type: 'done', finish: hasTools ? 'tool-calls' : 'stop' }
      return
    }
    throw new Error('Responses stream ended before completing the response')
  }

  async executeTool(toolName: string, args: any): Promise<ToolResult> {
    const tool = this.tools.find(t => t.id === toolName)
    if (!tool) {
      throw new Error(`Unknown tool: ${toolName}`)
    }

    const info = await tool.init()
    return info.execute(args, {
      sessionID: '',
      messageID: '',
      agent: 'ssh-agent',
      abort: this.signal || new AbortController().signal,
      metadata: () => {},
      extra: {
        connectionId: this.connectionId,
        serverEnvDocId: this.serverEnvDocId
      }
    })
  }

  private toModelMessages(messages: ChatMessage[]): any[] {
    const result = messages.map((msg, idx) => {
      if (msg.role === 'tool') {
        return {
          role: 'tool',
          content: msg.content,
          tool_call_id: msg.tool_call_id
        }
      }

      if (msg.role === 'assistant') {
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          const openaiToolCalls = msg.tool_calls.map(tc => ({
            id: tc.id,
            type: tc.type,
            ...(tc.extra_content ? { extra_content: tc.extra_content } : {}),
            function: {
              name: tc.function.name,
              arguments:
                typeof tc.function.arguments === 'string'
                  ? tc.function.arguments
                  : JSON.stringify(tc.function.arguments)
            }
          }))

          return {
            role: 'assistant',
            content: msg.content || null,
            ...this.chatReasoningFields(msg),
            tool_calls: openaiToolCalls
          }
        }
      }

      if (msg.role === 'assistant' && typeof msg.content === 'string') {
        const invokeMatch = msg.content.match(/^\s*<invoke><(\w+)>\r?\n(.*?)\r?\n<\/\1><\/invoke>\s*$/s)
        const following = messages[idx + 1]
        if (invokeMatch && msg.tool_call_id?.trim() && following?.role === 'tool' && following.tool_call_id === msg.tool_call_id) {
          const toolName = invokeMatch[1]
          const args = parseToolArguments(invokeMatch[2])
          return {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: msg.tool_call_id,
                type: 'function',
                function: {
                  name: toolName,
                  arguments: JSON.stringify(args)
                }
              }
            ]
          }
        }
      }

      return {
        role: msg.role,
        content: msg.content,
        ...(msg.role === 'assistant' ? this.chatReasoningFields(msg) : {})
      }
    })

    return result
  }

  private chatReasoningFields(msg: ChatMessage): Record<string, unknown> {
    if (msg.reasoning_details?.length) return { reasoning_details: msg.reasoning_details }
    return msg.reasoning_content !== undefined ? { reasoning_content: msg.reasoning_content } : {}
  }

  private toResponsesInput(messages: ChatMessage[]): Array<Record<string, unknown>> {
    return messages.flatMap(msg => {
      if (msg.role === 'tool') {
        return [{ type: 'function_call_output', call_id: msg.tool_call_id, output: this.toResponsesContent(msg.content) }]
      }
      if (msg.role === 'assistant' && msg.responseItems?.length) {
        return msg.responseItems
      }
      const items: Array<Record<string, unknown>> = []
      if (msg.content) items.push({ role: msg.role, content: this.toResponsesContent(msg.content) })
      for (const tool of msg.tool_calls || []) {
        items.push({ type: 'function_call', call_id: tool.id, name: tool.function.name,
          arguments: tool.function.arguments })
      }
      return items
    })
  }

  private toResponsesContent(content: ChatMessage['content']): ChatMessage['content'] {
    if (typeof content === 'string') return content
    return content.map(part => {
      if (part.type === 'text') return { type: 'input_text', text: part.text }
      if (part.type === 'image_url') {
        const image = part.image_url
        return { type: 'input_image', image_url: typeof image === 'string' ? image : image?.url,
          ...(typeof image === 'object' && image?.detail ? { detail: image.detail } : {}) }
      }
      return part
    })
  }

}

export function createLLMSession(
  provider: AIProvider,
  model: AIModel,
  tools: ToolInfo[],
  connectionId: string,
  onProgress?: (msg: string) => void,
  serverEnvDocId?: string,
  signal?: AbortSignal,
  reasoning: ReasoningSelection = model.requestConfig?.reasoning ?? 'default'
): LLMSession {
  return new LLMSession(provider, model, tools, connectionId, onProgress, serverEnvDocId, signal, reasoning)
}

interface ServerEvent {
  type?: string
  error?: unknown
  choices?: Array<{
    delta?: {
      content?: string
      refusal?: string | null
      reasoning_content?: string
      reasoning?: string
      reasoning_details?: Array<Record<string, unknown>>
      tool_calls?: Array<{ index?: number; id?: string; type?: string; extra_content?: Record<string, unknown>; function?: { name?: string; arguments?: string } }>
    }
    finish_reason?: string | null
  }>
  delta?: string
  output_index?: number
  item?: Record<string, unknown>
  response?: { status?: string; error?: unknown; incomplete_details?: unknown; output?: Array<Record<string, unknown>> }
}

function decodeServerEvent(data: string[]): ServerEvent | '[DONE]' {
  const payload = data.join('\n')
  if (payload === '[DONE]') return payload
  try {
    const event: unknown = JSON.parse(payload)
    if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('Expected an event object')
    return event as ServerEvent
  } catch {
    throw new Error('Model returned an invalid streaming event')
  }
}

async function* readServerEvents(
  body: ReadableStream,
  signal?: AbortSignal
): AsyncGenerator<ServerEvent | '[DONE]'> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let data: string[] = []
  let skipLF = false
  const cancelReader = () => {
    void reader.cancel(createAbortError()).catch(() => {})
  }
  signal?.addEventListener('abort', cancelReader, { once: true })
  try {
    if (signal?.aborted) throw createAbortError()
    while (true) {
      const { done, value } = await reader.read()
      if (signal?.aborted) throw createAbortError()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      if (skipLF && buffer.length) {
        if (buffer[0] === '\n') buffer = buffer.slice(1)
        skipLF = false
      }
      let newline: number
      while ((newline = buffer.search(/[\r\n]/)) !== -1) {
        // CR terminates a line immediately, even on an open HTTP connection.
        // Remember only whether its optional LF remains in the next chunk.
        const line = buffer.slice(0, newline)
        const carriageReturn = buffer[newline] === '\r'
        buffer = buffer.slice(newline + 1)
        if (carriageReturn) {
          if (buffer[0] === '\n') buffer = buffer.slice(1)
          else if (!buffer.length) skipLF = true
        }
        if (!line) {
          if (data.length) yield decodeServerEvent(data)
          data = []
        } else if (line.startsWith('data:')) {
          data.push(line.slice(5).replace(/^ /, ''))
        }
      }
      if (done) break
    }
    if (buffer.startsWith('data:')) data.push(buffer.slice(5).replace(/^ /, '').replace(/\r$/, ''))
    if (data.length) yield decodeServerEvent(data)
  } finally {
    signal?.removeEventListener('abort', cancelReader)
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

function parseToolArguments(input: string): unknown {
  try {
    const parsed: unknown = input ? JSON.parse(input) : {}
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected object arguments')
    return parsed
  } catch {
    throw new Error('Model returned invalid tool arguments')
  }
}

function providerError(error: unknown): string {
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const details = error as Record<string, unknown>
    return String(details.message || details.reason || details.code || 'Model request failed')
  }
  return 'Model request failed'
}

function createAbortError(): Error {
  const error = new Error('Request aborted')
  error.name = 'AbortError'
  return error
}
