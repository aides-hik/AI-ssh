import type { Message, MessagePart } from './message'
import type { ToolPart, TextPart } from './message'

export type ModelMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | null
  tool_calls?: Array<{
    id: string
    type: 'function'
    extra_content?: Record<string, unknown>
    function: {
      name: string
      arguments: string
    }
  }>
  tool_call_id?: string
  // Provider reasoning state stays in memory, outside visible and persisted chat history.
  reasoning_content?: string
  reasoning_details?: Array<Record<string, unknown>>
  responseItems?: Array<Record<string, unknown>>
  index?: number
}

const MAX_MODEL_TEXT_LENGTH = 4000
const MAX_TOOL_OUTPUT_LENGTH = 3000

function summarizeForModel(content: string, maxLength: number): string {
  if (content.length <= maxLength) {
    return content
  }

  const headLength = Math.floor(maxLength * 0.65)
  const tailLength = Math.floor(maxLength * 0.25)
  const head = content.slice(0, headLength).trimEnd()
  const tail = content.slice(-tailLength).trimStart()

  return `${head}\n\n...[内容已摘要，省略 ${content.length - head.length - tail.length} 个字符]...\n\n${tail}`
}

function summarizeStructuredOutput(
  content: string,
  tagName: string,
  maxLines: number,
  label: string
): string | null {
  const pattern = new RegExp(`<${tagName}[^>]*>\\n?([\\s\\S]*?)\\n?<\\/${tagName}>`, 'i')
  const match = content.match(pattern)
  if (!match) return null

  const body = match[1].trim()
  const lines = body.split(/\r?\n/).filter(Boolean)
  if (lines.length <= maxLines && body.length <= MAX_TOOL_OUTPUT_LENGTH) {
    return content
  }

  const head = lines.slice(0, maxLines).join('\n')
  const remaining = Math.max(lines.length - maxLines, 0)
  return `<${tagName}>\n${head}\n\n...[${label} 已摘要，省略 ${remaining} 行]...\n</${tagName}>`
}

function summarizeToolOutput(toolName: string, output: string): string {
  if (!output) return output

  if (toolName === 'list_files' || output.includes('<directory_listing')) {
    return (
      summarizeStructuredOutput(output, 'directory_listing', 40, '目录列表') ||
      summarizeForModel(output, 2200)
    )
  }

  if (toolName === 'webfetch' || output.includes('<web_content')) {
    return (
      summarizeStructuredOutput(output, 'web_content', 45, '网页内容') ||
      summarizeForModel(output, 2200)
    )
  }

  if (toolName === 'read_file' || output.includes('<file_content')) {
    return (
      summarizeStructuredOutput(output, 'file_content', 60, '文件内容') ||
      summarizeForModel(output, 2600)
    )
  }

  if (toolName === 'execute_ssh_command' || toolName === 'bash' || output.includes('<command_result')) {
    return (
      summarizeStructuredOutput(output, 'command_result', 50, '命令输出') ||
      summarizeForModel(output, 2400)
    )
  }

  return summarizeForModel(output, MAX_TOOL_OUTPUT_LENGTH)
}

export function fromUserMessage(content: string): Message {
  return {
    info: {
      id: `msg_${Date.now()}`,
      role: 'user',
      createdAt: Date.now()
    },
    parts: [
      {
        type: 'text',
        text: content
      }
    ]
  }
}

export function toModelMessages(msgs: Message[]): ModelMessage[] {
  const result: ModelMessage[] = []
  const seenToolCallIds = new Set<string>()
  let toolIndex = 0

  for (const msg of msgs) {
    if (msg.info.role === 'system') {
      result.push({
        role: 'system',
        content: msg.parts
          .filter((p): p is TextPart => p.type === 'text')
          .map(p => p.text)
          .join('\n')
      })
    }

    if (msg.info.role === 'user') {
      const userContent = msg.parts
        .filter((p): p is TextPart => p.type === 'text')
        .map(p => p.text)
        .join('\n')

      result.push({
        role: 'user',
        content: (msg.info.targets?.length ? `[操作目标: ${msg.info.targets.map(target => `${target.name} (${target.id})`).join('、')}]\n` : '') + userContent
      })
    }

    if (msg.info.role === 'assistant') {
      const assistantMsg: ModelMessage = {
        role: 'assistant',
        content: null as any
      }

      const toolParts = msg.parts.filter((p): p is ToolPart => p.type === 'tool')

      // 收集所有工具调用（包括已完成和待处理的）
      if (toolParts.length > 0) {
        assistantMsg.tool_calls = toolParts.map(tp => ({
          id: tp.callID,
          type: 'function' as const,
          function: {
            name: tp.tool,
            arguments: JSON.stringify(tp.state.input || {})
          }
        }))
      }

      const textParts = msg.parts
        .filter((p): p is TextPart => p.type === 'text')
        .map(p => p.text)
        .join('\n')

      if (textParts) {
        assistantMsg.content = isHistorySummary(msg)
          ? textParts
          : summarizeForModel(textParts, MAX_MODEL_TEXT_LENGTH)
      }

      if (assistantMsg.tool_calls?.length || assistantMsg.content !== null) {
        result.push(assistantMsg)
      }

      // 为已完成的 tool parts 添加 tool 结果消息
      for (const tp of toolParts) {
        if (tp.state.status === 'completed' || tp.state.status === 'error') {
          const toolCallId = tp.callID
          if (!seenToolCallIds.has(toolCallId)) {
            seenToolCallIds.add(toolCallId)
            const output = tp.state.output || tp.state.error || ''
            result.push({
              role: 'tool',
              content: (tp.state.metadata?.targetId ? `[服务器: ${tp.state.metadata.targetName} (${tp.state.metadata.targetId})]\n` : '') + summarizeToolOutput(tp.tool, output),
              tool_call_id: toolCallId,
              index: toolIndex++
            })
          }
        }
      }
    }

    if (msg.info.role === 'tool') {
      const toolPart = msg.parts.find((p): p is ToolPart => p.type === 'tool')
      if (toolPart) {
        const toolCallId = toolPart.callID
        if (!seenToolCallIds.has(toolCallId)) {
          seenToolCallIds.add(toolCallId)
          const output = toolPart.state.output || toolPart.state.error || ''
          result.push({
            role: 'tool',
            content: (toolPart.state.metadata?.targetId ? `[服务器: ${toolPart.state.metadata.targetName} (${toolPart.state.metadata.targetId})]\n` : '') + summarizeToolOutput(toolPart.tool, output),
            tool_call_id: toolCallId,
            index: toolIndex++
          })
        }
      }
    }
  }

  return result
}

export function filterValidMessages(msgs: Message[]): Message[] {
  return msgs.filter(msg => {
    if (msg.info.role === 'user') return true
    if (msg.info.role === 'assistant') {
      // 只要有内容就保留（包括文本和工具调用）
      if (msg.parts.length > 0) return true
      // 如果 finish 不是 unknown，说明是完整的 assistant 消息
      if (msg.info.finish !== 'unknown') return true
      return false
    }
    return true
  })
}

export function updateToolResult(
  msg: Message,
  callID: string,
  result: { output: string }
): Message {
  const now = Date.now()
  return {
    ...msg,
    parts: msg.parts.map((part): MessagePart => {
      if (part.type === 'tool' && part.callID === callID) {
        return {
          ...part,
          state: {
            ...part.state,
            status: 'completed',
            output: result.output,
            time: {
              start: part.state.time?.start ?? now,
              end: now
            }
          }
        }
      }
      return part
    })
  }
}

/**
 * 过滤已压缩的消息
 * 保留未压缩的原始消息及摘要，避免再次发送已被摘要替代的消息。
 */
export function filterCompactedMessages(msgs: Message[]): Message[] {
  return msgs.filter(msg => !msg.info.compacted || msg.info.role === 'user' || msg.info.role === 'system' || isHistorySummary(msg))
}

/**
 * 压缩旧助手回复和工具记录，始终完整保留用户要求与系统上下文。
 * 摘要保留在原来的时间位置和助手角色中，不提升远端输出的权限。
 * @param msgs 所有消息
 * @param maxMessages 保留的最近原始消息数；用户和系统消息不受此限制
 * @returns 压缩后的消息数组
 */
export function compactMessages(msgs: Message[], maxMessages: number = 20): Message[] {
  const recentLimit = Number.isFinite(maxMessages) ? Math.max(1, Math.floor(maxMessages)) : 20
  if (msgs.length <= recentLimit) {
    return msgs
  }

  let boundary = msgs.length - recentLimit
  // Keep a standalone tool result with its preceding assistant call.
  while (boundary > 0 && msgs[boundary].info.role === 'tool') boundary--

  const compacted: Message[] = []
  let segment: Message[] = []
  const flushSegment = () => {
    if (!segment.length) return
    const first = segment[0]
    const last = segment[segment.length - 1]
    const summary = generateMessageSummary(segment)
    compacted.push({
      info: {
        id: `compacted_${first.info.id}_${last.info.id}`,
        role: 'assistant',
        createdAt: last.info.createdAt,
        finish: 'stop',
        compacted: true,
        summary
      },
      parts: [{ type: 'text', text: `[历史执行记录摘要]\n${summary}` }]
    })
    segment = []
  }

  for (const msg of msgs.slice(0, boundary)) {
    if (msg.info.role === 'user' || msg.info.role === 'system' || isHistorySummary(msg)) {
      flushSegment()
      compacted.push(msg)
    } else {
      segment.push(msg)
    }
  }
  flushSegment()
  return [...compacted, ...msgs.slice(boundary)]
}

function isHistorySummary(msg: Message): boolean {
  return msg.info.role === 'assistant' && msg.info.compacted === true && typeof msg.info.summary === 'string'
}

/** Keep observed outcomes and host identity, rather than only counting tool calls. */
function generateMessageSummary(msgs: Message[]): string {
  const entries: string[] = []
  const seenToolCallIds = new Set<string>()
  const toolResults = new Map<string, ToolPart>()
  for (const msg of msgs) {
    for (const part of msg.parts) {
      if (part.type !== 'tool') continue
      const previous = toolResults.get(part.callID)
      // A standalone result may complete an earlier pending call. Keep its outcome
      // together with the parameters and host metadata from the original call.
      const terminal = part.state.status !== 'pending' && part.state.status !== 'running'
      const keepPrevious = previous && previous.state.status !== 'pending' && previous.state.status !== 'running' && !terminal
      const preferred = keepPrevious ? previous : part
      const fallback = keepPrevious ? part : previous
      toolResults.set(part.callID, {
        ...preferred,
        state: {
          ...fallback?.state,
          ...preferred.state,
          input: preferred.state.input ?? fallback?.state.input,
          output: preferred.state.output ?? fallback?.state.output,
          error: preferred.state.error ?? fallback?.state.error,
          metadata: { ...fallback?.state.metadata, ...preferred.state.metadata }
        }
      })
    }
  }
  for (const msg of msgs) {
    if (msg.info.targets?.length) {
      entries.push(`[操作目标: ${msg.info.targets.map(target => `${target.name} (${target.id})`).join('、')}]`)
    }
    const text = msg.parts.filter((part): part is TextPart => part.type === 'text').map(part => part.text).join('\n')
    if (text) entries.push(summarizeForModel(text, MAX_MODEL_TEXT_LENGTH))
    for (const part of msg.parts) {
      if (part.type !== 'tool' || seenToolCallIds.has(part.callID)) continue
      seenToolCallIds.add(part.callID)
      const result = toolResults.get(part.callID) ?? part
      const targetId = result.state.metadata?.targetId || result.state.input?.targetId
      const target = targetId ? ` / ${result.state.metadata?.targetName || targetId} (${targetId})` : ''
      entries.push(`[工具 ${result.tool}${target} / ${result.state.status}]`)
      if (result.state.input) entries.push(`参数: ${summarizeForModel(JSON.stringify(result.state.input), 1000)}`)
      const output = result.state.output || result.state.error
      if (output) entries.push(summarizeToolOutput(result.tool, output))
    }
  }
  return entries.join('\n\n') || '无详细历史执行记录'
}
