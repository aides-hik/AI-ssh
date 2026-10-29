import z from 'zod'
import { Tool, type Context } from './tool'
import { AskFollowupQuestionTool, AttemptCompletionTool, UpdateServerEnvDocTool, WebFetchTool } from './ssh-tools'
import { executeSSHCommand } from '../ssh/ssh-command.service'
import type { SSHCommandResult } from '../ssh/ssh-command-result'
import { sshService } from '../ssh.service'
import { MultiHostRun, type HostRunPhase } from '../multi-host-run'
import { executeDeploymentStage, type DeploymentStage, type FrozenDeploymentStage } from '../multi-host-deployment'

export interface HostToolOutput {
  targetId: string
  stream: 'stdout' | 'stderr'
  data: string
  truncated?: boolean
}

export interface HostToolPhase {
  targetId: string
  phase: HostRunPhase
  label: string
  stageName: string
}

export interface MultiHostToolOptions {
  approveDeployment?: (stage: FrozenDeploymentStage, signal: AbortSignal) => Promise<boolean>
  approveReadOnly?: (stage: FrozenDeploymentStage, signal: AbortSignal) => Promise<boolean>
  onOutput?: (event: HostToolOutput) => void
  onPhase?: (event: HostToolPhase) => void
}

function boundedText(value: string, limit: number): string {
  const bytes = new TextEncoder().encode(value)
  let end = Math.min(bytes.length, limit)
  while (end > 0 && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--
  return new TextDecoder().decode(bytes.subarray(0, end))
}

function deploymentOutput(result: SSHCommandResult, budget: number): SSHCommandResult {
  const output = boundedText(result.output, budget)
  const stderr = result.stderr === undefined ? undefined : boundedText(result.stderr, Math.floor(budget / 4))
  const error = result.error === undefined ? undefined : boundedText(result.error, 1000)
  // output already contains stdout; avoid duplicating image pull/build logs in model history.
  const rest = { ...result }
  delete rest.stdout
  return { ...rest, output, stderr, error,
    truncated: result.truncated === true || output !== result.output || stderr !== result.stderr || error !== result.error }
}

const inspections = {
  system: 'uname -a',
  cpu: 'uptime && getconf _NPROCESSORS_ONLN',
  memory: 'free -m',
  disk: 'df -hP',
  services: 'if command -v systemctl >/dev/null 2>&1; then systemctl list-units --type=service --state=running --no-pager --plain --no-legend; else ps -eo pid,comm; fi',
  network: 'if command -v ss >/dev/null 2>&1; then ss -lnt; else netstat -lnt; fi'
} as const
export type InspectionCheck = keyof typeof inspections

export function inspectionCommand(checks: InspectionCheck[]): string {
  // Only our literal scripts reach the shell; model input selects named checks.
  return ['prism_inspection_status=0', ...[...new Set(checks)].flatMap(check => [
    `printf '%s\\n' '--- PRISM_INSPECT_${check.toUpperCase()} ---'`,
    `( ${inspections[check]} )`,
    'prism_check_status=$?',
    'if [ "$prism_check_status" -ne 0 ]; then printf "Check unavailable (exit %s)\\n" "$prism_check_status"; prism_inspection_status=1; fi'
  ]), 'exit "$prism_inspection_status"'].join('\n')
}

export function quoteRemotePath(path: string): string {
  if (!path || /[\0\r\n]/.test(path)) throw new Error('文件路径无效')
  return `'${path.replace(/'/g, `'"'"'`)}'`
}

export function createMultiHostTools(run: MultiHostRun, options: MultiHostToolOptions = {}) {
  const targetId = z.enum(run.targets.map(target => target.id) as [string, ...string[]])
    .describe('Exact ID of one explicitly selected target server')
  const script = z.string().trim().min(1).max(64000).refine(value => !value.includes('\0'), 'NUL is not allowed in shell scripts')
  const timeoutSeconds = z.number().int().min(10).max(1800).optional().default(300)
  const deploymentStage = z.object({
    name: z.string().trim().min(1).max(160),
    kind: z.enum(['deploy', 'verify', 'rollback', 'command']),
    strategy: z.enum(['rolling', 'parallel']),
    timeoutSeconds,
    steps: z.array(z.object({
      targetId,
      label: z.string().trim().min(1).max(160),
      command: script.describe('Exact non-interactive shell script shown for approval. Runs with set -e. Can prepare directories, write configuration, pull images, and run Compose.'),
      verifyCommand: script.optional().describe('Required for deploy and rollback. Must exit nonzero if the service is unhealthy; merely listing containers does not verify health.')
    }).strict()).min(1).max(20)
  }).strict()
  const executeCommand = z.object({
    targetId,
    command: script,
    label: z.string().trim().min(1).max(160).optional(),
    timeoutSeconds
  }).strict()
  const environmentUpdate = z.object({
    targetId,
    content: z.string().max(48000).optional(),
    old_string: z.string().max(24000).optional(),
    new_string: z.string().max(24000).optional(),
    force_replace: z.boolean().optional()
  }).strict().refine(value => Boolean(value.old_string || value.content), 'content or old_string is required')
  let deploymentBlocked = false
  const phase = (event: HostToolPhase) => {
    run.setPhase(event.targetId, event.phase, event.label, event.stageName)
    options.onPhase?.(event)
  }
  const assertLive = async (id: string, signal: AbortSignal) => {
    const live = await sshService.getConnections()
    if (!live.some(connection => connection.id === id && (connection.status === 'connected' || ('isConnected' in connection && connection.isConnected === true)))) {
      run.stopTarget(id, true)
      throw new Error('服务器连接已断开')
    }
    signal.throwIfAborted()
  }
  const output = (id: string) => (event: { stream: 'stdout' | 'stderr'; data: string; truncated?: boolean }) => {
    options.onOutput?.({ targetId: id, stream: event.stream, data: event.data, truncated: event.truncated })
  }
  const executeStage = async (stage: DeploymentStage, ctx: Context) => {
    const operation = stage.operation ?? 'shell'
    const outputBudget = Math.min(12000, Math.floor(48000 / (stage.steps.length * 2)))
    const title = stage.name
    if (deploymentBlocked && stage.kind === 'deploy') {
      throw new Error('上一部署阶段未完成，已暂停后续部署。请先检查结果或提出回滚；重新部署需在新消息中制定计划。')
    }
    const result = await executeDeploymentStage(run, stage, {
      signal: ctx.abort,
      approve: options.approveDeployment,
      onPhase: options.onPhase,
      execute: async (id, command, signal, execution) => {
        await assertLive(id, signal)
        let result: SSHCommandResult
        if (operation === 'environment-document') {
          // This JSON string is the exact immutable change shown for approval.
          // It never reaches a shell; the canonical tool keeps atomic writes,
          // backups and exact-replacement semantics in one place.
          const parameters = JSON.parse(command) as Record<string, unknown>
          const tool = await UpdateServerEnvDocTool.init()
          signal.throwIfAborted()
          const changed = await tool.execute(parameters, {
            ...ctx, abort: signal, extra: { ...ctx.extra, connectionId: id, serverEnvDocId: id }
          })
          if (changed.metadata.committed !== true) signal.throwIfAborted()
          result = { success: true, exitCode: 0, output: changed.output,
            ...(changed.metadata.committed === true ? { committed: true } : {}) }
        } else {
          result = await executeSSHCommand(id, `set -e\n${command}`, signal, {
            timeoutMs: execution.timeoutMs, onOutput: output(id)
          })
        }
        return deploymentOutput(result, outputBudget)
      }
    })
    if (result.status !== 'completed') deploymentBlocked = true
    return { title, metadata: { deploymentStatus: result.status }, output: JSON.stringify(result) }
  }
  const remote = async (id: string, action: (signal: AbortSignal) => Promise<Record<string, unknown>>) =>
    run.execute(id, async (signal, target) => {
      await assertLive(id, signal)
      const result = await action(signal)
      return { title: target.name, metadata: { targetId: id, targetName: target.name, host: target.host },
        output: JSON.stringify({ targetId: id, targetName: target.name, host: target.host, ...result }) }
    })
  let readApprovalQueue: Promise<unknown> = Promise.resolve()
  const command = async (id: string, script: string, readLimit?: number) => remote(id, async signal => {
    if (options.approveReadOnly) {
      const approve = options.approveReadOnly
      const stage: FrozenDeploymentStage = Object.freeze({ name: '只读检查', kind: 'command', strategy: 'rolling', operation: 'shell', timeoutSeconds: 300,
        steps: Object.freeze([Object.freeze({ targetId: id, label: '读取服务器信息', command: script })]) })
      // Independent hosts may request reads together; present each review in order.
      const pending = readApprovalQueue.then(async () => {
        signal.throwIfAborted()
        return approve(stage, signal)
      })
      readApprovalQueue = pending.catch(() => {})
      if (!await pending) throw new Error('用户未批准只读检查，未读取远程信息')
    }
    signal.throwIfAborted()
    phase({ targetId: id, phase: 'inspecting', label: '读取服务器状态', stageName: '只读检查' })
    const result = await executeSSHCommand(id, script, signal, { onOutput: output(id) })
    if (!result.success) throw new Error(`${result.error || '巡检失败'}${result.output ? `\n${result.output.slice(0, 12000)}` : ''}`)
    const bytes = new TextEncoder().encode(result.output)
    const limit = Math.min(24000, readLimit === undefined ? 24000 : readLimit - 1)
    let end = Math.min(bytes.length, limit)
    while (end > 0 && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--
    return { success: true, output: new TextDecoder().decode(bytes.subarray(0, end)), exitCode: result.exitCode, durationMs: result.durationMs, truncated: bytes.length > limit || result.truncated === true }
  })
  return [
    Tool.define('execute_deployment_stage', async () => ({
      description: 'Execute ONE explicitly reviewed multi-server deployment, verification, or rollback stage. The application asks the user to approve the exact hosts and scripts before any command runs; never pass approved flags or claim approval yourself. Rolling execution verifies one host before starting the next. Parallel execution runs at most 3 hosts and stops dispatching on failure. A failed/rejected stage blocks further deploy stages in this request, but newly approved verification or rollback remains available. Use separate stages for dependencies and do not place dependent hosts in a parallel stage. Every deploy/rollback step requires a verification command. No automatic rollback or data deletion.',
      parameters: deploymentStage,
      execute: async (input, ctx) => executeStage(deploymentStage.parse(input), ctx)
    })),
    Tool.define('execute_ssh_command', async () => ({
      description: 'Execute a bounded non-interactive command on one selected server. Uses the same immutable plan and user approval for one or many selected hosts. Prefer dedicated read-only tools when possible. Returns a stage result with each host outcome; completed commands do not certify application health. Optional timeoutSeconds is shown in approval (10–1800 seconds, default 300).',
      parameters: executeCommand,
      execute: async (input, ctx) => {
        const parameters = executeCommand.parse(input)
        const label = parameters.label || '执行服务器命令'
        return executeStage({ name: label, kind: 'command', strategy: 'rolling', operation: 'shell',
          timeoutSeconds: parameters.timeoutSeconds,
          steps: [{ targetId: parameters.targetId, label, command: parameters.command }] }, ctx)
      }
    })),
    Tool.define('update_server_env_doc', async () => ({
      description: 'Update the canonical env.md for one selected target after reviewing the exact document change. Preserves backups and exact old_string/new_string replacements. Read the document first; use content for creation or explicitly requested full rewrites, and force_replace only after explicit user confirmation. This tool is available identically for one or many selected hosts.',
      parameters: environmentUpdate,
      execute: async (input, ctx) => {
        const { targetId: id, ...change } = environmentUpdate.parse(input)
        const label = '更新服务器环境文档'
        return executeStage({ name: label, kind: 'command', strategy: 'rolling', operation: 'environment-document',
          steps: [{ targetId: id, label, command: JSON.stringify(change, null, 2) }] }, ctx)
      }
    })),
    Tool.define('inspect_server', async () => ({
      description: 'Inspect a selected server without making changes. Returns labelled system, CPU, memory, disk, running service or listening port observations.',
      parameters: z.object({ targetId, checks: z.array(z.enum(['system', 'cpu', 'memory', 'disk', 'services', 'network'])).min(1).max(6) }),
      execute: ({ targetId: id, checks }) => command(id, inspectionCommand(checks))
    })),
    Tool.define('read_file', async () => ({
      description: 'Read up to 24000 bytes of an absolute file path on one selected server. Use read_server_env_doc for env.md.',
      parameters: z.object({ targetId, path: z.string().startsWith('/').max(4096) }),
      execute: ({ targetId: id, path }) => command(id, `head -c 24001 -- ${quoteRemotePath(path)}`, 24001)
    })),
    Tool.define('list_files', async () => ({
      description: 'List a directory on one selected server without making changes.',
      parameters: z.object({ targetId, path: z.string().max(4096).default('.') }),
      execute: ({ targetId: id, path = '.' }) => command(id, `ls -la -- ${quoteRemotePath(path)}`)
    })),
    Tool.define('read_server_env_doc', async () => ({
      description: 'Read the canonical env.md for one selected server. This tool cannot modify the document.',
      parameters: z.object({ targetId }),
      execute: ({ targetId: id }) => command(id, 'if [ -f "$HOME/env.md" ]; then head -c 16001 -- "$HOME/env.md"; else printf "%s\\n" "服务器环境文档不存在"; fi', 16001)
    })),
    AskFollowupQuestionTool,
    AttemptCompletionTool,
    WebFetchTool
  ]
}
