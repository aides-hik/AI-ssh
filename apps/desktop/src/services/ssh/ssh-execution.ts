export interface SSHExecutionOptions {
  timeoutMs?: number
}

export interface SSHExecuteOutputEvent {
  requestId: string
  connectionId: string
  stream: 'stdout' | 'stderr'
  data: string
  truncated?: boolean
}

export const DEFAULT_SSH_EXECUTION_TIMEOUT = 300000
export const MIN_SSH_EXECUTION_TIMEOUT = 10000
export const MAX_SSH_EXECUTION_TIMEOUT = 1800000

/** Used on both sides of IPC; reject malformed settings before starting work. */
export function sshExecutionTimeout(options: unknown): number {
  if (options === undefined) return DEFAULT_SSH_EXECUTION_TIMEOUT
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('命令超时设置无效')
  const timeoutMs = (options as SSHExecutionOptions).timeoutMs
  if (timeoutMs === undefined) return DEFAULT_SSH_EXECUTION_TIMEOUT
  if (typeof timeoutMs !== 'number' || !Number.isInteger(timeoutMs) ||
      timeoutMs < MIN_SSH_EXECUTION_TIMEOUT || timeoutMs > MAX_SSH_EXECUTION_TIMEOUT) {
    throw new Error('命令超时必须为 10 秒到 30 分钟之间的整数毫秒数')
  }
  return timeoutMs
}
