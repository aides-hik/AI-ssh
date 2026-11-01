<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ConversationSummary } from '@/services/chat-history'

const props = defineProps<{
  conversations: ConversationSummary[]
  activeId: string
  busy: boolean
  loading: boolean
  enabled: boolean
  error: string
}>()
const emit = defineEmits<{ select: [id: string]; delete: [id: string]; close: [] }>()
const { locale } = useI18n()
const zh = computed(() => locale.value.startsWith('zh'))
const copy = computed(() => zh.value ? {
  title: '历史对话', search: '搜索历史对话', searchHint: '搜索对话标题…', close: '关闭历史对话',
  newConversation: '新对话', current: '当前', messages: '条消息', remove: '删除对话',
  confirm: '删除这段对话？', cancel: '取消', confirmDelete: '确认删除',
  busy: '当前请求进行中，请先停止，再切换或删除对话。', loading: '正在读取历史对话…',
  disabledTitle: '历史保存已关闭', disabledHint: '可在设置中开启聊天历史，当前对话仍可继续。',
  emptyTitle: '暂无历史对话', emptyHint: '开始一次对话后，可在这里再次打开。',
  noResults: '没有匹配的对话', searchAgain: '试试其他关键词。',
  unavailable: '暂时无法读取历史对话', unknownDate: '时间未知'
} : {
  title: 'Conversation history', search: 'Search conversations', searchHint: 'Search conversation titles…', close: 'Close conversation history',
  newConversation: 'New conversation', current: 'Current', messages: 'messages', remove: 'Delete conversation',
  confirm: 'Delete this conversation?', cancel: 'Cancel', confirmDelete: 'Confirm delete',
  busy: 'A request is in progress. Stop it before switching or deleting conversations.', loading: 'Loading conversations…',
  disabledTitle: 'History saving is off', disabledHint: 'Enable chat history in settings to save conversations. You can keep using the current chat.',
  emptyTitle: 'No conversations yet', emptyHint: 'Start a conversation to find it here later.',
  noResults: 'No matching conversations', searchAgain: 'Try a different search.',
  unavailable: 'Could not load conversations', unknownDate: 'Unknown date'
})
const panel = ref<HTMLElement | null>(null)
const searchInput = ref<HTMLInputElement | null>(null)
const query = ref('')
const pendingDelete = ref('')
const headingId = `conversation-history-${useId()}`
const filtered = computed(() => filterConversations(props.conversations, query.value))

function conversationTitle(conversation: ConversationSummary): string {
  return conversation.title.trim() || copy.value.newConversation
}
function filterConversations(conversations: ConversationSummary[], term: string): ConversationSummary[] {
  const normalized = term.trim().toLocaleLowerCase()
  return conversations.filter(conversation => !normalized || conversationTitle(conversation).toLocaleLowerCase().includes(normalized))
}
function formatDate(timestamp: number): string {
  const date = new Date(timestamp)
  if (!Number.isFinite(timestamp) || Number.isNaN(date.getTime())) return copy.value.unknownDate
  return new Intl.DateTimeFormat(zh.value ? 'zh-CN' : 'en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  }).format(date)
}
function canChange(id: string): boolean {
  return !props.busy && !props.loading && props.enabled && props.conversations.some(conversation => conversation.id === id)
}
function selectConversation(id: string): void {
  if (!canChange(id)) return
  pendingDelete.value = ''
  emit('select', id)
}
function requestDelete(id: string): void {
  if (!canChange(id)) return
  pendingDelete.value = id
  void nextTick(() => {
    if (pendingDelete.value === id && canChange(id)) panel.value?.querySelector<HTMLButtonElement>('[data-delete-cancel]')?.focus({ preventScroll: true })
  })
}
function cancelDelete(): void {
  pendingDelete.value = ''
  void focusSearch()
}
function confirmDelete(id: string): void {
  if (!canChange(id) || pendingDelete.value !== id) return
  pendingDelete.value = ''
  emit('delete', id)
  void focusSearch()
}
function onKeydown(event: KeyboardEvent): void {
  if (event.isComposing || event.keyCode === 229 || event.key !== 'Escape') return
  event.preventDefault()
  event.stopPropagation()
  emit('close')
}
async function focusSearch(): Promise<void> {
  await nextTick()
  searchInput.value?.focus({ preventScroll: true })
}
watch(query, () => { pendingDelete.value = '' })
watch(() => [props.busy, props.loading, props.enabled, props.conversations] as const, () => {
  if (pendingDelete.value && !canChange(pendingDelete.value)) pendingDelete.value = ''
})
onMounted(focusSearch)
</script>

<template>
  <section ref="panel" class="oc-conversation-history" role="dialog" :aria-labelledby="headingId" :aria-busy="loading" @keydown="onKeydown">
    <header class="oc-history-heading">
      <div><i class="bi bi-clock-history" aria-hidden="true"></i><h3 :id="headingId">{{ copy.title }}</h3></div>
      <button class="oc-history-close" type="button" :aria-label="copy.close" :data-prism-tooltip="copy.close" @click="emit('close')"><i class="bi bi-x-lg" aria-hidden="true"></i></button>
    </header>
    <label class="oc-history-search"><i class="bi bi-search" aria-hidden="true"></i><input ref="searchInput" v-model="query" type="search" maxlength="200" :placeholder="copy.searchHint" :aria-label="copy.search" /></label>
    <p v-if="busy" class="oc-history-notice" role="status"><i class="bi bi-pause-circle" aria-hidden="true"></i>{{ copy.busy }}</p>
    <p v-if="error" class="oc-history-error" role="alert">{{ error }}</p>
    <div v-if="loading" class="oc-history-empty" role="status"><i class="bi bi-clock" aria-hidden="true"></i><p>{{ copy.loading }}</p></div>
    <div v-else-if="!enabled" class="oc-history-empty"><i class="bi bi-chat-left" aria-hidden="true"></i><strong>{{ copy.disabledTitle }}</strong><p>{{ copy.disabledHint }}</p></div>
    <div v-else-if="error && !conversations.length" class="oc-history-empty"><i class="bi bi-exclamation-circle" aria-hidden="true"></i><strong>{{ copy.unavailable }}</strong></div>
    <div v-else-if="!conversations.length" class="oc-history-empty"><i class="bi bi-chat-left-dots" aria-hidden="true"></i><strong>{{ copy.emptyTitle }}</strong><p>{{ copy.emptyHint }}</p></div>
    <div v-else-if="!filtered.length" class="oc-history-empty" role="status"><i class="bi bi-search" aria-hidden="true"></i><strong>{{ copy.noResults }}</strong><p>{{ copy.searchAgain }}</p></div>
    <ul v-else class="oc-history-list">
      <li v-for="conversation in filtered" :key="conversation.id" class="oc-history-row" :class="{ 'is-active': conversation.id === activeId, 'is-confirming': pendingDelete === conversation.id }">
        <div class="oc-history-row-main">
          <button type="button" class="oc-history-select" :disabled="busy || loading" :aria-current="conversation.id === activeId ? 'true' : undefined" @click="selectConversation(conversation.id)">
            <span class="oc-history-title">{{ conversationTitle(conversation) }}</span>
            <span class="oc-history-meta"><time>{{ formatDate(conversation.updatedAt) }}</time><span aria-hidden="true">·</span><span>{{ conversation.messageCount }} {{ copy.messages }}</span></span>
          </button>
          <span v-if="conversation.id === activeId" class="oc-history-current">{{ copy.current }}</span>
          <button type="button" class="oc-history-delete" :disabled="busy || loading" :aria-label="`${copy.remove}: ${conversationTitle(conversation)}`" :data-prism-tooltip="copy.remove" @click="requestDelete(conversation.id)"><i class="bi bi-trash3" aria-hidden="true"></i></button>
        </div>
        <div v-if="pendingDelete === conversation.id" class="oc-history-confirm" role="group" :aria-label="`${copy.confirm} ${conversationTitle(conversation)}`">
          <span>{{ copy.confirm }}</span><button type="button" data-delete-cancel @click="cancelDelete">{{ copy.cancel }}</button><button type="button" class="oc-history-confirm-delete" :disabled="busy || loading" @click="confirmDelete(conversation.id)">{{ copy.confirmDelete }}</button>
        </div>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.oc-conversation-history { box-sizing:border-box; display:flex; flex-direction:column; width:100%; max-height:100%; min-height:0; overflow:hidden; padding:12px; border:1px solid var(--vscode-border); border-radius:var(--prism-radius-panel,18px); background:var(--prism-surface-raised); color:var(--vscode-fg); box-shadow:var(--prism-shadow-raised,0 16px 48px #0003); font:var(--prism-font-12)/1.5 var(--prism-font,sans-serif); }
.oc-history-heading { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:10px; flex-shrink:0; }
.oc-history-heading>div { display:flex; align-items:center; gap:7px; min-width:0; }
.oc-history-heading>div>i { color:var(--vscode-accent); font-size:var(--prism-font-14); }
.oc-history-heading h3 { margin:0; font-size:var(--prism-font-13); font-weight:600; }
.oc-history-close,.oc-history-delete { display:grid; place-items:center; flex-shrink:0; width:28px; height:28px; padding:0; border:0; border-radius:var(--prism-radius-control,10px); background:transparent; color:var(--vscode-fg-muted); cursor:pointer; }
.oc-history-close:hover,.oc-history-delete:hover:not(:disabled) { background:var(--vscode-list-hoverBackground); color:var(--vscode-fg); }
.oc-history-search { display:flex; align-items:center; flex-shrink:0; gap:8px; min-height:34px; padding:0 9px; border:1px solid var(--vscode-border); border-radius:var(--prism-radius-control,10px); color:var(--vscode-fg-muted); }
.oc-history-search:focus-within { border-color:var(--vscode-accent); }
.oc-history-search input { width:100%; min-width:0; border:0; padding:6px 0; background:transparent; color:var(--vscode-fg); font:inherit; outline:0; box-shadow:none; }
.oc-history-search input::placeholder { color:var(--vscode-fg-muted); }
.oc-history-notice,.oc-history-error { flex-shrink:0; margin:9px 2px 0; font-size:var(--prism-font-11); color:var(--vscode-fg-muted); overflow-wrap:anywhere; }
.oc-history-notice { display:flex; align-items:flex-start; gap:6px; }
.oc-history-error { color:var(--vscode-error); }
.oc-history-list { display:grid; gap:3px; min-height:0; overflow:auto; margin:9px -4px -3px; padding:0 4px 3px; list-style:none; overscroll-behavior:contain; }
.oc-history-row { min-width:0; border-radius:var(--prism-radius-row,12px); }
.oc-history-row:hover { background:var(--vscode-list-hoverBackground); }
.oc-history-row.is-active { background:color-mix(in srgb,var(--vscode-accent) 9%,transparent); }
.oc-history-row-main { display:flex; align-items:center; gap:5px; min-width:0; padding-right:5px; }
.oc-history-select { display:grid; flex:1; gap:3px; min-width:0; padding:10px 8px; border:0; border-radius:var(--prism-radius-row,12px); text-align:left; background:transparent; color:inherit; font:inherit; cursor:pointer; }
.oc-history-title { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:var(--prism-font-12); font-weight:500; }
.oc-history-meta { display:flex; flex-wrap:wrap; align-items:center; gap:5px; color:var(--vscode-fg-muted); font-size:var(--prism-font-10); }
.oc-history-current { flex-shrink:0; color:var(--vscode-accent); font-size:var(--prism-font-10); }
.oc-history-delete:hover:not(:disabled) { color:var(--vscode-error); }
.oc-history-select:disabled,.oc-history-delete:disabled,.oc-history-confirm button:disabled { cursor:default; opacity:.55; }
.oc-history-confirm { display:flex; flex-wrap:wrap; align-items:center; gap:6px; margin:0 8px; padding:0 0 9px; color:var(--vscode-fg-muted); font-size:var(--prism-font-11); }
.oc-history-confirm>span { flex:1; min-width:110px; }
.oc-history-confirm button { min-height:28px; padding:3px 7px; border:1px solid var(--vscode-border); border-radius:7px; background:transparent; color:var(--vscode-fg); font:inherit; cursor:pointer; }
.oc-history-confirm .oc-history-confirm-delete { border-color:transparent; background:color-mix(in srgb,var(--vscode-error) 10%,transparent); color:var(--vscode-error); }
.oc-history-confirm button:hover:not(:disabled) { background:var(--vscode-list-hoverBackground); }
.oc-history-confirm .oc-history-confirm-delete:hover:not(:disabled) { background:color-mix(in srgb,var(--vscode-error) 16%,transparent); }
.oc-history-empty { display:grid; justify-items:center; gap:7px; padding:28px 10px; text-align:center; color:var(--vscode-fg-muted); overflow:auto; }
.oc-history-empty>i { font-size:var(--prism-font-20); opacity:.7; }
.oc-history-empty strong { font-size:var(--prism-font-12); font-weight:500; color:var(--vscode-fg); }
.oc-history-empty p { max-width:280px; margin:0; font-size:var(--prism-font-11); }
.oc-conversation-history button:focus-visible { outline:2px solid var(--vscode-accent); outline-offset:-2px; }
</style>
