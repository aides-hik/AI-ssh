<template>
  <div
    class="vscode-app liquid-app"
    :data-motion="theme.animations.value ? 'on' : 'off'"
    :data-sidebar-layout="isSidebarLayoutAnimating ? 'settling' : 'stable'"
  >
    <div class="liquid-wallpaper" aria-hidden="true">
      <svg viewBox="0 0 1400 800" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="app-flow-blue" x1="0" x2="1" y1="0" y2="1">
            <stop stop-color="#d3e0f4" />
            <stop offset=".48" stop-color="#649be8" />
            <stop offset="1" stop-color="#dcf7f5" />
          </linearGradient>
          <linearGradient id="app-flow-pink" x1="0" x2="1">
            <stop stop-color="#bdd2f0" />
            <stop offset="1" stop-color="#f2dae7" />
          </linearGradient>
        </defs>
        <path
          d="M-140 710C125 810 168 370 478 445S882 971 1588 499"
          fill="none"
          stroke="url(#app-flow-blue)"
          stroke-width="160"
        />
        <path
          d="M-120 585C128 691 170 293 474 370S884 890 1580 419"
          fill="none"
          stroke="#fff"
          stroke-opacity=".68"
          stroke-width="3"
        />
        <path
          d="M522-230C1155-162 617 226 1009 268S1390 66 1635 176"
          fill="none"
          stroke="url(#app-flow-pink)"
          stroke-width="145"
        />
        <path
          d="M553-165C1152-90 667 174 1007 205S1386 9 1616 113"
          fill="none"
          stroke="#fff"
          stroke-opacity=".75"
          stroke-width="2"
        />
        <path
          d="M-55 743C222 834 211 410 490 494S916 1010 1512 601"
          fill="none"
          stroke="#effaff"
          stroke-opacity=".7"
          stroke-width="2"
        />
      </svg>
    </div>

    <AppTitleBar v-if="!isFullscreen" />

    <div class="liquid-workbench">
      <Transition name="sidebar-scrim">
        <button
          v-if="showSidebar"
          type="button"
          class="sidebar-scrim"
          aria-label="收起连接列表"
          @click="showSidebar = false"
        ></button>
      </Transition>
      <div
        ref="sidebarRegion"
        class="liquid-sidebar-region"
        :data-open="showSidebar"
        :data-resizing="isResizing"
        :style="{ '--sidebar-width': sidebarWidth + 'px' }"
        :inert="!showSidebar"
        :aria-hidden="!showSidebar || undefined"
        @transitionrun="onSidebarLayoutTransition"
        @transitionend="onSidebarLayoutTransition"
        @transitioncancel="onSidebarLayoutTransition"
      >
        <LiquidSurface
          as="aside"
          id="connection-sidebar"
          class="vscode-sidebar liquid-sidebar"
          :radius="22"
          :strength="48"
          :blur="0.45"
          :interactive="false"
          :motion="theme.animations.value"
          aria-label="SSH 连接"
        >
          <AppSidebar :active-view="activeView" />
        </LiquidSurface>
        <div
          class="vscode-splitter vscode-splitter-vertical"
          role="separator"
          aria-label="调整连接列表宽度"
          aria-orientation="vertical"
          :aria-valuenow="sidebarWidth"
          :aria-valuemin="200"
          :aria-valuemax="600"
          tabindex="0"
          @keydown.left.prevent="sidebarWidth = Math.max(200, sidebarWidth - 20)"
          @keydown.right.prevent="sidebarWidth = Math.min(600, sidebarWidth + 20)"
          @mousedown="startLeftResize"
        ></div>
      </div>

      <div class="liquid-editor">
        <LiquidSurface
          class="liquid-toolbar"
          :radius="18"
          :blur="0.25"
          :strength="44"
          :interactive="false"
        >
          <button
            ref="sidebarToggle"
            class="sidebar-toggle liquid-icon-button"
            :aria-expanded="showSidebar"
            aria-controls="connection-sidebar"
            :data-prism-tooltip="showSidebar ? '收起连接列表 (Ctrl+B)' : '展开连接列表 (Ctrl+B)'"
            aria-label="切换连接列表"
            @click="showSidebar = !showSidebar"
          >
            <i class="bi bi-layout-sidebar" aria-hidden="true"></i>
          </button>
          <div
            class="vscode-tab-bar"
            role="tablist"
            aria-label="打开的页面"
            @keydown="handleTabKeydown"
          >
            <div
              v-for="tab in openTabs"
              :key="tab.id"
              class="vscode-tab"
              :class="{ active: activeTab === tab.id }"
              @mousedown.middle.prevent="closeTab(tab.id)"
            >
              <button
                class="liquid-tab-trigger"
                role="tab"
                :id="`workspace-tab-${tab.id}`"
                aria-controls="workspace-content"
                :tabindex="activeTab === tab.id ? 0 : -1"
                :aria-selected="activeTab === tab.id"
                @click="setActiveTab(tab.id)"
              >
                <i :class="tab.icon" aria-hidden="true"></i>
                <span>{{ tab.name }}</span>
              </button>
              <button
                v-if="openTabs.length > 1"
                class="vscode-tab-close"
                :aria-label="'关闭 ' + tab.name"
                @click="closeTab(tab.id)"
              >
                <i class="bi bi-x" aria-hidden="true"></i>
              </button>
            </div>
          </div>
          <button
            class="liquid-icon-button liquid-add-connection"
            data-prism-tooltip="新建连接"
            aria-label="新建连接"
            @click="createConnection"
          >
            <i class="bi bi-plus-lg" aria-hidden="true"></i>
          </button>
        </LiquidSurface>

        <main
          id="workspace-content"
          class="liquid-content"
          role="tabpanel"
          :aria-labelledby="`workspace-tab-${activeTab}`"
        >
          <router-view v-slot="{ Component, route }">
            <keep-alive>
              <component :is="Component" :key="getRouteKey(route)" />
            </keep-alive>
          </router-view>
        </main>
      </div>
    </div>

    <footer class="liquid-bottom">
      <WorkspaceDock
        :connected="Boolean(sessionTab)"
        :active="dockDestination"
        :motion="theme.animations.value"
        @navigate="navigateDock"
      />
      <AppStatusBar v-if="!isFullscreen" />
    </footer>
    <GlobalModals />
    <NotificationContainer />
    <PrismTooltip />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, provide, computed, watch, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import type { RouteLocationNormalizedLoaded } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useApp } from '@/composables/useApp'
import { useTheme } from '@/composables/useTheme'
import { useUpdateClient } from '@/services/update-client'
import AppTitleBar from '@/components/layout/AppTitleBar.vue'
import AppSidebar from '@/components/layout/AppSidebar.vue'
import AppStatusBar from '@/components/layout/AppStatusBar.vue'
import WorkspaceDock from '@/components/layout/WorkspaceDock.vue'
import { useConnectedSessions } from '@/composables/useConnectedSessions'
import { pickConnectedWorkspaceTab } from '@/utils/workspace-sessions'
import GlobalModals from '@/components/common/GlobalModals.vue'
import NotificationContainer from '@/components/common/NotificationContainer.vue'
import PrismTooltip from '@/components/common/PrismTooltip.vue'
import LiquidSurface from '@/components/common/LiquidSurface.vue'
import { clearRetiredAccountSession } from '@/utils/standalone-providers'

clearRetiredAccountSession()

const router = useRouter()
const route = useRoute()
const app = useApp()
const theme = useTheme()
const { connections: connectedSessions } = useConnectedSessions()
const updater = useUpdateClient()
const { t: $t } = useI18n()

// 响应式数据
const isFullscreen = ref(false)
const showSidebar = ref(true)
const sidebarRegion = ref<HTMLElement | null>(null)
const sidebarToggle = ref<HTMLButtonElement | null>(null)
const isSidebarLayoutAnimating = ref(false)
let sidebarLayoutFrame = 0
let sidebarLayoutTimer: ReturnType<typeof setTimeout> | undefined
const activeView = ref('ssh')
const activeTab = ref('ssh')
const lastSessionTabId = ref('')

// 打开的标签列表（本地状态）
const openTabsList = ref<Array<{ id: string; name: string; icon: string; path: string }>>([
  { id: 'ssh', name: '', icon: 'bi bi-hdd-network', path: '/ssh' }
])

// 面板尺寸
const sidebarWidth = ref(248) // 默认256px

// 拖拽状态
const isResizing = ref(false)
const resizeType = ref<'left' | null>(null)
const startX = ref(0)
const startWidth = ref(0)
let panelResizeFrame = 0
let pendingPanelWidth: number | undefined

// 打开的标签 - 更新 name 为国际化的
const openTabs = computed(() =>
  openTabsList.value.map(tab => ({
    ...tab,
    name:
      tab.id === 'ssh'
        ? $t('ssh.sshConnection')
        : tab.id === 'settings'
          ? $t('common.settings')
          : tab.name
  }))
)

// 当前激活的标签 ID

// 方法
const setActiveView = (viewId: string) => {
  activeView.value = viewId

  // SSH 视图只切换侧边栏，不打开新 tab
  if (viewId === 'ssh') {
    return
  }

  // 定义路由和标签信息映射
  const viewConfigs: Record<string, { path: string; name: string; icon: string }> = {
    ssh: { path: '/ssh', name: $t('ssh.sshConnection'), icon: 'bi bi-hdd-network' }
  }

  const config = viewConfigs[viewId]
  if (config) {
    // 在新标签中打开或切换到已存在的标签
    openNewTab(viewId, config.name, config.icon, config.path)
  }
}

const setActiveTab = (tabId: string) => {
  activeTab.value = tabId
  const tab = openTabs.value.find(t => t.id === tabId)
  if (tab && tab.path) {
    // 路由跳转到对应页面
    router.push(tab.path)
  }
}

const handleTabKeydown = (event: KeyboardEvent) => {
  if (!(event.target instanceof HTMLElement) || event.target.getAttribute('role') !== 'tab') return
  const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End']
  if (!keys.includes(event.key)) return
  event.preventDefault()
  const tabs = Array.from(
    (event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('[role="tab"]')
  )
  const index = tabs.indexOf(event.target as HTMLButtonElement)
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? tabs.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
  tabs[next]?.focus()
  tabs[next]?.click()
}

const closeTab = (tabId: string) => {
  const index = openTabsList.value.findIndex(t => t.id === tabId)
  if (index === -1) {
    return
  }

  // 如果只剩一个 tab，不允许关闭
  if (openTabsList.value.length === 1) {
    return
  }

  // 记录当前激活的标签
  const wasActive = activeTab.value === tabId

  // 正常关闭 tab
  openTabsList.value.splice(index, 1)

  if (wasActive) {
    // 切换到相邻标签
    const newIndex = Math.min(index, openTabsList.value.length - 1)
    const newTab = openTabsList.value[newIndex]

    activeTab.value = newTab.id
    // 路由跳转到新激活的标签页面
    router
      .push(newTab.path)
      .then(() => {})
      .catch(_err => {})
  }
}

// 打开新标签的方法
const openNewTab = (id: string, name: string, icon: string, path: string) => {
  // 检查标签是否已经存在
  const existingTab = openTabs.value.find(t => t.id === id)
  if (existingTab) {
    // 如果标签已存在，直接激活它
    activeTab.value = id

    // 如果路径不同，强制跳转路由（确保 query 参数生效）
    existingTab.path = path
    router.push(path)
    return
  }

  // 创建新标签
  const newTab = { id, name, icon, path }
  openTabsList.value.push(newTab)

  // 激活新标签
  activeTab.value = id
  router.push(path)
}

const openSettings = (section?: string | Event) => {
  // 打开设置页面 - 在新标签中打开

  const path =
    typeof section === 'string' ? `/settings?section=${encodeURIComponent(section)}` : '/settings'
  openNewTab('settings', $t('common.settings'), 'bi bi-gear', path)
}

const createConnection = async () => {
  showSidebar.value = true
  await nextTick()
  window.dispatchEvent(new CustomEvent('ssh-create-connection'))
}

// Reuse the current SSH session when moving between terminal and files.
const sessionTab = computed(() =>
  pickConnectedWorkspaceTab(
    openTabsList.value,
    connectedSessions.value,
    activeTab.value,
    lastSessionTabId.value
  )
)

const dockDestination = computed(() => {
  if (route.path === '/terminal') return 'terminal'
  if (route.path === '/file-manager') return 'files'
  if (route.path === '/settings') return 'settings'
  return 'home'
})

const navigateDock = (destination: 'home' | 'terminal' | 'files' | 'settings') => {
  if (destination === 'home')
    openNewTab('ssh', $t('ssh.sshConnection'), 'bi bi-hdd-network', '/ssh')
  else if (destination === 'settings') openSettings()
  else openSessionView(destination === 'files' ? 'file-manager' : 'terminal')
}

watch(
  activeTab,
  id => {
    const tab = openTabsList.value.find(item => item.id === id)
    if (
      tab &&
      /^\/(terminal|file-manager)\?/.test(tab.path) &&
      new URLSearchParams(tab.path.split('?')[1]).has('connectionId')
    )
      lastSessionTabId.value = id
  },
  { flush: 'sync' }
)

const openSessionView = (view: 'terminal' | 'file-manager') => {
  const session = sessionTab.value
  if (!session) return
  const query = new URLSearchParams(session.path.split('?')[1])
  const id = query.get('connectionId')
  const name = query.get('name') || 'SSH'
  const fileManager = view === 'file-manager'
  openNewTab(
    `${view}-${id}`,
    fileManager ? `${name} - 文件管理` : name,
    fileManager ? 'bi bi-folder2' : 'bi bi-terminal',
    `/${view}?${query}`
  )
}

const isSameTabRoute = (tabPath: string, currentFullPath: string) => {
  const [tabBasePath, tabQuery = ''] = tabPath.split('?')
  const [currentBasePath, currentQuery = ''] = currentFullPath.split('?')

  if (tabBasePath !== currentBasePath) {
    return false
  }

  const tabParams = new URLSearchParams(tabQuery)
  const currentParams = new URLSearchParams(currentQuery)
  const tabConnectionId = tabParams.get('connectionId') || ''
  const currentConnectionId = currentParams.get('connectionId') || ''

  return tabConnectionId === currentConnectionId
}

watch(
  () => route.fullPath,
  () => {
    if (route.path === '/') return
    const routeTabEntry = openTabsList.value.find(tab => isSameTabRoute(tab.path, route.fullPath))
    if (!routeTabEntry) {
      const id = route.query.connectionId
        ? `${route.path.slice(1)}-${route.query.connectionId}`
        : route.path.slice(1) || 'ssh'
      openTabsList.value.push({
        id,
        name: String(route.query.name || route.meta.title || 'SSH'),
        icon: `bi ${String(route.meta.icon || 'bi-window')}`,
        path: route.fullPath
      })
      activeTab.value = id
      return
    }

    activeTab.value = routeTabEntry.id

    if (routeTabEntry.path === route.fullPath) {
      return
    }

    routeTabEntry.path = route.fullPath
  },
  { immediate: true }
)

watch(
  () => updater.state.value,
  nextState => {
    if (!updater.shouldShowInstallPrompt(nextState) || !window.$notification) {
      return
    }

    window.$notification.add({
      type: 'success',
      title: '发现新版本',
      message: `新版本 ${nextState.availableVersion} 已下载完成，点击即可直接安装。`,
      persistent: true,
      actions: [
        {
          label: '立即安装',
          handler: async () => {
            await updater.installDownloadedUpdate()
          }
        }
      ]
    })
  },
  { deep: true }
)

// 提供打开新标签和关闭标签的方法给子组件
provide('openNewTab', openNewTab)
provide('closeTab', closeTab)
provide('openSettings', openSettings)

// 为路由生成唯一的缓存键
const getRouteKey = (route: RouteLocationNormalizedLoaded) => {
  // 对于终端路由，使用 connectionId 作为唯一键
  if (route.path.startsWith('/terminal') && route.query.connectionId) {
    return `terminal-${route.query.connectionId}`
  }

  if (route.path.startsWith('/file-manager') && route.query.connectionId) {
    return `file-manager-${route.query.connectionId}`
  }

  // 其他路由使用路径作为键
  return route.path
}

// 处理视图切换事件
const handleSwitchView = (event: Event) => {
  const customEvent = event as CustomEvent
  const { viewId } = customEvent.detail
  if (viewId) {
    setActiveView(viewId)
  }
}

// 拖拽调整大小功能
const startLeftResize = (event: MouseEvent) => {
  isResizing.value = true
  finishSidebarLayoutMotion()
  resizeType.value = 'left'
  startX.value = event.clientX
  startWidth.value = sidebarWidth.value
  document.body.classList.add('resizing')
  document.addEventListener('mousemove', handlePanelResize)
  document.addEventListener('mouseup', stopResize)
  event.preventDefault()
}

const handlePanelResize = (event: MouseEvent) => {
  if (!isResizing.value) return

  const deltaX = event.clientX - startX.value

  if (resizeType.value === 'left') {
    pendingPanelWidth = Math.max(200, Math.min(600, startWidth.value + deltaX))
    // High-polling mice can deliver several moves per display frame. Commit the
    // latest coordinate once per frame instead of rerendering the whole shell.
    if (!panelResizeFrame) panelResizeFrame = requestAnimationFrame(commitPanelResize)
  }
}

function commitPanelResize() {
  panelResizeFrame = 0
  if (pendingPanelWidth !== undefined) sidebarWidth.value = pendingPanelWidth
  pendingPanelWidth = undefined
}

const stopResize = () => {
  if (panelResizeFrame) cancelAnimationFrame(panelResizeFrame)
  // Mouseup may precede the next frame; retain its last requested coordinate.
  commitPanelResize()
  isResizing.value = false
  resizeType.value = null
  document.body.classList.remove('resizing')
  document.removeEventListener('mousemove', handlePanelResize)
  document.removeEventListener('mouseup', stopResize)
}

function setSidebarLayoutMotion(settling: boolean) {
  if (isSidebarLayoutAnimating.value === settling) return
  isSidebarLayoutAnimating.value = settling
  // Terminal reflow also resizes the remote PTY. Keep that work out of the
  // container tween, then fit once to the final layout instead of every column.
  window.dispatchEvent(new CustomEvent('workspace-layout-change', { detail: { settling } }))
}

function finishSidebarLayoutMotion() {
  clearTimeout(sidebarLayoutTimer)
  sidebarLayoutTimer = undefined
  if (sidebarLayoutFrame) cancelAnimationFrame(sidebarLayoutFrame)
  sidebarLayoutFrame = 0
  setSidebarLayoutMotion(false)
}

function sidebarLayoutDuration() {
  const region = sidebarRegion.value
  if (!region || isResizing.value || matchMedia('(max-width: 800px)').matches) return 0
  const style = getComputedStyle(region)
  const properties = style.transitionProperty.split(',').map(value => value.trim())
  const milliseconds = (value: string) =>
    parseFloat(value) * (value.trim().endsWith('ms') ? 1 : 1000)
  const durations = style.transitionDuration.split(',').map(milliseconds)
  const delays = style.transitionDelay.split(',').map(milliseconds)
  return Math.max(
    0,
    ...properties.map((property, index) =>
      property === 'width' || property === 'all'
        ? durations[index % durations.length] + delays[index % delays.length]
        : 0
    )
  )
}

function beginSidebarLayoutMotion() {
  const duration = sidebarLayoutDuration()
  if (!duration) {
    finishSidebarLayoutMotion()
    return
  }
  clearTimeout(sidebarLayoutTimer)
  setSidebarLayoutMotion(true)
  // A cancelled transition, breakpoint change or animation setting change must
  // never leave a terminal waiting indefinitely for a transitionend event.
  sidebarLayoutTimer = setTimeout(queueSidebarLayoutEnd, duration + 80)
}

function queueSidebarLayoutEnd() {
  if (sidebarLayoutFrame) cancelAnimationFrame(sidebarLayoutFrame)
  sidebarLayoutFrame = requestAnimationFrame(() => {
    sidebarLayoutFrame = 0
    const running = sidebarRegion.value
      ?.getAnimations()
      .some(
        animation =>
          animation instanceof CSSTransition &&
          animation.transitionProperty === 'width' &&
          (animation.playState === 'running' || animation.pending)
      )
    // A rapid reverse dispatches cancel for the old tween before run for the
    // replacement. Inspect the replacement on the next frame before settling.
    if (running) {
      clearTimeout(sidebarLayoutTimer)
      sidebarLayoutTimer = setTimeout(queueSidebarLayoutEnd, 80)
    } else finishSidebarLayoutMotion()
  })
}

function onSidebarLayoutTransition(event: TransitionEvent) {
  if (event.target !== sidebarRegion.value || event.propertyName !== 'width') return
  if (event.type === 'transitionrun') beginSidebarLayoutMotion()
  else queueSidebarLayoutEnd()
}

watch(
  sidebarWidth,
  () => {
    if (showSidebar.value) beginSidebarLayoutMotion()
  },
  { flush: 'sync' }
)

watch(
  showSidebar,
  open => {
    beginSidebarLayoutMotion()
    if (open) return
    stopResize()
    // Restore focus before the collapsing controls become inert, including Ctrl+B from search.
    if (
      sidebarRegion.value?.contains(document.activeElement) ||
      document.activeElement?.classList.contains('sidebar-scrim')
    ) {
      sidebarToggle.value?.focus({ preventScroll: true })
    }
  },
  { flush: 'sync' }
)

// 键盘快捷键处理
const handleKeydown = (event: KeyboardEvent) => {
  // Ctrl/Cmd + B 切换侧边栏
  if ((event.ctrlKey || event.metaKey) && event.key === 'b') {
    event.preventDefault()
    showSidebar.value = !showSidebar.value
  }

  // F11 切换全屏
  if (event.key === 'F11') {
    event.preventDefault()
    isFullscreen.value = !isFullscreen.value
    if (window.electronAPI?.toggleFullscreen) {
      window.electronAPI.toggleFullscreen()
    }
  }

  // Ctrl/Cmd + , 打开设置
  if ((event.ctrlKey || event.metaKey) && event.key === ',') {
    event.preventDefault()
    openSettings()
  }

  // F12 切换开发者工具
  if (event.key === 'F12') {
    event.preventDefault()
    if (window.electronAPI?.toggleDevTools) {
      window.electronAPI
        .toggleDevTools()
        .then((_opened: boolean) => {})
        .catch((_error: any) => {})
    }
  }
}

// 窗口大小变化处理
const handleResize = () => {
  // 响应式布局调整
  // 不再自动隐藏侧边栏，保持用户的选择
  if (isSidebarLayoutAnimating.value) queueSidebarLayoutEnd()
}

onMounted(async () => {
  // 初始化应用
  app.initialize()
  theme.initialize()
  await updater.initialize()

  // SSH、设置和历史记录始终使用本地存储，无需登录。

  // 绑定事件监听器
  document.addEventListener('keydown', handleKeydown)
  window.addEventListener('resize', handleResize)
  window.addEventListener('switch-view', handleSwitchView as EventListener)
  window.addEventListener('navigate-to-settings', openSettings)

  // 监听全屏状态变化
  if (window.electronAPI?.onFullscreenChange) {
    window.electronAPI.onFullscreenChange((fullscreen: boolean) => {
      isFullscreen.value = fullscreen
    })
  }
})

onUnmounted(async () => {
  // 清理事件监听器
  stopResize()
  finishSidebarLayoutMotion()
  document.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('resize', handleResize)
  window.removeEventListener('switch-view', handleSwitchView as EventListener)
  window.removeEventListener('navigate-to-settings', openSettings)
})
</script>
