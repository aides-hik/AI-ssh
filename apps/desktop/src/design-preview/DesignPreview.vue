<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import LiquidWorkspace from './LiquidWorkspace.vue'
import { APP_DISPLAY_NAME, APP_NAME_ZH } from '@ai-ssh/shared'

type StyleId = 'graphite' | 'paper' | 'aurora' | 'console' | 'liquid'
type Tab = 'terminal' | 'files'
const directions = [
  {
    id: 'graphite' as const,
    number: '01',
    name: '石墨工作台',
    english: 'Graphite',
    icon: 'command',
    brief: '沉静、利落，专注每一次操作',
    tags: ['石墨 × 琥珀', '经典三栏'],
    motion: '克制的位移，清晰的反馈',
    detail: '180ms 淡入与短距离滑动，让切换有回应，也让终端始终保持专注。',
    tempo: '180ms',
    curve: '敏捷 · 精准'
  },
  {
    id: 'paper' as const,
    number: '02',
    name: '纸间留白',
    english: 'Paper',
    icon: 'sun',
    brief: '暖白、松弛，让工具轻一点',
    tags: ['暖白 × 橄榄', '舒展布局'],
    motion: '轻柔展开，保留呼吸感',
    detail: '240ms 柔和显现，配合更宽的留白与低对比边界，适合长时间工作。',
    tempo: '240ms',
    curve: '柔和 · 自然'
  },
  {
    id: 'aurora' as const,
    number: '03',
    name: '浮光空间',
    english: 'Aurora',
    icon: 'layers',
    brief: '通透、悬浮，空间有了层次',
    tags: ['深海 × 冰青', '悬浮面板'],
    motion: '面板浮入，光感随操作流转',
    detail: '320ms 分层浮入，悬停时轻微抬升；光晕与玻璃质感为内容建立层次。',
    tempo: '320ms',
    curve: '流动 · 轻盈'
  },
  {
    id: 'console' as const,
    number: '04',
    name: '工程控制台',
    english: 'Console',
    icon: 'terminal',
    brief: '紧凑、直接，信息尽在眼前',
    tags: ['墨黑 × 信号绿', '底部 AI'],
    motion: '即时响应，减少视觉等待',
    detail: '100ms 快速状态切换，终端占据主视区，AI 指令停靠底部，操作更直接。',
    tempo: '100ms',
    curve: '直接 · 高效'
  },
  {
    id: 'liquid' as const,
    number: '05',
    name: '液态玻璃',
    english: 'Liquid Glass',
    icon: 'droplet',
    brief: '光线在边缘流动，思路保持清晰',
    tags: ['清透 × 冰蓝', '悬浮导航'],
    motion: '轻触有弹性，切换有连续感',
    detail:
      '导航与工具栏折射背后的光线，指针带动高光，按压后轻柔回弹。终端正文保持清晰，可切换清透与柔雾材质。',
    tempo: '240ms',
    curve: '流动 · 克制'
  }
]
const fromHash = location.hash.slice(1)
const current = ref<StyleId>(
  directions.some(item => item.id === fromHash) ? (fromHash as StyleId) : 'graphite'
)
const direction = computed(
  () => directions.find(item => item.id === current.value) ?? directions[0]
)
const motion = ref(true)
const replay = ref(0)
const tab = ref<Tab>('terminal')
const search = ref('')
const servers = [
  {
    name: 'production-01',
    address: '192.0.2.24',
    region: '新加坡',
    latency: 24,
    color: 'green',
    environment: 'PROD'
  },
  {
    name: 'staging-01',
    address: '192.0.2.48',
    region: '东京',
    latency: 38,
    color: 'amber',
    environment: 'STG'
  },
  {
    name: 'database-01',
    address: '192.0.2.80',
    region: '新加坡',
    latency: 26,
    color: 'blue',
    environment: 'DB'
  }
]
const activeServer = ref(0)
const server = computed(() => servers[activeServer.value] ?? servers[0])
const filteredServers = computed(() =>
  servers
    .map((item, index) => ({ ...item, index }))
    .filter(item => `${item.name} ${item.address}`.includes(search.value.toLowerCase()))
)
const command = ref('')
const commandHistory = ref<{ command: string; output: string }[]>([])
const commandInput = ref<HTMLInputElement>()
const terminalOutput = ref<HTMLElement>()
const searchInput = ref<HTMLInputElement>()
const aiInput = ref('')
const aiReply = ref('')
const chosen = ref<StyleId | null>(null)
const toast = ref('')
const selectedFile = ref('')
let toastTimer: ReturnType<typeof setTimeout> | undefined
try {
  const saved = localStorage.getItem('ai-ssh-design-choice')
  if (directions.some(item => item.id === saved)) chosen.value = saved as StyleId
} catch {
  /* The preview also works without browser storage. */
}
const files = [
  { name: 'config', kind: 'folder2', size: '—', mode: 'drwxr-xr-x', modified: '今天 10:24' },
  { name: 'logs', kind: 'folder2', size: '—', mode: 'drwxr-xr-x', modified: '今天 10:28' },
  { name: 'src', kind: 'folder2', size: '—', mode: 'drwxr-xr-x', modified: '昨天 16:42' },
  {
    name: 'docker-compose.yml',
    kind: 'file-earmark-code',
    size: '2.4 KB',
    mode: '-rw-r--r--',
    modified: '今天 09:12'
  },
  {
    name: 'nginx.conf',
    kind: 'file-earmark-code',
    size: '1.8 KB',
    mode: '-rw-r--r--',
    modified: '昨天 18:36'
  },
  {
    name: 'README.md',
    kind: 'file-earmark-text',
    size: '3.2 KB',
    mode: '-rw-r--r--',
    modified: '10月 20日'
  }
]
const bars = [
  19, 27, 22, 35, 29, 24, 41, 32, 25, 36, 47, 31, 28, 39, 30, 22, 27, 38, 32, 24, 29, 23, 32, 28
]

function selectStyle(id: StyleId) {
  current.value = id
  history.replaceState(null, '', `#${id}`)
  replay.value++
}
function announce(message: string) {
  toast.value = message
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toast.value = ''
  }, 2800)
}
function choose() {
  chosen.value = current.value
  try {
    localStorage.setItem('ai-ssh-design-choice', current.value)
  } catch {
    /* Optional persistence. */
  }
  announce(`已记下「${direction.value.name}」，可以继续比较其他风格`)
}
async function selectServer(index: number) {
  activeServer.value = index
  commandHistory.value = []
  replay.value++
  await nextTick()
  commandInput.value?.focus({ preventScroll: true })
}
function runCommand() {
  const value = command.value.trim() || 'uptime'
  const output =
    value === 'uptime'
      ? '10:32:08 up 24 days, 3:41, 2 users, load average: 0.12, 0.18, 0.16'
      : value === 'ls' || value === 'ls -la'
        ? 'config/   logs/   src/   docker-compose.yml   nginx.conf   README.md'
        : value === 'pwd'
          ? '/home/deploy/workspace'
          : value === 'whoami'
            ? 'deploy'
            : value === 'help'
              ? '预览指令：uptime · ls · pwd · whoami · clear'
              : '这是界面演示。试试 uptime、ls、pwd 或 whoami。'
  if (value === 'clear') commandHistory.value = []
  else commandHistory.value = [...commandHistory.value.slice(-2), { command: value, output }]
  command.value = ''
  nextTick(() => {
    if (terminalOutput.value) terminalOutput.value.scrollTop = terminalOutput.value.scrollHeight
    commandInput.value?.focus({ preventScroll: true })
  })
}
function askAI(prompt?: string) {
  const question = prompt || aiInput.value.trim()
  if (!question) {
    aiInput.value = '帮我检查服务器状态'
    return
  }
  aiReply.value = question.includes('磁盘')
    ? '可以先运行 df -h 查看磁盘使用情况，再用 du -sh /var/log 检查日志目录。执行前请确认目标路径。'
    : question.includes('日志')
      ? '建议先查看最近 50 条日志：journalctl -n 50 --no-pager。你可以将命令放入终端，再确认执行。'
      : '当前示例服务器运行平稳。建议依次检查负载、磁盘和服务状态：uptime → df -h → systemctl --failed。'
  aiInput.value = ''
}
function insertCommand() {
  tab.value = 'terminal'
  command.value = 'uptime'
  nextTick(() => commandInput.value?.focus({ preventScroll: true }))
  announce('命令已填入终端，按 Enter 运行演示')
}
function resetChat() {
  aiReply.value = ''
  aiInput.value = ''
  announce('已开始新的演示对话')
}
function focusSearch() {
  searchInput.value?.focus({ preventScroll: true })
}
function handleShortcut(event: KeyboardEvent) {
  if (current.value === 'liquid') return
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    focusSearch()
  }
  if (
    event.key === '/' &&
    !(event.target instanceof Element && event.target.closest('input, textarea, [contenteditable]'))
  ) {
    event.preventDefault()
    focusSearch()
  }
}
onMounted(() => window.addEventListener('keydown', handleShortcut))
onBeforeUnmount(() => {
  clearTimeout(toastTimer)
  window.removeEventListener('keydown', handleShortcut)
})
</script>

<template>
  <main
    class="design-lab"
    :data-style="current"
    :data-motion="motion ? 'on' : 'off'"
    :style="{ '--motion-duration': direction.tempo }"
  >
    <header class="lab-nav">
      <a
        href="/design-preview.html"
        class="lab-brand"
        :aria-label="`${APP_DISPLAY_NAME}设计实验室首页`"
        ><span class="lab-logo"><i class="bi bi-terminal" aria-hidden="true" /></span>
        {{ APP_NAME_ZH }} <span class="nav-divider" />
        <span class="nav-caption">设计实验室</span></a
      >
      <div class="lab-nav-right">
        <span class="prototype-badge"><span /> 交互原型</span
        ><a href="/" class="original-link"
          >当前界面 <i class="bi bi-arrow-up-right" aria-hidden="true"
        /></a>
      </div>
    </header>

    <section class="lab-intro">
      <div>
        <p class="eyebrow">A NEW WAY TO CONNECT / 2026</p>
        <h1>下一次连接，<span>换一种感觉。</span></h1>
        <p class="intro-copy">五种界面，五种工作节奏。新增液态玻璃，试试光线与交互的变化。</p>
      </div>
      <div class="intro-note">
        <span class="note-index">01 — 05</span>
        <p>从终端到 AI 助手<br />让工具也有自己的性格</p>
        <i class="bi bi-arrow-down-right" aria-hidden="true" />
      </div>
    </section>

    <nav class="direction-grid" aria-label="设计方向">
      <button
        v-for="item in directions"
        :key="item.id"
        :data-style-id="item.id"
        class="direction-card"
        :class="{ selected: current === item.id }"
        :aria-pressed="current === item.id"
        @click="selectStyle(item.id)"
      >
        <span class="card-top"
          ><span>{{ item.number }} / {{ item.english }}</span
          ><i
            :class="['bi', current === item.id ? 'bi-check-circle-fill' : 'bi-arrow-up-right']"
            aria-hidden="true"
        /></span>
        <span class="style-swatch" :class="`swatch-${item.id}`"
          ><span class="swatch-sidebar"><b /><b /><b /></span
          ><span class="swatch-main"><b /><b /><b /><b /></span
          ><span class="swatch-ai"><b /><b /><b /></span
        ></span>
        <span class="card-title">{{ item.name }}</span
        ><span class="card-description">{{ item.brief }}</span>
      </button>
    </nav>

    <section class="preview-section" aria-label="交互预览">
      <div class="preview-heading">
        <div class="preview-title">
          <span class="section-index">{{ direction.number }}</span>
          <h2>{{ direction.name }}</h2>
          <span v-for="tag in direction.tags" :key="tag" class="style-tag">{{ tag }}</span>
        </div>
        <div class="preview-controls">
          <button class="quiet-button" :aria-pressed="motion" @click="motion = !motion">
            <i :class="['bi', motion ? 'bi-toggle-on' : 'bi-toggle-off']" aria-hidden="true" />
            动效{{ motion ? '开启' : '关闭' }}</button
          ><button class="quiet-button" data-preview-action="replay-motion" @click="replay++">
            <i class="bi bi-arrow-clockwise" aria-hidden="true" /> 重播</button
          ><button class="choose-button" :class="{ chosen: chosen === current }" @click="choose">
            <i
              :class="['bi', chosen === current ? 'bi-check2' : 'bi-bookmark']"
              aria-hidden="true"
            />
            {{ chosen === current ? '已选中此方向' : '选中此方向' }}
          </button>
        </div>
      </div>
      <div class="preview-viewport">
        <LiquidWorkspace v-if="current === 'liquid'" :key="replay" :motion="motion" />
        <div v-else :key="`${current}-${replay}`" class="app-frame">
          <header class="app-bar">
            <div class="app-brand">
              <span class="brand-mark"><i class="bi bi-terminal" aria-hidden="true" /></span
              ><strong>{{ APP_NAME_ZH }}</strong
              ><span class="app-version">WORKSPACE</span>
            </div>
            <div class="app-breadcrumb">
              个人空间 <i class="bi bi-chevron-right" aria-hidden="true" /> 服务器
            </div>
            <button class="workspace-search" @click="focusSearch">
              <i class="bi bi-search" aria-hidden="true" /><span>搜索工作空间</span
              ><kbd>Ctrl K</kbd></button
            ><span class="user-avatar" title="本地工作空间">L</span>
          </header>
          <nav class="app-rail" aria-label="工作区工具">
            <button
              class="rail-button"
              :class="{ active: tab === 'terminal' }"
              aria-label="服务器"
              title="服务器"
              @click="tab = 'terminal'"
            >
              <i class="bi bi-hdd-network" aria-hidden="true" /></button
            ><button
              class="rail-button"
              aria-label="文件管理"
              :class="{ active: tab === 'files' }"
              title="文件管理"
              @click="tab = 'files'"
            >
              <i class="bi bi-folder2-open" aria-hidden="true" /></button
            ><button
              class="rail-button"
              aria-label="AI 助手"
              title="AI 助手"
              data-preview-tab="ai"
              @click="askAI('帮我检查服务器状态')"
            >
              <i class="bi bi-stars" aria-hidden="true" /></button
            ><span class="rail-spacer" /><button
              class="rail-button"
              aria-label="设置预览"
              title="设置"
              @click="announce('可用顶部开关调整动效，或切换上方四种界面风格')"
            >
              <i class="bi bi-sliders2" aria-hidden="true" />
            </button>
          </nav>
          <aside class="connections">
            <div class="panel-heading">
              <h3>服务器</h3>
              <button
                class="icon-button"
                aria-label="新建连接预览"
                @click="announce('设计原型使用示例连接；正式界面支持新建 SSH 连接')"
              >
                <i class="bi bi-plus-lg" aria-hidden="true" />
              </button>
            </div>
            <label class="server-search"
              ><i class="bi bi-search" aria-hidden="true" /><input
                v-model="search"
                ref="searchInput"
                placeholder="搜索连接…"
                aria-label="搜索示例连接"
              /><kbd>/</kbd></label
            >
            <div class="group-label">
              <span><i class="bi bi-chevron-down" aria-hidden="true" /> 我的服务器</span
              ><span>03</span>
            </div>
            <div class="server-list">
              <button
                v-for="item in filteredServers"
                :key="item.name"
                class="server-card"
                :class="{ active: activeServer === item.index }"
                :aria-pressed="activeServer === item.index"
                @click="selectServer(item.index)"
              >
                <span class="server-icon"
                  ><i class="bi bi-hdd-stack" aria-hidden="true" /><span
                    class="connection-dot" /></span
                ><span class="server-info"
                  ><strong>{{ item.name }}</strong
                  ><small>{{ item.address }}</small></span
                ><span class="server-tag">{{ item.environment }}</span>
              </button>
              <p v-if="!filteredServers.length" class="empty-search">没有匹配的示例连接</p>
            </div>
            <div class="sidebar-bottom">
              <span class="sidebar-orbit"><i class="bi bi-shield-check" aria-hidden="true" /></span>
              <div>
                <strong>连接，由你掌控</strong>
                <p>本地工作空间 · SSH</p>
              </div>
            </div>
          </aside>

          <section class="workspace" aria-label="服务器工作区">
            <div class="workspace-tabs">
              <button
                class="workspace-tab"
                :class="{ active: tab === 'terminal' }"
                :aria-pressed="tab === 'terminal'"
                data-preview-tab="terminal"
                @click="tab = 'terminal'"
              >
                <span class="connection-dot" /><i class="bi bi-terminal" aria-hidden="true" />
                {{ server.name }} <span class="tab-close" aria-hidden="true">×</span></button
              ><button
                class="workspace-tab"
                :class="{ active: tab === 'files' }"
                :aria-pressed="tab === 'files'"
                data-preview-tab="files"
                @click="tab = 'files'"
              >
                <i class="bi bi-folder2" aria-hidden="true" /> 文件</button
              ><button
                class="icon-button tab-add"
                aria-label="新建会话预览"
                @click="announce('可切换左侧服务器，预览不同连接状态')"
              >
                <i class="bi bi-plus-lg" aria-hidden="true" /></button
              ><span class="workspace-tab-spacer" /><span class="session-protocol">SSH 2.0</span>
            </div>
            <div class="workspace-summary">
              <div class="summary-kicker">
                <span class="connection-dot" /> 已安全连接
                <span class="summary-region">{{ server.region }} / {{ server.latency }} ms</span>
              </div>
              <h2 class="summary-title">{{ server.name }}<span>↗</span></h2>
              <div class="summary-meta">
                <span>Ubuntu 24.04 LTS</span><span>4 vCPU</span><span>8 GB RAM</span
                ><span class="server-tag">{{ server.environment }}</span>
              </div>
              <div class="metrics-grid">
                <div class="metric">
                  <span>CPU 负载</span>
                  <div>
                    <strong>12.4<small>%</small></strong
                    ><span class="metric-trend">↘ 2.1%</span>
                  </div>
                  <div class="mini-chart" aria-hidden="true">
                    <b v-for="(bar, i) in bars" :key="i" :style="{ height: `${bar + 12}%` }" />
                  </div>
                </div>
                <div class="metric">
                  <span>内存使用</span>
                  <div>
                    <strong>2.8<small> / 8 GB</small></strong>
                  </div>
                  <div class="meter"><span style="width: 35%" /></div>
                </div>
                <div class="metric">
                  <span>持续运行</span>
                  <div>
                    <strong>24<small>天 03 小时</small></strong>
                  </div>
                  <span class="metric-footnote"><span class="connection-dot" /> 一切运行平稳</span>
                </div>
              </div>
            </div>
            <div v-if="tab === 'terminal'" class="terminal">
              <div class="terminal-toolbar">
                <span><i class="bi bi-terminal" aria-hidden="true" /> 终端 <b>01</b></span
                ><span class="terminal-toolbar-right"
                  >UTF-8 <span>bash</span
                  ><button
                    class="icon-button"
                    aria-label="清空演示命令"
                    @click="commandHistory = []"
                  >
                    <i class="bi bi-trash3" aria-hidden="true" /></button
                ></span>
              </div>
              <div ref="terminalOutput" class="terminal-content">
                <p class="terminal-comment">Last login: Fri Oct 23 10:28:06 2026 from 192.0.2.1</p>
                <p class="terminal-welcome">Welcome back, deploy<span> 👋</span></p>
                <p class="terminal-line">
                  <span class="prompt-host">deploy@{{ server.name }}</span
                  ><span class="prompt-path"> ~/workspace</span><span> $ </span
                  ><span>docker compose ps</span>
                </p>
                <div class="terminal-table">
                  <div><span>NAME</span><span>STATUS</span><span>PORTS</span></div>
                  <div>
                    <span>web</span><span class="code-success">Up 24 days</span
                    ><span>0.0.0.0:8080→80</span>
                  </div>
                  <div>
                    <span>postgres</span><span class="code-success">Up 24 days</span
                    ><span>5432/tcp</span>
                  </div>
                  <div>
                    <span>redis</span><span class="code-success">Up 24 days</span
                    ><span>6379/tcp</span>
                  </div>
                </div>
                <div v-for="(entry, i) in commandHistory" :key="i" class="command-result">
                  <p class="terminal-line">
                    <span class="prompt-host">deploy@{{ server.name }}</span
                    ><span> $ {{ entry.command }}</span>
                  </p>
                  <p class="command-output">{{ entry.output }}</p>
                </div>
              </div>
              <form class="terminal-prompt" @submit.prevent="runCommand">
                <label for="terminal-command"
                  ><span class="prompt-host">deploy@{{ server.name }}</span
                  ><span class="prompt-path"> ~</span> $ </label
                ><input
                  id="terminal-command"
                  ref="commandInput"
                  v-model="command"
                  aria-label="演示终端命令"
                  autocomplete="off"
                  spellcheck="false"
                  placeholder="输入 help 试试"
                /><button
                  class="terminal-run"
                  data-preview-action="run-command"
                  aria-label="运行演示命令"
                  type="submit"
                >
                  <i class="bi bi-return" aria-hidden="true" />
                </button>
              </form>
              <div class="terminal-hint">
                <span
                  ><i class="bi bi-lightbulb" aria-hidden="true" /> 试试输入 uptime，或让 AI
                  帮你准备命令</span
                ><kbd>Enter ↵</kbd>
              </div>
            </div>
            <div v-else class="file-manager">
              <div class="file-toolbar">
                <span
                  ><i class="bi bi-folder2-open" aria-hidden="true" /> /home/deploy/workspace</span
                ><button class="quiet-button" @click="announce('文件列表已刷新（演示）')">
                  <i class="bi bi-arrow-clockwise" aria-hidden="true" /> 刷新
                </button>
              </div>
              <div class="file-columns">
                <span>名称</span><span>大小</span><span>修改时间</span>
              </div>
              <button
                v-for="file in files"
                :key="file.name"
                class="file-row"
                :class="{ selected: selectedFile === file.name }"
                @click="selectedFile = file.name"
              >
                <span
                  ><i :class="['bi', `bi-${file.kind}`]" aria-hidden="true" /> {{ file.name }}</span
                ><span>{{ file.size }}</span
                ><span>{{ file.modified }}</span>
              </button>
              <div class="file-detail">
                {{
                  selectedFile ? `已选择 ${selectedFile} · 文件预览示例` : '6 个项目 · 点击选择文件'
                }}
              </div>
            </div>
          </section>

          <aside class="assistant" aria-label="AI 助手预览">
            <div class="assistant-header">
              <div>
                <span class="ai-avatar"><i class="bi bi-stars" aria-hidden="true" /></span>
                <h3>AI 助手</h3>
                <span class="ai-ready" />
              </div>
              <button class="icon-button" aria-label="新对话" @click="resetChat">
                <i class="bi bi-plus-lg" aria-hidden="true" />
              </button>
            </div>
            <div class="ai-thread">
              <p class="ai-context">
                <i class="bi bi-link-45deg" aria-hidden="true" /> {{ server.name }}
                <span>上下文已就绪</span>
              </p>
              <div class="ai-intro">
                <span class="ai-spark"><i class="bi bi-stars" aria-hidden="true" /></span>
                <h4>复杂的事，一起解决。</h4>
                <p>分析日志、排查问题、生成命令。<br />说说你现在想做什么。</p>
              </div>
              <div class="ai-message">
                <p>服务都在正常运行。需要我帮你做一次快速健康检查吗？</p>
                <button class="ai-code" @click="insertCommand()">
                  <code>uptime</code
                  ><span
                    >填入终端 <i class="bi bi-arrow-down-left" aria-hidden="true"
                  /></span></button
                ><small><i class="bi bi-shield-check" aria-hidden="true" /> 执行前由你确认</small>
              </div>
              <div v-if="aiReply" class="ai-message demo-response" aria-live="polite">
                <span class="reply-label">示例回复</span>
                <p>{{ aiReply }}</p>
              </div>
              <div class="ai-suggestions">
                <button class="ai-suggestion" @click="askAI('检查磁盘空间')">
                  <i class="bi bi-device-hdd" aria-hidden="true" /> 检查磁盘空间
                  <span>↗</span></button
                ><button class="ai-suggestion" @click="askAI('查看最近日志')">
                  <i class="bi bi-file-text" aria-hidden="true" /> 查看最近日志 <span>↗</span>
                </button>
              </div>
            </div>
            <form class="composer" @submit.prevent="askAI()">
              <label for="ai-question" class="sr-only">询问 AI 助手（演示）</label
              ><textarea
                id="ai-question"
                v-model="aiInput"
                placeholder="描述问题，让思路继续…"
                rows="2"
                @keydown.enter.exact.prevent="askAI()"
              />
              <div class="composer-footer">
                <span
                  ><i class="bi bi-stars" aria-hidden="true" /> AI 助手
                  <i class="bi bi-chevron-down" aria-hidden="true" /></span
                ><button type="submit" data-preview-action="send-ai" aria-label="发送演示提问">
                  <i class="bi bi-arrow-up" aria-hidden="true" />
                </button>
              </div>
            </form>
          </aside>
          <footer class="app-status">
            <span
              ><span class="connection-dot" /> SSH 已连接 <span class="status-divider">/</span>
              {{ server.latency }} ms</span
            ><span
              ><i class="bi bi-shield-lock" aria-hidden="true" /> 安全连接
              <span class="status-divider">/</span> 本地工作空间</span
            >
          </footer>
        </div>
      </div>
      <div class="preview-caption">
        <span
          ><i class="bi bi-cursor" aria-hidden="true" />
          可以试试：切换服务器、打开文件、输入命令、向 AI 提问</span
        ><span>示例数据 · 不会连接服务器或调用模型</span>
      </div>
    </section>

    <section class="design-notes" aria-label="设计说明">
      <div>
        <span class="note-label">MOTION LANGUAGE / 动效语言</span>
        <h3>{{ direction.motion }}</h3>
        <p>{{ direction.detail }}</p>
      </div>
      <div class="motion-spec">
        <span class="note-label">交互节奏</span
        ><strong
          >{{ direction.tempo }}<small>{{ direction.curve }}</small></strong
        >
      </div>
      <div class="motion-demo">
        <div class="motion-track">
          <span :key="`${current}-${replay}-${motion}`"
            ><i class="bi bi-arrow-right" aria-hidden="true"
          /></span>
        </div>
        <span>悬停按钮与卡片，感受这个方向</span>
      </div>
    </section>
    <footer class="lab-footer">
      <span>{{ APP_DISPLAY_NAME }} / 界面探索</span
      ><span>选中方向后，可继续组合你喜欢的布局、配色和动效。</span
      ><span>DESIGNED FOR FOCUS ↗</span>
    </footer>
    <Transition name="toast"
      ><div v-if="toast" class="preview-toast" role="status">
        <i class="bi bi-check-circle" aria-hidden="true" /> {{ toast }}
      </div></Transition
    >
  </main>
</template>
