<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { HostRunPhase, HostRunState, HostRunStatus } from '@/services/multi-host-run'
defineProps<{ hosts: HostRunState[]; active: boolean }>()
const emit = defineEmits<{ stop: [id: string] }>()
const { locale } = useI18n()
const zh = computed(() => locale.value.startsWith('zh'))
const labels = computed<Record<HostRunStatus, string>>(() => zh.value ? {
  waiting: '等待执行', running: '执行中', complete: '已完成', error: '执行失败', stopped: '已停止', unavailable: '连接已断开', skipped: '未执行'
} : { waiting: 'Waiting', running: 'Running', complete: 'Completed', error: 'Failed', stopped: 'Stopped', unavailable: 'Disconnected', skipped: 'Not run' })
const phases = computed<Record<HostRunPhase, string>>(() => zh.value ? {
  inspecting: '巡检中', executing: '执行中', verifying: '验证中', 'updating-document': '更新文档'
} : { inspecting: 'Inspecting', executing: 'Running', verifying: 'Verifying', 'updating-document': 'Updating document' })
</script>
<template>
  <ul class="oc-host-progress" :aria-label="zh ? '各服务器执行进度' : 'Progress by server'">
    <li v-for="host in hosts" :key="host.id" :data-host-id="host.id" :data-status="host.status">
      <span class="oc-host-state-icon" :class="host.status" aria-hidden="true"><span v-if="host.status === 'running'" class="oc-status-dot"></span><i v-else :class="['bi', host.status === 'complete' ? 'bi-check2' : host.status === 'error' || host.status === 'unavailable' ? 'bi-exclamation-circle' : host.status === 'stopped' ? 'bi-pause-fill' : 'bi-hdd-stack']"></i></span>
      <span class="oc-host-progress-name"><strong :title="host.name">{{ host.name }}</strong><small :title="[host.host, host.error || (host.status === 'running' ? host.label : '')].filter(Boolean).join(' · ')">{{ host.error || (host.status === 'running' && host.label ? `${host.host} · ${host.label}` : host.host) }}</small></span>
      <span class="oc-host-state-label" :class="host.status">{{ host.status === 'running' && host.phase ? phases[host.phase] : labels[host.status] }}</span>
      <button v-if="active && !['stopped','unavailable','skipped'].includes(host.status)" type="button" :aria-label="`${zh ? '停止' : 'Stop'} ${host.name}`" :title="zh ? '停止此服务器的后续执行' : 'Stop further execution on this server'" @click="emit('stop', host.id)"><i class="bi bi-stop-fill" aria-hidden="true"></i></button>
    </li>
  </ul>
</template>
<style scoped>
.oc-host-progress { display:grid; gap:2px; list-style:none; padding:0 0 10px; margin:0 0 12px; border-bottom:1px solid color-mix(in srgb,var(--text-base) 9%,transparent); }
.oc-host-progress li { display:flex; align-items:center; gap:8px; min-width:0; min-height:42px; padding:4px 0; }
.oc-host-state-icon { display:grid; place-items:center; width:25px; height:25px; flex:none; color:var(--text-weak); }
.oc-host-state-icon.complete { color:var(--vscode-success,#258b72); }
.oc-host-state-icon.error,.oc-host-state-icon.unavailable,.oc-host-state-label.error,.oc-host-state-label.unavailable { color:var(--vscode-error,#d45b5b); }
.oc-host-progress-name { display:grid; gap:1px; flex:1; min-width:0; }
.oc-host-progress-name strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:var(--prism-font-11); font-weight:500; color:var(--text-base); }
.oc-host-progress-name small { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:var(--prism-font-10); color:var(--text-weak); }
.oc-host-state-label { color:var(--text-weak); font-size:var(--prism-font-10); white-space:nowrap; }
.oc-host-progress button { display:grid; place-items:center; flex:none; width:24px; height:24px; border:0; border-radius:8px; background:transparent; color:var(--text-weak); cursor:pointer; }
.oc-host-progress button:hover { background:color-mix(in srgb,var(--text-base) 7%,transparent); color:var(--text-base); }
.oc-host-progress button:focus-visible { outline:2px solid var(--vscode-accent); outline-offset:1px; }
</style>
