// apps/desktop/src/services/processor.ts

// 流式事件类型
export type StreamEvent =
  | { type: 'start' }
  | { type: 'text-delta'; delta: string }
  | { type: 'text-done' }
  | { type: 'tool-call'; toolCallId: string; toolName: string; input: any }
  | { type: 'tool-start'; toolCallId: string; toolName: string; input: any }
  | { type: 'tool-result'; toolCallId: string; output: { output: string } }
  | { type: 'tool-error'; toolCallId: string; error: string }
  | { type: 'done'; finish: 'stop' | 'tool-calls' }
  | { type: 'error'; error: Error }

import type { ModelMessage } from './messages/convert'
import type { ChatMessage, StreamChunk } from './llm'
import { createLLMSession } from './llm'
import type { AIProvider, AIModel } from '@/types/ai-providers'
import type { ReasoningSelection } from '../utils/model-reasoning'

// 流式处理器配置
export interface ProcessorConfig {
  messages: ModelMessage[]
  tools: any[]
  provider: AIProvider
  model: AIModel
  connectionId?: string
  serverEnvDocId?: string
  abortSignal?: AbortSignal
  reasoning?: ReasoningSelection
  toolConcurrency?: number
  /** Calls with the same key run in order; undefined creates an exclusive barrier. */
  toolExecutionKey?: (toolName: string, input: any) => string | undefined
  onEvent?: (event: StreamEvent) => void
  onToolExecute?: (toolName: string, input: any, callId?: string) => Promise<{ output: string }>
}

// 处理器结果
export interface ProcessorResult {
  finish: 'stop' | 'tool-calls'
  toolCalls?: Array<{ callId: string; name: string; input: any }>
  messages?: ModelMessage[]
  usage?: {
    inputTokens: number
    outputTokens: number
  }
}

// 会话状态
interface SessionState {
  toolCalls: Map<string, { name: string; input: any; extraContent?: Record<string, unknown> }>
  aborted: boolean
  stepCount: number
}

// 最大步数限制（防止无限循环）
const MAX_STEPS = 100

// 流式处理器类
export class SessionProcessor {
  private config: ProcessorConfig
  private state: SessionState
  private onProgress?: (msg: string) => void
  private messages: ModelMessage[]

  constructor(config: ProcessorConfig, onProgress?: (msg: string) => void) {
    this.config = {
      ...config,
      provider: { ...config.provider, config: config.provider.config ? { ...config.provider.config } : undefined },
      model: {
        ...config.model,
        parameters: config.model.parameters ? { ...config.model.parameters } : undefined,
        requestConfig: config.model.requestConfig ? { ...config.model.requestConfig } : undefined,
        reasoning: config.model.reasoning ? {
          ...config.model.reasoning,
          supportedEfforts: config.model.reasoning.supportedEfforts ? [...config.model.reasoning.supportedEfforts] : undefined
        } : config.model.reasoning
      },
      reasoning: config.reasoning ?? config.model.requestConfig?.reasoning ?? 'default'
    }
    this.messages = [...config.messages]
    this.state = {
      toolCalls: new Map(),
      aborted: false,
      stepCount: 0
    }
    this.onProgress = onProgress

    if (config.abortSignal) {
      if (config.abortSignal.aborted) {
        this.state.aborted = true
      } else {
        config.abortSignal.addEventListener(
          'abort',
          () => {
            this.state.aborted = true
          },
          { once: true }
        )
      }
    }
  }

  async process(): Promise<ProcessorResult> {
    this.throwIfAborted()
    this.state.stepCount = 0

    while (this.state.stepCount < MAX_STEPS && !this.state.aborted) {
      this.state.stepCount++
      this.state.toolCalls.clear()

      this.emit({ type: 'start' })

      try {
        const result = await this.processOneRound()
        this.throwIfAborted()

        if (result.finish === 'stop') {
          return { finish: 'stop', messages: this.messages }
        }

        if (result.finish === 'tool-calls' && result.toolCalls && result.toolCalls.length > 0) {
          await this.executeTools(result.toolCalls)
          continue
        }
      } catch (error) {
        const err = error as Error
        this.emit({ type: 'error', error: err })
        throw err
      }
    }

    return { finish: 'stop', messages: this.messages }
  }

  private async processOneRound(): Promise<{
    finish: 'stop' | 'tool-calls'
    toolCalls?: Array<{ callId: string; name: string; input: any }>
  }> {
    let accumulatedText = ''
    let accumulatedReasoning = ''
    const responseItems: Array<Record<string, unknown>> = []
    const reasoningDetails: Array<Record<string, unknown>> = []

    for await (const chunk of this.llmStream()) {
      if (this.state.aborted) break

      switch (chunk.type) {
        case 'reasoning':
          accumulatedReasoning += chunk.content || ''
          break

        case 'reasoning-details':
          if (chunk.reasoningDetails) reasoningDetails.push(...chunk.reasoningDetails)
          break

        case 'response-item':
          if (chunk.responseItem) responseItems.push(chunk.responseItem)
          break

        case 'text':
          accumulatedText += chunk.content || ''
          this.emit({ type: 'text-delta', delta: chunk.content || '' })
          break

        case 'tool-call':
          this.state.toolCalls.set(chunk.toolCallId!, {
            name: chunk.toolName!,
            input: chunk.toolInput,
            extraContent: chunk.toolExtraContent
          })
          this.emit({
            type: 'tool-call',
            toolCallId: chunk.toolCallId!,
            toolName: chunk.toolName!,
            input: chunk.toolInput
          })
          break

        case 'done':
          this.emit({ type: 'text-done' })

          if (this.state.toolCalls.size > 0) {
            // 构建 tool_calls 数组
            const toolCallsArray = Array.from(this.state.toolCalls.entries()).map(([id, tc]) => ({
              id: id,
              type: 'function' as const,
              ...(tc.extraContent ? { extra_content: tc.extraContent } : {}),
              function: {
                name: tc.name,
                arguments: typeof tc.input === 'string' ? tc.input : JSON.stringify(tc.input)
              }
            }))

            // 保存包含 tool_calls 的 assistant 消息
            this.messages.push({
              role: 'assistant',
              content: accumulatedText,
              ...(accumulatedReasoning ? { reasoning_content: accumulatedReasoning } : {}),
              ...(reasoningDetails.length ? { reasoning_details: reasoningDetails } : {}),
              ...(responseItems.length ? { responseItems } : {}),
              tool_calls: toolCallsArray
            })

            const toolCalls = Array.from(this.state.toolCalls.entries()).map(([id, tc]) => ({
              callId: id,
              name: tc.name,
              input: tc.input
            }))

            this.emit({ type: 'done', finish: 'tool-calls' })
            return { finish: 'tool-calls', toolCalls }
          }

          if (accumulatedText || responseItems.length || reasoningDetails.length) {
            this.messages.push({
              role: 'assistant',
              content: accumulatedText,
              ...(accumulatedReasoning ? { reasoning_content: accumulatedReasoning } : {}),
              ...(reasoningDetails.length ? { reasoning_details: reasoningDetails } : {}),
              ...(responseItems.length ? { responseItems } : {})
            })
          }

          this.emit({ type: 'done', finish: 'stop' })
          return { finish: 'stop' }
      }

    }

    return { finish: 'stop' }
  }

  private async executeTools(
    toolCalls: Array<{ callId: string; name: string; input: any }>
  ): Promise<void> {
    const configuredConcurrency = this.config.toolConcurrency ?? 1
    const concurrency = Number.isFinite(configuredConcurrency)
      ? Math.max(1, Math.floor(configuredConcurrency)) : 1
    const outputs: Array<ModelMessage | undefined> = new Array(toolCalls.length)
    type QueuedCall = { call: typeof toolCalls[number]; index: number; key: string }

    const executeCall = async (tc: typeof toolCalls[number], index: number): Promise<void> => {
      this.throwIfAborted()
      this.emit({
        type: 'tool-start',
        toolCallId: tc.callId,
        toolName: tc.name,
        input: tc.input
      })

      try {
        this.throwIfAborted()
        if (!this.config.onToolExecute) throw new Error(`Tool execution not configured: ${tc.name}`)
        const result = await this.config.onToolExecute(tc.name, tc.input, tc.callId)
        outputs[index] = {
          role: 'tool',
          content: result.output,
          tool_call_id: tc.callId
        }
        this.emit({
          type: 'tool-result',
          toolCallId: tc.callId,
          output: { output: result.output }
        })
      } catch (error) {
        const err = error as Error
        const toolAborted = err.name === 'AbortError' ||
          String(err.message || '').toLowerCase().includes('aborted')
        this.throwIfAborted()
        if (toolAborted && !this.config.toolExecutionKey) {
          this.state.aborted = true
          throw err
        }
        const errorOutput = err.message || String(error)
        outputs[index] = {
          role: 'tool',
          content: errorOutput,
          tool_call_id: tc.callId
        }
        this.emit({
          type: 'tool-error',
          toolCallId: tc.callId,
          error: errorOutput
        })
      }
    }

    const executeSegment = async (segment: QueuedCall[]): Promise<void> => {
      if (concurrency === 1) {
        for (const item of segment) await executeCall(item.call, item.index)
        return
      }
      const groups = new Map<string, QueuedCall[]>()
      for (const item of segment) {
        const group = groups.get(item.key)
        if (group) group.push(item)
        else groups.set(item.key, [item])
      }
      const queue = [...groups.values()]
      let nextGroup = 0
      let failed = false
      const worker = async () => {
        try {
          while (nextGroup < queue.length && !failed) {
            this.throwIfAborted()
            const group = queue[nextGroup++]
            for (const item of group) {
              if (failed) return
              await executeCall(item.call, item.index)
            }
          }
        } catch (error) {
          failed = true
          throw error
        }
      }
      // Settle every running worker before propagating cancellation. No orphaned tool
      // promises may update the old turn after the caller has started a new request.
      const results = await Promise.allSettled(
        Array.from({ length: Math.min(concurrency, queue.length) }, worker)
      )
      this.throwIfAborted()
      const failure = results.find(result => result.status === 'rejected')
      if (failure?.status === 'rejected') throw failure.reason
    }

    try {
      let segment: QueuedCall[] = []
      for (let index = 0; index < toolCalls.length; index++) {
        const tc = toolCalls[index]
        const key = this.config.toolExecutionKey?.(tc.name, tc.input)
        if (key === undefined) {
          await executeSegment(segment)
          segment = []
          await executeCall(tc, index)
        } else {
          segment.push({ call: tc, index, key })
        }
      }
      await executeSegment(segment)
      this.throwIfAborted()
    } finally {
      // Completion events are immediate, while model history keeps each tool output
      // in the original assistant call order, including completed work after a stop.
      for (const output of outputs) if (output) this.messages.push(output)
    }
  }

  private throwIfAborted(): void {
    if (!this.state.aborted && !this.config.abortSignal?.aborted) return
    this.state.aborted = true
    const error = new Error('Request aborted')
    error.name = 'AbortError'
    throw error
  }

  private async *llmStream(): AsyncGenerator<StreamChunk, void, unknown> {
    const messages = this.modelToChatMessages(this.messages)

    const session = createLLMSession(
      this.config.provider,
      this.config.model,
      this.config.tools,
      this.config.connectionId || '',
      msg => this.onProgress?.(msg),
      this.config.serverEnvDocId,
      this.config.abortSignal,
      this.config.reasoning
    )

    yield* session.stream(messages)
  }

  private modelToChatMessages(msgs: ModelMessage[]): ChatMessage[] {
    const result = msgs.map(msg => {
      const chatMsg: ChatMessage = {
        role: msg.role as any,
        content: msg.content ?? ''
      }

      if (msg.tool_calls) {
        chatMsg.tool_calls = msg.tool_calls.map(tc => ({
          id: tc.id,
          type: tc.type,
          ...(tc.extra_content ? { extra_content: tc.extra_content } : {}),
          function: tc.function
        }))
      }

      if (msg.tool_call_id) {
        chatMsg.tool_call_id = msg.tool_call_id
      }
      if (msg.reasoning_content !== undefined) chatMsg.reasoning_content = msg.reasoning_content
      if (msg.reasoning_details) chatMsg.reasoning_details = msg.reasoning_details
      if (msg.responseItems) chatMsg.responseItems = msg.responseItems

      return chatMsg
    })

    return result
  }

  private emit(event: StreamEvent) {
    this.config.onEvent?.(event)
  }

  getToolCalls(): Array<{ callId: string; name: string; input: any }> {
    return Array.from(this.state.toolCalls.entries()).map(([id, tc]) => ({
      callId: id,
      name: tc.name,
      input: tc.input
    }))
  }

  isAborted(): boolean {
    return this.state.aborted
  }

  getMessages(): ModelMessage[] {
    return this.messages
  }
}

export function getToolCallId(toolCallId: string | undefined, index: number): string {
  return toolCallId || `call_${index}`
}
