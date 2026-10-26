import { PREVIEW_PROVIDER } from './models'

const PREVIEW_ORIGIN = 'https://models.prism-preview.invalid'
const effortLabels: Record<string, string> = {
  default: '默认',
  none: '关闭',
  enabled: '开启',
  minimal: '极低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: '最高'
}

function requestEffort(body: Record<string, unknown>): string {
  if (body.enable_thinking === false) return 'none'
  if (body.enable_thinking === true) return 'enabled'
  return typeof body.reasoning_effort === 'string' ? body.reasoning_effort : 'default'
}

interface PreviewTarget {
  id: string
  name: string
  host: string
}
interface PreviewMessage {
  role?: unknown
  content?: unknown
  tool_call_id?: unknown
  tool_calls?: unknown
}
interface PreviewToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

interface PreviewHostResult {
  status: 'success' | 'failed' | 'stopped'
  output: string
}

function commandReply(targets: PreviewTarget[], messages: PreviewMessage[]): { content: string; toolCalls?: PreviewToolCall[] } {
  const calls = new Map<string, string>()
  for (const message of messages) {
    if (!Array.isArray(message.tool_calls)) continue
    for (const call of message.tool_calls) {
      if (call.function?.name !== 'execute_ssh_command' || typeof call.id !== 'string') continue
      try {
        const args = JSON.parse(call.function.arguments)
        if (typeof args.targetId === 'string') calls.set(call.id, args.targetId)
      } catch { /* A malformed call must not become evidence of execution. */ }
    }
  }
  if (!calls.size) {
    return {
      content: `我会展示 ${targets.length} 台演示服务器的 Docker 版本查询命令，确认后执行。输出均为网页预览模拟。`,
      toolCalls: targets.map((target, index) => ({
        id: `preview-command-${index}-${target.id}`, type: 'function',
        function: { name: 'execute_ssh_command', arguments: JSON.stringify({ targetId: target.id, command: 'docker version', label: '查看 Docker 版本', timeoutSeconds: 60 }) }
      }))
    }
  }
  const results = new Map<string, PreviewHostResult>()
  for (const message of messages) {
    const id = typeof message.tool_call_id === 'string' ? calls.get(message.tool_call_id) : undefined
    if (message.role !== 'tool' || !id) continue
    const raw = typeof message.content === 'string' ? message.content : ''
    try {
      const result = JSON.parse(raw)
      const step = Array.isArray(result.steps) ? result.steps.find((step: { targetId?: string }) => step?.targetId === id) : undefined
      const successful = result.status === 'completed' && step?.status === 'completed' && step?.commandResult?.success === true && step.commandResult.exitCode === 0
      const status = result.status === 'stopped' || step?.status === 'stopped' ? 'stopped' : successful ? 'success' : 'failed'
      results.set(id, { status, output: result.status === 'rejected' ? '未获确认，未执行命令' : successful ? String(step.commandResult.output || '命令完成，无输出') : String(step?.error || result.error || '未收到有效的命令执行结果') })
    } catch {
      results.set(id, { status: /已停止|abort|cancel/i.test(raw) ? 'stopped' : 'failed', output: raw || '未收到有效的命令执行结果' })
    }
  }
  const rows = targets.map(target => {
    const result = results.get(target.id)
    return `| ${tableCell(target.name)} | ${result?.status === 'success' ? '已完成' : result?.status === 'stopped' ? '已停止' : '未完成'} | ${tableCell(result?.output || '未收到此主机的命令结果').slice(0, 200)} |`
  })
  return { content: `## 服务器命令结果\n\n这是网页预览的模拟执行，不会访问真实服务器。本次 ${[...results.values()].filter(result => result.status === 'success').length}/${targets.length} 台完成。\n\n| 服务器 | 状态 | 输出 |\n| --- | --- | --- |\n${rows.join('\n')}` }
}

function deploymentReply(
  targets: PreviewTarget[],
  messages: PreviewMessage[],
  inspections: Map<string, PreviewHostResult>
): { content: string; toolCalls?: PreviewToolCall[] } {
  const stageCalls = new Set<string>()
  for (const message of messages) {
    if (!Array.isArray(message.tool_calls)) continue
    for (const call of message.tool_calls) {
      if (call.function?.name === 'execute_deployment_stage' && typeof call.id === 'string') stageCalls.add(call.id)
    }
  }
  // A rejected, malformed or interrupted stage must never lead the mock to
  // resubmit the same changes or invent a successful deployment.
  if (stageCalls.size) {
    const stageMessage = messages.findLast(message => message.role === 'tool' && typeof message.tool_call_id === 'string' && stageCalls.has(message.tool_call_id))
    let stageResult: Record<string, unknown> = {}
    try {
      const parsed: unknown = JSON.parse(typeof stageMessage?.content === 'string' ? stageMessage.content : '')
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) stageResult = parsed as Record<string, unknown>
    } catch { /* Preserve the absent result rather than report success. */ }
    const steps = Array.isArray(stageResult.steps) ? stageResult.steps : []
    let completed = 0
    const summary = targets.map(target => {
      const step = steps.find(step => step && typeof step === 'object' && step.targetId === target.id)
      if (stageResult.status === 'rejected') return `| ${tableCell(target.name)} | 未执行 | 本阶段未获确认，未执行部署命令 |`
      if (!step) return `| ${tableCell(target.name)} | 未执行 | 未收到此主机的部署结果 |`
      if (step.status === 'stopped') return `| ${tableCell(target.name)} | 已停止 | ${tableCell(String(step.error || '执行已停止，远程变更需继续检查'))} |`
      if (step.status === 'skipped') return `| ${tableCell(target.name)} | 未执行 | ${tableCell(String(step.error || '前序步骤未通过，已暂停后续部署'))} |`
      const verified = step.status === 'completed' && step.verified === true && step.commandResult?.success === true && step.verificationResult?.success === true
      if (verified) {
        completed++
        return `| ${tableCell(target.name)} | 已完成 | Compose 启动与检查均通过（模拟） |`
      }
      const failure = step.error || step.verificationResult?.error || step.commandResult?.error
      return `| ${tableCell(target.name)} | 未完成 | ${tableCell(String(failure || '未收到有效的启动与检查结果')).slice(0, 140)} |`
    })
    const outcome = stageResult.status === 'rejected' ? '你取消了本阶段，未执行部署命令。'
      : stageResult.status === 'stopped' ? '本次部署已停止，已执行的步骤保留各自结果。'
        : stageResult.status === 'failed' ? '部署阶段未通过，尚未启动的节点已暂停；未自动回滚。'
          : !Object.keys(stageResult).length ? '未收到部署阶段的有效结果，不能确认任何节点已完成部署。'
            : '以下状态来自实际收到的模拟执行结果。'
    return { content: `## ${targets.length === 1 ? '服务器' : '多服务器'} Compose 部署结果\n\n这是网页预览的模拟部署，不会访问真实服务器。${outcome}本次 ${completed}/${targets.length} 台完成。\n\n| 服务器 | 状态 | 结果 |\n| --- | --- | --- |\n${summary.join('\n')}\n\n可展开执行记录查看各节点的命令与输出。` }
  }

  const ready = targets.every(target => inspections.get(target.id)?.status === 'success')
  if (!ready) {
    const summary = targets.map(target => {
      const result = inspections.get(target.id)
      return `| ${tableCell(target.name)} | ${result?.status === 'success' ? '检查通过' : result?.status === 'stopped' ? '已停止' : '检查未完成'} | ${tableCell(result?.status === 'success' ? '等待其他节点通过检查' : result?.output || '未收到检查结果').slice(0, 140)} |`
    })
    return { content: `## 部署准备未通过\n\n这是网页预览的模拟检查。部分节点未通过，尚未提交部署命令。\n\n| 服务器 | 状态 | 结果 |\n| --- | --- | --- |\n${summary.join('\n')}` }
  }
  return {
    content: '演示节点的准备检查已返回。接下来将展示 Compose 部署阶段，确认后才逐台执行启动与检查；以下配置与结果均为网页预览模拟。',
    toolCalls: [{
      id: 'preview-compose-deploy', type: 'function',
      function: { name: 'execute_deployment_stage', arguments: JSON.stringify({
        name: `Docker Compose ${targets.length === 1 ? '单机' : '多机'}部署演示`, kind: 'deploy', strategy: 'rolling', timeoutSeconds: 300,
        steps: targets.map(target => ({ targetId: target.id, label: '启动演示项目并检查服务',
          command: 'mkdir -p /home/demo/projects/prism-demo\ncd /home/demo/projects/prism-demo\ndocker compose pull\ndocker compose up -d',
          verifyCommand: 'cd /home/demo/projects/prism-demo\ndocker compose ps --all\ncurl --fail --silent --show-error --max-time 15 http://127.0.0.1:8080/health' }))
      }) }
    }]
  }
}

function multiHostReply(body: Record<string, unknown>): { content: string; toolCalls?: PreviewToolCall[] } | undefined {
  const messages: PreviewMessage[] = Array.isArray(body.messages) ? body.messages : []
  const system = messages.find(message => message.role === 'system' && typeof message.content === 'string' && message.content.includes('<multi_host_targets>'))
  const marker = typeof system?.content === 'string' ? system.content.match(/<multi_host_targets>([\s\S]*?)<\/multi_host_targets>/) : null
  if (!marker) return undefined
  let targets: PreviewTarget[]
  try {
    const parsed: unknown = JSON.parse(marker[1])
    if (!Array.isArray(parsed)) return undefined
    targets = parsed.filter((target): target is PreviewTarget => !!target && typeof target === 'object' && typeof target.id === 'string' && typeof target.name === 'string' && typeof target.host === 'string')
  } catch { return undefined }
  if (!targets.length) return undefined

  const latestUser = messages.findLastIndex(message => message.role === 'user')
  const currentMessages = messages.slice(latestUser + 1)
  const toolMessages = currentMessages.filter(message => message.role === 'tool')
  const latestRequest = typeof messages[latestUser]?.content === 'string' ? messages[latestUser].content : ''
  const requestsPlanningOnly = /只规划|仅规划|先规划|先分析|只分析|不要修改|不要执行|不要实际部署|不执行|只读|只做计划|plan\s+only|do\s+not\s+(?:modify|deploy|execute)|read.only/i.test(latestRequest)
  const wantsDeployment = !requestsPlanningOnly && /部署|compose|\bdeploy/i.test(latestRequest)
  const wantsCommand = !requestsPlanningOnly && !wantsDeployment &&
    /docker\s+(?:--version|version)|docker.{0,12}版本/i.test(latestRequest) &&
    /执行|运行|查询|查看|检查|\brun\b|\bexecute\b|\bcheck\b/i.test(latestRequest)
  const wantsInspection = /巡检|检查|cpu|内存|磁盘|服务状态|host\s+health|\binspect\b/i.test(latestRequest)
  // Every real chat now receives a target list. Ordinary model/font/reasoning
  // previews must still answer normally instead of triggering server operations.
  if (!wantsDeployment && !wantsCommand && !wantsInspection && !toolMessages.length) return undefined
  const tools = Array.isArray(body.tools) ? body.tools : []
  if (wantsCommand) {
    const supportsCommand = tools.some(tool => tool && typeof tool === 'object' && tool.function?.name === 'execute_ssh_command')
    if (!supportsCommand) return { content: '这是网页预览的模拟回复。本次没有可用的服务器命令工具，未执行命令。' }
    return commandReply(targets, currentMessages)
  }
  const supportsDeployment = tools.some(tool => tool && typeof tool === 'object' && tool.function?.name === 'execute_deployment_stage')
  if (wantsDeployment && !supportsDeployment) return { content: '这是网页预览的模拟回复。本次没有可用的多服务器部署工具，未提交部署命令。' }
  if (!toolMessages.length) {
    const supportsInspection = tools.some(tool => tool && typeof tool === 'object' && tool.function?.name === 'inspect_server')
    if (!supportsInspection) return { content: '这是网页预览的模拟回复。本次没有可用的巡检工具，未执行服务器巡检。' }
    return {
      content: wantsDeployment
        ? `我会先检查 ${targets.length} 台演示服务器，再展示需要确认的 Compose 部署阶段。以下执行与数据均为网页预览模拟。`
        : `我会并行检查这 ${targets.length} 台演示服务器，并按主机汇总资源和服务状态。以下执行与数据均为网页预览模拟。`,
      toolCalls: targets.map((target, index) => ({
        id: `preview-inspect-${index}-${target.id}`,
        type: 'function',
        function: { name: 'inspect_server', arguments: JSON.stringify({ targetId: target.id, checks: ['system', 'cpu', 'memory', 'disk', 'services', 'network'] }) }
      }))
    }
  }

  const targetByCall = new Map<string, string>()
  for (const message of currentMessages) {
    if (!Array.isArray(message.tool_calls)) continue
    for (const call of message.tool_calls) {
      try {
        const args = JSON.parse(call.function?.arguments || '{}')
        if (typeof call.id === 'string' && typeof args.targetId === 'string') targetByCall.set(call.id, args.targetId)
      } catch { /* A malformed mock call cannot become a successful result. */ }
    }
  }
  const results = new Map<string, PreviewHostResult>()
  for (const message of toolMessages) {
    const raw = typeof message.content === 'string' ? message.content : JSON.stringify(message.content ?? '')
    const mappedTargetId = typeof message.tool_call_id === 'string' ? targetByCall.get(message.tool_call_id) : undefined
    try {
      const parsed = JSON.parse(raw)
      const targetId = typeof parsed.targetId === 'string' ? parsed.targetId : mappedTargetId
      if (!targetId) continue
      results.set(targetId, { status: parsed.success === true ? 'success' : 'failed', output: typeof parsed.output === 'string' ? parsed.output : String(parsed.error || '未收到有效执行结果') })
    } catch {
      if (!mappedTargetId) continue
      const stopped = /已停止|停止此服务器|abort|cancel/i.test(raw)
      results.set(mappedTargetId, { status: stopped ? 'stopped' : 'failed', output: raw })
    }
  }
  if (wantsDeployment) return deploymentReply(targets, currentMessages, results)
  const summary = targets.map(target => {
    const result = results.get(target.id)
    if (!result) return `| ${tableCell(target.name)} | 未执行 | 没有收到该主机的执行结果 |`
    if (result.status === 'stopped') return `| ${tableCell(target.name)} | 已停止 | 保留此前结果，本次未完成巡检 |`
    if (result.status === 'failed') return `| ${tableCell(target.name)} | 未完成 | ${tableCell(result.output).slice(0, 120)} |`
    const disk = result.output.match(/\b(\d{1,3})%\s+\//)?.[1]
    const cpu = result.output.match(/CPU usage:\s*([^\n]+)/)?.[1]
    const memory = result.output.match(/Memory:\s*([^\n]+)/)?.[1]
    const detail = [cpu ? `CPU ${cpu}` : null, memory ? `内存 ${memory}` : null, disk ? `磁盘 ${disk}%${Number(disk) >= 80 ? '，建议检查空间占用' : ''}` : null].filter(Boolean).join('；')
    return `| ${tableCell(target.name)} | 已完成 | ${tableCell(detail || '巡检命令已完成，展开过程查看输出')} |`
  })
  const complete = [...results.values()].filter(result => result.status === 'success').length
  const hasDiskPressure = [...results.values()].some(result => result.status === 'success' && /\b(?:8\d|9\d|100)%\s+\//.test(result.output))
  return {
    content: `## ${targets.length === 1 ? '服务器' : '多服务器'}巡检结果\n\n这是网页预览的模拟巡检。本次 ${complete}/${targets.length} 台完成，未完成的主机保留各自状态。\n\n| 服务器 | 状态 | 结果 |\n| --- | --- | --- |\n${summary.join('\n')}\n\n${hasDiskPressure ? '数据库节点磁盘占用较高，可以继续检查日志和数据目录的空间分布。' : '可展开每条执行记录查看对应主机的输出。'}本次没有修改服务器配置。`
  }
}

function tableCell(value: string) {
  return value.replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ').trim()
}

/** Installed by the browser preview entry only; other requests retain native fetch behavior. */
export function createPreviewModelFetch(realFetch: typeof fetch): typeof fetch {
  return async (input, init) => {
    let url: URL
    try {
      url = new URL(input instanceof Request ? input.url : String(input))
    } catch {
      return realFetch(input, init)
    }
    if (url.origin !== PREVIEW_ORIGIN) return realFetch(input, init)

    const request = new Request(input, init)
    request.signal.throwIfAborted()
    if (request.method === 'GET' && url.pathname === '/v1/models') {
      return Response.json({
        object: 'list',
        data: PREVIEW_PROVIDER.models.map(model => ({
          id: model.id,
          name: model.name,
          description: model.description,
          object: 'model',
          owned_by: PREVIEW_PROVIDER.id,
          context_window: model.contextWindow,
          function_calling: model.capabilities.functionCall
        }))
      })
    }
    if (request.method !== 'POST' || url.pathname !== '/v1/chat/completions') {
      return Response.json({ error: { message: '网页演示未提供这个接口。' } }, { status: 404 })
    }

    let body: Record<string, unknown>
    try {
      const parsed: unknown = await request.json()
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error()
      body = parsed as Record<string, unknown>
    } catch {
      request.signal.throwIfAborted()
      return Response.json({ error: { message: '演示请求必须是 JSON 对象。' } }, { status: 400 })
    }
    request.signal.throwIfAborted()
    const model = PREVIEW_PROVIDER.models.find(model => model.id === body.model)
    if (!model) {
      return Response.json({ error: { message: '请选择网页预览中的演示模型。' } }, { status: 400 })
    }

    const effort = requestEffort(body)
    const multiHost = multiHostReply(body)
    const content = multiHost?.content ?? `这是网页预览的模拟回复。\n\n当前模型：${model.name}\n推理强度：${effortLabels[effort] || effort}\n\n可以切换模型和推理强度，再次发送来查看变化。未调用真实模型，也未执行服务器命令。`
    const toolCalls = multiHost?.toolCalls
    const finishReason = toolCalls?.length ? 'tool_calls' : 'stop'
    const id = 'chatcmpl-ui-preview'
    const created = Math.floor(Date.now() / 1000)
    if (body.stream === true) {
      const chunk = (delta: Record<string, unknown>, finishReason: string | null) =>
        `data: ${JSON.stringify({
          id,
          created,
          object: 'chat.completion.chunk',
          model: model.id,
          choices: [{ index: 0, delta, finish_reason: finishReason }]
        })}\n\n`
      return new Response(
        chunk({ role: 'assistant', content, ...(toolCalls ? { tool_calls: toolCalls.map((call, index) => ({ ...call, index })) } : {}) }, null) + chunk({}, finishReason) + 'data: [DONE]\n\n',
        { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } }
      )
    }
    return Response.json({
      id,
      created,
      object: 'chat.completion',
      model: model.id,
      choices: [{ index: 0, message: { role: 'assistant', content, ...(toolCalls ? { tool_calls: toolCalls } : {}) }, finish_reason: finishReason }]
    })
  }
}
