<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { HostTarget } from '@/services/multi-host-run'

const props = defineProps<{ modelValue: string[]; connections: HostTarget[]; currentId?: string; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>()
const { locale } = useI18n()
const zh = computed(() => locale.value.startsWith('zh'))
const open = ref(false)
const query = ref('')
const trigger = ref<HTMLButtonElement>()
const panel = ref<HTMLElement>()
const style = ref<Record<string, string>>({})
const panelId = `host-targets-${useId()}`
const filtered = computed(() => props.connections.filter(host => `${host.name} ${host.host}`.toLowerCase().includes(query.value.toLowerCase())))
const selectedNames = computed(() => props.connections.filter(host => props.modelValue.includes(host.id)).map(host => host.name).join('、'))

function position() {
  if (!trigger.value || !panel.value) return
  const bounds = trigger.value.getBoundingClientRect()
  if (!bounds.width || bounds.bottom < 0 || bounds.top > innerHeight) { close(); return }
  const width = Math.min(340, innerWidth - 24)
  const above = bounds.top - 20
  const below = innerHeight - bounds.bottom - 20
  const upwards = above >= below
  const maxHeight = Math.max(80, upwards ? above : below)
  const height = Math.min(panel.value.scrollHeight, maxHeight)
  style.value = { width: `${width}px`, left: `${Math.max(12, Math.min(bounds.left, innerWidth - width - 12))}px`,
    top: `${upwards ? bounds.top - height - 8 : bounds.bottom + 8}px`, maxHeight: `${maxHeight}px`,
    transformOrigin: upwards ? 'left bottom' : 'left top' }
}
async function toggle() {
  if (props.disabled) return
  if (open.value) { close(); return }
  query.value = ''
  open.value = true
  await nextTick()
  position()
  panel.value?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true })
}
function close(restore = false) { open.value = false; if (restore) trigger.value?.focus({ preventScroll: true }) }
function change(id: string) {
  if (props.disabled) return
  emit('update:modelValue', props.modelValue.includes(id) ? props.modelValue.filter(value => value !== id) : [...props.modelValue, id])
}
function pointer(event: PointerEvent) {
  if (!panel.value?.contains(event.target as Node) && !trigger.value?.contains(event.target as Node)) close()
}
function key(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); close(true) }
  if (event.key === 'Tab' && panel.value) {
    const controls = [...panel.value.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')]
    const next = event.shiftKey ? controls.at(-1) : controls[0]
    if ((event.shiftKey && document.activeElement === controls[0]) || (!event.shiftKey && document.activeElement === controls.at(-1))) {
      event.preventDefault(); next?.focus()
    }
  }
}
watch(open, value => {
  if (value) {
    document.addEventListener('pointerdown', pointer, true)
    document.addEventListener('keydown', key, true)
    window.addEventListener('resize', position)
    window.addEventListener('scroll', position, true)
  } else {
    document.removeEventListener('pointerdown', pointer, true)
    document.removeEventListener('keydown', key, true)
    window.removeEventListener('resize', position)
    window.removeEventListener('scroll', position, true)
  }
})
watch(() => props.disabled, value => { if (value) close() })
watch([filtered, () => props.modelValue], () => { if (open.value) void nextTick(position) })
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', pointer, true)
  document.removeEventListener('keydown', key, true)
  window.removeEventListener('resize', position)
  window.removeEventListener('scroll', position, true)
})
</script>

<template>
  <button ref="trigger" class="oc-target-trigger" type="button" :disabled="disabled" :aria-expanded="open" :aria-controls="panelId" aria-haspopup="dialog"
    :aria-label="`${zh ? '选择操作目标' : 'Choose target servers'} (${modelValue.length})`" :title="selectedNames || (zh ? '选择操作目标' : 'Choose target servers')" @click="toggle">
    <i class="bi bi-hdd-network" aria-hidden="true"></i><span>{{ modelValue.length }} {{ zh ? '台' : 'hosts' }}</span><i class="bi bi-chevron-down" aria-hidden="true"></i>
  </button>
  <Teleport to="body">
    <Transition name="host-picker">
      <section v-if="open" :id="panelId" ref="panel" class="oc-target-popover" :style="style" role="dialog" aria-modal="true" :aria-label="zh ? '选择操作目标' : 'Choose target servers'">
        <header><div><strong>{{ zh ? '操作目标' : 'Target servers' }}</strong><span>{{ zh ? '已连接的服务器' : 'Connected servers' }}</span></div><button type="button" class="oc-target-close" :aria-label="zh ? '完成选择' : 'Done'" @click="close(true)"><i class="bi bi-check2"></i></button></header>
        <label class="oc-target-search"><i class="bi bi-search" aria-hidden="true"></i><input v-model="query" type="search" :placeholder="zh ? '查找服务器' : 'Find a server'" :aria-label="zh ? '查找服务器' : 'Find a server'" /></label>
        <div class="oc-target-shortcuts"><button type="button" @click="emit('update:modelValue', connections.map(host => host.id))">{{ zh ? '选择全部' : 'Select all' }}</button><button v-if="currentId && connections.some(host => host.id === currentId)" type="button" @click="emit('update:modelValue', [currentId])">{{ zh ? '仅当前主机' : 'Current host only' }}</button></div>
        <div class="oc-target-options">
          <label v-for="host in filtered" :key="host.id" class="oc-target-option" :class="{ selected: modelValue.includes(host.id) }">
            <input type="checkbox" :checked="modelValue.includes(host.id)" @change="change(host.id)" />
            <span class="oc-target-server" aria-hidden="true"><i class="bi bi-hdd-stack"></i></span>
            <span class="oc-target-description"><strong>{{ host.name }}</strong><small>{{ host.host }}</small></span><span v-if="host.id === currentId" class="oc-target-current">{{ zh ? '当前' : 'Current' }}</span>
          </label>
          <p v-if="!filtered.length" class="oc-target-empty">{{ zh ? '没有可选的连接，请先连接服务器。' : 'No matching connections. Connect a server first.' }}</p>
        </div>
        <footer><i class="bi bi-shield-check" aria-hidden="true"></i>{{ zh ? '单台、多台使用相同规则。读取直接执行；命令、部署和文档修改需确认。' : 'The same rules apply to one or more hosts. Reads run directly; commands, deployments and document changes need approval.' }}</footer>
      </section>
    </Transition>
  </Teleport>
</template>

<style scoped>
.oc-target-popover { --background-base:var(--prism-surface-raised); --text-base:var(--vscode-fg); --text-weak:var(--vscode-fg-muted); --text-interactive-base:var(--vscode-accent); --font-family-sans:var(--prism-font); }
.oc-target-trigger { display:flex; align-items:center; gap:5px; padding:4px 6px; min-height:28px; border:0; border-radius:9px; background:transparent; color:var(--text-weak); font:var(--prism-font-11)/1.4 var(--font-family-sans); white-space:nowrap; cursor:pointer; }
.oc-target-trigger>i:first-child { color:var(--text-interactive-base); font-size:var(--prism-font-13); }
.oc-target-trigger>i:last-child { font-size:var(--prism-font-8); }
.oc-target-trigger:hover,.oc-target-trigger[aria-expanded=true] { background:color-mix(in srgb,var(--vscode-accent) 9%,transparent); color:var(--text-base); }
.oc-target-trigger:disabled { opacity:.6; cursor:default; }
.oc-target-popover { position:fixed; z-index:10030; display:flex; flex-direction:column; overflow:auto; padding:14px; border:1px solid color-mix(in srgb,var(--text-base) 13%,transparent); border-radius:18px; background:color-mix(in srgb,var(--background-base) 96%,transparent); color:var(--text-base); box-shadow:0 16px 48px #0002,inset 0 1px 0 #ffffff60; backdrop-filter:blur(22px); font:var(--prism-font-12)/1.5 var(--font-family-sans); }
.oc-target-popover header { display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:12px; }
.oc-target-popover header div { display:grid; gap:2px; }
.oc-target-popover header strong { font-size:var(--prism-font-13); font-weight:600; }
.oc-target-popover header span { color:var(--text-weak); font-size:var(--prism-font-11); }
.oc-target-close { display:grid; place-items:center; width:28px; height:28px; border:0; border-radius:9px; background:color-mix(in srgb,var(--vscode-accent) 10%,transparent); color:var(--text-interactive-base); cursor:pointer; }
.oc-target-search { display:flex; align-items:center; gap:8px; min-height:34px; padding:0 10px; border:1px solid color-mix(in srgb,var(--text-base) 12%,transparent); border-radius:10px; color:var(--text-weak); }
.oc-target-search input { min-width:0; width:100%; padding:6px 0; border:0; background:transparent; color:var(--text-base); outline:0; font:inherit; box-shadow:none; }
.oc-target-search:focus-within { border-color:var(--vscode-accent); }
.oc-target-shortcuts { display:flex; justify-content:space-between; padding:10px 2px 6px; }
.oc-target-shortcuts button { padding:2px 0; border:0; background:transparent; color:var(--text-interactive-base); font:var(--prism-font-11)/1.5 var(--font-family-sans); cursor:pointer; }
.oc-target-options { display:grid; gap:3px; max-height:260px; overflow:auto; min-height:0; }
.oc-target-option { display:flex; align-items:center; gap:9px; min-height:56px; padding:8px; border-radius:11px; cursor:pointer; }
.oc-target-option:hover { background:color-mix(in srgb,var(--text-base) 4%,transparent); }
.oc-target-option.selected { background:color-mix(in srgb,var(--vscode-accent) 8%,transparent); }
.oc-target-option input { width:14px; height:14px; flex:none; margin:0; accent-color:var(--vscode-accent); }
.oc-target-server { color:var(--text-weak); font-size:var(--prism-font-18); }
.oc-target-description { display:grid; flex:1; min-width:0; gap:1px; }
.oc-target-description strong { font-size:var(--prism-font-12); font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.oc-target-description small { font-size:var(--prism-font-10); color:var(--text-weak); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.oc-target-current { color:var(--text-weak); font-size:var(--prism-font-10); }
.oc-target-empty { padding:14px 4px; color:var(--text-weak); }
.oc-target-popover footer { display:flex; gap:6px; padding-top:12px; margin-top:8px; border-top:1px solid color-mix(in srgb,var(--text-base) 9%,transparent); color:var(--text-weak); font-size:var(--prism-font-10); line-height:1.6; }
.oc-target-popover button:focus-visible,.oc-target-option input:focus-visible,.oc-target-trigger:focus-visible { outline:2px solid var(--vscode-accent); outline-offset:2px; }
.host-picker-enter-active,.host-picker-leave-active { transition:opacity 150ms ease,transform 180ms cubic-bezier(.2,.8,.2,1); }
.host-picker-enter-from,.host-picker-leave-to { opacity:0; transform:translateY(4px) scale(.97); }
@media(prefers-reduced-motion:reduce) { .host-picker-enter-active,.host-picker-leave-active { transition:none; } }
</style>
