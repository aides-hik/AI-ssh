
import type { AIProvider, AIModel } from '../types/ai-providers'
import { zodToOpenAIParameters } from './zod-schema'
import { isRetiredManagedProvider } from '../utils/standalone-providers'
import { buildReasoningRequest, type ReasoningSelection } from '../utils/model-reasoning'

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
    private reasoning: ReasoningSelection = 'default'
  ) {
    this.provider = provider
    this.model = model
    this.tools = tools
  }

  async *stream(messages: ChatMessage[]): AsyncGenerator<StreamChunk, void, unknown> {
    const toolDefinitions = await Promise.all(
      this.tools.map(async tool => {
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

    const reasoningRequest = buildReasoningRequest(this.provider, this.model, this.reasoning)
    const responses = reasoningRequest.protocol === 'responses'
    const apiBase = this.provider.endpoint.replace(/\/+$/, '')
    let endpoint = `${apiBase}/${responses ? 'responses' : 'chat/completions'}`
    let requestModelId = this.model.id
    if (!responses) {
      try {
        const googleEndpoint = new URL(apiBase)
        if (googleEndpoint.hostname === 'generativelanguage.googleapis.com') {
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
      ...(responses
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
      ...(!reasoningRequest.omitTemperature ? { temperature: 0.3 } : {}),
      stream: true,
      tool_choice: toolDefinitions.length > 0 ? 'auto' : undefined,
      ...reasoningRequest.body
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.provider.apiKey}`,
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
    if (responses) yield* this.parseResponsesStream(response.body, this.signal)
    else yield* this.parseStream(response.body, this.signal)
  }

  async *parseStream(
    body: ReadableStream,
    signal?: AbortSignal
  ): AsyncGenerator<StreamChunk, void, unknown> {
    const toolCalls = new Map<number, { id?: string; name: string; arguments: string; extraContent?: Record<string, unknown> }>()
    for await (const parsed of readServerEvents(body, signal)) {
      if (parsed === '[DONE]') {
        if (toolCalls.size > 0) throw new Error('Model stream ended before completing tool calls')
        yield { type: 'done', done: true, finish: 'stop' }
        return
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
      for (const tc of choice.delta?.tool_calls || []) {
        const index = tc.index ?? 0
        const current = toolCalls.get(index) || { name: '', arguments: '' }
        if (tc.id) current.id = tc.id
        if (tc.extra_content) current.extraContent = tc.extra_content
        if (tc.function?.name) current.name += tc.function.name
        if (tc.function?.arguments) current.arguments += tc.function.arguments
        toolCalls.set(index, current)
      }
      if (!choice.finish_reason) continue
      if (choice.finish_reason !== 'stop' && choice.finish_reason !== 'tool_calls') {
        throw new Error(`Model response ended: ${choice.finish_reason}`)
      }
      for (const [index, tc] of [...toolCalls].sort(([a], [b]) => a - b)) {
        if (!tc.name) throw new Error('Model returned a tool call without a name')
        yield {
          type: 'tool-call', toolCallId: tc.id || String(index), toolName: tc.name,
          toolInput: parseToolArguments(tc.arguments), toolExtraContent: tc.extraContent
        }
      }
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
        completedItems.set(event.output_index ?? completedItems.size, event.item)
      }
      if (event.type !== 'response.completed') continue
      if (event.response?.error) throw new Error(providerError(event.response.error))
      if (event.response?.status && event.response.status !== 'completed') {
        throw new Error(`Model response ended: ${event.response.status}`)
      }
      const items: Array<Record<string, unknown>> = event.response?.output ||
        [...completedItems.entries()].sort(([a], [b]) => a - b).map(([, item]) => item)
      let hasTools = false
      for (const item of items) {
        // Reuse complete output items, including encrypted reasoning, on the next tool round.
        yield { type: 'response-item', responseItem: item }
        if (item.type === 'function_call') {
          if (typeof item.call_id !== 'string' || typeof item.name !== 'string') {
            throw new Error('Model returned an incomplete function call')
          }
          hasTools = true
          yield {
            type: 'tool-call', toolCallId: item.call_id, toolName: item.name,
            toolInput: parseToolArguments(String(item.arguments || '{}'))
          }
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

      if (typeof msg.content === 'string') {
        const invokeMatch = msg.content.match(/<invoke><(\w+)>\n(.*?)\n<\/\1><\/invoke>/s)
        if (invokeMatch) {
          const toolName = invokeMatch[1]
          const argsStr = invokeMatch[2]
          let args = {}
          try {
            args = JSON.parse(argsStr)
          } catch {
            // parse error
          }
          return {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: msg.tool_call_id || `call_${idx}_${Date.now()}`,
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
        return [{ type: 'function_call_output', call_id: msg.tool_call_id, output: msg.content }]
      }
      if (msg.role === 'assistant' && msg.responseItems?.length) {
        return msg.responseItems
      }
      const items: Array<Record<string, unknown>> = []
      if (msg.content) items.push({ role: msg.role, content: msg.content })
      for (const tool of msg.tool_calls || []) {
        items.push({ type: 'function_call', call_id: tool.id, name: tool.function.name,
          arguments: tool.function.arguments })
      }
      return items
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
  reasoning: ReasoningSelection = 'default'
): LLMSession {
  return new LLMSession(provider, model, tools, connectionId, onProgress, serverEnvDocId, signal, reasoning)
}

interface ServerEvent {
  type?: string
  error?: unknown
  choices?: Array<{
    delta?: {
      content?: string
      reasoning_content?: string
      reasoning?: string
      reasoning_details?: Array<Record<string, unknown>>
      tool_calls?: Array<{ index?: number; id?: string; extra_content?: Record<string, unknown>; function?: { name?: string; arguments?: string } }>
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
    return JSON.parse(payload) as ServerEvent
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
      let newline: number
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, '')
        buffer = buffer.slice(newline + 1)
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
