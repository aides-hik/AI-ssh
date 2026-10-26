<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { HostExecutionLog } from '@/services/execution-log'
import type { HostRunState } from '@/services/multi-host-run'

const props = withDefaults(defineProps<{
  logs: HostExecutionLog[]
  hosts: HostRunState[]
  active: boolean
  zh?: boolean
}>(), { zh: true })
const selectedId = ref('')
const viewport = ref<HTMLElement>()
const follow = ref(true)
const copied = ref(false)
const available = computed(() => props.hosts.filter(host => props.logs.some(log => log.targetId === host.id && log.entries.length)))
const current = computed(() => props.logs.find(log => log.targetId === selectedId.value))
const host = computed(() => props.hosts.find(item => item.id === selectedId.value))
watch(available, hosts => {
  if (!hosts.some(item => item.id === selectedId.value)) selectedId.value = hosts[0]?.id || ''
}, { immediate: true })
watch(() => [current.value, selectedId.value], async () => {
  copied.value = false
  await nextTick()
  if (follow.value && viewport.value) viewport.value.scrollTop = viewport.value.scrollHeight
})
function select(id: string) { selectedId.value = id; follow.value = true }
function scroll() {
  const node = viewport.value
  if (node) follow.value = node.scrollHeight - node.scrollTop - node.clientHeight < 28
}
async function latest() {
  follow.value = true
  await nextTick()
  if (viewport.value) viewport.value.scrollTop = viewport.value.scrollHeight
}
async function copy() {
  try {
    await navigator.clipboard.writeText(current.value?.entries.map(entry => entry.text).join('') || '')
    copied.value = true
  } catch { copied.value = false }
}
</script>

<template>
  <section v-if="available.length" class="oc-execution-log" :aria-label="zh ? '执行日志' : 'Execution log'">
    <header class="oc-execution-log-header">
      <span><i class="bi bi-terminal" aria-hidden="true"></i>{{ zh ? '执行日志' : 'Execution log' }}</span>
      <span v-if="active" class="oc-execution-log-live">{{ zh ? '实时' : 'Live' }}</span>
      <button type="button" :aria-label="zh ? '复制当前服务器日志' : 'Copy host log'" @click="copy">{{ copied ? (zh ? '已复制' : 'Copied') : (zh ? '复制' : 'Copy') }}</button>
    </header>
    <div v-if="available.length > 1" class="oc-execution-log-tabs" role="group" :aria-label="zh ? '选择日志服务器' : 'Choose log host'">
      <button v-for="item in available" :key="item.id" type="button" :aria-pressed="selectedId === item.id" :data-host-id="item.id" @click="select(item.id)">{{ item.name }}</button>
    </div>
    <p class="oc-execution-log-host"><span>{{ host?.name }}</span><span>{{ host?.host }}</span></p>
    <div ref="viewport" class="oc-execution-log-viewport" tabindex="0" :aria-label="zh ? '服务器输出，可滚动查看' : 'Server output, scroll to read'" @scroll="scroll">
      <pre><template v-for="(entry, index) in current?.entries" :key="index"><span :class="`is-${entry.stream}`">{{ entry.text }}</span></template></pre>
    </div>
    <footer v-if="current?.truncated || !follow" class="oc-execution-log-footer">
      <span v-if="current?.truncated">{{ zh ? '输出较长，仅保留部分日志。' : 'Long output; only part of the log is retained.' }}</span>
      <button v-if="!follow" type="button" @click="latest"><i class="bi bi-arrow-down" aria-hidden="true"></i>{{ zh ? '跟随最新' : 'Follow latest' }}</button>
    </footer>
  </section>
</template>

<style scoped>
.oc-execution-log { min-width: 0; margin: 10px 0 14px; overflow: hidden; border: 1px solid var(--vscode-border); border-radius: 11px; background: color-mix(in srgb, var(--vscode-bg) 70%, transparent); color: var(--vscode-fg); font: var(--prism-font-11)/1.5 var(--prism-font, sans-serif); }
.oc-execution-log-header { display: flex; align-items: center; gap: 7px; padding: 9px 10px; }
.oc-execution-log-header > span:first-child { display: flex; align-items: center; gap: 6px; font-weight: 550; }
.oc-execution-log-live { color: var(--vscode-success, #258b72); font-size: var(--prism-font-10); }
.oc-execution-log-header button { margin-left: auto; }
.oc-execution-log button { flex: none; min-height: 26px; padding: 3px 7px; border: 0; border-radius: 6px; background: transparent; color: var(--vscode-fg-muted); font: inherit; cursor: pointer; }
.oc-execution-log button:hover { background: var(--vscode-list-hoverBackground); color: var(--vscode-fg); }
.oc-execution-log button:focus-visible,.oc-execution-log-viewport:focus-visible { outline: 2px solid var(--vscode-accent); outline-offset: -2px; }
.oc-execution-log-tabs { display: flex; gap: 3px; padding: 0 8px 7px; overflow-x: auto; scrollbar-width: thin; }
.oc-execution-log-tabs button { max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--prism-font-10); }
.oc-execution-log-tabs button[aria-pressed='true'] { background: color-mix(in srgb, var(--vscode-accent) 12%, transparent); color: var(--vscode-accent); }
.oc-execution-log-host { display: flex; gap: 8px; justify-content: space-between; margin: 0; padding: 0 10px 7px; color: var(--vscode-fg-muted); font-size: var(--prism-font-9); }
.oc-execution-log-host span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oc-execution-log-viewport { max-height: 200px; min-height: 70px; overflow: auto; padding: 10px; border-top: 1px solid var(--vscode-border-subtle, var(--vscode-border)); scrollbar-width: thin; }
.oc-execution-log pre { margin: 0; padding: 0; border: 0; border-radius: 0; background: transparent; color: inherit; font: var(--prism-font-10)/1.7 'Cascadia Code', Consolas, monospace; white-space: pre; user-select: text; }
.oc-execution-log .is-stderr { color: var(--vscode-error, #d45b5b); }
.oc-execution-log .is-phase { color: var(--vscode-accent); }
.oc-execution-log-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 9px; color: var(--vscode-fg-muted); font-size: var(--prism-font-9); }
</style>
