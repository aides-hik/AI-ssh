import { MultiHostRun, type HostRunPhase } from './multi-host-run'
import { normalizeSSHCommandResult, type SSHCommandResult } from './ssh/ssh-command-result'

export interface DeploymentStep {
  targetId: string
  label: string
  command: string
  verifyCommand?: string
}

export interface DeploymentStage {
  name: string
  kind: 'deploy' | 'verify' | 'rollback' | 'command'
  strategy: 'rolling' | 'parallel'
  operation?: 'shell' | 'environment-document'
  timeoutSeconds?: number
  steps: DeploymentStep[]
}

export type FrozenDeploymentStage = Readonly<Omit<DeploymentStage, 'steps'>> & {
  readonly steps: readonly Readonly<DeploymentStep>[]
}

export interface DeploymentStepResult {
  targetId: string
  targetName: string
  host: string
  label: string
  status: 'completed' | 'failed' | 'skipped' | 'stopped'
  commandResult?: SSHCommandResult
  verificationResult?: SSHCommandResult
  verified: boolean
  error?: string
}

export interface DeploymentStageResult {
  stage: Pick<DeploymentStage, 'name' | 'kind' | 'strategy' | 'operation' | 'timeoutSeconds'>
  status: 'completed' | 'failed' | 'rejected' | 'stopped'
  steps: DeploymentStepResult[]
  error?: string
}

export interface DeploymentExecutionOptions {
  signal: AbortSignal
  /** No approval callback means no execution. Model-supplied approval flags are never used. */
  approve?: (stage: FrozenDeploymentStage, signal: AbortSignal) => Promise<boolean>
  /** The caller must recheck the exact live connection before sending each command. */
  execute: (targetId: string, command: string, signal: AbortSignal, context: {
    timeoutMs: number
    phase: HostRunPhase
    label: string
    stageName: string
  }) => Promise<SSHCommandResult>
  onPhase?: (event: { targetId: string; phase: HostRunPhase; label: string; stageName: string }) => void
  concurrency?: number
}

const activeStages = new WeakSet<MultiHostRun>()

function text(value: unknown, field: string, limit: number): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || value.length > limit) {
    throw new Error(`${field}无效`)
  }
  return value
}

/** Validate all hosts and operations before asking approval or changing run state. */
function snapshotStage(run: MultiHostRun, stage: DeploymentStage): FrozenDeploymentStage {
  if (!stage || !['deploy', 'verify', 'rollback', 'command'].includes(stage.kind) ||
      !['rolling', 'parallel'].includes(stage.strategy)) throw new Error('部署阶段类型或执行方式无效')
  const name = text(stage.name, '阶段名称', 160)
  const operation = stage.operation ?? 'shell'
  if (!['shell', 'environment-document'].includes(operation) || (operation === 'environment-document' && stage.kind !== 'command')) {
    throw new Error('执行内容类型无效')
  }
  const timeoutSeconds = stage.timeoutSeconds ?? 300
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 10 || timeoutSeconds > 1800) throw new Error('执行超时必须介于 10 秒和 30 分钟之间')
  if (!Array.isArray(stage.steps) || !stage.steps.length || stage.steps.length > run.targets.length) {
    throw new Error('部署阶段需要有效的服务器步骤')
  }
  const ids = new Set<string>()
  const steps = stage.steps.map(step => {
    if (!step || typeof step !== 'object') throw new Error('部署步骤无效')
    const targetId = text(step.targetId, '目标服务器', 512)
    run.target(targetId)
    if (ids.has(targetId)) throw new Error('同一阶段不能重复包含同一台服务器，请分成多个阶段')
    ids.add(targetId)
    const label = text(step.label, '步骤名称', 160)
    const command = text(step.command, '执行命令', 65536)
    const verifyCommand = step.verifyCommand === undefined ? undefined : text(step.verifyCommand, '验证命令', 65536)
    if ((stage.kind === 'deploy' || stage.kind === 'rollback') && !verifyCommand) throw new Error('部署和回滚步骤必须提供验证命令')
    return Object.freeze({ targetId, label, command, ...(verifyCommand ? { verifyCommand } : {}) })
  })
  return Object.freeze({ name, kind: stage.kind, strategy: stage.strategy, operation, timeoutSeconds, steps: Object.freeze(steps) })
}

function abortError(): Error {
  const error = new Error('已停止此部署阶段')
  error.name = 'AbortError'
  return error
}

function approval(
  approve: NonNullable<DeploymentExecutionOptions['approve']>,
  stage: FrozenDeploymentStage,
  signal: AbortSignal
): Promise<boolean> {
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise<boolean>((resolve, reject) => {
    const stop = () => reject(abortError())
    signal.addEventListener('abort', stop, { once: true })
    Promise.resolve().then(() => {
      signal.throwIfAborted()
      return approve(stage, signal)
    }).then(resolve, reject).finally(() => signal.removeEventListener('abort', stop))
  })
}

function assertCommandSuccess(result: SSHCommandResult, verifying: boolean): void {
  // A deployment cannot be certified from a legacy response lacking an exit status.
  if (result.success && result.exitCode === 0 && !result.signal) return
  const operation = verifying ? '验证' : '执行'
  throw new Error(result.error || (result.exitCode === undefined || result.exitCode === null
    ? `${operation}未返回退出状态，无法确认成功` : `${operation}失败，退出码为 ${result.exitCode}`))
}

/**
 * Run one explicitly approved deployment phase. Rolling advances only after health
 * verification; parallel settles in-flight work and skips new work after a failure.
 * Each phase needs its own approval, including repair and rollback phases.
 */
export async function executeDeploymentStage(
  run: MultiHostRun,
  stage: DeploymentStage,
  options: DeploymentExecutionOptions
): Promise<DeploymentStageResult> {
  const frozen = snapshotStage(run, stage)
  if (activeStages.has(run)) throw new Error('上一部署阶段尚未结束，请等待其完成后再启动下一阶段')
  activeStages.add(run)
  const steps: DeploymentStepResult[] = frozen.steps.map(step => {
    const target = run.target(step.targetId)
    return { targetId: target.id, targetName: target.name, host: target.host,
      label: step.label, status: 'skipped', verified: false }
  })
  const result: DeploymentStageResult = {
    stage: { name: frozen.name, kind: frozen.kind, strategy: frozen.strategy, operation: frozen.operation, timeoutSeconds: frozen.timeoutSeconds }, status: 'rejected', steps
  }
  const stopped = () => options.signal.aborted || frozen.steps.some(step => run.isStopped(step.targetId))
  const markUnstartedStops = () => {
    for (const step of steps) if (step.status === 'skipped' &&
        (options.signal.aborted || run.isStopped(step.targetId))) {
      step.status = 'stopped'
      step.error = '已停止此服务器的部署步骤'
    }
  }

  try {
    if (stopped()) {
      result.status = 'stopped'
      markUnstartedStops()
      return result
    }
    if (!options.approve) {
      result.error = '缺少用户确认，部署阶段未执行'
      return result
    }
    let accepted: boolean
    try {
      accepted = await approval(options.approve, frozen, options.signal)
    } catch (error) {
      result.status = stopped() ? 'stopped' : 'rejected'
      result.error = stopped() ? '已停止此部署阶段' : `未取得用户确认：${error instanceof Error ? error.message : String(error)}`
      markUnstartedStops()
      return result
    }
    if (stopped()) {
      result.status = 'stopped'
      markUnstartedStops()
      return result
    }
    if (accepted !== true) {
      result.error = '用户未批准此阶段，未执行远程操作。重新执行必须再次获得明确确认。'
      return result
    }

    const configured = options.concurrency ?? 3
    const parallelism = frozen.strategy === 'rolling' ? 1
      : Number.isFinite(configured) ? Math.min(3, Math.max(1, Math.floor(configured))) : 3
    let next = 0
    let halt = false
    const worker = async () => {
      while (next < frozen.steps.length && !halt && !stopped()) {
        const index = next++
        const step = frozen.steps[index]
        const outcome = steps[index]
        let commandSignal: AbortSignal | undefined
        try {
          await run.execute(step.targetId, async hostSignal => {
            commandSignal = AbortSignal.any([hostSignal, options.signal])
            try {
              commandSignal.throwIfAborted()
              const phase: HostRunPhase = frozen.operation === 'environment-document' ? 'updating-document'
                : frozen.kind === 'verify' ? 'verifying' : 'executing'
              const context = { timeoutMs: (frozen.timeoutSeconds ?? 300) * 1000, phase, label: step.label, stageName: frozen.name }
              run.setPhase(step.targetId, phase, step.label, frozen.name)
              options.onPhase?.({ targetId: step.targetId, ...context })
              outcome.commandResult = normalizeSSHCommandResult(
                await options.execute(step.targetId, step.command, commandSignal, context)
              )
              if (!(frozen.operation === 'environment-document' && outcome.commandResult.committed)) commandSignal.throwIfAborted()
              assertCommandSuccess(outcome.commandResult, frozen.kind === 'verify')
              if (step.verifyCommand) {
                const verificationContext = { ...context, phase: 'verifying' as const }
                run.setPhase(step.targetId, 'verifying', step.label, frozen.name)
                options.onPhase?.({ targetId: step.targetId, ...verificationContext })
                outcome.verificationResult = normalizeSSHCommandResult(
                  await options.execute(step.targetId, step.verifyCommand, commandSignal, verificationContext)
                )
                commandSignal.throwIfAborted()
                assertCommandSuccess(outcome.verificationResult, true)
              }
              outcome.verified = frozen.kind === 'verify' || Boolean(step.verifyCommand)
              outcome.status = 'completed'
            } catch (error) {
              // Close the queue before publishing a failed host, so another worker
              // cannot pick a dependent node while this failure is being reported.
              halt = true
              throw error
            }
          }, { committed: () => frozen.operation === 'environment-document' && outcome.status === 'completed' && outcome.commandResult?.committed === true })
        } catch (error) {
          halt = true
          outcome.status = commandSignal?.aborted || options.signal.aborted || run.isStopped(step.targetId)
            ? 'stopped' : 'failed'
          outcome.verified = false
          outcome.error = error instanceof Error ? error.message : String(error)
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(parallelism, frozen.steps.length) }, worker))
    markUnstartedStops()
    result.status = steps.some(step => step.status === 'failed') ? 'failed'
      : steps.every(step => step.status === 'completed') ? 'completed' : 'stopped'
    return result
  } finally {
    activeStages.delete(run)
  }
}
