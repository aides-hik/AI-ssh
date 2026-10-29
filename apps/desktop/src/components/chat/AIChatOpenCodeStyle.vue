<script setup lang="ts">
import { ref, shallowRef, computed, nextTick, watch, onMounted, onUnmounted, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { createMarkdownRenderCache } from '@/utils/markdown-render-cache'
import { renderChatMarkdown } from '@/utils/chat-markdown'

import { settingsService } from '@/services/settings.service'
import { ChatHistoryStore, type HistorySettings } from '@/services/chat-history'
import { sshService, type SSHConnection } from '@/services/ssh.service'
import { docStorageService } from '@/services/doc-storage.service'
import { Message as V2Message, createAssistantMessage, type ToolPart, type TextPart } from '@/services/messages/message'
import {
  fromUserMessage,
  filterValidMessages,
  filterCompactedMessages,
  compactMessages,
  updateToolResult
} from '@/services/messages/convert'
import { SessionProcessor } from '@/services/processor'
import { ProcessorHistory } from '@/services/messages/processor-history'
import type { AIProvider, AIModel } from '@/types/ai-providers'
import ReasoningSlider from './ReasoningSlider.vue'
import ComposerModelList from './ComposerModelList.vue'
import LiquidSurface from '@/components/common/LiquidSurface.vue'
import HostTargetPicker from './HostTargetPicker.vue'
import MultiHostProgress from './MultiHostProgress.vue'
import DeploymentApproval from './DeploymentApproval.vue'
import DeploymentStageResult from './DeploymentStageResult.vue'
import ExecutionLogPanel from './ExecutionLogPanel.vue'
import { ExecutionLogBuffer, type HostExecutionLog } from '@/services/execution-log'
import type { FrozenDeploymentStage } from '@/services/multi-host-deployment'
import { useConnectedSessions } from '@/composables/useConnectedSessions'
import { MultiHostRun, buildMultiHostPrompt, type HostTarget, type HostRunState } from '@/services/multi-host-run'
import { createMultiHostTools } from '@/services/tools/multi-host-tools'
import {
  getReasoningCapability,
  normalizeReasoningSelection,
  readReasoningPreferences,
  reasoningPreferenceKey,
  type ReasoningSelection
} from '@/utils/model-reasoning'

const props = defineProps<{
  currentProvider: AIProvider | null
  currentModel: AIModel | null
  connectionId?: string
  sessionId?: string
  historyId?: string
  serverEnvDocId?: string
  showServerEnvButton?: boolean
}>()

const emit = defineEmits<{
  openServerEnvDoc: []
}>()

const { locale } = useI18n()
const router = useRouter()
const ui = computed(() => locale.value.startsWith('zh') ? {
  configure: '配置模型',
  emptyTitle: '从一个问题开始', emptyText: '排查报错、解释命令，或一起梳理下一步。',
  placeholder: '描述问题，或粘贴终端输出…', draftPlaceholder: '继续补充，当前回复结束后可发送…',
  promptHint: '选择一个起点，编辑后发送', user: '你', assistant: 'Prism',
  older: '加载更早的消息', latest: '回到最新', thinking: '处理中', done: '已完成',
  failed: '未完成', stopped: '已停止', send: '发送消息', stop: '停止生成', stopping: '正在停止',
  copy: '复制', copied: '已复制', copyReply: '复制回复', copyCode: '复制代码', code: '代码',
  showProcess: '查看过程', hideProcess: '收起过程', analysis: '分析过程',
  details: '展开或收起过程', model: '选择模型',
  sendHint: '发送', newlineHint: '换行', environment: '环境文档',
  connectionHint: '连接主机后，AI 可以协助处理当前终端的问题。',
  modelHint: '先配置模型服务，再开始对话。'
} : {
  configure: 'Configure model',
  emptyTitle: 'Start with a question', emptyText: 'Troubleshoot an error, explain a command, or plan your next step.',
  placeholder: 'Ask a question or paste terminal output…', draftPlaceholder: 'Draft your next message while the response finishes…',
  promptHint: 'Choose a starting point, then edit and send', user: 'You', assistant: 'Prism',
  older: 'Load earlier messages', latest: 'Back to latest', thinking: 'Working', done: 'Complete',
  failed: 'Incomplete', stopped: 'Stopped', send: 'Send message', stop: 'Stop generating', stopping: 'Stopping',
  copy: 'Copy', copied: 'Copied', copyReply: 'Copy reply', copyCode: 'Copy code', code: 'Code',
  showProcess: 'Show process', hideProcess: 'Hide process', analysis: 'Analysis',
  details: 'Toggle process details', model: 'Choose model',
  sendHint: 'send', newlineHint: 'new line', environment: 'Environment',
  connectionHint: 'Connect a host so AI can help with this terminal.',
  modelHint: 'Configure a model service to start chatting.'
})
const quickPrompts = computed(() => locale.value.startsWith('zh') ? [
  { icon: 'bi-activity', title: '检查主机状态', prompt: effectiveHostIds.value.length > 1 ? '请并行检查所有选中服务器的 CPU、内存、磁盘和运行中的服务，按服务器汇总只读检查结果并比较异常。' : '请检查当前主机的 CPU、内存、磁盘和运行中的服务，先给出只读检查结果。' },
  { icon: 'bi-terminal', title: '分析终端报错', prompt: '请帮我分析这段终端输出，说明原因并给出排查步骤：\n' },
  { icon: 'bi-list-check', title: '梳理部署步骤', prompt: '请帮我梳理部署步骤，先确认环境和依赖，不要直接修改服务器。我的项目是：\n' }
] : [
  { icon: 'bi-activity', title: 'Check host health', prompt: 'Check CPU, memory, disk, and running services on this host. Start with read-only observations.' },
  { icon: 'bi-terminal', title: 'Explain an error', prompt: 'Help me understand this terminal output and suggest troubleshooting steps:\n' },
  { icon: 'bi-list-check', title: 'Plan a deployment', prompt: 'Help me plan a deployment. Check the environment and dependencies first, without changing the server. My project is:\n' }
])
const hasModel = computed(() => Boolean(props.currentProvider && props.currentModel))
const { connections: connectedHosts } = useConnectedSessions()
const selectedHostIds = ref<string[] | null>(null)
const effectiveHostIds = computed(() => selectedHostIds.value ?? (props.connectionId ? [props.connectionId] : []))
const multiHostStates = ref<HostRunState[]>([])
let multiHostRun: MultiHostRun | null = null
const deploymentStatus = ref<'completed' | 'failed' | 'rejected' | 'stopped' | null>(null)
const deploymentIssue = ref<'failed' | 'rejected' | 'stopped' | null>(null)
const executionLogBuffer = new ExecutionLogBuffer()
const executionLogs = shallowRef<HostExecutionLog[]>([])
let executionLogTimer: ReturnType<typeof setTimeout> | undefined
function flushExecutionLogs() {
  clearTimeout(executionLogTimer)
  executionLogTimer = undefined
  executionLogs.value = executionLogBuffer.snapshot()
}
function queueExecutionLog(targetId: string, stream: 'stdout' | 'stderr' | 'phase', data: string, truncated = false) {
  executionLogBuffer.append(targetId, stream, data, truncated)
  if (!executionLogTimer) executionLogTimer = setTimeout(flushExecutionLogs, 60)
}
const hasExecutionLogs = computed(() => executionLogs.value.some(host => host.entries.length))
const executionStageTools = new Set(['execute_deployment_stage', 'execute_ssh_command', 'update_server_env_doc'])
const pendingDeploymentApproval = shallowRef<{
  stage: FrozenDeploymentStage
  targets: readonly HostTarget[]
  resolve: (approved: boolean) => void
} | null>(null)
const hasHostActivity = computed(() => Boolean(pendingDeploymentApproval.value || deploymentStatus.value || multiHostStates.value.some(host => host.completed || host.failed || !['waiting', 'skipped'].includes(host.status))))
function requestDeploymentApproval(stage: FrozenDeploymentStage, signal: AbortSignal, targets: readonly HostTarget[]): Promise<boolean> {
  if (signal.aborted || pendingDeploymentApproval.value) return Promise.resolve(false)
  return new Promise(resolve => {
    const settle = (approved: boolean) => {
      signal.removeEventListener('abort', cancelled)
      if (pendingDeploymentApproval.value?.resolve === settle) pendingDeploymentApproval.value = null
      resolve(approved && !signal.aborted)
    }
    const cancelled = () => settle(false)
    pendingDeploymentApproval.value = { stage, targets, resolve: settle }
    signal.addEventListener('abort', cancelled, { once: true })
    setStatus('executing', `等待确认：${stage.name}`)
    nextTick(() => scrollToBottom(true))
  })
}
const multiHostSummary = computed(() => {
  const hosts = multiHostStates.value
  if (!hosts.length || !hasHostActivity.value) return ''
  const zh = locale.value.startsWith('zh')
  const complete = hosts.filter(host => host.status === 'complete').length
  const failed = hosts.filter(host => ['error', 'unavailable'].includes(host.status)).length
  const stopped = hosts.filter(host => host.status === 'stopped').length
  const remaining = hosts.filter(host => ['waiting', 'skipped'].includes(host.status)).length
  if (pendingDeploymentApproval.value) return zh ? '请确认本阶段的目标与执行内容' : 'Review this stage’s targets and operations'
  if (deploymentIssue.value === 'rejected') return zh ? '有阶段未获确认 · 已保留各节点结果' : 'A stage was declined · host results retained'
  if (deploymentIssue.value === 'stopped') return zh ? '已停止后续执行 · 远程状态需核对' : 'Further execution stopped · remote state needs checking'
  if (deploymentIssue.value === 'failed') return zh ? '有执行阶段未完成 · 已保留各节点结果' : 'An execution stage failed · host results retained'
  const running = hosts.find(host => host.status === 'running')
  if (isGenerating.value && running) return zh ? `${running.name} · ${running.label || '执行中'}${hosts.filter(host => host.status === 'running').length > 1 ? ' 等任务' : ''}` : `${running.name} · ${running.label || 'Running'}`
  return zh
    ? `${hosts.length} 台服务器 · ${complete} 台已完成${failed ? ` · ${failed} 台失败` : ''}${stopped ? ` · ${stopped} 台停止` : ''}${!isGenerating.value && remaining ? ` · ${remaining} 台未执行` : ''}`
    : `${hosts.length} hosts · ${complete} complete${failed ? ` · ${failed} failed` : ''}${stopped ? ` · ${stopped} stopped` : ''}${!isGenerating.value && remaining ? ` · ${remaining} not executed` : ''}`
})
watch(connectedHosts, hosts => {
  if (!isGenerating.value || !multiHostRun) return
  const ids = new Set(hosts.map(host => host.id))
  for (const target of multiHostRun.targets) if (!ids.has(target.id)) multiHostRun.stopTarget(target.id, true)
})
const modelLabel = computed(() => props.currentModel?.name || props.currentModel?.id || ui.value.model)
const REASONING_PREFERENCES_KEY = 'prism.reasoning-preferences.v1'
const reasoningPreferences = ref<Record<string, ReasoningSelection>>({})
try {
  reasoningPreferences.value = readReasoningPreferences(localStorage.getItem(REASONING_PREFERENCES_KEY))
} catch { /* Storage may be unavailable; session-only preferences still work. */ }
const reasoningCapability = computed(() => getReasoningCapability(props.currentProvider, props.currentModel))
const reasoningSelection = computed<ReasoningSelection>({
  get() {
    const { currentProvider, currentModel } = props
    if (!currentProvider || !currentModel) return 'default'
    return normalizeReasoningSelection(reasoningCapability.value, reasoningPreferences.value[reasoningPreferenceKey(currentProvider, currentModel)] ?? currentModel.requestConfig?.reasoning)
  },
  set(value) {
    const { currentProvider, currentModel } = props
    if (isGenerating.value || !currentProvider || !currentModel) return
    reasoningPreferences.value[reasoningPreferenceKey(currentProvider, currentModel)] = normalizeReasoningSelection(reasoningCapability.value, value)
    try {
      localStorage.setItem(REASONING_PREFERENCES_KEY, JSON.stringify(reasoningPreferences.value))
    } catch { /* Keep the current session usable when storage is full or blocked. */ }
  }
})

const inputMessage = ref('')
const isGenerating = ref(false)
const activeAssistantId = ref<string | null>(null)
const isStopping = ref(false)
const messagesContainer = ref<HTMLElement | null>(null)
const messages = ref<V2Message[]>([])
let historySettings: HistorySettings = {}
let loadedHistoryId = ''
let historyLoading: Promise<void> | undefined
async function loadConversationHistory() {
  const connectionId = props.connectionId
  const historyId = props.historyId
  const pending = (historyLoading || Promise.resolve()).catch(() => {}).then(async () => {
    const settings = await settingsService.getSettings()
    historySettings = settings.aiAssistant || {}
    const connection = historyId ? null : (await sshService.getConnections()).find(item => item.id === connectionId)
    if (connectionId !== props.connectionId || historyId !== props.historyId) return
    const config = connection?.config
    const id = historyId || config?.id || (config ? JSON.stringify([config.host, config.port, config.username]) : '')
    const store = new ChatHistoryStore(localStorage)
    store.applySettings(historySettings)
    if (id !== loadedHistoryId) {
      // A runtime reconnect of the same saved connection keeps this conversation.
      messages.value = store.load(id, historySettings)
      processorHistory.clear()
      loadedHistoryId = id
    }
  })
  historyLoading = pending
  return pending.finally(() => { if (historyLoading === pending) historyLoading = undefined })
}
async function saveConversationHistory() {
  const id = loadedHistoryId
  const conversation = messages.value
  try {
    // Read the authoritative setting at save time. A closing tab must not
    // recreate records after another view has just disabled history.
    const settings = await settingsService.getSettings()
    new ChatHistoryStore(localStorage).save(id, conversation, settings.aiAssistant || {})
  }
  catch (cause) { console.warn('[AIChat] 保存本地历史失败:', cause) }
}
const processorHistory = new ProcessorHistory()
const error = ref<any>(null)
const abortController = ref<AbortController | null>(null)
const expandedTools = ref<Set<string>>(new Set())
const expandedTurns = ref<Set<string>>(new Set())
const visibleCount = ref(5)
const isLoadingMore = ref(false)
const copiedId = ref<string | null>(null)
let copyFeedbackTimer: ReturnType<typeof setTimeout> | undefined
const codeCopyFeedback = new Map<HTMLButtonElement, ReturnType<typeof setTimeout>>()
const currentStatus = ref('')
const currentStage = ref<
  'idle' | 'preparing' | 'thinking' | 'executing' | 'complete' | 'error' | 'stopped'
>('idle')
const sessionStatusExpanded = ref(false)
const sessionStatusToggle = ref<HTMLButtonElement | null>(null)
const sessionDetailsId = `session-details-${useId()}`
const sessionErrorMessage = computed(() => error.value
  ? normalizeUserErrorMessage(error.value.message || error.value)
  : currentStage.value === 'error' ? currentStatus.value : '')
const sessionDuration = ref('')
const performanceMetrics = ref<SessionPerformanceMetrics>({
  prepMs: null,
  firstResponseMs: null,
  totalMs: null,
  toolCalls: 0,
  compactionLimit: null,
  contextCompacted: false
})
const cachedConnection = ref<SSHConnection | null>(null)
const cachedServerEnvDoc = ref<string | null>(null)
const cacheLoading = ref(false)
const sessionContextStats = ref<SessionContextStats>({
  connectionSource: 'unknown',
  envDocSource: 'unknown',
  lastRefreshedAt: null
})
const stopRequested = ref(false)
const interruptionState = ref<InterruptionState | null>(null)
const durationInterval = ref<number | null>(null)
const sessionStartTime = ref<number | null>(null)
const inputRef = ref<HTMLTextAreaElement | null>(null)
const followLatest = ref(true)
let scrollFrame = 0
let viewportObserver: ResizeObserver | null = null
const serverEnvMenuOpen = ref(false)
const serverEnvMenuRef = ref<HTMLElement | null>(null)

const INPUT_MIN_HEIGHT = 32
const INPUT_MAX_HEIGHT = 176

interface TodoItem {
  id: string
  content: string
  status: 'pending' | 'completed'
  activeForm?: string
}

interface DiffItem {
  file: string
  before?: string
  after?: string
  changes?: number
}

interface DisplayMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  blocks: DisplayBlock[]
  finish?: string
  timestamp: number
  summary?: string
  modelInfo?: { providerID: string; modelID: string }
  targets?: HostTarget[]
}

type DisplayBlock =
  | {
      id: string
      type: 'analysis'
      text: string
      compact: boolean
    }
  | {
      id: string
      type: 'inquiry' | 'summary'
      text: string
    }
  | {
      id: string
      type: 'tool'
      toolPart: ToolPart
    }
  | {
      id: string
      type: 'todos'
      todos: TodoItem[]
    }
  | {
      id: string
      type: 'diffs'
      diffs: DiffItem[]
    }

interface SessionPerformanceMetrics {
  prepMs: number | null
  firstResponseMs: number | null
  totalMs: number | null
  toolCalls: number
  compactionLimit: number | null
  contextCompacted: boolean
}

interface SessionContextStats {
  connectionSource: 'cache' | 'fresh' | 'missing' | 'unknown'
  envDocSource: 'cache' | 'fresh' | 'missing' | 'unknown'
  lastRefreshedAt: number | null
}

interface InterruptionState {
  reason: string
  completedTools: number
  lastTool: string
  partialResponse: string
  canResume: boolean
}

const displayMessages = computed<DisplayMessage[]>(() => {
  const filtered = messages.value.filter(
    msg => msg.info.role === 'user' || msg.info.role === 'assistant'
  )
  const visible = Math.min(filtered.length, visibleCount.value)
  const sliced = filtered.slice(-visible)
  const mapped = sliced.map(msg => ({
    id: msg.info.id,
    role: msg.info.role as 'user' | 'assistant',
    content: getContent(msg),
    blocks: getOrderedBlocks(msg),
    finish: msg.info.finish,
    timestamp: msg.info.createdAt,
    summary: (msg.info as any).summary,
    modelInfo: (msg.info as any).model,
    targets: msg.info.targets
  }))
  return mapped
})

const earlierMessageCount = computed(() => Math.max(0,
  messages.value.filter(msg => msg.info.role === 'user' || msg.info.role === 'assistant').length - visibleCount.value
))

const sessionSteps = computed(() => {
  const complete = currentStage.value === 'complete'
  const chinese = locale.value.startsWith('zh')
  return [
    {
      key: 'preparing',
      label: chinese ? '准备' : 'Prepare',
      active: currentStage.value === 'preparing',
      done: performanceMetrics.value.prepMs !== null || complete
    },
    {
      key: 'thinking',
      label: chinese ? '分析' : 'Analyze',
      active: currentStage.value === 'thinking',
      done: performanceMetrics.value.toolCalls > 0 || complete
    },
    {
      key: 'executing',
      label: complete && performanceMetrics.value.toolCalls === 0
        ? (chinese ? '无需工具' : 'No tools') : (chinese ? '执行' : 'Tools'),
      active: currentStage.value === 'executing',
      done: currentStage.value === 'complete' && performanceMetrics.value.toolCalls > 0,
      skipped: currentStage.value === 'complete' && performanceMetrics.value.toolCalls === 0
    },
    {
      key: 'complete',
      label: chinese ? '完成' : 'Done',
      active: false,
      done: currentStage.value === 'complete'
    }
  ]
})

function formatSessionElapsed(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
}

const sessionElapsed = computed(() => isGenerating.value
  ? sessionDuration.value
  : performanceMetrics.value.totalMs !== null
    ? formatSessionElapsed(performanceMetrics.value.totalMs)
    : '')

const sessionCopy = computed(() => locale.value.startsWith('zh') ? {
  expand: '展开请求状态', collapse: '收起请求状态', duration: '总耗时',
  process: '执行过程', prepare: '准备上下文', response: '首次响应', tools: '工具调用',
  details: '请求详情', toolChain: '最近工具', times: '次'
} : {
  expand: 'Expand request status', collapse: 'Collapse request status', duration: 'Total time',
  process: 'Request progress', prepare: 'Preparation', response: 'First response', tools: 'Tool calls',
  details: 'Request details', toolChain: 'Recent tools', times: 'calls'
})

const performanceItems = computed(() => {
  const metrics = performanceMetrics.value
  return [
    { label: sessionCopy.value.prepare, value: metrics.prepMs === null ? '—' : formatSessionElapsed(metrics.prepMs) },
    { label: sessionCopy.value.response, value: metrics.firstResponseMs === null ? '—' : formatSessionElapsed(metrics.firstResponseMs) },
    { label: sessionCopy.value.tools, value: `${metrics.toolCalls} ${sessionCopy.value.times}` }
  ]
})

const performanceInsight = computed(() => {
  const metrics = performanceMetrics.value

  if (metrics.totalMs !== null && metrics.totalMs >= 8000) {
    if (metrics.toolCalls >= 3) {
      return '这次请求较慢，主要因为发生了多次工具往返。'
    }
    if ((metrics.prepMs || 0) >= 1500) {
      return '这次请求较慢，准备上下文占用了较多时间。'
    }
    if ((metrics.firstResponseMs || 0) >= 2500) {
      return '这次请求较慢，模型首个响应返回得比较晚。'
    }
    return '这次请求整体偏慢，系统已记录关键耗时供后续优化。'
  }

  if (metrics.toolCalls >= 3) {
    return '本轮请求包含多次工具调用，回答会更完整，但耗时通常也会更长一些。'
  }

  if (metrics.contextCompacted) {
    return '会话较长时已自动压缩历史上下文，以保持响应更稳定。'
  }

  return ''
})

const latestToolParts = computed(() => {
  for (let i = messages.value.length - 1; i >= 0; i -= 1) {
    const msg = messages.value[i]
    if (msg.info.role === 'assistant') {
      const toolParts = getToolParts(msg)
      if (toolParts.length > 0) {
        return toolParts
      }
    }
  }
  return [] as ToolPart[]
})

const debugFacts = computed(() => {
  const facts: Array<{ label: string; value: string }> = []
  const providerName = props.currentProvider?.name || props.currentProvider?.id || '未选择'
  const modelName = props.currentModel?.name || props.currentModel?.id || '未选择'

  facts.push({ label: '模型', value: `${providerName} / ${modelName}` })
  facts.push({
    label: '连接上下文',
    value:
      sessionContextStats.value.connectionSource === 'cache'
        ? '命中缓存'
        : sessionContextStats.value.connectionSource === 'fresh'
          ? '实时读取'
          : sessionContextStats.value.connectionSource === 'missing'
            ? '缺失'
            : '未知'
  })
  facts.push({
    label: '环境文档',
    value:
      sessionContextStats.value.envDocSource === 'cache'
        ? '命中缓存'
        : sessionContextStats.value.envDocSource === 'fresh'
          ? '实时读取'
          : sessionContextStats.value.envDocSource === 'missing'
            ? '缺失'
            : '未知'
  })

  if (performanceMetrics.value.compactionLimit !== null) {
    facts.push({
      label: '上下文策略',
      value: performanceMetrics.value.contextCompacted
        ? `压缩到最近 ${performanceMetrics.value.compactionLimit} 条`
        : `保留最近 ${performanceMetrics.value.compactionLimit} 条`
    })
  }

  if (sessionContextStats.value.lastRefreshedAt) {
    facts.push({
      label: '上下文时间',
      value: formatTime(sessionContextStats.value.lastRefreshedAt)
    })
  }

  return facts
})

const debugToolChain = computed(() => {
  return latestToolParts.value.slice(-6).map(part => ({
    id: part.callID,
    label: part.tool,
    status: part.state.status || 'unknown'
  }))
})

watch(displayMessages, () => scrollToBottom(), { flush: 'post' })

onMounted(() => {
  nextTick(() => {
    resizeInputHeight()
  })

  viewportObserver = new ResizeObserver(() => {
    if (messagesContainer.value?.clientHeight) scrollToBottom()
  })
  if (messagesContainer.value) viewportObserver.observe(messagesContainer.value)

  document.addEventListener('pointerdown', handlePointerDownOutsideMenu)
  void loadConversationHistory().catch(cause => console.warn('[AIChat] 读取本地历史失败:', cause))
  window.addEventListener('settings-updated', reloadHistorySettings)
  void refreshSessionContext()
})

onUnmounted(() => {
  stopDurationTimer()
  clearTimeout(copyFeedbackTimer)
  codeCopyFeedback.forEach(timer => clearTimeout(timer))
  codeCopyFeedback.clear()
  viewportObserver?.disconnect()
  if (scrollFrame) cancelAnimationFrame(scrollFrame)
  abortController.value?.abort()
  clearTimeout(executionLogTimer)
  document.removeEventListener('pointerdown', handlePointerDownOutsideMenu)
  window.removeEventListener('settings-updated', reloadHistorySettings)
  saveConversationHistory()
})

async function reloadHistorySettings() {
  try {
    await loadConversationHistory()
    saveConversationHistory()
  } catch (cause) { console.warn('[AIChat] 更新历史设置失败:', cause) }
}
watch(() => props.historyId, () => {
  abortController.value?.abort()
  saveConversationHistory()
  if (!isGenerating.value) void loadConversationHistory()
})

watch(
  () => [props.connectionId, props.serverEnvDocId],
  () => {
    cachedConnection.value = null
    cachedServerEnvDoc.value = null
    if (!isGenerating.value) void loadConversationHistory()
    void refreshSessionContext(true)
  }
)

watch(inputMessage, () => {
  nextTick(() => {
    resizeInputHeight()
  })
})

function startDurationTimer() {
  stopDurationTimer()
  sessionDuration.value = ''
  sessionStartTime.value = Date.now()
  durationInterval.value = window.setInterval(() => {
    if (sessionStartTime.value) {
      const elapsed = Date.now() - sessionStartTime.value
      const seconds = Math.floor(elapsed / 1000)
      if (seconds < 60) {
        sessionDuration.value = `${seconds}s`
      } else {
        const mins = Math.floor(seconds / 60)
        const secs = seconds % 60
        sessionDuration.value = `${mins}m ${secs}s`
      }
    }
  }, 1000)
}

function stopDurationTimer() {
  if (durationInterval.value) {
    clearInterval(durationInterval.value)
    durationInterval.value = null
  }
}

async function loadEarlierMessages() {
  const container = messagesContainer.value
  if (!container || isLoadingMore.value) return
  const previousHeight = container.scrollHeight
  const previousTop = container.scrollTop
  followLatest.value = false
  isLoadingMore.value = true
  visibleCount.value += 10
  await nextTick()
  container.scrollTop = previousTop + container.scrollHeight - previousHeight
  isLoadingMore.value = false
}

function extractTodos(part: ToolPart): TodoItem[] {
  if (part.tool !== 'todowrite' || part.state.status !== 'completed' || !part.state.output) {
    return []
  }

  try {
    const output = JSON.parse(part.state.output)
    if (!output.todos || !Array.isArray(output.todos)) return []

    return output.todos.map((t: any) => ({
      id: t.id || Math.random().toString(36).substr(2, 9),
      content: t.content,
      status: t.status || 'pending',
      activeForm: t.activeForm
    }))
  } catch {
    return []
  }
}

function extractDiffs(part: ToolPart): DiffItem[] {
  if (part.tool !== 'edit' || part.state.status !== 'completed' || !part.state.metadata?.filediff) {
    return []
  }

  const fd = part.state.metadata.filediff
  return [
    {
      file: fd.file || part.state.input?.path || 'Unknown',
      before: fd.before,
      after: fd.after,
      changes: fd.changes
    }
  ]
}

function appendAssistantTextBlock(msg: V2Message, delta: string) {
  const lastPart = msg.parts[msg.parts.length - 1]
  if (lastPart?.type === 'text' && (lastPart.kind || 'analysis') !== 'summary') {
    lastPart.text += delta
    return
  }

  msg.parts.push({ type: 'text', text: delta, kind: 'analysis' })
}

function markLastAssistantTextBlockAsSummary(msg: V2Message | null) {
  if (!msg) return

  for (let i = msg.parts.length - 1; i >= 0; i -= 1) {
    const part = msg.parts[i]
    if (part.type === 'text' && part.text.trim()) {
      part.kind = 'summary'
      return
    }

    if (part.type === 'tool') {
      return
    }
  }
}

function snapshotRequestTargets(): HostTarget[] {
  if (!effectiveHostIds.value.length) throw new Error('请先选择操作目标')
  return effectiveHostIds.value.map(id => {
    const host = connectedHosts.value.find(host => host.id === id)
    if (!host) throw new Error('所选服务器连接已断开，请重新选择操作目标')
    return { id: host.id, name: host.name, host: host.host }
  })
}

async function sendMessageWithTools(content: string) {
  const requestStartedAt = Date.now()
  let firstResponseRecorded = false
  let performanceLogged = false
  let slowThinkingTimer: number | null = null
  let slowExecutionTimer: number | null = null

  if (!props.currentProvider || !props.currentModel) {
    throw new Error('未选择 AI 提供商或模型')
  }
  if (!props.connectionId) {
    throw new Error('未建立 SSH 连接')
  }

  // Keep every tool round on the model and reasoning level chosen when Send was pressed.
  const requestProvider: AIProvider = { ...props.currentProvider }
  const requestModel: AIModel = {
    ...props.currentModel,
    capabilities: { ...props.currentModel.capabilities },
    reasoning: props.currentModel.reasoning ? {
      ...props.currentModel.reasoning,
      supportedEfforts: props.currentModel.reasoning.supportedEfforts ? [...props.currentModel.reasoning.supportedEfforts] : undefined
    } : props.currentModel.reasoning
  }
  const requestReasoning = reasoningSelection.value
  const requestTargets = snapshotRequestTargets()
  const isMultiHost = requestTargets.length > 1
  const requestConnectionId = requestTargets[0].id
  const requestSessionId = props.sessionId
  const requestEnvDocId = requestConnectionId === props.connectionId ? props.serverEnvDocId : requestConnectionId

  isGenerating.value = true
  error.value = null
  abortController.value = new AbortController()
  const requestSignal = abortController.value.signal
  const requestRun = new MultiHostRun(requestTargets, requestSignal, states => {
    multiHostStates.value = states
    const pending = pendingDeploymentApproval.value
    if (pending && pending.stage.steps.some(step => states.some(host => host.id === step.targetId && (host.status === 'stopped' || host.status === 'unavailable')))) pending.resolve(false)
  })
  multiHostRun = requestRun
  deploymentStatus.value = null
  deploymentIssue.value = null
  clearTimeout(executionLogTimer)
  executionLogTimer = undefined
  executionLogBuffer.reset(requestTargets.map(target => target.id))
  executionLogs.value = []
  let openedExecutionDetails = false
  let requestAutoApproveReadOnly = true
  const requestTools = createMultiHostTools(requestRun, {
    approveDeployment: (stage, signal) => requestDeploymentApproval(stage, signal, requestRun.targets),
    approveReadOnly: (stage, signal) => requestAutoApproveReadOnly ? Promise.resolve(true) : requestDeploymentApproval(stage, signal, requestRun.targets),
    onOutput: event => {
      if (requestSignal.aborted || multiHostRun !== requestRun) return
      queueExecutionLog(event.targetId, event.stream, event.data, event.truncated)
    },
    onPhase: event => {
      if (requestSignal.aborted || multiHostRun !== requestRun) return
      queueExecutionLog(event.targetId, 'phase', `\n── ${event.stageName || event.label} / ${event.label} ──\n`)
      if (!openedExecutionDetails) {
        openedExecutionDetails = true
        sessionStatusExpanded.value = true
      }
    }
  })
  if (isMultiHost) sessionStatusExpanded.value = true
  stopRequested.value = false
  interruptionState.value = null
  startDurationTimer()
  performanceMetrics.value = {
    prepMs: null,
    firstResponseMs: null,
    totalMs: null,
    toolCalls: 0,
    compactionLimit: null,
    contextCompacted: false
  }
  setStatus('preparing', isMultiHost ? `正在准备 ${requestTargets.length} 台服务器的操作` : '正在准备当前主机的上下文')

  try {
    slowThinkingTimer = window.setTimeout(() => {
      if (
        isGenerating.value &&
        currentStage.value === 'preparing' &&
        performanceMetrics.value.firstResponseMs === null
      ) {
        setStatus('preparing', '正在读取上下文和环境文档，这一步稍慢一些')
      }
    }, 1200)

    {
      const settings = await settingsService.getSettings()
      requestAutoApproveReadOnly = settings.aiAssistant?.autoApproveReadOnly !== false
      await loadConversationHistory()
      const providerConfig = (settings?.aiProviders || []).find(
        (p: any) => p.id === requestProvider.id
      )
      if (!providerConfig?.apiKey && requestProvider.id !== 'ollama') {
        throw new Error('未找到 API 密钥配置')
      }
      requestProvider.apiKey = providerConfig?.apiKey || requestProvider.apiKey
    }
    requestSignal.throwIfAborted()

    const userMsg = fromUserMessage(content)
    userMsg.info.targets = requestTargets
    messages.value.push(userMsg)

    await nextTick()
    scrollToBottom(true)

    const serverEnvDocId = requestEnvDocId || requestConnectionId
    const requestContext = !isMultiHost ? await refreshSessionContext(false, requestConnectionId) : null
    requestSignal.throwIfAborted()
    const currentConnection = requestContext?.connection || null
    const serverEnvDoc = requestContext?.doc || null
    setStatus('thinking', '正在分析你的请求')

    const validMessages = filterValidMessages(messages.value)
    // 保留已有摘要，仅过滤已被摘要替代的原始消息。
    const uncompactedMessages = filterCompactedMessages(validMessages)
    const adaptiveCompactionLimit = getAdaptiveCompactionLimit(uncompactedMessages)
    performanceMetrics.value.compactionLimit = adaptiveCompactionLimit
    performanceMetrics.value.contextCompacted = adaptiveCompactionLimit < 20
    if (adaptiveCompactionLimit < 20) {
      setStatus('thinking', '当前会话较长，正在压缩历史执行记录并保留完整用户要求')
    }
    // 如果消息太多，自动压缩旧消息
    const compactedMessages = compactMessages(uncompactedMessages, adaptiveCompactionLimit)
    const modelMessages = [
      {
        role: 'system' as const,
        content: [buildMultiHostPrompt(requestTargets), !isMultiHost ? buildSystemPrompt(currentConnection, serverEnvDoc, serverEnvDocId) : ''].filter(Boolean).join('\n\n')
      },
      ...processorHistory.toModelMessages(
        compactedMessages,
        JSON.stringify([requestProvider.id, requestProvider.endpoint, requestModel.id, requestTargets.map(target => target.id).sort(), requestSessionId]),
        true // Missing or interrupted tool state is summarized instead of replaying incomplete calls.
      )
    ]
    performanceMetrics.value.prepMs = Date.now() - requestStartedAt

    let currentMsg: V2Message | null = null

    const processor = new SessionProcessor(
      {
        messages: modelMessages,
        tools: requestTools,
        toolConcurrency: isMultiHost ? 3 : 1,
        toolExecutionKey: (name, input) => !executionStageTools.has(name) && typeof input?.targetId === 'string' ? input.targetId : undefined,
        provider: requestProvider,
        model: requestModel,
        reasoning: requestReasoning,
        connectionId: requestConnectionId,
        serverEnvDocId,
        abortSignal: requestSignal,
        onEvent: event => {
          switch (event.type) {
            case 'start':
              setStatus('thinking', '正在分析你的请求')
              break

            case 'text-delta': {
              if (!firstResponseRecorded) {
                performanceMetrics.value.firstResponseMs = Date.now() - requestStartedAt
                firstResponseRecorded = true
                if (slowThinkingTimer) {
                  clearTimeout(slowThinkingTimer)
                  slowThinkingTimer = null
                }
                slowExecutionTimer = window.setTimeout(() => {
                  if (
                    isGenerating.value &&
                    currentStage.value === 'thinking' &&
                    performanceMetrics.value.toolCalls === 0
                  ) {
                    setStatus('thinking', '模型正在整理较长的回答，请稍候')
                  }
                }, 2500)
              }
              if (!currentMsg) {
                currentMsg = createAssistantMessage(
                  `msg_${Date.now()}`,
                  userMsg.info.id,
                  requestSessionId,
                  'ssh-agent'
                )
                if (isMultiHost) currentMsg.info.targets = requestTargets
                messages.value.push(currentMsg)
                activeAssistantId.value = currentMsg.info.id
              }
              appendAssistantTextBlock(currentMsg, event.delta)
              const activeMsg = currentMsg
              const msgIdx = messages.value.findIndex(m => m.info.id === activeMsg.info.id)
              if (msgIdx !== -1) {
                messages.value = messages.value
                  .slice(0, msgIdx)
                  .concat([activeMsg], messages.value.slice(msgIdx + 1))
              }
              updateStatus()
              scrollToBottom()
              break
            }

            case 'tool-call': {
              if (!firstResponseRecorded) {
                performanceMetrics.value.firstResponseMs = Date.now() - requestStartedAt
                firstResponseRecorded = true
                if (slowThinkingTimer) {
                  clearTimeout(slowThinkingTimer)
                  slowThinkingTimer = null
                }
              }
              if (slowExecutionTimer) {
                clearTimeout(slowExecutionTimer)
              }
              slowExecutionTimer = window.setTimeout(() => {
                if (
                  isGenerating.value &&
                  currentStage.value === 'executing' &&
                  performanceMetrics.value.toolCalls > 0
                ) {
                  setStatus(
                    'executing',
                    isMultiHost ? '正在处理所选服务器的任务' : `正在串行执行 ${performanceMetrics.value.toolCalls} 个工具步骤，请稍候`
                  )
                }
              }, 2500)
              if (!currentMsg) {
                currentMsg = createAssistantMessage(
                  `msg_${Date.now()}`,
                  userMsg.info.id,
                  requestSessionId,
                  'ssh-agent'
                )
                if (isMultiHost) currentMsg.info.targets = requestTargets
                messages.value.push(currentMsg)
                activeAssistantId.value = currentMsg.info.id
              }
              // 检查是否已存在相同的 tool call
              const existingToolPart = currentMsg.parts.find(
                (p): p is ToolPart => p.type === 'tool' && p.callID === event.toolCallId
              )
              if (existingToolPart) {
                break
              }
              performanceMetrics.value.toolCalls += 1
              const toolTarget = requestTargets.find(target => target.id === event.input?.targetId)
              const tp: ToolPart = {
                type: 'tool',
                tool: event.toolName,
                callID: event.toolCallId,
                displayKind: event.toolName === 'ask_followup_question' ? 'inquiry' : 'tool',
                state: { status: 'pending', input: event.input, metadata: toolTarget ? {
                  targetId: event.input.targetId,
                  targetName: toolTarget.name
                } : undefined }
              }
              currentMsg.parts.push(tp)
              if (event.toolName === 'ask_followup_question') {
                setStatus('thinking', '正在等待你的补充信息')
              } else {
                setStatus('executing', getStatusDescription(tp))
              }
              messages.value = [...messages.value]
              scrollToBottom()
              break
            }

            case 'tool-start': {
              if (!currentMsg) break
              const toolPart = currentMsg.parts.find((part): part is ToolPart => part.type === 'tool' && part.callID === event.toolCallId)
              if (toolPart) toolPart.state = { ...toolPart.state, status: 'running', time: { start: Date.now() } }
              setStatus('executing', isMultiHost ? '正在处理所选服务器的任务' : toolPart ? getStatusDescription(toolPart) : '正在执行工具')
              messages.value = [...messages.value]
              break
            }

            case 'tool-result': {
              if (!currentMsg) break
              const completed = updateToolResult(currentMsg, event.toolCallId, {
                output: event.output.output
              })
              const stagePart = completed.parts.find((part): part is ToolPart => part.type === 'tool' && part.callID === event.toolCallId && executionStageTools.has(part.tool))
              if (stagePart && deploymentStatus.value && deploymentStatus.value !== 'completed') {
                stagePart.state.status = deploymentStatus.value === 'failed' ? 'error' : 'aborted'
                stagePart.state.error = multiHostSummary.value
              }
              const idx = messages.value.findIndex(m => m.info.id === completed.info.id)
              if (idx !== -1) messages.value[idx] = completed
              currentMsg = completed
              const updatedDocument = completed.parts.find((part): part is ToolPart => part.type === 'tool' && part.callID === event.toolCallId && part.tool === 'update_server_env_doc')
              const documentTargetId = updatedDocument?.state.input?.targetId
              if (typeof documentTargetId === 'string' && deploymentStatus.value === 'completed' && documentTargetId === props.connectionId) {
                void refreshSessionContext(true, documentTargetId)
              }
              messages.value = [...messages.value]
              scrollToBottom()
              break
            }

            case 'tool-error': {
              if (!currentMsg) break
              const errPart = currentMsg.parts.find(
                p => p.type === 'tool' && p.callID === event.toolCallId
              ) as ToolPart | undefined
              if (errPart && executionStageTools.has(errPart.tool)) {
                deploymentStatus.value = 'failed'
                deploymentIssue.value = 'failed'
              }
              const toolWasAborted =
                stopRequested.value ||
                Boolean(requestRun?.snapshot().some(host => host.id === errPart?.state.input?.targetId && host.status === 'stopped')) ||
                String(event.error || '')
                  .toLowerCase()
                  .includes('aborted')
              const friendlyToolError = normalizeUserErrorMessage(event.error)
              if (errPart) {
                errPart.state = {
                  ...errPart.state,
                  status: toolWasAborted ? 'aborted' : 'error',
                  error: toolWasAborted ? 'Command aborted' : friendlyToolError,
                  time: { start: errPart.state.time?.start || Date.now(), end: Date.now() }
                }
              }
              if (!toolWasAborted) {
                setStatus('error', friendlyToolError)
              }
              messages.value = [...messages.value]
              break
            }

            case 'done':
              if (event.finish === 'step-limit') {
                if (currentMsg) currentMsg.info.finish = 'step-limit'
                messages.value = [...messages.value]
                setStatus('error', '达到执行上限，任务尚未完成；已保留当前进度，可发送新消息继续。')
                updateStatus()
                break
              }
              if (currentMsg) {
                if (event.finish === 'stop') {
                  markLastAssistantTextBlockAsSummary(currentMsg)
                }
                currentMsg.info.finish = event.finish
                messages.value = [...messages.value]
              }
              if (event.finish === 'stop') {
                performanceMetrics.value.totalMs = Date.now() - requestStartedAt
                if (!performanceLogged) {
                  logPerformanceSummary('success')
                  performanceLogged = true
                }
              }
              if (event.finish === 'stop') {
                requestRun?.finish()
                sessionStatusExpanded.value = false
                const hostFailures = requestRun?.snapshot().some(host => host.status === 'error' || host.status === 'unavailable')
                const stageCancelled = deploymentIssue.value === 'rejected' || deploymentIssue.value === 'stopped'
                setStatus(deploymentIssue.value === 'failed' || hostFailures ? 'error' : stageCancelled ? 'stopped' : 'complete', multiHostSummary.value || '已完成这次请求')
              } else {
                setStatus('thinking', '正在继续处理下一步')
              }
              updateStatus()
              break

            case 'error':
              if (
                stopRequested.value ||
                event.error.name === 'AbortError' ||
                String(event.error.message || '')
                  .toLowerCase()
                  .includes('aborted')
              ) {
                setStatus('stopped', '正在停止本次请求并保留当前进度')
              } else {
                console.error('[AIChatOpenCode] 错误:', event.error)
                setStatus('error', normalizeUserErrorMessage(event.error.message))
              }
              break
          }
        },
        onToolExecute: async (toolName, input) => {
          const tool = requestTools.find(t => t.id === toolName)
          if (!tool) throw new Error(`Unknown tool: ${toolName}`)
          const info = await tool.init()
          const result = await info.execute(input, {
            sessionID: requestSessionId || '',
            messageID: '',
            agent: 'ssh-agent',
            abort: requestSignal,
            metadata: () => ({}),
            extra: {
              connectionId: requestConnectionId,
              serverEnvDocId: requestEnvDocId || ''
            }
          })
          if (executionStageTools.has(toolName)) {
            const stageResult = JSON.parse(result.output)
            deploymentStatus.value = stageResult.status
            if (stageResult.status === 'failed' || stageResult.status === 'rejected' || stageResult.status === 'stopped') {
              if (!deploymentIssue.value || stageResult.status === 'failed') deploymentIssue.value = stageResult.status
            }
          }
          return result
        }
      },
      () => {}
    )

    const result = await processor.process()
    const completedAssistant = currentMsg as V2Message | null
    if (!requestSignal.aborted && completedAssistant && result.messages) {
      processorHistory.remember(completedAssistant.info.id, result.messages)
    }
  } catch (err: any) {
    const wasAborted =
      stopRequested.value ||
      err?.name === 'AbortError' ||
      String(err?.message || '')
        .toLowerCase()
        .includes('aborted')

    if (wasAborted) {
      error.value = null
      performanceMetrics.value.totalMs = Date.now() - requestStartedAt
      captureInterruptionState('本次请求已停止，当前进度已保留')
      setStatus('stopped', '已停止后续执行，继续前需核对远程状态')
      if (!performanceLogged) {
        logPerformanceSummary('aborted')
        performanceLogged = true
      }
      return
    }

    console.error('[AIChatOpenCode] 错误:', err)
    error.value = err
    performanceMetrics.value.totalMs = Date.now() - requestStartedAt
    setStatus('error', normalizeUserErrorMessage(err?.message || '执行失败'))
    if (!performanceLogged) {
      logPerformanceSummary(err?.name === 'AbortError' ? 'aborted' : 'error')
      performanceLogged = true
    }
    throw err
  } finally {
    flushExecutionLogs()
    requestRun?.finish()
    if (multiHostRun === requestRun) multiHostRun = null
    if (requestSignal.aborted) {
      for (const message of messages.value) {
        if (message.info.id !== activeAssistantId.value) continue
        for (const part of message.parts) {
          if (part.type === 'tool' && (part.state.status === 'pending' || part.state.status === 'running')) {
            part.state = { ...part.state, status: 'aborted', error: 'Command aborted', time: { start: part.state.time?.start || Date.now(), end: Date.now() } }
          }
        }
      }
      messages.value = [...messages.value]
    }
    isGenerating.value = false
    if (props.historyId && loadedHistoryId !== props.historyId) void loadConversationHistory()
    isStopping.value = false
    stopDurationTimer()
    abortController.value = null
    if (slowThinkingTimer) clearTimeout(slowThinkingTimer)
    if (slowExecutionTimer) clearTimeout(slowExecutionTimer)
    if (performanceMetrics.value.totalMs === null) {
      performanceMetrics.value.totalMs = Date.now() - requestStartedAt
    }
    if (!performanceLogged) {
      logPerformanceSummary('aborted')
      performanceLogged = true
    }
    await saveConversationHistory()
  }
}

function updateStatus() {
  if (
    currentStage.value === 'complete' ||
    currentStage.value === 'stopped' ||
    currentStage.value === 'error'
  ) {
    return
  }

  const lastMsg = messages.value[messages.value.length - 1]
  if (lastMsg && lastMsg.info.role === 'assistant') {
    const toolParts = getToolParts(lastMsg)
    const lastTool = toolParts[toolParts.length - 1]
    if (lastTool) {
      setStatus('executing', getStatusDescription(lastTool))
    } else if (lastMsg.parts.some(p => p.type === 'text')) {
      setStatus('thinking', '正在整理回答内容')
    }
  }
}

function getStatusDescription(part: ToolPart): string {
  const input = part.state.input || {}

  if (part.tool === 'execute_ssh_command' || part.tool === 'bash') {
    const command = input.command || input.description || ''
    if (command) {
      const preview = command.length > 60 ? command.substring(0, 60) + '...' : command
      return `正在这台主机上执行命令: ${preview}`
    }
    return '正在这台主机上执行命令'
  }

  if (part.tool === 'read_server_env_doc') {
    return '正在读取当前主机的环境文档'
  }

  if (part.tool === 'update_server_env_doc') {
    return input.content ? '正在更新当前主机的环境文档' : '正在按当前文档内容做精确更新'
  }

  const descriptions: Record<string, string> = {
    read_file: '正在读取服务器文件',
    read: '正在读取服务器文件',
    list_files: '正在查看目录内容',
    list: '正在查看目录内容',
    edit: '正在整理修改内容',
    write: '正在写入文件',
    glob: '正在搜索相关文件',
    grep: '正在搜索相关内容',
    webfetch: '正在查询网络信息',
    task: '正在拆解任务步骤',
    todowrite: '正在整理下一步计划',
    todoread: '正在读取当前计划'
  }
  return descriptions[part.tool] || '正在处理中'
}

function setStatus(
  stage: 'idle' | 'preparing' | 'thinking' | 'executing' | 'complete' | 'error' | 'stopped',
  message: string
) {
  currentStage.value = stage
  currentStatus.value = message
}

function toggleSessionStatusExpanded() {
  if (sessionStatusExpanded.value) sessionStatusToggle.value?.focus({ preventScroll: true })
  sessionStatusExpanded.value = !sessionStatusExpanded.value
}

function summarizePartialResponse(): string {
  for (let i = messages.value.length - 1; i >= 0; i -= 1) {
    const msg = messages.value[i]
    if (msg.info.role !== 'assistant') continue

    const text = getContent(msg).trim()
    if (!text) continue
    return text.length > 120 ? `${text.slice(0, 120)}...` : text
  }

  return ''
}

function captureInterruptionState(reason: string) {
  const toolParts = latestToolParts.value
  const completedTools = toolParts.filter(part => part.state.status === 'completed').length
  const lastTool = toolParts[toolParts.length - 1]?.tool || '尚未执行工具'

  interruptionState.value = {
    reason,
    completedTools,
    lastTool,
    partialResponse: summarizePartialResponse(),
    canResume: true
  }
}

function logPerformanceSummary(result: 'success' | 'error' | 'aborted') {
  void result
}

async function refreshSessionContext(force = false, connectionId = props.connectionId) {
  const settings = await settingsService.getSettings()
  const allowAutomaticRead = settings.aiAssistant?.autoApproveReadOnly !== false
  if (!connectionId) {
    cachedConnection.value = null
    cachedServerEnvDoc.value = null
    return { connection: null, doc: null }
  }

  if (allowAutomaticRead && !force && cachedConnection.value?.id === connectionId && cachedServerEnvDoc.value !== null) {
    sessionContextStats.value = {
      connectionSource: 'cache',
      envDocSource: 'cache',
      lastRefreshedAt: Date.now()
    }
    return { connection: cachedConnection.value, doc: cachedServerEnvDoc.value }
  }

  cacheLoading.value = true

  try {
    const [connections, serverEnvDoc] = await Promise.all([
      sshService.getConnections().catch(error => {
        console.warn('[AIChat] 获取 SSH 连接信息失败:', error)
        return [] as SSHConnection[]
      }),
      allowAutomaticRead && connectionId
        ? docStorageService.readServerEnvDoc(connectionId).catch(error => {
            console.warn('[AIChat] 读取服务器环境文档失败:', error)
            return null
          })
        : Promise.resolve(null)
    ])

    const connection = connections.find(connection => connection.id === connectionId) || null
    const doc = serverEnvDoc?.content || null
    cachedConnection.value = connection
    cachedServerEnvDoc.value = doc
    sessionContextStats.value = {
      connectionSource: cachedConnection.value ? 'fresh' : 'missing',
      envDocSource: serverEnvDoc?.content ? 'fresh' : 'missing',
      lastRefreshedAt: Date.now()
    }
    return { connection, doc }
  } finally {
    cacheLoading.value = false
  }
}

function summarizeServerEnvDoc(serverEnvDoc: string | null): string {
  if (!serverEnvDoc) {
    return 'Current server environment document for this connection does not exist yet.'
  }

  const normalized = serverEnvDoc.trim()
  if (normalized.length <= 2400) {
    return `Current server environment document for this connection:\n\n${normalized}`
  }

  const lines = normalized.split(/\r?\n/)
  const headings = lines.filter(line => /^(#|##|###)\s+/.test(line)).slice(0, 12)
  const head = lines.slice(0, 40).join('\n')
  const tail = lines.slice(-25).join('\n')

  const sections = [
    'Current server environment document for this connection (summarized to reduce prompt size):',
    '',
    'Document outline:',
    headings.length > 0 ? headings.join('\n') : '(no headings detected)',
    '',
    'Document beginning:',
    head,
    '',
    'Recent document tail:',
    tail
  ]

  return sections.join('\n')
}

function buildSystemPrompt(
  connection: SSHConnection | null,
  serverEnvDoc: string | null,
  serverEnvDocId: string
): string {
  const connectionConfig = connection?.config
  const connectionName = connectionConfig?.name || (connection as any)?.name || '(unnamed)'
  const connectionHost = connectionConfig?.host || (connection as any)?.host || 'unknown-host'
  const connectionPort = connectionConfig?.port || (connection as any)?.port || 'unknown-port'
  const connectionUsername =
    connectionConfig?.username || (connection as any)?.username || 'unknown-user'

  const connectionSummary = connection
    ? [
        `Current SSH connection ID: ${connection.id}`,
        `Connection name: ${connectionName}`,
        `Host: ${connectionHost}`,
        `Port: ${connectionPort}`,
        `Username: ${connectionUsername}`
      ].join('\n')
    : `Current SSH connection ID: ${serverEnvDocId || 'unknown'}`

  const rules = [
    'When handling server environment documentation, always use the dedicated tools read_server_env_doc and update_server_env_doc.',
    'Always call read_server_env_doc before modifying the environment document unless you are creating or replacing the entire document with update_server_env_doc content.',
    'When updating the server environment document, default to old_string/new_string exact replacements.',
    'Do not replace the entire document with content unless the user clearly asked for a full rewrite.',
    'Only use force_replace=true after the user explicitly confirms a full-document overwrite.',
    "The canonical environment document is env.md in the authenticated remote user's $HOME.",
    'It is shared by every computer that connects as that same remote user; never create a machine-local or alternate environment document.',
    'Never access env.md with generic file or command tools. Use only read_server_env_doc and update_server_env_doc so $HOME is resolved remotely and writes are atomic.',
    '',
    'Software documentation workflow:',
    'When the user asks to add or update software information in the environment document, inspect and document the live server state. Do not install, upgrade, restart, reload, or reconfigure the software unless the user separately asks for that operational change.',
    'Always complete this sequence: read the full env.md, locate the existing software section or a suitable insertion point, inspect the live server with bounded read-only commands, update only that section, then read env.md again and verify the result.',
    'Before writing, collect all applicable facts: installed state; exact version and build options; executable and related command paths; package name, repository/source, package manager, and verified install/update/remove commands; service manager and unit name; enabled and active state; process user; installation, configuration, include, module, certificate, web root, data, cache, temporary, PID, and log paths; listening addresses and ports; relevant virtual hosts or instances; syntax/configuration validation command and result; and verification time.',
    'Adapt inspection to the target type instead of using a product-specific checklist: for packages and command-line tools inspect version/build, executable, package source, dependencies, and lifecycle commands; for system or network services also inspect service state, process user, listeners, configuration/includes, validation, logs, PID, data/cache/temp paths, and instances; for databases inspect client/server versions, service, listeners, configuration, data, logs, backup/restore commands, and instance names without exposing credentials; for containers inspect runtime, compose or unit definitions, images, volumes, networks, ports, logs, and restart policy; for language runtimes inspect executable, version manager, package manager, global paths, environment files, and active application usage; for web applications inspect deployment root, process manager, environment file locations, upstream/listen endpoints, logs, static/upload/data paths, and health check.',
    'Collect only fields applicable to the target, but do not stop after a version check when the target is a running service or deployed application. Discover target-specific paths and commands from observed package metadata, process arguments, service definitions, configuration output, and live listeners rather than relying on conventional defaults.',
    'Use non-interactive privilege escalation only when it cannot prompt, such as sudo -n. If a fact cannot be observed because a command is unavailable or permission is denied, record it as 未确认 and briefly state why; never present an inferred default path or port as an observed fact.',
    'Do not paste raw command output into env.md. Normalize the evidence into concise Markdown, preserve the document language and heading hierarchy, keep exactly one section for the software, and leave unrelated sections unchanged.',
    'Use this readable structure for a new software section: a level-3 software heading; a 基本信息 table for version, package, executable, service, status, and process user; a 路径与文件 table for purpose and absolute path; a 网络与实例 table for addresses, ports, protocols, and virtual hosts; a 常用命令 fenced shell block grouped by status, validation, start/stop/reload, install/update/remove, and logs; then a 验证记录 bullet list with verification time, validation result, unknown items, and evidence notes.',
    'Keep table cells short, put one path or endpoint per row, use absolute paths where observed, and use fenced shell blocks only for reusable commands. Do not put long commands, multiline output, or paragraphs inside tables.',
    'After updating, reread env.md and confirm that the target software section exists exactly once, required facts or explicit 未确认 markers are present, Markdown tables and code fences are complete, and no unrelated content changed.',
    '',
    'SSH command execution rules:',
    'All SSH commands must be non-interactive and one-shot.',
    'Never run interactive programs like vim, nano, less, more, top, htop, watch, mysql, psql, or ssh.',
    'Never run commands that wait indefinitely for input or stream forever, such as tail -f, journalctl -f, docker logs -f, or read.',
    'Never rely on the user sending Ctrl+C or replying to command prompts to finish a command.',
    'Use non-interactive flags whenever available (for example: --no-pager, -n, --yes, --batch, --non-interactive).',
    'Explicitly limit output for commands that can produce large results.',
    'If a task cannot be completed safely in non-interactive mode, ask the user before proceeding instead of executing the command.'
  ].join('\n')

  const envDocSection = summarizeServerEnvDoc(serverEnvDoc)

  return [
    'You are an SSH assistant using structured tool calls.',
    connectionSummary,
    '',
    'Server environment documentation rules:',
    rules,
    '',
    envDocSection
  ].join('\n')
}

async function handleSendMessage() {
  if (!inputMessage.value.trim() || isGenerating.value) return
  activeAssistantId.value = null

  if (!props.currentProvider || !props.currentModel || !props.connectionId) {
    const message = !props.currentProvider || !props.currentModel
      ? '请先选择 AI 提供商和模型后再发送'
      : '请先建立 SSH 连接后再发送'
    error.value = new Error(message)
    setStatus('error', message)
    inputRef.value?.focus()
    return
  }

  const content = inputMessage.value.trim()
  inputMessage.value = ''
  inputRef.value?.focus()
  try {
    await sendMessageWithTools(content)
  } catch (cause: unknown) {
    const sendError = cause instanceof Error ? cause : new Error(String(cause))
    if (error.value !== sendError) {
      console.error('[AIChatOpenCode] 发送失败:', sendError)
    }
    error.value = sendError
    setStatus('error', normalizeUserErrorMessage(sendError.message))
    if (!inputMessage.value.trim()) {
      inputMessage.value = content
    }
  }
  nextTick(() => {
    resizeInputHeight()
  })
}

function handleInputKeydown(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) return
  if (event.key === 'Escape' && serverEnvMenuOpen.value) {
    event.preventDefault()
    serverEnvMenuOpen.value = false
    serverEnvMenuRef.value?.querySelector<HTMLButtonElement>('button')?.focus()
    return
  }
  if (
    event.key === 'Enter' &&
    !event.shiftKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey
  ) {
    event.preventDefault()
    void handleSendMessage()
  }
}

function resizeInputHeight() {
  const input = inputRef.value
  if (!input) return

  input.style.height = 'auto'
  const targetHeight = Math.min(Math.max(input.scrollHeight, INPUT_MIN_HEIGHT), INPUT_MAX_HEIGHT)
  input.style.height = `${targetHeight}px`
  input.style.overflowY = input.scrollHeight > INPUT_MAX_HEIGHT ? 'auto' : 'hidden'
}

function closeServerEnvMenu() {
  serverEnvMenuOpen.value = false
  serverEnvMenuRef.value?.querySelector<HTMLButtonElement>('button')?.focus()
}

function openServerEnvDoc() {
  serverEnvMenuOpen.value = false
  emit('openServerEnvDoc')
}

function prepareServerEnvUpdatePrompt() {
  const prompt = '请更新当前主机的环境文档，补充或修正以下内容：\n'
  const current = inputMessage.value.trim()
  inputMessage.value = current.startsWith(prompt.trim())
    ? current
    : current
      ? `${prompt}${current}`
      : prompt
  serverEnvMenuOpen.value = false

  nextTick(() => {
    const input = inputRef.value
    if (!input) return
    input.focus()
    const cursor = input.value.length
    input.setSelectionRange(cursor, cursor)
  })
}

function handleStop() {
  if (abortController.value) {
    isStopping.value = true
    stopRequested.value = true
    abortController.value.abort()
    abortController.value = null
  }
  setStatus('stopped', '正在停止本次请求并保留当前进度')
}

function handlePointerDownOutsideMenu(event: PointerEvent) {
  if (!serverEnvMenuOpen.value) return

  const target = event.target as Node | null
  if (!target) return

  if (serverEnvMenuRef.value?.contains(target)) {
    return
  }

  serverEnvMenuOpen.value = false
}

function handleMessagesScroll() {
  const container = messagesContainer.value
  if (!container || displayMessages.value.length === 0) return
  followLatest.value = container.scrollHeight - container.scrollTop - container.clientHeight < 56
}

function scrollToBottom(force = false) {
  if (displayMessages.value.length === 0) return
  if (force) followLatest.value = true
  if (!followLatest.value || scrollFrame) return
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0
    if (!followLatest.value || displayMessages.value.length === 0) return
    const container = messagesContainer.value
    if (container) container.scrollTop = container.scrollHeight
  })
}

function useQuickPrompt(prompt: string) {
  inputMessage.value = inputMessage.value.trim() ? `${inputMessage.value}\n\n${prompt}` : prompt
  nextTick(() => {
    inputRef.value?.focus()
    inputRef.value?.setSelectionRange(inputMessage.value.length, inputMessage.value.length)
  })
}

function openModelSettings() {
  void router.push({ path: '/settings', query: { section: 'ai-providers' } })
}

function messageStatus(msg: DisplayMessage): { label: string; kind: string } | null {
  if (msg.role !== 'assistant') return null
  if (msg.finish === 'step-limit') return { label: ui.value.failed, kind: 'error' }
  if (msg.id === activeAssistantId.value) {
    if (isGenerating.value) return { label: isStopping.value ? ui.value.stopping : ui.value.thinking, kind: 'info' }
    if (currentStage.value === 'error') return { label: ui.value.failed, kind: 'error' }
    if (currentStage.value === 'stopped') return { label: ui.value.stopped, kind: 'muted' }
  }
  if (msg.blocks.some(block => block.type === 'tool' && block.toolPart.state.status === 'error')) {
    return { label: ui.value.failed, kind: 'error' }
  }
  return msg.finish === 'stop' ? { label: ui.value.done, kind: 'success' } : null
}

const renderCachedMarkdown = createMarkdownRenderCache(text => {
  try {
    return renderChatMarkdown(text, ui.value.copyCode, ui.value.code)
  } catch {
    return text
  }
})

function renderMarkdown(text: string, key: string): string {
  return renderCachedMarkdown(text, `${locale.value}:${key}`)
}

function getContent(msg: V2Message): string {
  return msg.parts
    .filter((p): p is TextPart => p.type === 'text')
    .map(p => p.text)
    .join('\n')
}

function getToolParts(msg: V2Message): ToolPart[] {
  return msg.parts.filter(
    (p): p is ToolPart => p.type === 'tool' && (p.displayKind || 'tool') === 'tool'
  )
}

function getOrderedBlocks(msg: V2Message): DisplayBlock[] {
  const blocks: DisplayBlock[] = []

  msg.parts.forEach((part, index) => {
    if (part.type === 'text') {
      const text = part.text.trim()
      if (!text) return

      const kind = part.kind || 'analysis'
      if (kind === 'summary') {
        blocks.push({
          id: `${msg.info.id}-summary-${index}`,
          type: 'summary',
          text
        })
        return
      }

      blocks.push({
        id: `${msg.info.id}-analysis-${index}`,
        type: 'analysis',
        text,
        compact: shouldCompactAnalysis(text)
      })
      return
    }

    if (part.type !== 'tool') return

    if ((part.displayKind || 'tool') === 'inquiry') {
      const text = String(part.state.output || part.state.input?.question || '').trim()
      if (!text) return

      blocks.push({
        id: `${msg.info.id}-inquiry-${part.callID}`,
        type: 'inquiry',
        text
      })
      return
    }

    blocks.push({
      id: `${msg.info.id}-tool-${part.callID}`,
      type: 'tool',
      toolPart: part
    })

    const todos = extractTodos(part)
    if (todos.length > 0) {
      blocks.push({
        id: `${msg.info.id}-todos-${part.callID}`,
        type: 'todos',
        todos
      })
    }

    const diffs = extractDiffs(part)
    if (diffs.length > 0) {
      blocks.push({
        id: `${msg.info.id}-diffs-${part.callID}`,
        type: 'diffs',
        diffs
      })
    }
  })

  return blocks
}

function shouldCompactAnalysis(text: string): boolean {
  const lineCount = text.split(/\r?\n/).filter(Boolean).length
  return text.length > 120 || lineCount > 3
}

function getFileInfo(path: string) {
  const lastSlash = path.lastIndexOf('/')
  return {
    directory: path.substring(0, lastSlash) || '/',
    filename: path.substring(lastSlash + 1)
  }
}

function getToolInfo(
  toolName: string,
  input: Record<string, any> = {},
  _metadata: Record<string, any> = {}
) {
  switch (toolName) {
    case 'execute_deployment_stage':
      return { icon: 'terminal', title: input.kind === 'rollback' ? '回滚' : input.kind === 'verify' ? '验证' : input.kind === 'command' ? '执行命令' : '部署', subtitle: input.name || '等待确认执行阶段', args: [] }
    case 'inspect_server':
      return { icon: 'terminal', title: '只读巡检', subtitle: Array.isArray(input.checks) ? input.checks.map((check: string) => ({ system: '系统', cpu: 'CPU', memory: '内存', disk: '磁盘', services: '服务', network: '端口' }[check] || check)).join('、') : '检查服务器状态', args: [] }
    case 'execute_ssh_command':
    case 'bash': {
      const cmd = input.command || ''
      const preview = cmd.length > 50 ? cmd.substring(0, 50) + '...' : cmd
      return {
        icon: 'terminal',
        title: 'Shell',
        subtitle: cmd ? `$ ${preview}` : 'Running command',
        args: []
      }
    }
    case 'read_file':
    case 'read': {
      const readFile = getFileInfo(input.path || input.filePath || '')
      return {
        icon: 'file-text',
        title: 'Read',
        subtitle: input.path || input.filePath || 'Unknown file',
        pathInfo: readFile,
        args: []
      }
    }
    case 'list_files':
    case 'list':
      return { icon: 'folder', title: 'List', subtitle: input.path || '/', args: [] }
    case 'webfetch': {
      const url = input.url || ''
      const urlPreview = url.length > 50 ? url.substring(0, 50) + '...' : url
      return {
        icon: 'globe',
        title: 'Web',
        subtitle: urlPreview || 'Fetching URL',
        args: []
      }
    }
    case 'edit': {
      const editFile = getFileInfo(input.path || input.filePath || '')
      return {
        icon: 'code',
        title: 'Edit',
        subtitle: input.path || input.filePath || 'Unknown file',
        pathInfo: editFile,
        args: input.old_string ? [`Replace "${input.old_string?.substring(0, 30)}..."`] : []
      }
    }
    case 'write':
    case 'attempt_completion': {
      const writeFile = getFileInfo(input.path || input.filePath || '')
      return {
        icon: 'file-plus',
        title: 'Write',
        subtitle: input.path || input.filePath || input.result?.substring(0, 50) || 'New file',
        pathInfo: writeFile,
        args: []
      }
    }
    case 'todowrite':
      return { icon: 'checklist', title: 'To-dos', subtitle: '', args: [] }
    case 'todoread':
      return { icon: 'list', title: 'Read to-dos', subtitle: '', args: [] }
    case 'glob':
      return {
        icon: 'search',
        title: 'Glob',
        subtitle: input.path || '/',
        args: input.pattern ? [`pattern: ${input.pattern}`] : []
      }
    case 'grep':
      return {
        icon: 'search',
        title: 'Grep',
        subtitle: input.path || '/',
        args: input.pattern ? [`pattern: ${input.pattern}`] : []
      }
    case 'task':
      return {
        icon: 'users',
        title: `${input.subagent_type || 'Task'} Agent`,
        subtitle: input.description || '',
        args: []
      }
    default:
      return { icon: 'tool', title: toolName, subtitle: '', args: [] }
  }
}

function getToolStatusText(status: string): string {
  if (locale.value.startsWith('zh')) {
    const labels: Record<string, string> = { pending: '等待中', running: '执行中', completed: '已完成', error: '失败', aborted: '已取消' }
    return labels[status] || status
  }
  const statusMap: Record<string, string> = {
    pending: 'Pending',
    running: 'Running',
    completed: 'Completed',
    error: 'Failed',
    aborted: 'Cancelled'
  }
  return statusMap[status] || status
}

function normalizeUserErrorMessage(rawError: string): string {
  const cleaned = rawError.replace(/^Error: /i, '').trim()

  if (
    cleaned.includes('No document ID or connection ID available') ||
    cleaned.includes('No SSH connection available') ||
    cleaned.includes('未建立 SSH 连接')
  ) {
    return '当前没有可用的主机连接，请先连接到目标主机后再试。'
  }

  if (cleaned.includes('未找到 API 密钥配置')) {
    return '当前模型没有可用的 API Key，请先在设置中完成配置。'
  }

  if (cleaned.includes('content or old_string is required')) {
    return '这次环境文档更新缺少有效内容，系统将优先改用整篇文档更新。'
  }

  if (cleaned.includes('old_string not found in document')) {
    return '当前环境文档已经变化，局部替换无法安全完成。建议直接按整篇文档重新更新。'
  }

  if (cleaned.includes('Failed to read file')) {
    return '目标文件暂时无法读取，请确认路径存在且当前主机有权限访问。'
  }

  const httpStatus = cleaned.match(/\bHTTP\s+(\d{3})\b/)?.[1]
  if (httpStatus === '401' || httpStatus === '403') {
    return `模型服务认证失败（HTTP ${httpStatus}），请检查 API Key 和模型访问权限。`
  }
  if (httpStatus === '429') {
    return '模型服务请求受限（HTTP 429），请稍后重试并检查配额。'
  }
  if (httpStatus) {
    return `模型服务响应异常（HTTP ${httpStatus}），请检查服务地址和模型是否可用后重试。`
  }

  return cleaned
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const chinese = locale.value.startsWith('zh')
  if (diff < 60000) return chinese ? '刚刚' : 'just now'
  if (diff < 3600000) return chinese ? `${Math.floor(diff / 60000)} 分钟前` : `${Math.floor(diff / 60000)}m ago`
  if (date.toDateString() === now.toDateString())
    return date.toLocaleTimeString(locale.value, { hour: 'numeric', minute: '2-digit' })
  return date.toLocaleDateString(locale.value, { month: 'short', day: 'numeric' })
}

function toggleTool(callID: string) {
  if (expandedTools.value.has(callID)) expandedTools.value.delete(callID)
  else expandedTools.value.add(callID)
}

function toggleTurn(turnId: string) {
  if (expandedTurns.value.has(turnId)) expandedTurns.value.delete(turnId)
  else expandedTurns.value.add(turnId)
}

function hasTools(msg: DisplayMessage): boolean {
  return msg.blocks.some(block => block.type === 'tool')
}

function getTurnId(msg: DisplayMessage): string {
  return `turn-${msg.id}`
}

function canCollapse(msg: DisplayMessage): boolean {
  return msg.role === 'assistant' && hasTools(msg)
}

function isCollapsed(msg: DisplayMessage): boolean {
  if (!canCollapse(msg)) {
    return false
  }

  const hasRunningTool = msg.blocks.some(
    block => block.type === 'tool' && block.toolPart?.state.status === 'running'
  )

  if (hasRunningTool) {
    return false
  }

  return expandedTurns.value.has(getTurnId(msg)) ? false : msg.finish === 'stop'
}

async function copyToClipboard(text: string, id: string) {
  try {
    await navigator.clipboard.writeText(text)
    clearTimeout(copyFeedbackTimer)
    copiedId.value = id
    copyFeedbackTimer = setTimeout(() => (copiedId.value = null), 2000)
  } catch (err) {
    console.error('Failed to copy:', err)
  }
}

async function handleCodeCopy(event: MouseEvent) {
  const target = event.target
  if (!(target instanceof Element)) return
  const button = target.closest<HTMLButtonElement>('button[data-code-copy]')
  const code = button?.closest('.oc-code-block')?.querySelector('pre > code')
  if (!button || !code || !event.currentTarget || !(event.currentTarget as Element).contains(button)) return
  try {
    await navigator.clipboard.writeText(code.textContent || '')
    clearTimeout(codeCopyFeedback.get(button))
    button.classList.add('is-copied')
    button.setAttribute('aria-label', ui.value.copied)
    const label = button.querySelector('span')
    if (label) label.textContent = ui.value.copied
    codeCopyFeedback.set(button, setTimeout(() => {
      button.classList.remove('is-copied')
      button.setAttribute('aria-label', ui.value.copyCode)
      if (label) label.textContent = ui.value.copyCode
      codeCopyFeedback.delete(button)
    }, 2000))
  } catch (err) {
    console.error('Failed to copy code:', err)
  }
}

function getErrorTitle(error: string): { title: string; message: string } {
  const cleaned = normalizeUserErrorMessage(error)

  if (cleaned.includes('主机连接')) {
    return { title: '连接不可用', message: cleaned }
  }

  if (cleaned.includes('API Key') || cleaned.includes('模型服务')) {
    return { title: '模型服务异常', message: cleaned }
  }

  if (cleaned.includes('环境文档')) {
    return { title: '环境文档更新失败', message: cleaned }
  }

  if (cleaned.includes('文件')) {
    return { title: '文件访问失败', message: cleaned }
  }

  return { title: '执行失败', message: cleaned }
}

function estimateMessageWeight(msg: V2Message): number {
  return msg.parts.reduce((total, part) => {
    if (part.type === 'text') {
      return total + (part.text?.length || 0)
    }

    if (part.type === 'tool') {
      return (
        total +
        JSON.stringify(part.state.input || {}).length +
        (part.state.output?.length || 0) +
        (part.state.error?.length || 0)
      )
    }

    if (part.type === 'reasoning') {
      return total + (part.text?.length || 0)
    }

    return total
  }, 0)
}

function getAdaptiveCompactionLimit(msgs: V2Message[]): number {
  const totalWeight = msgs.reduce((sum, msg) => sum + estimateMessageWeight(msg), 0)

  if (totalWeight > 45000) return 8
  if (totalWeight > 30000) return 12
  if (totalWeight > 18000) return 16
  return 20
}

function toolOutputForDisplay(part: ToolPart): string {
  const output = part.state.output || ''
  if (!part.state.metadata?.targetId) return output
  try {
    const result = JSON.parse(output)
    if (typeof result.output !== 'string') return output
    const longest = Math.max(2, ...(result.output.match(/`+/g) || []).map((run: string) => run.length))
    const fence = '`'.repeat(longest + 1)
    return `${fence}text\n${result.output}\n${fence}${result.truncated ? '\n\n输出已截断，仅显示部分内容。' : ''}`
  } catch { return output }
}
</script>

<template>
  <div
    class="oc-chat"
    :class="{ generating: isGenerating }"
  >
    <div class="oc-conversation">
    <div ref="messagesContainer" class="oc-messages" :class="{ 'is-empty': displayMessages.length === 0 }" @scroll.passive="handleMessagesScroll" @click="handleCodeCopy" tabindex="0" :aria-label="locale.startsWith('zh') ? '对话记录' : 'Conversation'">
      <div v-if="displayMessages.length === 0" class="oc-empty">
        <div class="oc-empty-icon">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="m12 3 2.8 6.2L21 12l-6.2 2.8L12 21l-2.8-6.2L3 12l6.2-2.8L12 3Z" />
          </svg>
        </div>
        <h2 class="oc-empty-title">{{ ui.emptyTitle }}</h2>
        <p class="oc-empty-text">{{ ui.emptyText }}</p>
        <div class="oc-suggestions">
          <button v-for="prompt in quickPrompts" :key="prompt.title" type="button" class="oc-suggestion" @click="useQuickPrompt(prompt.prompt)">
            <i :class="['bi', prompt.icon]" aria-hidden="true"></i>
            <span>{{ prompt.title }}</span>
            <i class="bi bi-arrow-up-left" aria-hidden="true"></i>
          </button>
        </div>
        <p class="oc-suggestion-hint">{{ ui.promptHint }}</p>
        <p v-if="!props.connectionId" class="oc-setup-hint">{{ ui.connectionHint }}</p>
      </div>

      <div v-else class="oc-message-list">
        <button
          v-if="earlierMessageCount > 0"
          type="button"
          class="oc-load-more"
          :disabled="isLoadingMore"
          @click="loadEarlierMessages"
        >
          <span v-if="isLoadingMore" class="oc-loading-spinner"></span>
          <span v-else>{{ ui.older }} <span class="oc-earlier-count">{{ earlierMessageCount }}</span></span>
        </button>

        <template v-for="msg in displayMessages" :key="msg.id">
          <div
            class="oc-turn"
            role="article"
            :aria-label="msg.role === 'user' ? ui.user : ui.assistant"
            :class="{
              collapsed: isCollapsed(msg),
              working: isGenerating && msg.id === activeAssistantId,
              'oc-turn-user': msg.role === 'user',
              'oc-turn-multi-host': (msg.targets?.length || 0) > 1
            }"
            :data-msg-id="msg.id"
            :data-msg-role="msg.role"
          >
            <div v-if="msg.role === 'assistant'" class="oc-turn-header">
              <button
                v-if="canCollapse(msg)"
                class="oc-collapse-button"
                type="button"
                :aria-label="isCollapsed(msg) ? ui.showProcess : ui.hideProcess"
                :aria-expanded="!isCollapsed(msg)"
                :data-prism-tooltip="isCollapsed(msg) ? ui.showProcess : ui.hideProcess"
                @click="toggleTurn(getTurnId(msg))"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  :class="{ expanded: expandedTurns.has(getTurnId(msg)) }"
                >
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
                <span>{{ isCollapsed(msg) ? ui.showProcess : ui.hideProcess }}</span>
              </button>
              <div class="oc-turn-title">
                <span class="oc-turn-avatar" aria-hidden="true"><i class="bi bi-stars"></i></span>
                <span class="oc-turn-role">{{ ui.assistant }}</span>
                <span class="oc-turn-time">{{ formatTime(msg.timestamp) }}</span>
                <span v-if="msg.modelInfo" class="oc-model-badge">{{
                  msg.modelInfo.modelID
                }}</span>
              </div>
              <span v-if="messageStatus(msg) && messageStatus(msg)?.kind !== 'success'" class="oc-turn-badge" :class="`oc-badge-${messageStatus(msg)?.kind}`">
                {{ messageStatus(msg)?.label }}
              </span>
            </div>

            <div class="oc-turn-content">
              <template v-if="msg.role === 'user'">
                <div class="oc-user-message">
                  <div
                    v-if="msg.content"
                    class="oc-markdown oc-user-text"
                    v-html="renderMarkdown(msg.content, msg.id)"
                  ></div>
                </div>
                <div class="oc-message-actions oc-user-actions">
                  <span v-if="msg.targets?.length" class="oc-message-targets" :title="msg.targets.map(host => `${host.name} (${host.host})`).join('、')"><i class="bi bi-hdd-network" aria-hidden="true"></i>{{ msg.targets.length }} {{ locale.startsWith('zh') ? '台' : 'hosts' }}</span>
                  <span class="oc-message-time">{{ formatTime(msg.timestamp) }}</span>
                  <button
                    class="oc-copy-button"
                    type="button"
                    @click="copyToClipboard(msg.content, msg.id)"
                    :data-prism-tooltip="copiedId === msg.id ? ui.copied : ui.copy"
                    :aria-label="copiedId === msg.id ? ui.copied : ui.copy"
                  >
                    <svg
                      v-if="copiedId !== msg.id"
                      xmlns="http://www.w3.org/2000/svg"
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                    >
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                    <svg
                      v-else
                      xmlns="http://www.w3.org/2000/svg"
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                    >
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                    <span>{{ copiedId === msg.id ? ui.copied : ui.copy }}</span>
                  </button>
                </div>
              </template>

              <template v-else>
                <template v-for="block in msg.blocks" :key="block.id">
                  <div v-if="block.type === 'analysis'" class="oc-timeline-block">
                    <details v-if="block.compact && hasTools(msg)" class="oc-analysis-block">
                      <summary><i class="bi bi-lightbulb" aria-hidden="true"></i>{{ ui.analysis }}<i class="bi bi-chevron-right" aria-hidden="true"></i></summary>
                      <div
                        class="oc-markdown oc-analysis-text"
                        v-html="renderMarkdown(block.text, block.id)"
                      ></div>
                    </details>
                    <div
                      v-else
                      class="oc-markdown oc-analysis-text"
                      v-html="renderMarkdown(block.text, block.id)"
                    ></div>
                  </div>

                  <div v-else-if="block.type === 'tool' && block.toolPart" class="oc-tools">
                    <div
                      class="oc-tool"
                      :class="{
                        expanded: expandedTools.has(block.toolPart.callID),
                        [block.toolPart.state.status]: true,
                        'has-error': block.toolPart.state.status === 'error'
                      }"
                    >
                      <DeploymentStageResult
                        v-if="executionStageTools.has(block.toolPart.tool) && block.toolPart.state.output"
                        :output="block.toolPart.state.output"
                        :zh="locale.startsWith('zh')"
                      />
                      <template
                        v-else-if="block.toolPart.state.status === 'error' && block.toolPart.state.error"
                      >
                        <div class="oc-tool-error-card">
                          <div class="oc-error-icon">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="2"
                            >
                              <circle cx="12" cy="12" r="10"></circle>
                              <line x1="15" y1="9" x2="9" y2="15"></line>
                              <line x1="9" y1="9" x2="15" y2="15"></line>
                            </svg>
                          </div>
                          <div class="oc-error-content">
                            <div class="oc-error-title">
                              {{ getErrorTitle(block.toolPart.state.error).title }}
                            </div>
                            <div class="oc-error-message">
                              {{ getErrorTitle(block.toolPart.state.error).message }}
                            </div>
                          </div>
                        </div>
                      </template>

                      <template v-else>
                        <button type="button" class="oc-tool-trigger"
                          :aria-expanded="expandedTools.has(block.toolPart.callID)"
                          :aria-label="`${ui.details}: ${getToolInfo(block.toolPart.tool, block.toolPart.state.input).title}`"
                          @click="toggleTool(block.toolPart.callID)">
                          <div class="oc-tool-icon">
                            <svg
                              v-if="
                                getToolInfo(
                                  block.toolPart.tool,
                                  block.toolPart.state.input,
                                  block.toolPart.state.metadata || {}
                                ).icon === 'terminal'
                              "
                              xmlns="http://www.w3.org/2000/svg"
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="2"
                            >
                              <polyline points="4 17 10 11 4 5"></polyline>
                              <line x1="12" y1="19" x2="20" y2="19"></line>
                            </svg>
                            <svg
                              v-else-if="
                                getToolInfo(
                                  block.toolPart.tool,
                                  block.toolPart.state.input,
                                  block.toolPart.state.metadata || {}
                                ).icon === 'file-text'
                              "
                              xmlns="http://www.w3.org/2000/svg"
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="2"
                            >
                              <path
                                d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
                              ></path>
                              <polyline points="14 2 14 8 20 8"></polyline>
                              <line x1="16" y1="13" x2="8" y2="13"></line>
                              <line x1="16" y1="17" x2="8" y2="17"></line>
                            </svg>
                            <svg
                              v-else-if="
                                getToolInfo(
                                  block.toolPart.tool,
                                  block.toolPart.state.input,
                                  block.toolPart.state.metadata || {}
                                ).icon === 'folder'
                              "
                              xmlns="http://www.w3.org/2000/svg"
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="2"
                            >
                              <path
                                d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"
                              ></path>
                            </svg>
                            <svg
                              v-else-if="
                                getToolInfo(
                                  block.toolPart.tool,
                                  block.toolPart.state.input,
                                  block.toolPart.state.metadata || {}
                                ).icon === 'code'
                              "
                              xmlns="http://www.w3.org/2000/svg"
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="2"
                            >
                              <polyline points="16 18 22 12 16 6"></polyline>
                              <polyline points="8 6 2 12 8 18"></polyline>
                            </svg>
                            <svg
                              v-else-if="
                                getToolInfo(
                                  block.toolPart.tool,
                                  block.toolPart.state.input,
                                  block.toolPart.state.metadata || {}
                                ).icon === 'file-plus'
                              "
                              xmlns="http://www.w3.org/2000/svg"
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="2"
                            >
                              <path
                                d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
                              ></path>
                              <line x1="12" y1="18" x2="12" y2="12"></line>
                              <line x1="9" y1="15" x2="15" y2="15"></line>
                            </svg>
                            <svg
                              v-else-if="
                                getToolInfo(
                                  block.toolPart.tool,
                                  block.toolPart.state.input,
                                  block.toolPart.state.metadata || {}
                                ).icon === 'checklist'
                              "
                              xmlns="http://www.w3.org/2000/svg"
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="2"
                            >
                              <polyline points="9 11 12 14 22 4"></polyline>
                              <path
                                d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"
                              ></path>
                            </svg>
                            <svg
                              v-else-if="
                                getToolInfo(
                                  block.toolPart.tool,
                                  block.toolPart.state.input,
                                  block.toolPart.state.metadata || {}
                                ).icon === 'search'
                              "
                              xmlns="http://www.w3.org/2000/svg"
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="2"
                            >
                              <circle cx="11" cy="11" r="8"></circle>
                              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                            </svg>
                            <svg
                              v-else-if="
                                getToolInfo(
                                  block.toolPart.tool,
                                  block.toolPart.state.input,
                                  block.toolPart.state.metadata || {}
                                ).icon === 'globe'
                              "
                              xmlns="http://www.w3.org/2000/svg"
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="2"
                            >
                              <circle cx="12" cy="12" r="10"></circle>
                              <line x1="2" y1="12" x2="22" y2="12"></line>
                            </svg>
                            <svg
                              v-else
                              xmlns="http://www.w3.org/2000/svg"
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="2"
                            >
                              <circle cx="12" cy="12" r="10"></circle>
                              <line x1="12" y1="16" x2="12" y2="12"></line>
                              <line x1="12" y1="8" x2="12.01" y2="8"></line>
                            </svg>
                          </div>
                          <div class="oc-tool-info">
                            <span v-if="block.toolPart.state.metadata?.targetName" class="oc-tool-host"><i class="bi bi-hdd-network" aria-hidden="true"></i>{{ block.toolPart.state.metadata.targetName }}</span>
                            <span class="oc-tool-title">{{
                              getToolInfo(
                                block.toolPart.tool,
                                block.toolPart.state.input,
                                block.toolPart.state.metadata || {}
                              ).title
                            }}</span>
                            <span class="oc-tool-subtitle">{{
                              getToolInfo(
                                block.toolPart.tool,
                                block.toolPart.state.input,
                                block.toolPart.state.metadata || {}
                              ).subtitle
                            }}</span>
                          </div>
                          <div class="oc-tool-status" :class="block.toolPart.state.status">
                            <span
                              v-if="block.toolPart.state.status === 'running'"
                              class="oc-status-dot"
                            ></span>
                            {{ getToolStatusText(block.toolPart.state.status) }}
                          </div>
                          <svg
                            class="oc-chevron"
                            :class="{ expanded: expandedTools.has(block.toolPart.callID) }"
                            xmlns="http://www.w3.org/2000/svg"
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                          >
                            <polyline points="6 9 12 15 18 9"></polyline>
                          </svg>
                        </button>
                        <div
                          v-if="expandedTools.has(block.toolPart.callID)"
                          class="oc-tool-content"
                        >
                          <div
                            v-if="
                              block.toolPart.tool === 'todowrite' && block.toolPart.state.output
                            "
                            class="oc-tool-input"
                          >
                            <div class="oc-tool-section-label">Plan</div>
                            <div
                              class="oc-tool-output-content"
                              v-html="renderMarkdown(toolOutputForDisplay(block.toolPart), block.id)"
                            ></div>
                          </div>
                          <div
                            v-else-if="
                              block.toolPart.tool === 'bash' &&
                              (block.toolPart.state.input?.command || block.toolPart.state.output)
                            "
                            class="oc-tool-input"
                          >
                            <div class="oc-tool-section-label">Command</div>
                            <pre>{{
                              block.toolPart.state.input?.command ||
                              block.toolPart.state.input?.description
                            }}</pre>
                          </div>
                          <div
                            v-else-if="
                              block.toolPart.tool === 'read_file' &&
                              block.toolPart.state.input?.path
                            "
                            class="oc-tool-input"
                          >
                            <div class="oc-tool-section-label">File Path</div>
                            <pre>{{ block.toolPart.state.input.path }}</pre>
                          </div>
                          <div
                            v-else-if="
                              block.toolPart.state.input &&
                              Object.keys(block.toolPart.state.input).length > 0
                            "
                            class="oc-tool-input"
                          >
                            <div class="oc-tool-section-label">Input</div>
                            <pre>{{ JSON.stringify(block.toolPart.state.input, null, 2) }}</pre>
                          </div>
                          <div
                            v-if="
                              block.toolPart.state.status === 'completed' &&
                              block.toolPart.state.output
                            "
                            class="oc-tool-output"
                          >
                            <div class="oc-tool-section-label">Output</div>
                            <div
                              class="oc-tool-output-content"
                              v-html="renderMarkdown(toolOutputForDisplay(block.toolPart), block.id)"
                            ></div>
                          </div>
                        </div>
                      </template>
                    </div>
                  </div>

                  <div v-else-if="block.type === 'todos' && block.todos" class="oc-todos">
                    <div class="oc-todos-header">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                      >
                        <polyline points="9 11 12 14 22 4"></polyline>
                        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
                      </svg>
                      <span>To-dos</span>
                    </div>
                    <div class="oc-todos-list">
                      <div
                        v-for="todo in block.todos"
                        :key="todo.id"
                        class="oc-todo-item"
                        :class="{ completed: todo.status === 'completed' }"
                      >
                        <div class="oc-todo-checkbox">
                          <svg
                            v-if="todo.status === 'completed'"
                            xmlns="http://www.w3.org/2000/svg"
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="3"
                          >
                            <polyline points="20 6 9 17 4 12"></polyline>
                          </svg>
                          <svg
                            v-else
                            xmlns="http://www.w3.org/2000/svg"
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                          >
                            <circle cx="12" cy="12" r="10"></circle>
                          </svg>
                        </div>
                        <span class="oc-todo-content">{{ todo.activeForm || todo.content }}</span>
                      </div>
                    </div>
                  </div>

                  <div v-else-if="block.type === 'diffs' && block.diffs" class="oc-diffs">
                    <div class="oc-diffs-header">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                      >
                        <polyline points="16 18 22 12 16 6"></polyline>
                        <polyline points="8 6 2 12 8 18"></polyline>
                      </svg>
                      <span>Changes</span>
                    </div>
                    <div v-for="diff in block.diffs" :key="diff.file" class="oc-diff-item">
                      <div class="oc-diff-file">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                        >
                          <path
                            d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
                          ></path>
                        </svg>
                        <span class="oc-diff-path">{{ diff.file }}</span>
                      </div>
                    </div>
                  </div>

                  <div
                    v-else-if="(block.type === 'inquiry' || block.type === 'summary') && block.text"
                    class="oc-response"
                    :class="{ 'is-standalone': block.type === 'summary' && msg.blocks.length === 1 }"
                  >
                    <div v-if="block.type === 'inquiry' || msg.blocks.length > 1" class="oc-response-header">
                      <span class="oc-response-title">{{
                        block.type === 'inquiry' ? '询问' : '总结'
                      }}</span>
                    </div>
                    <div class="oc-response-content" v-html="renderMarkdown(block.text, block.id)"></div>
                    <div class="oc-response-actions">
                      <button
                        class="oc-copy-button"
                        type="button"
                        @click="copyToClipboard(block.text, block.id)"
                        :data-prism-tooltip="copiedId === block.id ? ui.copied : ui.copyReply"
                        :aria-label="copiedId === block.id ? ui.copied : ui.copyReply"
                      >
                        <svg
                          v-if="copiedId !== block.id"
                          xmlns="http://www.w3.org/2000/svg"
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                        >
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                        <svg
                          v-else
                          xmlns="http://www.w3.org/2000/svg"
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                        >
                          <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                        <span>{{ copiedId === block.id ? ui.copied : ui.copyReply }}</span>
                      </button>
                    </div>
                  </div>
                </template>
              </template>
            </div>
          </div>
        </template>
        <DeploymentApproval
          v-if="pendingDeploymentApproval"
          :stage="pendingDeploymentApproval.stage"
          :targets="pendingDeploymentApproval.targets"
          :zh="locale.startsWith('zh')"
          @approve="pendingDeploymentApproval?.resolve(true)"
          @reject="pendingDeploymentApproval?.resolve(false)"
        />
      </div>
    </div>
    <button v-if="!followLatest && displayMessages.length > 0" class="oc-jump-latest" type="button" @click="scrollToBottom(true)">
      <i class="bi bi-arrow-down" aria-hidden="true"></i>{{ ui.latest }}
    </button>
    </div>

    <LiquidSurface
      v-if="currentStatus || error"
      class="oc-session-status"
      :class="[error ? 'is-error' : `is-${currentStage}`, { 'is-expanded': sessionStatusExpanded }]"
      :radius="18"
      :strength="40"
      :blur="0.35"
      :interactive="false"
    >
      <button
        ref="sessionStatusToggle"
        class="oc-session-status-main oc-session-toggle"
        type="button"
        :aria-expanded="sessionStatusExpanded"
        :aria-controls="sessionDetailsId"
        :title="sessionStatusExpanded ? sessionCopy.collapse : sessionCopy.expand"
        @click="toggleSessionStatusExpanded"
      >
        <span class="oc-session-status-icon" aria-hidden="true">
          <i v-if="error || currentStage === 'error'" class="bi bi-exclamation-circle"></i>
          <i v-else-if="currentStage === 'complete'" class="bi bi-check2"></i>
          <i v-else-if="currentStage === 'stopped'" class="bi bi-pause-fill"></i>
          <span v-else class="oc-status-dot"></span>
        </span>
        <span class="oc-session-status-text" :role="error || currentStage === 'error' ? 'alert' : 'status'" :aria-live="error || currentStage === 'error' ? 'assertive' : 'polite'">{{ sessionErrorMessage || multiHostSummary || (currentStage === 'complete' ? ui.done : currentStatus) }}</span>
        <span v-if="sessionElapsed" class="oc-session-status-time" :title="sessionCopy.duration">
          <i class="bi bi-clock" aria-hidden="true"></i>{{ sessionElapsed }}
        </span>
        <i class="bi bi-chevron-down oc-session-chevron" aria-hidden="true"></i>
      </button>
      <div
        :id="sessionDetailsId"
        class="oc-session-details"
        :inert="!sessionStatusExpanded"
        :aria-hidden="!sessionStatusExpanded"
      >
        <div class="oc-session-details-clip">
          <div class="oc-session-details-scroll">
            <MultiHostProgress v-if="hasHostActivity" :hosts="multiHostStates" :active="isGenerating" @stop="multiHostRun?.stopTarget($event)" />
            <ExecutionLogPanel v-if="hasExecutionLogs" :logs="executionLogs" :hosts="multiHostStates" :active="isGenerating" :zh="locale.startsWith('zh')" />
            <p v-if="sessionErrorMessage" class="oc-session-error-detail">{{ sessionErrorMessage }}</p>
            <ol class="oc-session-status-steps" :aria-label="sessionCopy.process">
              <li
                v-for="step in sessionSteps"
                :key="step.key"
                class="oc-session-step"
                :class="{ active: step.active, done: step.done, skipped: step.skipped }"
                :aria-current="step.active ? 'step' : undefined"
              >
                <span class="oc-session-step-dot" aria-hidden="true">
                  <i v-if="step.done" class="bi bi-check2"></i>
                  <i v-else-if="step.skipped" class="bi bi-dash"></i>
                  <span v-else></span>
                </span>
                <span class="oc-session-step-label">{{ step.label }}</span>
              </li>
            </ol>
            <dl class="oc-session-metrics">
              <div v-for="item in performanceItems" :key="item.label" class="oc-session-metric">
                <dt>{{ item.label }}</dt>
                <dd>{{ item.value }}</dd>
              </div>
            </dl>
            <div v-if="interruptionState" class="oc-session-interruption">
              <div class="oc-session-interruption-title">已保留当前进度</div>
              <div class="oc-session-interruption-meta">
                <span>已完成工具 {{ interruptionState.completedTools }} 次</span>
                <span class="oc-hint-divider">·</span>
                <span>最后一步: {{ interruptionState.lastTool }}</span>
              </div>
              <div v-if="interruptionState.partialResponse" class="oc-session-interruption-preview">
                {{ interruptionState.partialResponse }}
              </div>
              <div v-if="interruptionState.canResume" class="oc-session-interruption-hint">
                直接发送“继续”或补一句新要求，我会基于当前上下文接着处理。
              </div>
            </div>
            <details v-if="debugFacts.length > 0 || debugToolChain.length > 0" class="oc-debug-panel">
              <summary class="oc-debug-panel-title">
                {{ sessionCopy.details }}<i class="bi bi-chevron-right" aria-hidden="true"></i>
              </summary>
              <dl v-if="debugFacts.length > 0" class="oc-debug-facts">
                <div v-for="fact in debugFacts" :key="fact.label" class="oc-debug-fact">
                  <dt class="oc-debug-fact-label">{{ fact.label }}</dt>
                  <dd class="oc-debug-fact-value">{{ fact.value }}</dd>
                </div>
              </dl>
              <div v-if="debugToolChain.length > 0" class="oc-debug-chain">
                <span class="oc-debug-chain-label">{{ sessionCopy.toolChain }}</span>
                <span
                  v-for="tool in debugToolChain"
                  :key="tool.id"
                  class="oc-debug-chain-item"
                  :class="`is-${tool.status}`"
                >
                  {{ tool.label }}
                </span>
              </div>
              <p v-if="performanceInsight" class="oc-session-insight">{{ performanceInsight }}</p>
            </details>
          </div>
        </div>
      </div>
    </LiquidSurface>

    <div class="oc-composer-area">
    <div v-if="!hasModel" class="oc-model-notice">
      <span>{{ ui.modelHint }}</span>
      <button type="button" class="oc-configure-model" @click="openModelSettings">{{ ui.configure }}<i class="bi bi-arrow-up-right" aria-hidden="true"></i></button>
    </div>
    <LiquidSurface class="oc-input-wrapper" :radius="18" :strength="40" :blur="0.35" :interactive="false">
      <div class="oc-input-container">
        <textarea
          ref="inputRef"
          v-model="inputMessage"
          class="oc-input"
          :placeholder="isGenerating ? ui.draftPlaceholder : ui.placeholder"
          :aria-label="ui.placeholder"
          @keydown="handleInputKeydown"
          rows="1"
        ></textarea>
      </div>
      <div class="oc-input-actions">
        <div class="oc-input-actions-left">
          <HostTargetPicker :model-value="effectiveHostIds" :connections="connectedHosts" :current-id="props.connectionId" :disabled="isGenerating" @update:model-value="selectedHostIds = $event" />
          <div
            v-if="props.showServerEnvButton && effectiveHostIds.length === 1 && effectiveHostIds[0] === props.connectionId"
            ref="serverEnvMenuRef"
            class="oc-action-menu"
            @keydown.esc.stop.prevent="closeServerEnvMenu"
          >
            <button
              class="oc-action-button"
              type="button"
              :aria-expanded="serverEnvMenuOpen"
              :data-prism-tooltip="ui.environment"
              :aria-label="ui.environment"
              @click="serverEnvMenuOpen = !serverEnvMenuOpen"
            >
              <i class="bi bi-file-earmark-text" aria-hidden="true"></i>
              <span>{{ ui.environment }}</span>
            </button>

            <div v-if="serverEnvMenuOpen" class="oc-action-menu-popover">
              <button class="oc-action-menu-item" type="button" @click="openServerEnvDoc">
                <i class="bi bi-file-earmark-text"></i>
                <span>查看文档</span>
              </button>
              <button
                class="oc-action-menu-item"
                type="button"
                @click="prepareServerEnvUpdatePrompt"
              >
                <i class="bi bi-pencil-square"></i>
                <span>更新文档</span>
              </button>
            </div>
          </div>
        </div>
        <div class="oc-input-actions-right">
          <ReasoningSlider v-model="reasoningSelection" :capability="reasoningCapability" :model-name="modelLabel" :disabled="isGenerating">
            <template #models>
              <ComposerModelList :provider-id="props.currentProvider?.id" :model-id="props.currentModel?.id" :disabled="isGenerating" @configure="openModelSettings" />
            </template>
          </ReasoningSlider>
          <button
            v-if="!isGenerating"
            class="oc-send-button"
            type="button"
            :disabled="!inputMessage.trim()"
            :data-prism-tooltip="ui.send"
            :aria-label="ui.send"
            @click="handleSendMessage"
          >
            <i class="bi bi-arrow-up"></i>
          </button>
          <button
            v-else
            class="oc-send-button oc-stop-button"
            type="button"
            :class="{ 'is-stopping': isStopping }"
            :data-prism-tooltip="isStopping ? ui.stopping : ui.stop"
            :aria-label="isStopping ? ui.stopping : ui.stop"
            :disabled="isStopping"
            @click="handleStop"
          >
            <i :class="isStopping ? 'bi bi-hourglass-split' : 'bi bi-stop-fill'"></i>
            <span>{{ isStopping ? ui.stopping : ui.stop }}</span>
          </button>
        </div>
      </div>
    </LiquidSurface>
    <div class="oc-composer-hint"><span><kbd>Enter</kbd> {{ ui.sendHint }}</span><span><kbd>Shift + Enter</kbd> {{ ui.newlineHint }}</span></div>
    </div>
  </div>
</template>

<style>
@import 'highlight.js/styles/github-dark.css';

.oc-chat {
  --background-base: var(--prism-surface-raised);
  --background-weak: var(--vscode-bg-light);
  --text-base: var(--vscode-fg);
  --text-strong: var(--vscode-fg);
  --text-weak: var(--vscode-fg-muted);
  --surface-base: var(--prism-control);
  --surface-base-hover: var(--vscode-bg-lighter);
  --surface-inset-base: var(--vscode-bg-input);
  --surface-raised-base: var(--prism-surface);
  --surface-interactive-weak: color-mix(in srgb, var(--vscode-accent) 12%, transparent);
  --text-interactive-base: var(--vscode-accent);
  --text-success-base: var(--vscode-success);
  --surface-success-strong: var(--vscode-success);
  --surface-success-weak: color-mix(in srgb, var(--vscode-success) 12%, transparent);
  --text-critical-base: var(--vscode-error);
  --surface-critical-base: var(--vscode-error);
  --text-on-critical-base: var(--vscode-button-foreground);
  --font-family-sans: var(--prism-font);
  --font-family-mono: 'Cascadia Code', Consolas, monospace;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  background: var(--background-base);
  color: var(--text-base);
  font-family: var(--font-family-sans);
}

.oc-messages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 20px 24px;
  scroll-behavior: smooth;
}

.oc-connection-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--prism-info-bg);
  border: 1px solid color-mix(in srgb, var(--prism-info) 22%, transparent);
}

.oc-connection-banner-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.oc-connection-banner-name {
  color: var(--text-base);
  font-size: var(--prism-font-13);
  font-weight: 600;
}

.oc-connection-banner-host {
  color: var(--text-weak);
  font-size: var(--prism-font-12);
  word-break: break-all;
}

.oc-connection-banner-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.oc-connection-banner-label {
  color: var(--text-interactive-base);
  font-size: var(--prism-font-11);
}

.oc-connection-banner-id {
  padding: 2px 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--prism-text) 8%, transparent);
  color: var(--text-base);
  font-size: var(--prism-font-11);
  font-family: 'Consolas', 'Monaco', monospace;
}

.oc-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  text-align: center;
  color: var(--text-weak);
}

.oc-empty-icon {
  color: var(--text-weak);
  margin-bottom: 16px;
}
.oc-empty-icon svg {
  opacity: 0.5;
}
.oc-empty-title {
  font-size: var(--prism-font-18);
  font-weight: 600;
  color: var(--text-strong);
  margin-bottom: 8px;
}
.oc-empty-text {
  font-size: var(--prism-font-14);
  min-height: 24px;
}

.oc-empty-hint {
  margin-top: 16px;
  font-size: var(--prism-font-12);
  background: var(--surface-base);
  padding: 8px 16px;
  border-radius: 20px;
}

.oc-empty-hint kbd {
  color: var(--text-base);
  background: var(--surface-inset-base);
  padding: 2px 6px;
  border-radius: var(--prism-radius-small);
  font-family: inherit;
  font-size: var(--prism-font-11);
}

.oc-message-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.oc-load-more {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  color: var(--text-weak);
  font-size: var(--prism-font-12);
}

.oc-loading-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid var(--surface-base);
  border-top-color: var(--text-interactive-base);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.oc-turn {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 16px;
  margin: -12px -16px;
  border-radius: 12px;
  transition: background 0.15s ease;
  user-select: text;
  -webkit-user-select: text;
}

.oc-turn:hover {
  background: var(--surface-base);
}
.oc-turn.collapsed {
  cursor: pointer;
}
.oc-turn.working {
  background: var(--surface-base-hover);
}

.oc-turn-header {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 20px;
}

.oc-collapse-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: none;
  background: transparent;
  color: var(--text-weak);
  cursor: pointer;
  border-radius: var(--prism-radius-small);
  transition: background-color var(--prism-duration) var(--prism-ease), border-color var(--prism-duration) var(--prism-ease), color var(--prism-duration) var(--prism-ease), opacity var(--prism-duration) var(--prism-ease), transform var(--prism-duration) var(--prism-ease);
}

.oc-collapse-button:hover {
  background: var(--surface-base-hover);
  color: var(--text-base);
}
.oc-collapse-button svg.expanded {
  transform: rotate(180deg);
}

.oc-turn-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--prism-font-11);
  flex: 1;
}
.oc-turn-role {
  font-weight: 500;
  color: var(--text-strong);
  text-transform: capitalize;
}
.oc-turn-time {
  color: var(--text-weak);
}
.oc-model-badge {
  font-size: var(--prism-font-9);
  background: var(--surface-interactive-weak);
  color: var(--text-interactive-base);
  padding: 2px 6px;
  border-radius: 10px;
  font-weight: 500;
}

.oc-turn-badge {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--prism-font-10);
  font-weight: 500;
  padding: 3px 8px;
  border-radius: 12px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
.oc-badge-success {
  background: var(--surface-success-weak);
  color: var(--surface-success-strong);
}
.oc-badge-info {
  background: var(--surface-interactive-weak);
  color: var(--text-interactive-base);
}
.oc-badge-spinner {
  width: 8px;
  height: 8px;
  border: 1.5px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

.oc-turn-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-left: 0;
}

.oc-user-message {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.oc-user-text {
  flex: 1;
}

.oc-copy-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  color: var(--text-weak);
  cursor: pointer;
  border-radius: var(--prism-radius-control);
  transition: background-color var(--prism-duration) var(--prism-ease), border-color var(--prism-duration) var(--prism-ease), color var(--prism-duration) var(--prism-ease), opacity var(--prism-duration) var(--prism-ease), transform var(--prism-duration) var(--prism-ease);
  opacity: 0;
  margin-top: 2px;
}

.oc-user-message:hover .oc-copy-button {
  opacity: 1;
}
.oc-copy-button:hover {
  background: var(--surface-base);
  color: var(--text-base);
}

.oc-markdown {
  font-size: var(--prism-font-14);
  line-height: 1.6;
  color: var(--text-base);
  user-select: text;
  -webkit-user-select: text;
}
.oc-markdown p {
  margin: 6px 0;
}
.oc-markdown p:first-child {
  margin-top: 0;
}
.oc-markdown pre {
  background: var(--surface-inset-base);
  padding: 10px 14px;
  border-radius: var(--prism-radius-control);
  overflow-x: auto;
  margin: 10px 0;
  font-family: var(--font-family-mono);
  font-size: var(--prism-font-12);
  line-height: 1.5;
}
.oc-markdown code {
  font-family: var(--font-family-mono);
  font-size: var(--prism-font-12);
  background: var(--surface-inset-base);
  padding: 2px 5px;
  border-radius: var(--prism-radius-small);
}
.oc-markdown pre code {
  background: transparent;
  padding: 0;
}
.oc-markdown ul,
.oc-markdown ol {
  padding-left: 18px;
  margin: 8px 0;
}

.oc-analysis-text {
  margin-bottom: 8px;
  color: var(--text-weak);
}

.oc-analysis-block {
  margin-bottom: 8px;
  border: 1px solid var(--surface-base);
  border-radius: 10px;
  background: color-mix(in srgb, var(--prism-text) 2%, transparent);
}

.oc-analysis-block summary {
  cursor: pointer;
  padding: 8px 12px;
  font-size: var(--prism-font-12);
  color: var(--text-weak);
  user-select: none;
}

.oc-analysis-block .oc-analysis-text {
  padding: 0 12px 12px;
  margin-bottom: 0;
}

.oc-todos {
  background: var(--surface-base);
  border: 1px solid var(--surface-base);
  border-radius: 10px;
  overflow: hidden;
}
.oc-todos-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: var(--surface-base-hover);
  font-size: var(--prism-font-11);
  font-weight: 500;
  color: var(--text-weak);
  border-bottom: 1px solid var(--surface-base);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.oc-todos-list {
  padding: 6px;
}
.oc-todo-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border-radius: var(--prism-radius-control);
  transition: background 0.15s ease;
}
.oc-todo-item:hover {
  background: var(--surface-base-hover);
}
.oc-todo-item.completed {
  opacity: 0.5;
}
.oc-todo-checkbox {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  color: var(--text-success-base);
}
.oc-todo-content {
  font-size: var(--prism-font-12);
  color: var(--text-base);
}
.oc-todo-item.completed .oc-todo-content {
  text-decoration: line-through;
}

.oc-tools {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.oc-tool {
  border: 1px solid var(--surface-base);
  border-radius: 10px;
  overflow: hidden;
  transition: background-color var(--prism-duration) var(--prism-ease), border-color var(--prism-duration) var(--prism-ease), color var(--prism-duration) var(--prism-ease), opacity var(--prism-duration) var(--prism-ease), transform var(--prism-duration) var(--prism-ease);
}
.oc-tool.expanded {
  border-color: var(--surface-raised-base);
}
.oc-tool.running {
  border-left: 3px solid var(--text-interactive-base);
}
.oc-tool.completed {
  border-left: 3px solid var(--text-success-base);
}
.oc-tool.has-error {
  border-left: 3px solid var(--text-critical-base);
}

.oc-tool-error-card {
  display: flex;
  gap: 10px;
  padding: 10px 14px;
  background: var(--surface-critical-base);
  color: var(--text-on-critical-base);
}
.oc-error-icon {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.oc-error-content {
  flex: 1;
  min-width: 0;
}
.oc-error-title {
  font-size: var(--prism-font-12);
  font-weight: 500;
  margin-bottom: 2px;
}
.oc-error-message {
  font-size: var(--prism-font-11);
  opacity: 0.9;
  word-break: break-word;
}

.oc-tool-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  background: var(--surface-base);
  transition: background 0.15s ease;
}
.oc-tool-trigger:hover {
  background: var(--surface-base-hover);
}
.oc-tool-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  color: var(--text-weak);
}
.oc-tool-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.oc-tool-title {
  font-size: var(--prism-font-12);
  font-weight: 500;
  color: var(--text-base);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.oc-tool-subtitle {
  font-size: var(--prism-font-11);
  color: var(--text-weak);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.oc-tool-status {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--prism-font-10);
  font-weight: 500;
  text-transform: capitalize;
  flex-shrink: 0;
}
.oc-tool-status.pending {
  color: var(--text-weak);
}
.oc-tool-status.running {
  color: var(--text-interactive-base);
}
.oc-tool-status.completed {
  color: var(--text-success-base);
}
.oc-tool-status.error {
  color: var(--text-critical-base);
}
.oc-status-dot {
  width: 6px;
  height: 6px;
  background: currentColor;
  border-radius: 50%;
  animation: pulse 1.2s infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}

.oc-chevron {
  color: var(--text-weak);
  transition: transform 0.15s ease;
  flex-shrink: 0;
}
.oc-chevron.expanded {
  transform: rotate(180deg);
}

.oc-tool-content {
  background: var(--surface-raised-base);
  border-top: 1px solid var(--surface-base);
  max-height: 300px;
  overflow-y: auto;
}
.oc-tool-input,
.oc-tool-output {
  padding: 10px 14px;
}
.oc-tool-input {
  border-bottom: 1px solid var(--surface-base);
}
.oc-tool-input pre,
.oc-tool-output-content {
  background: var(--surface-inset-base);
  padding: 10px;
  border-radius: var(--prism-radius-control);
  margin: 6px 0 0;
  font-family: var(--font-family-mono);
  font-size: var(--prism-font-11);
  color: var(--text-base);
  overflow-x: auto;
  white-space: pre-wrap;
}
.oc-tool-output-content {
  color: var(--text-base);
  user-select: text;
  -webkit-user-select: text;
}
.oc-tool-section-label {
  font-size: var(--prism-font-10);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-weak);
  margin-bottom: 2px;
}

.oc-diffs {
  background: var(--surface-base);
  border: 1px solid var(--surface-base);
  border-radius: 10px;
  overflow: hidden;
  margin-top: 8px;
}
.oc-diffs-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: var(--surface-base-hover);
  font-size: var(--prism-font-11);
  font-weight: 500;
  color: var(--text-weak);
  border-bottom: 1px solid var(--surface-base);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.oc-diff-item {
  padding: 8px 12px;
  border-bottom: 1px solid var(--surface-base);
}
.oc-diff-item:last-child {
  border-bottom: none;
}
.oc-diff-file {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--prism-font-11);
  color: var(--text-base);
}
.oc-diff-path {
  font-family: var(--font-family-mono);
}

.oc-response {
  background: var(--surface-base);
  border: 1px solid var(--surface-base);
  border-radius: 10px;
  overflow: hidden;
  margin-top: 8px;
}
.oc-response-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: var(--surface-base-hover);
  border-bottom: 1px solid var(--surface-base);
}
.oc-response-title {
  font-size: var(--prism-font-11);
  font-weight: 500;
  color: var(--text-weak);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.oc-response-content {
  padding: 12px 14px;
  font-size: var(--prism-font-13);
  user-select: text;
  -webkit-user-select: text;
}

.oc-error {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--surface-critical-base);
  color: var(--text-on-critical-base);
  padding: 10px 14px;
  margin: 0 16px 8px;
  border-radius: var(--prism-radius-control);
  font-size: var(--prism-font-12);
}
.oc-error-icon {
  display: flex;
  align-items: center;
}

.oc-input-wrapper {
  padding: 0;
  background: var(--background-weak);
  border-top: 1px solid var(--surface-base);
  display: flex;
  flex-direction: column;
  gap: 0;
}
.oc-input-container {
  display: flex;
  background: var(--surface-raised-base);
  border: 1px solid transparent;
  border-radius: 12px;
  padding: 8px 10px;
  min-height: 56px;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}
.oc-input-container:focus-within {
  border-color: transparent;
  box-shadow: none;
}
.oc-input {
  flex: 1;
  display: block;
  background: transparent;
  border: none;
  color: var(--text-base);
  -webkit-text-fill-color: var(--text-base);
  caret-color: var(--text-interactive-base);
  opacity: 1;
  padding: 0;
  resize: none;
  font-size: var(--prism-font-14);
  font-family: inherit;
  line-height: 1.35;
  min-height: 48px;
  height: 48px;
  max-height: 104px;
  overflow-y: hidden;
  box-sizing: border-box;
}

.oc-input-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 28px;
  width: 100%;
  box-sizing: border-box;
  padding: 0 10px 6px;
}

.oc-input-actions-left,
.oc-input-actions-right {
  display: flex;
  align-items: center;
}

.oc-action-menu {
  position: relative;
}

.oc-action-menu::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 100%;
  height: 8px;
}

.oc-action-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 10px;
  border: none;
  border-radius: var(--prism-radius-control);
  background: color-mix(in srgb, var(--prism-text) 6%, transparent);
  color: var(--text-weak);
  cursor: pointer;
  transition: background-color var(--prism-duration) var(--prism-ease), border-color var(--prism-duration) var(--prism-ease), color var(--prism-duration) var(--prism-ease), opacity var(--prism-duration) var(--prism-ease), transform var(--prism-duration) var(--prism-ease);
}

.oc-action-menu-popover {
  position: absolute;
  left: 0;
  bottom: 100%;
  min-width: 132px;
  padding: 6px;
  border-radius: 14px;
  background: var(--prism-surface);
  border: 1px solid var(--liquid-rim);
  box-shadow: var(--prism-shadow);
  display: flex;
  flex-direction: column;
  gap: 2px;
  z-index: 20;
  backdrop-filter: blur(24px) saturate(1.3);
}

.oc-action-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 32px;
  padding: 0 10px;
  border: none;
  border-radius: var(--prism-radius-control);
  background: transparent;
  color: var(--text-base);
  font-size: var(--prism-font-12);
  cursor: pointer;
  text-align: left;
}

.oc-action-menu-item:hover {
  background: color-mix(in srgb, var(--prism-text) 6%, transparent);
}

.oc-action-menu-item i {
  font-size: var(--prism-font-13);
  color: var(--text-weak);
}

.oc-action-button:hover {
  background: color-mix(in srgb, var(--prism-text) 12%, transparent);
  color: var(--text-base);
}

.oc-action-button i {
  font-size: var(--prism-font-13);
  line-height: 1;
}

.oc-action-button span {
  font-size: var(--prism-font-12);
}
.oc-input:focus {
  outline: none;
  background: transparent;
  background-color: transparent;
  color: var(--text-base);
  -webkit-text-fill-color: var(--text-base);
}
.oc-input::placeholder {
  color: var(--text-weak);
  -webkit-text-fill-color: var(--text-weak);
  opacity: 1;
  transition: opacity 0.2s;
}
.oc-input:focus::placeholder {
  opacity: 1;
}
.oc-send-button {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: var(--prism-radius-control);
  background: color-mix(in srgb, var(--prism-text) 6%, transparent);
  color: var(--text-base);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color var(--prism-duration) var(--prism-ease), border-color var(--prism-duration) var(--prism-ease), color var(--prism-duration) var(--prism-ease), opacity var(--prism-duration) var(--prism-ease), transform var(--prism-duration) var(--prism-ease);
  flex-shrink: 0;
}
.oc-send-button:hover:not(:disabled) {
  background: var(--surface-base-hover);
  color: var(--text-base);
}
.oc-send-button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  transform: none;
}
.oc-send-button i {
  font-size: var(--prism-font-14);
  line-height: 1;
}
.oc-btn-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid color-mix(in srgb, currentColor 30%, transparent);
  border-top-color: var(--vscode-button-foreground);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}
.oc-stop-button {
  background: var(--prism-danger-bg);
  color: var(--prism-danger);
}
.oc-stop-button.is-stopping {
  gap: 6px;
  min-width: 92px;
}
.oc-stop-button:hover {
  background: color-mix(in srgb, var(--prism-danger) 20%, transparent);
  color: var(--prism-danger);
}
.oc-stop-button:disabled {
  opacity: 0.8;
  cursor: wait;
}

.oc-input-hint {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: var(--prism-font-10);
  color: var(--text-weak);
  line-height: 1.2;
}
.oc-hint-divider {
  opacity: 0.5;
}
</style>

<style src="./chat-workspace.css"></style>
