<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import LiquidSurface from '../components/common/LiquidSurface.vue'
import { APP_NAME_ZH } from '@ai-ssh/shared'
import './liquid-workspace.css'

defineProps<{ motion: boolean }>()
type WorkspaceTab = 'terminal' | 'files' | 'ai'
const tab = ref<WorkspaceTab>('terminal')
const material = ref<'clear' | 'frost'>('clear')
const refraction = ref(true)
const quiet = ref(false)
const showAssistant = ref(true)
const search = ref('')
const searchInput = ref<HTMLInputElement>()
const defaultServer = {
  name: 'production-01',
  address: '192.0.2.24',
  region: '新加坡',
  environment: '生产环境',
  latency: 24
}
const servers = ref([
  defaultServer,
  { name: 'staging-01', address: '192.0.2.48', region: '东京', environment: '预发布', latency: 38 },
  {
    name: 'database-01',
    address: '192.0.2.80',
    region: '新加坡',
    environment: '数据库',
    latency: 26
  }
])
const activeServer = ref(0)
const server = computed(() => servers.value[activeServer.value] ?? defaultServer)
const visibleServers = computed(() =>
  servers.value
    .map((item, index) => ({ ...item, index }))
    .filter(item => `${item.name} ${item.address}`.includes(search.value.toLowerCase()))
)
const blur = computed(() => (material.value === 'frost' ? 8 : 2))
const command = ref('')
const commandInput = ref<HTMLInputElement>()
const terminalOutput = ref<HTMLElement>()
const commandHistory = ref<{ command: string; output: string }[]>([])
const aiQuestion = ref('')
const aiReply = ref('')
const selectedFile = ref('nginx.conf')
const dialog = ref<HTMLDialogElement>()
const newName = ref('')
const newNameInput = ref<HTMLInputElement>()
const newConnectionButton = ref<{ $el: HTMLButtonElement }>()
const formError = ref('')
const notice = ref('')
let noticeTimer: ReturnType<typeof setTimeout> | undefined
const files = [
  { name: 'config', icon: 'folder2', size: '—', modified: '今天 10:24', mode: 'drwxr-xr-x' },
  { name: 'logs', icon: 'folder2', size: '—', modified: '今天 10:28', mode: 'drwxr-xr-x' },
  { name: 'src', icon: 'folder2', size: '—', modified: '昨天 16:42', mode: 'drwxr-xr-x' },
  {
    name: 'docker-compose.yml',
    icon: 'file-earmark-code',
    size: '2.4 KB',
    modified: '今天 09:12',
    mode: '-rw-r--r--'
  },
  {
    name: 'nginx.conf',
    icon: 'file-earmark-code',
    size: '1.8 KB',
    modified: '昨天 18:36',
    mode: '-rw-r--r--'
  },
  {
    name: 'README.md',
    icon: 'file-earmark-text',
    size: '3.2 KB',
    modified: '10月 20日',
    mode: '-rw-r--r--'
  }
]
const selectedFileDetail = computed(() => files.find(item => item.name === selectedFile.value))
const navigation: { id: WorkspaceTab; name: string; icon: string }[] = [
  { id: 'terminal', name: '终端', icon: 'terminal' },
  { id: 'files', name: '文件', icon: 'folder2' },
  { id: 'ai', name: 'AI 助手', icon: 'stars' }
]
function announce(message: string) {
  notice.value = message
  clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => {
    notice.value = ''
  }, 2600)
}
function selectTab(value: WorkspaceTab) {
  tab.value = value
  if (value === 'ai') showAssistant.value = true
}
function selectServer(index: number) {
  activeServer.value = index
  commandHistory.value = []
  announce(`已切换到 ${server.value.name}（演示连接）`)
}
async function runCommand() {
  const value = command.value.trim() || 'uptime'
  const output =
    value === 'uptime'
      ? '10:32:08 up 24 days, 3:41, 2 users, load average: 0.12, 0.18, 0.16'
      : value === 'whoami'
        ? 'deploy'
        : value === 'pwd'
          ? '/home/deploy/workspace'
          : value === 'ls' || value === 'ls -la'
            ? 'config/  logs/  src/  docker-compose.yml  nginx.conf  README.md'
            : value === 'help'
              ? '演示指令：uptime、whoami、pwd、ls、clear'
              : '当前为交互预览。试试 uptime、whoami、pwd 或 ls。'
  if (value === 'clear') commandHistory.value = []
  else commandHistory.value.push({ command: value, output })
  command.value = ''
  await nextTick()
  if (terminalOutput.value) terminalOutput.value.scrollTop = terminalOutput.value.scrollHeight
  commandInput.value?.focus({ preventScroll: true })
}
function sendAI(question?: string) {
  const value = question || aiQuestion.value.trim()
  if (!value) {
    aiQuestion.value = '帮我检查当前服务器的负载'
    return
  }
  aiReply.value = value.includes('磁盘')
    ? '先查看磁盘使用率，再检查日志目录。可使用 df -h 与 du -sh /var/log；请先确认目标路径。'
    : '这台示例服务器负载较低，内存余量充足。先运行 uptime 确认当前负载，再检查是否有失败的服务。'
  aiQuestion.value = ''
}
async function insertCommand() {
  tab.value = 'terminal'
  command.value = 'uptime'
  await nextTick()
  commandInput.value?.focus({ preventScroll: true })
  announce('已填入 uptime，确认后按 Enter 运行演示')
}
async function openConnection() {
  newName.value = ''
  formError.value = ''
  dialog.value?.showModal()
  await nextTick()
  newNameInput.value?.focus()
}
function closeConnection() {
  dialog.value?.close()
  newConnectionButton.value?.$el.focus({ preventScroll: true })
}
function addConnection() {
  const name = newName.value.trim()
  if (!name) {
    formError.value = '请填写连接名称'
    newNameInput.value?.focus()
    return
  }
  servers.value.push({
    name,
    address: `192.0.2.${100 + servers.value.length}`,
    region: '本地分组',
    environment: '演示连接',
    latency: 18
  })
  activeServer.value = servers.value.length - 1
  commandHistory.value = []
  closeConnection()
  announce(`已添加 ${name}，仅保存在本次预览中`)
}
function onDialogClick(event: MouseEvent) {
  if (event.target === dialog.value) closeConnection()
}
function onShortcut(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && !dialog.value?.open) {
    event.preventDefault()
    searchInput.value?.focus({ preventScroll: true })
  }
}
onMounted(() => window.addEventListener('keydown', onShortcut))
onBeforeUnmount(() => {
  clearTimeout(noticeTimer)
  window.removeEventListener('keydown', onShortcut)
})
</script>

<template>
  <div
    class="app-frame liquid-workspace"
    :class="{
      'liquid-frost': material === 'frost',
      'liquid-motion-off': !motion,
      'liquid-quiet': quiet,
      'liquid-without-ai': !showAssistant
    }"
  >
    <div class="liquid-landscape" aria-hidden="true">
      <svg viewBox="0 0 1400 800" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="liquid-flow-blue" x1="0" x2="1" y1="0" y2="1">
            <stop stop-color="#d3e0f4" />
            <stop offset=".48" stop-color="#649be8" />
            <stop offset="1" stop-color="#dcf7f5" />
          </linearGradient>
          <linearGradient id="liquid-flow-pink" x1="0" x2="1">
            <stop stop-color="#bdd2f0" />
            <stop offset="1" stop-color="#f2dae7" />
          </linearGradient>
        </defs>
        <path
          d="M-140 710C125 810 168 370 478 445S882 971 1588 499"
          fill="none"
          stroke="url(#liquid-flow-blue)"
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
          stroke="url(#liquid-flow-pink)"
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

    <header class="liquid-titlebar">
      <a class="liquid-brand" href="#liquid" :aria-label="`${APP_NAME_ZH}工作空间`"
        ><span class="liquid-brand-icon"><i class="bi bi-terminal" /></span
        ><strong>{{ APP_NAME_ZH }}</strong
        ><span class="liquid-brand-divider" /><span>工作空间</span></a
      >
      <span class="liquid-window-name">{{ server.name }}<span> / </span>SSH</span>
      <div class="liquid-window-dots" aria-hidden="true"><span /><span /><span /></div>
    </header>

    <div class="liquid-content">
      <aside class="liquid-connections" aria-label="连接列表">
        <div class="liquid-sidebar-heading">
          <h2>我的连接</h2>
          <span>{{ String(servers.length).padStart(2, '0') }}</span>
        </div>
        <LiquidSurface
          class="liquid-search-glass"
          :radius="14"
          :strength="40"
          :blur="blur"
          :motion="motion"
          :refraction="refraction"
        >
          <label class="liquid-search"
            ><i class="bi bi-search" /><input
              ref="searchInput"
              v-model="search"
              placeholder="搜索连接"
              aria-label="搜索连接"
            /><kbd>Ctrl K</kbd></label
          >
        </LiquidSurface>
        <div class="liquid-group-label">
          <span>常用服务器</span><i class="bi bi-chevron-down" />
        </div>
        <div class="liquid-server-list">
          <button
            v-for="item in visibleServers"
            :key="item.address"
            type="button"
            class="liquid-server"
            :class="{ 'is-active': activeServer === item.index }"
            :aria-pressed="activeServer === item.index"
            @click="selectServer(item.index)"
          >
            <span class="liquid-server-icon"><i class="bi bi-hdd-stack" /><span /></span>
            <span class="liquid-server-copy"
              ><strong>{{ item.name }}</strong
              ><small>{{ item.region }}<span>·</span>{{ item.environment }}</small></span
            >
            <i v-if="activeServer === item.index" class="bi bi-check2" />
          </button>
          <p v-if="!visibleServers.length" class="liquid-empty">没有匹配的连接</p>
        </div>
        <button class="liquid-add-connection" type="button" @click="openConnection">
          <i class="bi bi-plus" />添加连接
        </button>
        <div class="liquid-sidebar-bottom">
          <span class="liquid-private-icon"><i class="bi bi-shield-check" /></span>
          <div><strong>你的工作空间</strong><small>连接与配置保存在本地</small></div>
        </div>
      </aside>

      <section class="liquid-main-area" aria-label="服务器工作区">
        <header class="liquid-workspace-heading">
          <div>
            <div class="liquid-breadcrumb">
              工作空间 <i class="bi bi-chevron-right" /> {{ server.region }}
            </div>
            <h1>
              {{ server.name }}<span class="liquid-connected"><span />已连接</span>
            </h1>
            <p>deploy@{{ server.address }}<span>Ubuntu 24.04 LTS</span></p>
          </div>
          <div class="liquid-tools" role="group" aria-label="工作区工具">
            <LiquidSurface
              as="button"
              type="button"
              class="liquid-tool"
              :radius="16"
              :strength="48"
              :blur="blur"
              :motion="motion"
              :refraction="refraction"
              :aria-pressed="quiet"
              aria-label="切换柔和背景"
              title="切换柔和背景"
              @click="quiet = !quiet"
              ><i class="bi" :class="quiet ? 'bi-sun' : 'bi-brightness-high'"
            /></LiquidSurface>
            <LiquidSurface
              as="button"
              type="button"
              class="liquid-tool"
              :radius="16"
              :strength="48"
              :blur="blur"
              :motion="motion"
              :refraction="refraction"
              :aria-pressed="showAssistant"
              aria-label="切换 AI 面板"
              title="切换 AI 面板"
              @click="showAssistant = !showAssistant"
              ><i class="bi bi-layout-sidebar-reverse"
            /></LiquidSurface>
            <span class="liquid-tool-divider" />
            <LiquidSurface
              ref="newConnectionButton"
              as="button"
              data-preview-action="new-connection"
              type="button"
              class="liquid-tool liquid-tool-primary"
              :radius="16"
              :strength="48"
              :blur="blur"
              :motion="motion"
              :refraction="refraction"
              aria-label="新建连接"
              title="新建连接"
              @click="openConnection"
              ><i class="bi bi-plus-lg"
            /></LiquidSurface>
          </div>
        </header>

        <div class="liquid-metrics" aria-label="服务器指标（演示数据）">
          <div class="liquid-metric">
            <span class="liquid-metric-icon"><i class="bi bi-cpu" /></span>
            <div>
              <small>处理器</small><strong>12<span>%</span></strong>
            </div>
            <svg viewBox="0 0 76 30" aria-hidden="true">
              <path d="M1 22 8 20 15 24 22 14 29 18 36 9 43 16 50 13 57 18 64 11 75 14" />
            </svg>
          </div>
          <div class="liquid-metric">
            <span class="liquid-metric-icon"><i class="bi bi-memory" /></span>
            <div>
              <small>内存</small><strong>2.4<span> / 8 GB</span></strong>
            </div>
            <span class="liquid-memory-track"><span /></span>
          </div>
          <div class="liquid-metric">
            <span class="liquid-metric-icon"><i class="bi bi-activity" /></span>
            <div>
              <small>连接延迟</small><strong>{{ server.latency }}<span> ms</span></strong>
            </div>
            <span class="liquid-latency-bars" aria-hidden="true"><i /><i /><i /><i /></span>
          </div>
        </div>

        <section v-if="tab !== 'files'" class="liquid-terminal" aria-label="终端演示">
          <header class="liquid-terminal-header">
            <span
              ><i class="bi bi-terminal" />{{ server.name
              }}<span class="liquid-terminal-session">1</span></span
            >
            <div>
              <span class="liquid-shell-label">zsh</span
              ><span class="liquid-terminal-header-divider" /><button
                type="button"
                aria-label="清空终端演示"
                title="清空终端"
                @click="commandHistory = []"
              >
                <i class="bi bi-arrow-clockwise" />
              </button>
            </div>
          </header>
          <div ref="terminalOutput" class="liquid-terminal-output" aria-live="polite">
            <p class="liquid-login">Last login: Thu Oct 22 10:24:08 2026</p>
            <p class="liquid-terminal-welcome">Connected to {{ server.name }}.</p>
            <p class="liquid-terminal-comment"># /home/deploy/workspace · service health</p>
            <div class="liquid-initial-command">
              <p>
                <span class="liquid-prompt">deploy@{{ server.name }}</span
                ><span class="liquid-prompt-path"> ~ </span
                ><span class="liquid-prompt-arrow">❯</span> systemctl status nginx
              </p>
              <p>
                <span class="liquid-terminal-success">●</span> nginx.service - A high performance
                web server
              </p>
              <p class="liquid-command-indent">
                Loaded: loaded (/lib/systemd/system/nginx.service; enabled)
              </p>
              <p class="liquid-command-indent">
                Active: <span class="liquid-terminal-success">active (running)</span> since Thu
                2026-10-22 10:24:02
              </p>
              <p class="liquid-command-indent">Tasks: 3 (limit: 9412)</p>
              <p class="liquid-command-indent">Memory: 5.8M</p>
            </div>
            <div v-for="(entry, index) in commandHistory" :key="index" class="command-result">
              <p>
                <span class="liquid-prompt">deploy@{{ server.name }}</span
                ><span class="liquid-prompt-path"> ~ </span
                ><span class="liquid-prompt-arrow">❯</span> {{ entry.command }}
              </p>
              <pre class="command-output">{{ entry.output }}</pre>
            </div>
          </div>
          <form class="liquid-command-form" @submit.prevent="runCommand">
            <label for="terminal-command"
              ><span class="liquid-prompt">deploy@{{ server.name }}</span
              ><span class="liquid-prompt-path"> ~ </span
              ><span class="liquid-prompt-arrow">❯</span></label
            ><input
              id="terminal-command"
              ref="commandInput"
              v-model="command"
              autocomplete="off"
              spellcheck="false"
              placeholder="输入 uptime 试试"
              aria-label="终端命令（仅演示）"
            /><button
              data-preview-action="run-command"
              type="submit"
              title="运行演示命令"
              aria-label="运行演示命令"
            >
              <i class="bi bi-arrow-return-left" />
            </button>
          </form>
          <footer class="liquid-terminal-footer">
            <span><span />SSH 会话已加密</span><span>UTF-8 <i class="bi bi-dot" /> 120 × 32</span>
          </footer>
        </section>

        <section v-else class="liquid-files file-manager" aria-label="文件管理演示">
          <header>
            <div><i class="bi bi-folder2-open" /><span>/home/deploy/workspace</span></div>
            <span>{{ files.length }} 个项目</span>
          </header>
          <div class="liquid-file-columns">
            <span>名称</span><span>大小</span><span>修改时间</span>
          </div>
          <button
            v-for="file in files"
            :key="file.name"
            type="button"
            class="file-row"
            :class="{ 'is-selected': selectedFile === file.name }"
            :aria-pressed="selectedFile === file.name"
            @click="selectedFile = file.name"
          >
            <span><i class="bi" :class="`bi-${file.icon}`" />{{ file.name }}</span
            ><span>{{ file.size }}</span
            ><span>{{ file.modified }}</span>
          </button>
          <div class="file-detail">
            <i class="bi bi-info-circle" />
            <div>
              <strong>{{ selectedFile }}</strong>
              <p>{{ selectedFileDetail?.mode }}<span>所有者 deploy</span></p>
              <small>文件选择为交互演示，不会访问远程服务器。</small>
            </div>
          </div>
        </section>
      </section>

      <aside
        v-if="showAssistant"
        class="liquid-ai"
        :class="{ 'liquid-ai-focused': tab === 'ai' }"
        aria-label="AI 助手演示"
      >
        <header>
          <span class="liquid-ai-mark"><i class="bi bi-stars" /></span>
          <h2>AI 助手</h2>
          <span class="liquid-ai-ready"><span />就绪</span>
        </header>
        <div class="liquid-ai-conversation">
          <div class="liquid-ai-context">
            <i class="bi bi-link-45deg" /><span>{{ server.name }}</span
            ><i class="bi bi-check2" />
          </div>
          <h3>下一条命令，<br />先一起确认。</h3>
          <p class="liquid-ai-intro">
            理解当前会话，为下一步提供建议。<br />所有命令由你确认后执行。
          </p>
          <div class="liquid-ai-suggestions">
            <button type="button" @click="sendAI('帮我检查当前服务器的负载')">
              <i class="bi bi-activity" />检查服务器状态<i class="bi bi-arrow-up-left" /></button
            ><button type="button" @click="sendAI('查看磁盘使用情况')">
              <i class="bi bi-device-hdd" />查看磁盘使用情况<i class="bi bi-arrow-up-left" />
            </button>
          </div>
          <div v-if="aiReply" class="liquid-ai-answer demo-response">
            <span><i class="bi bi-stars" />AI 助手</span>
            <p>{{ aiReply }}</p>
            <div class="liquid-ai-command">
              <code>uptime</code
              ><button type="button" data-preview-action="insert-command" @click="insertCommand">
                <i class="bi bi-arrow-down-left" />填入终端
              </button>
            </div>
            <small>仅填入命令，不会自动执行</small>
          </div>
        </div>
        <form class="liquid-ai-compose" @submit.prevent="sendAI()">
          <label for="ai-question" class="liquid-sr-only">向 AI 提问（演示）</label
          ><textarea
            id="ai-question"
            v-model="aiQuestion"
            placeholder="描述你想完成的操作…"
            rows="2"
            @keydown.enter.exact.prevent="sendAI()"
          />
          <div>
            <span><i class="bi bi-circle-fill" />示例模型</span
            ><button type="submit" data-preview-action="send-ai" aria-label="发送演示问题">
              <i class="bi bi-arrow-up" />
            </button>
          </div>
        </form>
        <p class="liquid-ai-disclaimer">界面演示 · 不连接模型服务</p>
      </aside>
    </div>

    <div class="liquid-bottom-shelf">
      <div class="liquid-material-controls" aria-label="玻璃材质设置">
        <span>材质</span>
        <div>
          <button
            type="button"
            data-preview-action="material-clear"
            :aria-pressed="material === 'clear'"
            @click="material = 'clear'"
          >
            清透</button
          ><button
            type="button"
            data-preview-action="material-frost"
            :aria-pressed="material === 'frost'"
            @click="material = 'frost'"
          >
            柔雾
          </button>
        </div>
        <button
          type="button"
          data-preview-action="toggle-refraction"
          :aria-pressed="refraction"
          @click="refraction = !refraction"
        >
          <i class="bi bi-droplet" />折射 <b>{{ refraction ? '开' : '关' }}</b>
        </button>
      </div>
      <LiquidSurface
        class="liquid-dock"
        :radius="32"
        :strength="42"
        :blur="blur"
        :motion="motion"
        :refraction="refraction"
      >
        <nav aria-label="工作区导航">
          <div
            class="liquid-active-lens"
            :style="{
              transform: `translateX(${navigation.findIndex(item => item.id === tab) * 98}px)`
            }"
          >
            <LiquidSurface
              :radius="25"
              :strength="28"
              :blur="1"
              :motion="motion"
              :refraction="refraction"
            />
          </div>
          <button
            v-for="item in navigation"
            :key="item.id"
            type="button"
            :data-preview-tab="item.id"
            :aria-pressed="tab === item.id"
            @click="selectTab(item.id)"
          >
            <i class="bi" :class="`bi-${item.icon}`" /><span>{{ item.name }}</span>
          </button>
        </nav>
      </LiquidSurface>
      <span class="liquid-demo-label"><span />本地交互预览</span>
    </div>
    <div class="liquid-notice" role="status" :class="{ 'is-visible': notice }">
      <i class="bi bi-check-circle" />{{ notice }}
    </div>

    <dialog
      ref="dialog"
      class="liquid-connection-dialog"
      :class="{ 'liquid-dialog-motion-off': !motion }"
      aria-labelledby="liquid-dialog-title"
      @cancel.prevent="closeConnection"
      @click="onDialogClick"
    >
      <LiquidSurface
        class="liquid-dialog-surface"
        :radius="30"
        :strength="35"
        :blur="blur"
        :motion="motion"
        :refraction="refraction"
      >
        <form @submit.prevent="addConnection">
          <div class="liquid-dialog-heading">
            <span class="liquid-dialog-symbol"><i class="bi bi-hdd-network" /></span
            ><button type="button" aria-label="关闭新建连接" @click="closeConnection">
              <i class="bi bi-x-lg" />
            </button>
          </div>
          <h2 id="liquid-dialog-title">新建连接</h2>
          <p>为你的下一处工作空间起个名字。</p>
          <label for="liquid-connection-name">连接名称</label
          ><input
            id="liquid-connection-name"
            ref="newNameInput"
            v-model="newName"
            autocomplete="off"
            maxlength="30"
            placeholder="例如 development-01"
            :aria-invalid="!!formError"
            :aria-describedby="formError ? 'liquid-name-error' : undefined"
          /><span v-if="formError" id="liquid-name-error" class="liquid-form-error">{{
            formError
          }}</span>
          <div class="liquid-dialog-info">
            <i class="bi bi-info-circle" /><span
              >此处创建演示连接，使用示例地址，不会连接真实服务器。</span
            >
          </div>
          <div class="liquid-dialog-actions">
            <button type="button" @click="closeConnection">取消</button
            ><button type="submit">添加连接<i class="bi bi-plus-lg" /></button>
          </div>
        </form>
      </LiquidSurface>
    </dialog>
  </div>
</template>
