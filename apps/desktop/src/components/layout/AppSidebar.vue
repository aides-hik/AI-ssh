<template>
  <div class="vscode-sidebar-container h-full flex flex-col">
    <!-- 侧边栏标题 -->
    <div class="vscode-sidebar-header px-4 py-2 border-b border-vscode-border">
      <div class="sidebar-heading">
        <i class="bi bi-hdd-network" aria-hidden="true"></i>
        <h3 class="text-sm font-medium text-vscode-fg m-0">{{ sidebarTitle }}</h3>
      </div>
      <span class="sidebar-local-badge">本地</span>
    </div>

    <!-- 侧边栏内容 -->
    <div class="flex-1 overflow-y-auto scrollbar-thin">
      <!-- SSH 连接视图 -->
      <div v-if="activeView === 'ssh'" class="p-2">
        <label class="sidebar-search">
          <i class="bi bi-search" aria-hidden="true"></i>
          <input v-model="search" type="search" placeholder="搜索连接" aria-label="搜索连接" />
        </label>
        <div class="connection-list-actions mb-4">
          <button class="vscode-button primary" @click="openConnectionDialog()">
            <i class="bi bi-plus-lg" aria-hidden="true"></i>新建连接
          </button>
          <button
            class="vscode-button sidebar-folder-button"
            :data-prism-tooltip="$t('ssh.newFolder')"
            :aria-label="$t('ssh.newFolder')"
            @click="createRootFolder"
          >
            <i class="bi bi-folder-plus" aria-hidden="true"></i>
          </button>
        </div>

        <div class="space-y-2">
          <div class="vscode-tree-title text-xs font-medium text-vscode-fg-muted mb-2">
            {{ $t('ssh.connectionList') }}
          </div>
          <div v-if="sshLoading" class="sidebar-empty" role="status">正在读取连接…</div>
          <div v-else-if="sshError" class="sidebar-empty" role="status">
            <p>{{ sshError }}</p>
            <button class="vscode-button" @click="loadSSHTree">重新加载</button>
          </div>
          <div v-else-if="filteredTree.length === 0" class="sidebar-empty">
            <i class="bi bi-hdd-network" aria-hidden="true"></i>
            <p>{{ search ? '没有找到匹配的连接' : '还没有连接' }}</p>
            <span v-if="!search">添加服务器，开始远程工作。</span>
          </div>
          <div class="ssh-tree-container">
            <SSHTreeNode
              v-for="node in filteredTree"
              :key="node.id"
              :node="node"
              :selected-id="selectedNodeId"
              :connecting-node-id="connectingNodeId"
              :connecting-elapsed-seconds="connectingElapsedSeconds"
              :auto-edit-id="autoEditNodeId"
              :edit-trigger="editTrigger"
              :force-expanded="Boolean(search.trim())"
              @select="handleNodeSelect"
              @update="handleNodeUpdate"
              @delete="handleNodeDelete"
              @connect="handleNodeConnect"
              @drag-node="handleDragNode"
              @drop-node="handleDropNode"
              @create-folder="handleCreateSubFolder"
              @create-connection="handleCreateSubConnection"
              @edit-connection="openEditConnectionDialog"
              @open-file-manager="handleOpenFileManager"
            />
          </div>
        </div>

        <!-- SSH 连接配置对话框 -->
        <SSHConnectionDialog
          v-model="showConnectionDialog"
          :folder-id="currentFolderId"
          :connection="editingConnection"
          :save-connection="handleConnectionSubmit"
          @test="handleConnectionTest"
        />
      </div>

      <!-- 终端视图 -->
      <div v-else-if="activeView === 'terminal'" class="p-4">
        <div class="mb-4">
          <button class="vscode-button primary w-full mb-2">新建终端</button>
        </div>

        <div class="space-y-2">
          <div class="vscode-tree-title text-xs font-medium text-vscode-fg-muted mb-2">
            终端会话
          </div>
          <div v-for="terminal in terminals" :key="terminal.id" class="vscode-tree-item">
            <i class="bi bi-terminal text-vscode-info mr-2"></i>
            <span>{{ terminal.name }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 输入对话框 -->
    <Teleport to="body">
      <div
        v-if="showInputDialog"
        class="input-dialog-overlay prism-dialog-overlay"
        @click.self="closeInputDialog"
      >
        <div
          class="input-dialog prism-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sidebar-input-title"
        >
          <div class="input-dialog-header">
            <h3 id="sidebar-input-title" class="text-sm font-medium text-vscode-fg">
              {{ inputDialogTitle }}
            </h3>
            <button
              type="button"
              @click="closeInputDialog"
              class="vscode-icon-button"
              :aria-label="$t('ssh.cancel')"
            >
              <i class="bi bi-x"></i>
            </button>
          </div>
          <div class="input-dialog-body">
            <input
              ref="inputDialogInput"
              v-model="inputDialogValue"
              type="text"
              :placeholder="inputDialogPlaceholder"
              class="form-input-full"
              @keyup.enter="confirmInputDialog"
              @keyup.escape="closeInputDialog"
            />
          </div>
          <div class="input-dialog-footer">
            <button @click="closeInputDialog" class="vscode-button">
              {{ $t('ssh.cancel') }}
            </button>
            <button
              @click="confirmInputDialog"
              class="vscode-button primary"
              :disabled="!inputDialogValue.trim()"
            >
              {{ $t('ssh.confirm') }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch, nextTick, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import SSHTreeNode, { type SSHTreeNodeData } from '../ssh/SSHTreeNode.vue'
import SSHConnectionDialog from '../ssh/SSHConnectionDialog.vue'
import { sshService } from '../../services/ssh.service'
import { settingsService } from '../../services/settings.service'
import { $alert } from '@/composables/useDialog'

interface Props {
  activeView: string
}

const props = defineProps<Props>()

const { t: $t } = useI18n()

// 输入对话框相关
const showInputDialog = ref(false)
const inputDialogTitle = ref('')
const inputDialogPlaceholder = ref('')
const inputDialogValue = ref('')
const inputDialogInput = ref<HTMLInputElement | null>(null)
const inputDialogCallback = ref<((value: string) => void) | null>(null)

// 注入 openNewTab 方法
const openNewTab =
  inject<(id: string, name: string, icon: string, path: string) => void>('openNewTab')

// ============= SSH 相关（✅ 直接使用 sshService） =============
const sshTreeData = ref<SSHTreeNodeData[]>([])
const search = ref('')
const filteredTree = computed(() => {
  const term = search.value.trim().toLocaleLowerCase()
  if (!term) return sshTreeData.value
  const filterNodes = (nodes: SSHTreeNodeData[]): SSHTreeNodeData[] =>
    nodes.flatMap(node => {
      if (
        `${node.name ?? ''} ${node.host ?? ''} ${node.username ?? ''}`
          .toLocaleLowerCase()
          .includes(term)
      )
        return [node]
      const children = filterNodes(node.children ?? [])
      return children.length ? [{ ...node, children }] : []
    })
  return filterNodes(sshTreeData.value)
})
const handleCreateConnection = () => openConnectionDialog(null)
const selectedNodeId = ref<string | null>(null)
const connectingNodeId = ref<string | null>(null)
const connectingElapsedSeconds = ref(0)
const sshLoading = ref(false)
const sshError = ref<string | null>(null)
let connectingTimer: number | null = null

// 拖拽的节点
const dragNode = ref<SSHTreeNodeData | null>(null)

// 连接对话框
const showConnectionDialog = ref(false)
const currentFolderId = ref<string | null>(null)
const editingConnection = ref<any>(null)

// 自动编辑的节点 ID
const autoEditNodeId = ref<string | null>(null)
// 编辑触发计数器（用于强制触发 watch）
const editTrigger = ref(0)

// ============= SSH 数据加载 =============
onMounted(() => {
  loadSSHTree()
  window.addEventListener('ssh-connections-imported', loadSSHTree)
  window.addEventListener('ssh-create-connection', handleCreateConnection)
})

watch(
  () => props.activeView,
  newView => {
    if (newView === 'ssh') {
      loadSSHTree()
    }
  }
)

const clearConnectionProgress = () => {
  if (connectingTimer) {
    window.clearInterval(connectingTimer)
    connectingTimer = null
  }
  connectingNodeId.value = null
  connectingElapsedSeconds.value = 0
}

onUnmounted(() => {
  clearConnectionProgress()
  window.removeEventListener('ssh-connections-imported', loadSSHTree)
  window.removeEventListener('ssh-create-connection', handleCreateConnection)
})

const getSSHSettings = async () => {
  const settings = await settingsService.getSettings()
  return {
    timeout: settings?.ssh?.timeout || 10,
    keepAlive: settings?.ssh?.keepAlive !== false,
    keepAliveInterval: settings?.ssh?.keepAliveInterval ?? 15
  }
}

const loadSSHTree = async () => {
  sshLoading.value = true
  sshError.value = null

  try {
    // ✅ 直接使用 sshService
    sshTreeData.value = await sshService.getSSHTree()
  } catch (err: any) {
    sshError.value = err.message || '加载 SSH 树失败'
    console.error('加载 SSH 树失败:', err)
  } finally {
    sshLoading.value = false
  }
}

const terminals = ref([
  { id: '1', name: 'bash' },
  { id: '2', name: 'powershell' }
])

// 计算侧边栏标题
const sidebarTitle = computed(() => {
  const titles: Record<string, string> = {
    ssh: $t('sidebar.ssh'),
    terminal: $t('sidebar.terminal')
  }
  return titles[props.activeView] || $t('sidebar.ssh')
})

// 创建根文件夹
const createRootFolder = async () => {
  try {
    // ✅ 直接使用 sshService
    const newFolder = await sshService.createFolder({
      name: '新建文件夹',
      order: 0
    })

    // 重新加载树
    await loadSSHTree()

    // 创建成功后，等待树重新加载完成，然后标记为自动编辑
    if (newFolder && newFolder.id) {
      // 等待树加载和 DOM 更新完成
      await nextTick()
      await new Promise(resolve => setTimeout(resolve, 150))

      autoEditNodeId.value = newFolder.id
      editTrigger.value++ // 增加触发计数器

      // 清除标记
      setTimeout(() => {
        autoEditNodeId.value = null
      }, 500)
    }
  } catch (err) {
    console.error('创建文件夹失败:', err)
  }
}

// 打开连接对话框（新建）
const openConnectionDialog = (folderId: string | null = null) => {
  editingConnection.value = null
  currentFolderId.value = folderId
  showConnectionDialog.value = true
}

// 打开编辑连接对话框
const openEditConnectionDialog = (connection: any) => {
  editingConnection.value = connection
  currentFolderId.value = connection.folderId
  showConnectionDialog.value = true
}

// 处理连接提交
const handleConnectionSubmit = async (data: any) => {
  const connection = editingConnection.value
  if (connection) {
    // ✅ 编辑模式 - 直接使用 sshService
    await sshService.updateConnection(connection.id, {
      ...data,
      authType: data.authType as any
    })
  } else {
    // ✅ 新建模式 - 直接使用 sshService
    await sshService.createConnection({
      ...data,
      authType: data.authType as any
    })
  }

  // 重新加载树
  await loadSSHTree()

  // 关闭对话框后重置编辑状态
  if (editingConnection.value === connection) editingConnection.value = null
}

// 处理连接测试
const handleConnectionTest = async (data: any) => {
  try {
    // 使用 sshService 进行测试，自动根据 storageMode 选择本地或远程实现
    const result = await sshService.testConnection({
      host: data.host,
      port: data.port || 22,
      username: data.username,
      authType: data.authType,
      password: data.password,
      privateKey: data.privateKey,
      passphrase: data.passphrase
    })

    if (result.success) {
      return { success: true, message: '连接测试成功！' }
    } else {
      return {
        success: false,
        message: result.message || '连接测试失败'
      }
    }
  } catch (err: any) {
    console.error('测试连接失败:', err)
    return {
      success: false,
      message: err.message || '测试连接时发生错误'
    }
  }
}

// 选中节点
const handleNodeSelect = (node: SSHTreeNodeData) => {
  selectedNodeId.value = node.id
}

// 更新节点
const handleNodeUpdate = async (node: SSHTreeNodeData) => {
  try {
    if (node.type === 'folder') {
      // ✅ 直接使用 sshService
      await sshService.updateFolder(node.id, {
        name: node.name,
        parentId: node.parentId,
        order: node.order
      })
    } else {
      // ✅ 直接使用 sshService
      await sshService.updateConnection(node.id, {
        name: node.name,
        host: node.host,
        port: node.port,
        username: node.username,
        password: node.password,
        authType: node.authType,
        folderId: node.folderId,
        order: node.order
      })
    }
    // 重新加载树
    await loadSSHTree()
  } catch (err) {
    console.error('更新节点失败:', err)
  }
}

// 删除节点
const handleNodeDelete = async (node: SSHTreeNodeData) => {
  try {
    if (node.type === 'folder') {
      // ✅ 直接使用 sshService
      await sshService.deleteFolder(node.id)
    } else {
      // ✅ 直接使用 sshService
      await sshService.deleteConnection(node.id)
    }
    // 重新加载树
    await loadSSHTree()
  } catch (err) {
    console.error('删除节点失败:', err)
  }
}

// 连接节点
const handleNodeConnect = async (node: SSHTreeNodeData) => {
  if (node.type !== 'connection') {
    return
  }

  if (connectingNodeId.value) {
    return
  }

  try {
    // 检查是否在 Electron 环境
    if (!window.electronAPI) {
      $alert('SSH 连接功能仅在桌面应用中可用')
      return
    }

    connectingNodeId.value = node.id
    connectingElapsedSeconds.value = 1
    connectingTimer = window.setInterval(() => {
      connectingElapsedSeconds.value += 1
    }, 1000)

    // 构建连接配置
    const sshSettings = await getSSHSettings()
    const connectionConfig = {
      id: node.id,
      name: node.name,
      host: node.host,
      port: node.port || 22,
      username: node.username,
      authType: node.authType,
      password: node.password,
      privateKey: node.privateKey,
      passphrase: node.passphrase,
      timeout: sshSettings.timeout,
      keepAlive: sshSettings.keepAlive,
      keepAliveInterval: sshSettings.keepAliveInterval
    }

    // 调用 Electron IPC 建立 SSH 连接
    const result = await window.electronAPI.ssh.connect(connectionConfig)

    if (result && result.status === 'connected') {
      // 连接成功，打开终端标签页
      if (openNewTab) {
        const terminalId = `terminal-${result.id || node.id}`
        openNewTab(
          terminalId,
          `${node.name} (${node.host})`,
          'bi bi-terminal',
          `/terminal?connectionId=${result.id || node.id}&nodeId=${node.id}&name=${encodeURIComponent(node.name)}`
        )
      }
    } else {
      $alert(`连接失败: ${result?.message || '未知错误'}`)
    }
  } catch (err: any) {
    $alert(`连接失败: ${err.message || '未知错误'}`)
  } finally {
    clearConnectionProgress()
  }
}

// 拖拽节点
const handleDragNode = (node: SSHTreeNodeData) => {
  dragNode.value = node
}

// 放置节点
const handleDropNode = async (data: { dragNode: SSHTreeNodeData; dropNode: SSHTreeNodeData }) => {
  const { dragNode, dropNode } = data

  // 防止拖到自己或自己的子节点
  if (dragNode.id === dropNode.id) {
    return
  }

  try {
    // ✅ 直接使用 sshService
    await sshService.moveNode({
      nodeId: dragNode.id,
      nodeType: dragNode.type,
      targetFolderId: dropNode.type === 'folder' ? dropNode.id : dropNode.folderId,
      order: 0
    })
    // 重新加载树
    await loadSSHTree()
  } catch (err) {
    console.error('移动节点失败:', err)
  }
}

// 创建子文件夹
const handleCreateSubFolder = async (data: { parentId: string; name: string }) => {
  try {
    // ✅ 直接使用 sshService
    const newFolder = await sshService.createFolder({
      name: data.name,
      parentId: data.parentId,
      order: 0
    })

    // 重新加载树
    await loadSSHTree()
    // 创建成功后，等待树重新加载完成，然后标记为自动编辑
    if (newFolder && newFolder.id) {
      // 等待树加载和 DOM 更新完成
      await nextTick()
      await new Promise(resolve => setTimeout(resolve, 150))

      autoEditNodeId.value = newFolder.id
      editTrigger.value++ // 增加触发计数器

      // 清除标记
      setTimeout(() => {
        autoEditNodeId.value = null
      }, 500)
    }
  } catch (err) {
    console.error('创建子文件夹失败:', err)
  }
}

// 创建子连接（从右键菜单触发）
const handleCreateSubConnection = (data: { folderId: string; name: string }) => {
  // 打开对话框，并传入 folderId
  openConnectionDialog(data.folderId)
}

const handleOpenFileManager = async (connection: SSHTreeNodeData) => {
  if (!window.electronAPI) {
    $alert('文件管理功能仅在桌面应用中可用')
    return
  }

  if (!openNewTab) {
    console.error('openNewTab 方法未注入')
    return
  }

  try {
    const sshSettings = await getSSHSettings()
    const connectionConfig = {
      id: connection.id,
      name: connection.name,
      host: connection.host,
      port: connection.port || 22,
      username: connection.username,
      authType: connection.authType,
      password: connection.password,
      privateKey: connection.privateKey,
      passphrase: connection.passphrase,
      timeout: sshSettings.timeout,
      keepAlive: sshSettings.keepAlive,
      keepAliveInterval: sshSettings.keepAliveInterval
    }

    const result = await window.electronAPI.ssh.connect(connectionConfig)

    if (result && result.status === 'connected') {
      const fileManagerId = `file-manager-${result.id || connection.id}`
      openNewTab(
        fileManagerId,
        `${connection.name} - 文件管理`,
        'bi bi-folder-open',
        `/file-manager?connectionId=${result.id || connection.id}&nodeId=${connection.id}&name=${encodeURIComponent(connection.name)}&host=${encodeURIComponent(connection.host || '')}&port=${connection.port || 22}`
      )
    } else {
      $alert(`连接失败: ${result?.message || '未知错误'}`)
    }
  } catch (err: any) {
    $alert(`连接失败: ${err.message || '未知错误'}`)
  }
}

// 导航到指定视图

// 输入对话框方法

const closeInputDialog = () => {
  showInputDialog.value = false
  inputDialogTitle.value = ''
  inputDialogPlaceholder.value = ''
  inputDialogValue.value = ''
  inputDialogCallback.value = null
}

const confirmInputDialog = () => {
  const value = inputDialogValue.value.trim()
  if (value && inputDialogCallback.value) {
    inputDialogCallback.value(value)
  }
  closeInputDialog()
}

// 处理来自 ChatTreeNode 的输入请求

// ============= 文档管理方法 (已移除) =============
// 文档管理功能已移除
</script>

<style scoped>
.vscode-sidebar-container {
  min-width: 0;
  background: transparent;
  color: var(--prism-text);
  font-family: var(--prism-font);
}

.vscode-sidebar-header {
  background: transparent;
}

.vscode-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 34px;
  padding: 7px 12px;
  border: 1px solid var(--prism-border);
  border-radius: var(--prism-radius-control);
  background: var(--prism-control);
  color: var(--prism-text);
  font: inherit;
  font-size: var(--prism-font-12);
  cursor: pointer;
  touch-action: manipulation;
  transition:
    background-color var(--prism-duration) var(--prism-ease),
    border-color var(--prism-duration) var(--prism-ease),
    color var(--prism-duration) var(--prism-ease);
}

.connection-list-actions {
  display: flex;
  gap: 8px;
}
.connection-list-actions .primary {
  flex: 1;
}
.sidebar-folder-button {
  width: 36px;
  padding: 0;
}

.vscode-button:focus-visible,
.vscode-icon-button:focus-visible {
  outline: 2px solid var(--vscode-accent);
  outline-offset: 3px;
}
.vscode-button.primary {
  background: var(--vscode-accent);
  color: var(--vscode-button-foreground);
  border-color: var(--vscode-accent);
}
.vscode-button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.vscode-button:active:not(:disabled) {
  opacity: 0.8;
}

.vscode-tree-title {
  color: var(--prism-muted);
  text-transform: none;
  letter-spacing: 0;
}
.vscode-tree-item {
  display: flex;
  align-items: center;
  min-height: 34px;
  padding: 6px 8px;
  border-radius: var(--prism-radius-small);
  font-size: var(--prism-font-13);
  cursor: pointer;
  transition: background-color var(--prism-duration) var(--prism-ease);
}
.vscode-icon-button {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border: 0;
  border-radius: var(--prism-radius-small);
  background: transparent;
  color: var(--prism-muted);
  cursor: pointer;
  touch-action: manipulation;
  transition:
    background-color var(--prism-duration) var(--prism-ease),
    color var(--prism-duration) var(--prism-ease);
}
.vscode-icon-button i {
  font-size: var(--prism-font-18);
}

.sidebar-empty {
  overflow-wrap: anywhere;
}
.sidebar-empty .vscode-button {
  margin: 14px auto 0;
}
.sidebar-empty[role='status']:has(.vscode-button) {
  margin-top: 8px;
  padding: 16px 12px;
  border: 1px solid color-mix(in srgb, var(--prism-danger) 24%, transparent);
  border-radius: var(--prism-radius-control);
  background: var(--prism-danger-bg);
  color: var(--prism-danger);
}
.sidebar-search:focus-within {
  outline: 2px solid var(--vscode-accent);
  outline-offset: 2px;
}

.input-dialog-overlay {
  padding: 20px;
  z-index: 10000;
}
.input-dialog {
  width: min(100%, 420px);
  min-width: 0;
  max-height: calc(100dvh - 40px);
  overflow: auto;
}
.input-dialog-header,
.input-dialog-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 22px;
}
.input-dialog-header {
  border-bottom: 1px solid var(--prism-border);
}
.input-dialog-header h3 {
  margin: 0;
  font-size: var(--prism-font-16);
  font-weight: 600;
}
.input-dialog-body {
  padding: 22px;
}
.input-dialog-footer {
  justify-content: flex-end;
  border-top: 1px solid var(--prism-border);
}
.form-input-full {
  width: 100%;
  min-width: 0;
  min-height: 40px;
  padding: 9px 12px;
  background: var(--prism-control);
  border: 1px solid var(--prism-border);
  border-radius: var(--prism-radius-control);
  color: var(--prism-text);
  font: inherit;
  transition: border-color var(--prism-duration) var(--prism-ease);
}
.form-input-full:focus-visible {
  outline: 2px solid var(--vscode-accent);
  outline-offset: 2px;
}
.form-input-full::placeholder {
  color: var(--prism-muted);
}

@media (hover: hover) and (pointer: fine) {
  .vscode-button:hover:not(:disabled),
  .vscode-tree-item:hover,
  .vscode-icon-button:hover {
    background: var(--vscode-list-hoverBackground);
  }
  .vscode-button:hover:not(:disabled) {
    border-color: color-mix(in srgb, var(--vscode-accent) 35%, var(--prism-border));
  }
  .vscode-button.primary:hover:not(:disabled) {
    background: var(--vscode-accent-hover);
    border-color: var(--vscode-accent-hover);
  }
  .vscode-icon-button:hover {
    color: var(--prism-text);
  }
}
</style>
