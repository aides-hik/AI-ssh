<template>
  <footer
    class="vscode-statusbar text-vscode-fg h-6 flex items-center justify-between text-xs select-none"
  >
    <!-- 左侧状态信息 -->
    <div class="flex items-center"></div>

    <!-- 中央消息区域 -->
    <div class="flex-1 px-4">
      <span v-if="currentMessage" class="text-center block">{{ currentMessage }}</span>
    </div>

    <!-- 右侧信息 -->
    <div class="flex items-center">
      <!-- 系统资源 -->
      <div
        v-if="cpuUsage !== null || memoryUsage !== null"
        class="statusbar-item"
        @click="showSystemInfo"
      >
        <span v-if="cpuUsage !== null">CPU: {{ cpuUsage }}%</span>
        <span v-if="memoryUsage !== null" :class="{ 'ml-2': cpuUsage !== null }"
          >内存: {{ memoryUsage }}MB</span
        >
      </div>
      <span v-else class="statusbar-context">本地工作空间</span>

      <!-- 通知图标 -->
      <div v-if="hasNotifications" class="statusbar-item" @click="showNotifications">
        <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 16 16">
          <path
            d="M8 16a2 2 0 0 0 2-2H6a2 2 0 0 0 2 2zM8 1.918l-.797.161A4.002 4.002 0 0 0 4 6c0 .628-.134 2.197-.459 3.742-.16.767-.376 1.566-.663 2.258h10.244c-.287-.692-.502-1.49-.663-2.258C12.134 8.197 12 6.628 12 6a4.002 4.002 0 0 0-3.203-3.92L8 1.917zM14.22 12c.223.447.481.801.78 1H1c.299-.199.557-.553.78-1C2.68 10.2 3 6.88 3 6c0-2.42 1.72-4.44 4.005-4.901a1 1 0 1 1 1.99 0A5.002 5.002 0 0 1 13 6c0 .88.32 4.2 1.22 6z"
          />
        </svg>
      </div>
    </div>
  </footer>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

// 响应式数据
const currentMessage = ref('')
const memoryUsage = ref<number | null>(null)
const cpuUsage = ref<number | null>(null)
const networkStatus = ref<'online' | 'offline'>('online')

// 状态栏相关数据
const errors = ref(0)
const warnings = ref(0)
const hasNotifications = ref(false)

// 安全访问器
const getWindow = (): Window | null => {
  return typeof window !== 'undefined' ? window : null
}

const getNavigator = (): Navigator | null => {
  return typeof navigator !== 'undefined' ? navigator : null
}

interface SystemSnapshot {
  totalMemory?: number
  freeMemory?: number
  memory?: { used?: number }
  cpu?: { usage?: number }
}

// 定时器
let systemTimer: NodeJS.Timeout | null = null
let messageTimer: ReturnType<typeof setTimeout> | null = null
let sampleInFlight = false
let mounted = false
let removeStatusListener: (() => void) | undefined
let removeNotificationListener: (() => void) | undefined

const showSystemInfo = () => {
  const resources = [
    cpuUsage.value === null ? '' : `CPU: ${cpuUsage.value}%`,
    memoryUsage.value === null ? '' : `内存: ${memoryUsage.value}MB`
  ].filter(Boolean)
  showMessage(resources.length ? `本机系统资源 - ${resources.join('，')}` : '本地工作空间', 3000)
}

const showNotifications = () => {
  showMessage(hasNotifications.value ? '已收到新通知' : '暂无新通知', 2000)
}

// 更新系统信息
const updateSystemInfo = async () => {
  if (sampleInFlight) return
  const win = getWindow()
  if (typeof win?.electronAPI?.getSystemInfo !== 'function') {
    memoryUsage.value = null
    cpuUsage.value = null
    return
  }
  sampleInFlight = true
  try {
    const info: SystemSnapshot | null = await win.electronAPI.getSystemInfo()
    if (!mounted) return
    const total = info?.totalMemory
    const free = info?.freeMemory
    const used =
      typeof total === 'number' &&
      Number.isFinite(total) &&
      total > 0 &&
      typeof free === 'number' &&
      Number.isFinite(free) &&
      free >= 0 &&
      free <= total
        ? total - free
        : info?.memory?.used
    memoryUsage.value =
      typeof used === 'number' && Number.isFinite(used) && used >= 0
        ? Math.round(used / 1024 / 1024)
        : null
    // The current system snapshot has a CPU count, not CPU utilisation.
    // Only display usage if the bridge explicitly provides a measured value.
    const usage = info?.cpu?.usage
    cpuUsage.value =
      typeof usage === 'number' && Number.isFinite(usage) && usage >= 0 && usage <= 100
        ? Math.round(usage)
        : null
  } catch {
    if (mounted) {
      memoryUsage.value = null
      cpuUsage.value = null
    }
  } finally {
    sampleInFlight = false
  }
}

// 更新网络状态
const updateNetworkStatus = () => {
  const nav = getNavigator()
  if (nav) {
    networkStatus.value = nav.onLine ? 'online' : 'offline'
  }
}

// 显示临时消息
const showMessage = (message: string, duration: number = 3000) => {
  currentMessage.value = message
  if (messageTimer) clearTimeout(messageTimer)
  messageTimer = setTimeout(() => {
    currentMessage.value = ''
    messageTimer = null
  }, duration)
}

onMounted(() => {
  mounted = true
  // 初始化系统信息
  updateSystemInfo()
  updateNetworkStatus()

  // 启动定时器
  const win = getWindow()
  if (typeof win?.electronAPI?.getSystemInfo === 'function') {
    systemTimer = setInterval(updateSystemInfo, 10000) // 每10秒更新一次真实本机快照
  }

  // 监听网络状态变化
  if (win) {
    win.addEventListener('online', updateNetworkStatus)
    win.addEventListener('offline', updateNetworkStatus)
  }

  // 监听来自主进程的状态更新
  if (typeof win?.electronAPI?.onStatusUpdate === 'function') {
    removeStatusListener = win.electronAPI.onStatusUpdate(
      (status: { message?: string; errors?: number; warnings?: number }) => {
        if (status.message) showMessage(status.message)
        if (status.errors !== undefined) errors.value = status.errors
        if (status.warnings !== undefined) warnings.value = status.warnings
      }
    )
  }
  if (typeof win?.electronAPI?.onNotification === 'function') {
    removeNotificationListener = win.electronAPI.onNotification(() => {
      hasNotifications.value = true
    })
  }
})

onUnmounted(() => {
  mounted = false
  // 清理定时器
  if (systemTimer) clearInterval(systemTimer)
  if (messageTimer) clearTimeout(messageTimer)
  removeStatusListener?.()
  removeNotificationListener?.()

  // 清理事件监听器
  const win = getWindow()
  if (win) {
    win.removeEventListener('online', updateNetworkStatus)
    win.removeEventListener('offline', updateNetworkStatus)
  }
})

// 暴露给父组件的方法
defineExpose({
  showMessage,
  updateProblems: (errorCount: number, warningCount: number) => {
    errors.value = errorCount
    warnings.value = warningCount
  }
})
</script>

<style scoped>
.vscode-statusbar {
  font-family: 'Segoe UI', 'Consolas', monospace;
  font-size: 12px;
  user-select: none;
  border-top: 1px solid var(--vscode-border);
  background-color: var(--vscode-bg-light) !important;
  color: var(--vscode-fg);
}

.statusbar-item {
  padding: 0.25rem 0.5rem;
  cursor: pointer;
  transition: background-color 120ms ease-out;
  display: flex;
  align-items: center;
  min-height: 22px;
  border-right: 1px solid transparent;
}

.statusbar-context {
  padding: 0 8px;
  color: var(--vscode-fg-muted);
}

.statusbar-item:hover {
  background-color: var(--vscode-bg-lighter);
}

.statusbar-item:active {
  background-color: var(--vscode-bg-lighter);
}

/* 状态指示器动画 */
.w-2.h-2 {
  transition: all 0.3s ease;
}

/* 连接状态特殊样式 */
.animate-pulse {
  animation: vscode-pulse 1.5s infinite;
}

@keyframes vscode-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}

/* SVG 图标样式 */
.statusbar-item svg {
  flex-shrink: 0;
}

/* 错误和警告颜色 */
.text-red-400 {
  color: var(--vscode-error);
}

.text-yellow-400 {
  color: var(--vscode-warning);
}

.text-green-400 {
  color: var(--vscode-success);
}

/* 暗色文本 */
.text-vscode-statusbar-text-dim {
  color: var(--vscode-fg);
  opacity: 0.7;
}

/* 响应式调整 */
@media (max-width: 1200px) {
  .statusbar-item {
    padding-left: 0.25rem;
    padding-right: 0.25rem;
  }

  .statusbar-item span {
    font-size: 11px;
  }
}

@media (max-width: 800px) {
  .statusbar-item:not(.statusbar-item:first-child):not(.statusbar-item:last-child) {
    display: none;
  }
}
</style>
