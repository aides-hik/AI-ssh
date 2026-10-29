export interface SSHCommandResult {
  success: boolean
  output: string
  error?: string
  stdout?: string
  stderr?: string
  exitCode?: number | null
  durationMs?: number
  truncated?: boolean
  signal?: string
  committed?: boolean
}

/** Accept legacy IPC responses while keeping exit status separate from diagnostics. */
export function normalizeSSHCommandResult(value: unknown): SSHCommandResult {
  if (typeof value === 'string') return { success: true, output: value }
  if (!value || typeof value !== 'object') {
    return { success: false, output: '', error: '命令执行没有返回结果' }
  }
  const result = value as Record<string, unknown>
  const text = (input: unknown) => input === undefined || input === null ? '' : String(input)
  const output = text(result.output ?? result.stdout ?? result.data)
  const stdout = result.stdout === undefined ? undefined : text(result.stdout)
  const stderr = result.stderr === undefined ? undefined : text(result.stderr)
  const hasExitCode = Object.hasOwn(result, 'exitCode')
  const exitCode = typeof result.exitCode === 'number' && Number.isInteger(result.exitCode)
    ? result.exitCode : null
  const explicitError = text(result.error || result.message)
  const signal = typeof result.signal === 'string' && result.signal ? result.signal : undefined
  const success = hasExitCode
    ? exitCode === 0 && result.success !== false && !signal
    : result.success !== false && !explicitError && !signal
  const error = success ? undefined : explicitError || (
    signal ? `命令被信号 ${signal} 终止`
      : exitCode !== null ? `命令退出码为 ${exitCode}${stderr ? `：${stderr.trim()}` : ''}`
        : hasExitCode ? '命令已结束，但未收到退出状态' : stderr || '命令执行失败'
  )
  return {
    success,
    output,
    ...(success && result.committed === true ? { committed: true } : {}),
    ...(error ? { error } : {}),
    ...(stdout !== undefined ? { stdout } : {}),
    ...(stderr !== undefined ? { stderr } : {}),
    ...(hasExitCode ? { exitCode } : {}),
    ...(typeof result.durationMs === 'number' && Number.isFinite(result.durationMs)
      ? { durationMs: Math.max(0, result.durationMs) } : {}),
    ...(typeof result.truncated === 'boolean' ? { truncated: result.truncated } : {}),
    ...(signal ? { signal } : {})
  }
}
