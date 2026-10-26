<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{ output: string; zh?: boolean }>(), { zh: true })
type StageStatus = 'completed' | 'failed' | 'rejected' | 'stopped' | 'unknown'
type StepStatus = 'completed' | 'failed' | 'skipped' | 'stopped' | 'unknown'
interface CommandResult {
  output: string
  stdout?: string
  stderr?: string
  success?: boolean
  exitCode?: number | null
  durationMs?: number
  truncated: boolean
  error?: string
}
interface StepResult {
  targetId: string
  targetName: string
  host: string
  label: string
  status: StepStatus
  verified: boolean
  commandResult?: CommandResult
  verificationResult?: CommandResult
  error?: string
}
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined
const text = (value: unknown) => typeof value === 'string' ? value : ''
function command(value: unknown): CommandResult | undefined {
  const raw = record(value)
  if (!raw) return
  return {
    output: text(raw.output),
    stdout: typeof raw.stdout === 'string' ? raw.stdout : undefined,
    stderr: typeof raw.stderr === 'string' ? raw.stderr : undefined,
    success: typeof raw.success === 'boolean' ? raw.success : undefined,
    exitCode: raw.exitCode === null ? null : typeof raw.exitCode === 'number' && Number.isInteger(raw.exitCode) ? raw.exitCode : undefined,
    durationMs: typeof raw.durationMs === 'number' && Number.isFinite(raw.durationMs) && raw.durationMs >= 0 ? raw.durationMs : undefined,
    truncated: raw.truncated === true,
    error: text(raw.error) || undefined
  }
}
const result = computed(() => {
  try {
    const raw = record(JSON.parse(props.output))
    const stage = record(raw?.stage)
    if (!raw || !stage || !Array.isArray(raw.steps) || raw.steps.length > 100) return
    const passed = (value: CommandResult | undefined) => value?.success === true && value.exitCode === 0
    const steps: StepResult[] = raw.steps.map((value: unknown) => {
      const step = record(value) || {}
      const commandResult = command(step.commandResult)
      const verificationResult = command(step.verificationResult)
      const candidate = text(step.status)
      let status: StepStatus = candidate === 'completed' || candidate === 'failed' || candidate === 'skipped' || candidate === 'stopped' ? candidate : 'unknown'
      const failed = (value: CommandResult | undefined) => value?.success === false || (typeof value?.exitCode === 'number' && value.exitCode !== 0)
      const verified = stage.kind !== 'command' && step.verified === true && passed(commandResult) && (stage.kind === 'verify' || passed(verificationResult))
      if (status === 'completed' && (failed(commandResult) || failed(verificationResult))) status = 'failed'
      else if (status === 'completed' && !(stage.kind === 'command' ? passed(commandResult) && (!verificationResult || passed(verificationResult)) : verified)) status = 'unknown'
      return {
        targetId: text(step.targetId), targetName: text(step.targetName), host: text(step.host),
        label: text(step.label), status,
        verified,
        commandResult, verificationResult, error: text(step.error) || undefined
      }
    })
    const candidate = text(raw.status)
    let status: StageStatus = candidate === 'completed' || candidate === 'failed' || candidate === 'rejected' || candidate === 'stopped' ? candidate : 'unknown'
    if (status === 'rejected') {
      for (const step of steps) {
        if (step.status === 'completed') step.status = 'unknown'
        step.verified = false
      }
    }
    // An incomplete or contradictory history must never appear as a successful stage.
    if (status === 'completed' && (!steps.length || steps.some(step => step.status !== 'completed'))) status = 'unknown'
    return { name: text(stage.name), status, steps, error: text(raw.error) }
  } catch {
    return undefined
  }
})
const stageLabels = computed<Record<StageStatus, string>>(() => props.zh
  ? { completed: '本阶段已完成', failed: '本阶段失败', rejected: '已取消 · 未开始执行', stopped: '本阶段已停止', unknown: '结果待确认' }
  : { completed: 'Stage completed', failed: 'Stage failed', rejected: 'Declined · not started', stopped: 'Stage stopped', unknown: 'Unconfirmed result' })
const stepLabels = computed<Record<StepStatus, string>>(() => props.zh
  ? { completed: '已完成', failed: '失败', skipped: '未执行', stopped: '已停止', unknown: '未确认' }
  : { completed: 'Completed', failed: 'Failed', skipped: 'Not run', stopped: 'Stopped', unknown: 'Unconfirmed' })
const icon = (status: string) => status === 'completed' ? 'bi-check2-circle' : status === 'failed' ? 'bi-exclamation-circle' : status === 'unknown' ? 'bi-question-circle' : 'bi-pause-circle'
const commands = (step: StepResult) => [
  ...(step.commandResult ? [{ label: props.zh ? '执行结果' : 'Command result', value: step.commandResult }] : []),
  ...(step.verificationResult ? [{ label: props.zh ? '检查结果' : 'Verification result', value: step.verificationResult }] : [])
]
const duration = (milliseconds: number) => milliseconds < 1000 ? `${Math.round(milliseconds)} ms` : `${(milliseconds / 1000).toFixed(1)} s`
</script>

<template>
  <section v-if="result" class="oc-deployment-result" :data-stage-status="result.status" :aria-label="zh ? '执行阶段结果' : 'Execution stage result'">
    <header class="oc-deployment-result-heading" :class="result.status">
      <i class="bi" :class="icon(result.status)" aria-hidden="true"></i>
      <div><strong>{{ result.name || (zh ? '执行阶段' : 'Execution stage') }}</strong><span>{{ stageLabels[result.status] }}</span></div>
    </header>
    <p v-if="result.error" class="oc-deployment-result-error">{{ result.error }}</p>
    <ul class="oc-deployment-result-hosts" :aria-label="zh ? '服务器执行结果' : 'Results by server'">
      <li v-for="(step, index) in result.steps" :key="`${step.targetId}-${index}`" :data-host-id="step.targetId" :data-step-status="step.status">
        <div class="oc-deployment-result-host">
          <i class="bi" :class="[icon(step.status), step.status]" aria-hidden="true"></i>
          <div class="oc-deployment-result-host-name"><strong>{{ step.targetName || step.targetId || (zh ? '未知服务器' : 'Unknown host') }}</strong><span v-if="step.host">{{ step.host }}</span></div>
          <span class="oc-deployment-result-state" :class="step.status">{{ stepLabels[step.status] }}</span>
        </div>
        <p v-if="step.label" class="oc-deployment-result-label">{{ step.label }}</p>
        <p v-if="step.error" class="oc-deployment-result-error">{{ step.error }}</p>
        <span v-if="step.verified" class="oc-deployment-result-verified"><i class="bi bi-check2" aria-hidden="true"></i>{{ zh ? '检查通过' : 'Verification passed' }}</span>
        <details v-for="(item, commandIndex) in commands(step)" :key="commandIndex" class="oc-deployment-result-command" :open="item.value.success === false">
          <summary>{{ item.label }}<span class="oc-deployment-result-metrics"><span v-if="item.value.exitCode !== undefined">{{ zh ? '退出码' : 'Exit' }} {{ item.value.exitCode ?? (zh ? '未返回' : 'unknown') }}</span><span v-if="item.value.durationMs !== undefined">{{ duration(item.value.durationMs) }}</span></span></summary>
          <p v-if="item.value.error" class="oc-deployment-result-error">{{ item.value.error }}</p>
          <pre v-if="item.value.stdout || (!item.value.stdout && item.value.output)"><code>{{ item.value.stdout || item.value.output }}</code></pre>
          <div v-if="item.value.stderr" class="oc-deployment-result-stderr"><span>stderr</span><pre><code>{{ item.value.stderr }}</code></pre></div>
          <p v-if="!item.value.output && !item.value.stdout && !item.value.stderr" class="oc-deployment-result-no-output">{{ zh ? '无命令输出' : 'No command output' }}</p>
          <p v-if="item.value.truncated" class="oc-deployment-result-truncated">{{ zh ? '输出较长，已截断。' : 'Long output was truncated.' }}</p>
        </details>
      </li>
    </ul>
    <details v-if="result.status === 'unknown'" class="oc-deployment-result-raw"><summary>{{ zh ? '查看原始结果' : 'View raw result' }}</summary><pre><code>{{ output }}</code></pre></details>
  </section>
  <div v-else class="oc-deployment-result oc-deployment-result-fallback">
    <span>{{ zh ? '阶段结果格式无法识别，保留原始输出。' : 'Unrecognized stage result. Raw output is preserved.' }}</span>
    <pre><code>{{ output || (zh ? '未返回结果' : 'No result returned') }}</code></pre>
  </div>
</template>

<style scoped>
.oc-deployment-result { min-width: 0; padding: 10px 12px; color: var(--vscode-fg); font: var(--prism-font-11)/1.6 var(--prism-font, sans-serif); }
.oc-deployment-result-heading { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 0 0 10px; }
.oc-deployment-result-heading > i { flex: none; font-size: var(--prism-font-16); }
.oc-deployment-result-heading > div { display: grid; min-width: 0; }
.oc-deployment-result-heading strong { color: var(--vscode-fg); font-weight: 600; overflow-wrap: anywhere; }
.oc-deployment-result-heading span { font-size: var(--prism-font-10); }
.oc-deployment-result .completed { color: var(--vscode-success, #258b72); }
.oc-deployment-result .failed,.oc-deployment-result-error { color: var(--vscode-error, #d45b5b); }
.oc-deployment-result .skipped,.oc-deployment-result .stopped,.oc-deployment-result .rejected,.oc-deployment-result .unknown { color: var(--vscode-fg-muted); }
.oc-deployment-result-hosts { display: grid; gap: 9px; margin: 0; padding: 0; list-style: none; }
.oc-deployment-result-hosts > li { min-width: 0; padding: 9px; border: 1px solid var(--vscode-border); border-radius: 9px; background: color-mix(in srgb, var(--vscode-bg) 35%, transparent); }
.oc-deployment-result-host { display: flex; align-items: center; gap: 7px; min-width: 0; }
.oc-deployment-result-host > i { flex: none; font-size: var(--prism-font-13); }
.oc-deployment-result-host-name { display: grid; flex: 1; min-width: 0; }
.oc-deployment-result-host-name strong { color: var(--vscode-fg); font-size: var(--prism-font-11); font-weight: 500; overflow-wrap: anywhere; }
.oc-deployment-result-host-name > span { color: var(--vscode-fg-muted); font-size: var(--prism-font-10); overflow-wrap: anywhere; }
.oc-deployment-result-state { flex: none; font-size: var(--prism-font-10); white-space: nowrap; }
.oc-deployment-result-label,.oc-deployment-result-error { margin: 6px 0 0; font-size: var(--prism-font-10); overflow-wrap: anywhere; }
.oc-deployment-result-verified { display: inline-flex; align-items: center; gap: 4px; margin-top: 5px; color: var(--vscode-success, #258b72); font-size: var(--prism-font-10); }
.oc-deployment-result-command { min-width: 0; margin-top: 7px; font-size: var(--prism-font-10); }
.oc-deployment-result-command summary,.oc-deployment-result-raw summary { width: fit-content; max-width: 100%; color: var(--vscode-fg-muted); cursor: pointer; border-radius: 3px; }
.oc-deployment-result-metrics { display: inline-flex; gap: 6px; margin-left: 7px; font-size: var(--prism-font-9); color: var(--vscode-fg-muted); }
.oc-deployment-result pre { max-height: 220px; margin: 6px 0 0; padding: 8px; overflow: auto; border: 1px solid var(--vscode-border-subtle); border-radius: 7px; background: var(--vscode-bg); color: var(--vscode-fg); font: var(--prism-font-10)/1.65 'Cascadia Code', Consolas, monospace; white-space: pre; tab-size: 2; user-select: text; }
.oc-deployment-result code { padding: 0; border: 0; background: transparent; color: inherit; font: inherit; white-space: inherit; }
.oc-deployment-result-stderr { margin-top: 7px; color: var(--vscode-fg-muted); }
.oc-deployment-result-no-output,.oc-deployment-result-truncated { margin: 6px 0 0; color: var(--vscode-fg-muted); font-size: var(--prism-font-10); }
.oc-deployment-result-raw { margin-top: 10px; }
.oc-deployment-result-fallback > span { color: var(--vscode-fg-muted); }
.oc-deployment-result summary:focus-visible { outline: 2px solid var(--vscode-accent); outline-offset: 2px; }
</style>
