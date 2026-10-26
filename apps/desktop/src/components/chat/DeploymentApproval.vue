<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import type { FrozenDeploymentStage } from '../../services/multi-host-deployment'
import type { HostTarget } from '../../services/multi-host-run'
import LiquidSurface from '../common/LiquidSurface.vue'

const props = withDefaults(defineProps<{
  stage: FrozenDeploymentStage
  targets: readonly HostTarget[]
  zh?: boolean
}>(), { zh: true })
const emit = defineEmits<{ approve: []; reject: [] }>()
const titleId = `deployment-approval-${useId()}`
const descriptionId = `${titleId}-description`
const cancelButton = ref<HTMLButtonElement>()
const overlay = ref<HTMLElement>()
let previousFocus: HTMLElement | undefined
const settled = ref(false)
const isDocument = computed(() => props.stage.operation === 'environment-document')
const kindLabel = computed(() => props.zh
  ? { deploy: '部署', verify: '验证', rollback: '回滚', command: isDocument.value ? '更新环境文档' : '执行命令' }[props.stage.kind]
  : { deploy: 'Deploy', verify: 'Verify', rollback: 'Roll back', command: isDocument.value ? 'Update environment document' : 'Run command' }[props.stage.kind])
const strategyLabel = computed(() => props.stage.strategy === 'rolling'
  ? props.stage.kind === 'command'
    ? props.zh ? '逐台执行 · 成功后继续' : 'One host at a time · continue after success'
    : props.zh ? '逐台执行 · 检查通过后继续' : 'One host at a time · verify before continuing'
  : props.zh ? '并行执行 · 最多同时 3 台' : 'In parallel · up to 3 hosts')
const timeoutLabel = computed(() => {
  const seconds = props.stage.timeoutSeconds ?? 300
  return seconds % 60 === 0
    ? `${seconds / 60} ${props.zh ? '分钟' : 'min'}`
    : `${seconds} ${props.zh ? '秒' : 's'}`
})
const target = (id: string) => props.targets.find(host => host.id === id)

function decide(approved: boolean) {
  if (settled.value) return
  settled.value = true
  if (approved) emit('approve')
  else emit('reject')
}

const focusCancel = () => nextTick(() => cancelButton.value?.focus({ preventScroll: true }))
onMounted(() => {
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
  void focusCancel()
})
onBeforeUnmount(() => {
  const restore = previousFocus
  void nextTick(() => { if (restore?.isConnected) restore.focus({ preventScroll: true }) })
})
function trapFocus(event: KeyboardEvent) {
  if (event.key !== 'Tab') return
  const focusable = [...(overlay.value?.querySelectorAll<HTMLElement>('button:not(:disabled), summary, a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') || [])]
    .filter(element => element.getClientRects().length > 0)
  const first = focusable[0], last = focusable.at(-1)
  if (!first || !last) { event.preventDefault(); return }
  if (event.shiftKey && (document.activeElement === first || !overlay.value?.contains(document.activeElement))) {
    event.preventDefault(); last.focus()
  } else if (!event.shiftKey && (document.activeElement === last || !overlay.value?.contains(document.activeElement))) {
    event.preventDefault(); first.focus()
  }
}
watch(() => props.stage, () => {
  settled.value = false
  void focusCancel()
})
</script>

<template>
  <Teleport to="body">
  <div ref="overlay" class="oc-deployment-approval-overlay" @keydown="trapFocus">
  <LiquidSurface
    as="section"
    class="oc-deployment-approval"
    :radius="18"
    :strength="38"
    :blur="0.4"
    :interactive="false"
    :motion="false"
    role="dialog"
    aria-modal="true"
    :aria-labelledby="titleId"
    :aria-describedby="descriptionId"
    @keydown.esc.stop.prevent="decide(false)"
  >
    <div class="oc-deployment-approval-content">
      <header class="oc-deployment-approval-header">
        <span class="oc-deployment-approval-icon" aria-hidden="true"><i class="bi bi-hdd-stack"></i></span>
        <div class="oc-deployment-approval-heading">
          <span class="oc-deployment-approval-eyebrow">{{ kindLabel }} · {{ zh ? '等待确认' : 'Awaiting approval' }}</span>
          <h3 :id="titleId">{{ stage.name }}</h3>
        </div>
      </header>
      <p :id="descriptionId" class="oc-deployment-approval-description">
        {{ isDocument ? (zh ? '请检查目标服务器和文档修改内容，确认后保存。' : 'Review the target servers and document changes before saving.') : (zh ? '请检查本阶段的目标和命令，确认后开始执行。' : 'Review this stage’s hosts and commands before running it.') }}
        <span v-if="!isDocument">{{ zh ? '脚本使用 set -e，命令失败时停止当前脚本。' : 'Scripts use set -e and stop on a command failure.' }}</span>
      </p>
      <div class="oc-deployment-approval-strategy"><i class="bi bi-diagram-3" aria-hidden="true"></i>{{ strategyLabel }}</div>
      <p v-if="!isDocument" class="oc-deployment-approval-timeout"><i class="bi bi-clock" aria-hidden="true"></i>{{ zh ? '每条命令超时' : 'Timeout per command' }} {{ timeoutLabel }}{{ zh ? '（包括验证）' : ' (including verification)' }}</p>
      <ol class="oc-deployment-approval-steps" :aria-label="zh ? '本阶段执行计划' : 'Stage execution plan'">
        <li v-for="(step, index) in stage.steps" :key="`${step.targetId}-${index}`" class="oc-deployment-approval-step">
          <div class="oc-deployment-approval-host">
            <span class="oc-deployment-approval-order" aria-hidden="true">{{ index + 1 }}</span>
            <div class="oc-deployment-approval-host-name">
              <strong>{{ target(step.targetId)?.name || step.targetId }}</strong>
              <span>{{ target(step.targetId)?.host || step.targetId }}</span>
            </div>
          </div>
          <p class="oc-deployment-approval-step-label">{{ step.label }}</p>
          <details class="oc-deployment-approval-command" open>
            <summary>{{ isDocument ? (zh ? '文档修改内容' : 'Document changes') : (zh ? '执行命令' : 'Command') }}</summary>
            <pre><code>{{ step.command }}</code></pre>
          </details>
          <details v-if="step.verifyCommand" class="oc-deployment-approval-command">
            <summary>{{ zh ? '完成后的检查命令' : 'Verification command' }}</summary>
            <pre><code>{{ step.verifyCommand }}</code></pre>
          </details>
        </li>
      </ol>
      <footer class="oc-deployment-approval-actions">
        <span class="oc-deployment-approval-scope">{{ zh ? '仅确认本阶段' : 'This stage only' }}</span>
        <button ref="cancelButton" type="button" class="oc-deployment-approval-cancel" :disabled="settled" @click="decide(false)">{{ zh ? '取消' : 'Cancel' }}</button>
        <button type="button" class="oc-deployment-approval-confirm" :disabled="settled" @click="decide(true)">{{ zh ? '确认本阶段' : 'Approve stage' }}<i class="bi bi-arrow-right-short" aria-hidden="true"></i></button>
      </footer>
    </div>
  </LiquidSurface>
  </div>
  </Teleport>
</template>

<style scoped>
.oc-deployment-approval-overlay { position: fixed; inset: 0; z-index: 11000; display: flex; align-items: center; justify-content: center; padding: 24px 16px; background: color-mix(in srgb, var(--vscode-bg) 50%, #07132638); backdrop-filter: blur(4px); }
.oc-deployment-approval {
  --liquid-tint: color-mix(in srgb, var(--prism-surface-raised, var(--vscode-bg)) 60%, transparent);
  flex: none;
  min-width: 0;
  width: min(620px, calc(100vw - 32px));
  margin: 0;
  border: 1px solid color-mix(in srgb, var(--vscode-accent) 20%, transparent);
  color: var(--vscode-fg);
  font: var(--prism-font-12)/1.6 var(--prism-font, sans-serif);
}
.oc-deployment-approval-content {
  display: flex;
  flex-direction: column;
  min-width: 0;
  max-height: calc(100dvh - 50px);
  padding: 20px;
}
.oc-deployment-approval-header { display: flex; flex: none; align-items: center; gap: 9px; min-width: 0; }
.oc-deployment-approval-icon { display: grid; place-items: center; flex: none; width: 30px; height: 30px; border-radius: 10px; background: color-mix(in srgb, var(--vscode-accent) 10%, transparent); color: var(--vscode-accent); font-size: var(--prism-font-15); }
.oc-deployment-approval-heading { min-width: 0; }
.oc-deployment-approval-eyebrow { display: block; color: var(--vscode-fg-muted); font-size: var(--prism-font-10); }
.oc-deployment-approval-heading h3 { margin: 0; font: 600 var(--prism-font-13)/1.5 var(--prism-font, sans-serif); overflow-wrap: anywhere; }
.oc-deployment-approval-description { flex: none; margin: 10px 0 7px; color: var(--vscode-fg-muted); font-size: var(--prism-font-11); }
.oc-deployment-approval-description > span { display: block; margin-top: 3px; font-size: var(--prism-font-10); }
.oc-deployment-approval-strategy { display: flex; flex: none; align-items: center; gap: 6px; margin-bottom: 9px; color: var(--vscode-fg-muted); font-size: var(--prism-font-10); }
.oc-deployment-approval-timeout { display: flex; flex: none; align-items: center; gap: 6px; margin: 0 0 9px; color: var(--vscode-fg-muted); font-size: var(--prism-font-10); }
.oc-deployment-approval-steps { display: grid; gap: 8px; min-height: 0; margin: 0; padding: 0 3px 0 0; overflow: auto; list-style: none; scrollbar-width: thin; }
.oc-deployment-approval-step { min-width: 0; padding: 10px; border: 1px solid var(--vscode-border); border-radius: 11px; background: color-mix(in srgb, var(--prism-surface-raised, var(--vscode-bg)) 68%, transparent); }
.oc-deployment-approval-host { display: flex; align-items: center; gap: 7px; min-width: 0; }
.oc-deployment-approval-order { display: grid; place-items: center; flex: none; width: 20px; height: 20px; border-radius: 6px; background: color-mix(in srgb, var(--vscode-accent) 9%, transparent); color: var(--vscode-accent); font-size: var(--prism-font-10); }
.oc-deployment-approval-host-name { display: grid; min-width: 0; }
.oc-deployment-approval-host-name strong { font-size: var(--prism-font-11); font-weight: 600; overflow-wrap: anywhere; }
.oc-deployment-approval-host-name > span { color: var(--vscode-fg-muted); font-size: var(--prism-font-10); overflow-wrap: anywhere; }
.oc-deployment-approval-step-label { margin: 7px 0 6px; font-size: var(--prism-font-11); overflow-wrap: anywhere; }
.oc-deployment-approval-command { min-width: 0; font-size: var(--prism-font-10); }
.oc-deployment-approval-command + .oc-deployment-approval-command { margin-top: 7px; }
.oc-deployment-approval-command summary { width: fit-content; max-width: 100%; border-radius: 3px; color: var(--vscode-fg-muted); cursor: pointer; }
.oc-deployment-approval-command pre { max-height: 160px; margin: 5px 0 0; padding: 8px; overflow: auto; border: 1px solid var(--vscode-border-subtle); border-radius: 7px; background: color-mix(in srgb, var(--vscode-bg) 85%, transparent); color: var(--vscode-fg); font: var(--prism-font-10)/1.65 'Cascadia Code', Consolas, monospace; white-space: pre; tab-size: 2; user-select: text; }
.oc-deployment-approval-command code { padding: 0; border: 0; background: transparent; color: inherit; font: inherit; white-space: inherit; }
.oc-deployment-approval-actions { display: flex; flex: none; align-items: center; flex-wrap: wrap; gap: 7px; padding-top: 12px; }
.oc-deployment-approval-scope { flex: 1; min-width: 80px; color: var(--vscode-fg-muted); font-size: var(--prism-font-10); }
.oc-deployment-approval-actions button { display: inline-flex; align-items: center; justify-content: center; gap: 3px; min-height: 32px; padding: 6px 10px; border: 1px solid var(--vscode-border); border-radius: 9px; font: 500 var(--prism-font-11)/1.5 var(--prism-font, sans-serif); cursor: pointer; }
.oc-deployment-approval-cancel { background: transparent; color: var(--vscode-fg); }
.oc-deployment-approval-confirm { border-color: transparent !important; background: var(--vscode-accent); color: var(--vscode-button-foreground, white); }
.oc-deployment-approval-actions button:disabled { cursor: default; opacity: 0.55; }
.oc-deployment-approval-cancel:hover:not(:disabled) { background: var(--vscode-list-hoverBackground); }
.oc-deployment-approval-confirm:hover:not(:disabled) { background: var(--vscode-accent-hover, var(--vscode-accent)); }
.oc-deployment-approval-actions button:focus-visible,.oc-deployment-approval-command summary:focus-visible { outline: 2px solid var(--vscode-accent); outline-offset: 2px; }
@media (max-height: 680px) {
  .oc-deployment-approval-content { padding: 11px; }
}
</style>
