<template>
  <div class="ssh-tree-node">
    <!-- 节点内容 -->
    <div
      :class="[
        'tree-node-content',
        {
          'is-selected': isSelected,
          'is-dragging': isDragging,
          'is-drag-over': isDragOver
        }
      ]"
      :style="{ paddingLeft: `${depth * 16}px` }"
      draggable="true"
      tabindex="0"
      :aria-label="node.name"
      @keydown.enter.self.prevent="handleNodeClick"
      @keydown.space.self.prevent="handleNodeClick"
      @keydown.f2.self.prevent="startEdit"
      @keydown.escape="closeActionMenu"
      @click="handleNodeClick"
      @dragstart="handleDragStart"
      @dragend="handleDragEnd"
      @dragover.prevent="handleDragOver"
      @dragleave="handleDragLeave"
      @drop.prevent="handleDrop"
      @contextmenu.prevent="openContextMenu"
    >
      <!-- 展开/折叠图标 -->
      <div v-if="node.type !== 'connection'" class="tree-node-arrow">
        <svg
          v-if="node.type === 'folder'"
          :class="['chevron-icon', { expanded: isExpanded || forceExpanded }]"
          width="16"
          height="16"
          viewBox="0 0 16 16"
        >
          <path fill="currentColor" d="M6 4l4 4-4 4V4z" />
        </svg>
        <span v-else class="tree-node-spacer"></span>
      </div>

      <!-- 节点图标（仅显示连接图标） -->
      <i
        v-if="node.type === 'connection'"
        class="bi bi-hdd-network tree-node-icon text-vscode-accent"
      ></i>

      <!-- 节点名称 -->
      <input
        v-if="isEditing"
        ref="editInput"
        v-model="editName"
        type="text"
        class="tree-node-input"
        @blur="handleEditBlur"
        @keydown.enter="handleEditConfirm"
        @keydown.esc="cancelEdit"
        @click.stop
      />
      <span v-else class="tree-node-label-group">
        <span class="tree-node-label">{{ node.name }}</span>
        <span v-if="isConnecting" class="tree-node-connection-status">
          连接中 {{ connectingElapsedSeconds }}s
        </span>
      </span>

      <!-- 更多操作按钮 -->
      <div :class="['tree-node-actions', { 'menu-visible': showActions }]" @click.stop>
        <div ref="actionMenuWrapper" class="action-menu-wrapper">
          <button
            type="button"
            class="vscode-icon-button more-button"
            :aria-label="`${node.name}：更多操作`"
            aria-haspopup="menu"
            :aria-expanded="showActions"
            @click="toggleActionMenu($event)"
            @mouseenter="showActionMenu($event)"
            @mouseleave="scheduleHideActionMenu"
          >
            <i class="bi bi-three-dots-vertical"></i>
          </button>

          <!-- 操作下拉菜单 -->
          <div
            v-if="showActions"
            class="action-dropdown prism-menu"
            role="menu"
            @keydown="handleActionMenuKeydown"
            :style="actionDropdownStyle"
            @mouseenter="cancelHideActionMenu"
            @mouseleave="scheduleHideActionMenu"
          >
            <!-- 连接节点菜单 -->
            <template v-if="node.type === 'connection'">
              <button type="button" class="action-item" role="menuitem" @click="handleConnect">
                <i class="bi bi-play"></i>
                <span>{{ $t('ssh.treeConnect') }}</span>
              </button>
              <button
                type="button"
                class="action-item"
                role="menuitem"
                @click="handleOpenFileManager"
              >
                <i class="bi bi-folder-open"></i>
                <span>{{ $t('ssh.treeFileManager') }}</span>
              </button>
              <div class="action-divider"></div>
              <button
                type="button"
                class="action-item"
                role="menuitem"
                @click="handleEditConnection"
              >
                <i class="bi bi-gear"></i>
                <span>{{ $t('ssh.treeEdit') }}</span>
              </button>
              <button type="button" class="action-item" role="menuitem" @click="startEdit">
                <i class="bi bi-pencil"></i>
                <span>{{ $t('ssh.treeRename') }}</span>
              </button>
              <button
                type="button"
                class="action-item danger"
                role="menuitem"
                @click="handleDelete"
              >
                <i class="bi bi-trash"></i>
                <span>{{ $t('ssh.treeDelete') }}</span>
              </button>
            </template>

            <!-- 文件夹节点菜单 -->
            <template v-else>
              <button type="button" class="action-item" role="menuitem" @click="handleCreateFolder">
                <i class="bi bi-folder-plus"></i>
                <span>{{ $t('ssh.treeNewFolder') }}</span>
              </button>
              <button
                type="button"
                class="action-item"
                role="menuitem"
                @click="handleCreateConnection"
              >
                <i class="bi bi-hdd-network"></i>
                <span>{{ $t('ssh.treeNewConnection') }}</span>
              </button>
              <div class="action-divider"></div>
              <button type="button" class="action-item" role="menuitem" @click="startEdit">
                <i class="bi bi-pencil"></i>
                <span>{{ $t('ssh.treeRename') }}</span>
              </button>
              <button
                type="button"
                class="action-item danger"
                role="menuitem"
                @click="handleDelete"
              >
                <i class="bi bi-trash"></i>
                <span>{{ $t('ssh.treeDelete') }}</span>
              </button>
            </template>
          </div>
        </div>
      </div>
    </div>

    <!-- 子节点 -->
    <div
      v-if="node.type === 'folder' && (isExpanded || forceExpanded) && node.children"
      class="tree-node-children"
    >
      <SSHTreeNode
        v-for="child in node.children"
        :key="child.id"
        :node="child"
        :depth="depth + 1"
        :selected-id="selectedId"
        :connecting-node-id="connectingNodeId"
        :connecting-elapsed-seconds="connectingElapsedSeconds"
        :auto-edit-id="autoEditId"
        :edit-trigger="editTrigger"
        :force-expanded="forceExpanded"
        @select="$emit('select', $event)"
        @update="$emit('update', $event)"
        @delete="$emit('delete', $event)"
        @connect="$emit('connect', $event)"
        @drag-node="$emit('drag-node', $event)"
        @drop-node="$emit('drop-node', $event)"
        @create-folder="$emit('create-folder', $event)"
        @create-connection="$emit('create-connection', $event)"
        @edit-connection="$emit('edit-connection', $event)"
        @open-file-manager="$emit('open-file-manager', $event)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, watch, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'

export interface SSHTreeNodeData {
  id: string
  name: string
  type: 'folder' | 'connection'
  order?: number
  children?: SSHTreeNodeData[]
  // 文件夹特有属性
  parentId?: string | null
  // 连接特有属性
  host?: string
  port?: number
  username?: string
  password?: string
  privateKey?: string
  passphrase?: string
  authType?: string
  folderId?: string | null
  status?: string
}

interface Props {
  node: SSHTreeNodeData
  forceExpanded?: boolean
  depth?: number
  selectedId?: string | null
  connectingNodeId?: string | null
  connectingElapsedSeconds?: number
  autoEditId?: string | null
  editTrigger?: number
}

const props = withDefaults(defineProps<Props>(), {
  depth: 0,
  selectedId: null,
  connectingNodeId: null,
  connectingElapsedSeconds: 0,
  autoEditId: null,
  editTrigger: 0
})

const { t: $t } = useI18n()

const emit = defineEmits<{
  select: [node: SSHTreeNodeData]
  update: [node: SSHTreeNodeData]
  delete: [node: SSHTreeNodeData]
  connect: [node: SSHTreeNodeData]
  'drag-node': [node: SSHTreeNodeData]
  'drop-node': [data: { dragNode: SSHTreeNodeData; dropNode: SSHTreeNodeData }]
  'create-folder': [data: { parentId: string; name: string }]
  'create-connection': [data: { folderId: string; name: string }]
  'edit-connection': [connection: SSHTreeNodeData]
  'open-file-manager': [connection: SSHTreeNodeData]
}>()

// 展开/折叠状态（文件夹默认展开）
const isExpanded = ref(props.node.type === 'folder')

// 选中状态
const isSelected = computed(() => props.selectedId === props.node.id)
const isConnecting = computed(
  () => props.node.type === 'connection' && props.connectingNodeId === props.node.id
)

// 编辑状态
const isEditing = ref(false)
const editName = ref('')
const editInput = ref<HTMLInputElement | null>(null)

// 拖拽状态
const isDragging = ref(false)
const isDragOver = ref(false)

// 操作菜单
const showActions = ref(false)
const actionMenuMode = ref<'hover' | 'contextmenu' | null>(null)
const actionMenuPosition = ref({ left: 0, top: 0 })
const actionMenuWrapper = ref<HTMLElement | null>(null)
let hideTimer: number | null = null

const actionDropdownStyle = computed(() => ({
  left: `${actionMenuPosition.value.left}px`,
  top: `${actionMenuPosition.value.top}px`
}))

const tryConnectNode = () => {
  emit('connect', props.node)
}

// 监听 editTrigger 和 autoEditId，如果匹配当前节点则自动进入编辑模式
watch([() => props.editTrigger, () => props.autoEditId], ([trigger, editId]) => {
  if (editId && editId === props.node.id && trigger > 0) {
    nextTick(() => {
      startEdit()
    })
  }
})

// 切换展开/折叠
const toggleExpand = () => {
  if (props.node.type === 'folder') {
    isExpanded.value = !isExpanded.value
  }
}

// 点击节点（整行点击）
const handleNodeClick = async () => {
  emit('select', props.node)
  // 如果是文件夹，点击整行展开/折叠
  if (props.node.type === 'folder') {
    toggleExpand()
  }
  // 如果是连接节点，直接连接
  else if (props.node.type === 'connection') {
    await tryConnectNode()
  }
}

// Keep the floating menu within the visible workspace, including near the status bar.
const fitActionMenu = async () => {
  await nextTick()
  const menu = actionMenuWrapper.value?.querySelector<HTMLElement>('.action-dropdown')
  if (!showActions.value || !menu) return
  const rect = menu.getBoundingClientRect()
  actionMenuPosition.value = {
    left: Math.max(8, Math.min(actionMenuPosition.value.left, window.innerWidth - rect.width - 8)),
    top: Math.max(8, Math.min(actionMenuPosition.value.top, window.innerHeight - rect.height - 8))
  }
}

const closeActionMenu = () => {
  showActions.value = false
  actionMenuMode.value = null
  cancelHideActionMenu()
}

const handleActionMenuKeydown = (event: KeyboardEvent) => {
  const controls = Array.from(
    actionMenuWrapper.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []
  )
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    closeActionMenu()
    actionMenuWrapper.value?.querySelector<HTMLButtonElement>('.more-button')?.focus()
  } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault()
    const index = controls.indexOf(document.activeElement as HTMLButtonElement)
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? controls.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + controls.length) % controls.length
    controls[next]?.focus()
  }
}

// 显示操作菜单
const showActionMenu = (event?: MouseEvent) => {
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }

  if (showActions.value && actionMenuMode.value === 'contextmenu') {
    return
  }

  if (event?.currentTarget instanceof HTMLElement) {
    const rect = event.currentTarget.getBoundingClientRect()
    actionMenuPosition.value = {
      left: rect.right - 168,
      top: rect.bottom + 2
    }
  }

  actionMenuMode.value = 'hover'
  showActions.value = true
  void fitActionMenu()
}

// 切换操作菜单
const toggleActionMenu = (event?: MouseEvent) => {
  if (showActions.value && actionMenuMode.value === 'contextmenu') {
    return
  }

  if (showActions.value) {
    showActions.value = false
    actionMenuMode.value = null
    return
  }

  showActionMenu(event)
}

const openContextMenu = (event: MouseEvent) => {
  cancelHideActionMenu()
  actionMenuPosition.value = {
    left: event.clientX,
    top: event.clientY
  }
  actionMenuMode.value = 'contextmenu'
  showActions.value = true
  void fitActionMenu()
}

// 延迟隐藏操作菜单
const scheduleHideActionMenu = () => {
  if (actionMenuMode.value !== 'hover') {
    return
  }

  hideTimer = window.setTimeout(() => {
    showActions.value = false
    actionMenuMode.value = null
  }, 200)
}

// 取消隐藏操作菜单
const cancelHideActionMenu = () => {
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
}

const handleOutsideClick = (event: MouseEvent) => {
  if (!showActions.value || actionMenuMode.value !== 'contextmenu') {
    return
  }

  if (actionMenuWrapper.value?.contains(event.target as Node)) {
    return
  }

  showActions.value = false
  actionMenuMode.value = null
}

onMounted(() => {
  document.addEventListener('click', handleOutsideClick, true)
})

onBeforeUnmount(() => {
  cancelHideActionMenu()
  document.removeEventListener('click', handleOutsideClick, true)
})

// 处理连接
const handleConnect = async () => {
  await tryConnectNode()
  showActions.value = false
  actionMenuMode.value = null
}

// 处理删除
const handleDelete = () => {
  emit('delete', props.node)
  showActions.value = false
  actionMenuMode.value = null
}

// 处理编辑连接
const handleEditConnection = () => {
  emit('edit-connection', props.node)
  showActions.value = false
  actionMenuMode.value = null
}

const handleOpenFileManager = () => {
  emit('open-file-manager', props.node)
  showActions.value = false
  actionMenuMode.value = null
}

// 处理创建文件夹
const handleCreateFolder = () => {
  if (props.node.type === 'folder') {
    emit('create-folder', {
      parentId: props.node.id,
      name: '新建文件夹'
    })
    isExpanded.value = true
  }
  showActions.value = false
  actionMenuMode.value = null
}

// 处理创建连接
const handleCreateConnection = () => {
  if (props.node.type === 'folder') {
    emit('create-connection', {
      folderId: props.node.id,
      name: '新建连接'
    })
    isExpanded.value = true
  }
  showActions.value = false
  actionMenuMode.value = null
}

// 开始编辑
const startEdit = () => {
  editName.value = props.node.name
  isEditing.value = true
  showActions.value = false
  actionMenuMode.value = null
  nextTick(() => {
    editInput.value?.focus()
    editInput.value?.select()
  })
}

// 确认编辑
const handleEditConfirm = () => {
  if (editName.value.trim()) {
    emit('update', { ...props.node, name: editName.value.trim() })
  }
  isEditing.value = false
}

// 取消编辑
const cancelEdit = () => {
  editName.value = props.node.name
  isEditing.value = false
}

// 失去焦点时确认编辑
const handleEditBlur = () => {
  handleEditConfirm()
}

// 拖拽开始
const handleDragStart = (event: DragEvent) => {
  isDragging.value = true
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('application/json', JSON.stringify(props.node))
  }
  emit('drag-node', props.node)
}

// 拖拽结束
const handleDragEnd = () => {
  isDragging.value = false
}

// 拖拽经过
const handleDragOver = (event: DragEvent) => {
  if (props.node.type === 'folder') {
    isDragOver.value = true
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move'
    }
  }
}

// 拖拽离开
const handleDragLeave = () => {
  isDragOver.value = false
}

// 放置
const handleDrop = (event: DragEvent) => {
  isDragOver.value = false
  if (props.node.type === 'folder' && event.dataTransfer) {
    const dragNodeData = JSON.parse(event.dataTransfer.getData('application/json'))
    emit('drop-node', { dragNode: dragNodeData, dropNode: props.node })
  }
}
</script>

<style scoped>
.ssh-tree-node {
  user-select: none;
  min-width: 0;
}
.tree-node-content {
  display: flex;
  align-items: center;
  min-height: 34px;
  padding: 4px 7px 4px 0;
  border: 1px solid transparent;
  border-radius: var(--prism-radius-control);
  position: relative;
  font-size: 13px;
  cursor: pointer;
  transition:
    background-color var(--prism-duration) var(--prism-ease),
    border-color var(--prism-duration) var(--prism-ease);
}
.tree-node-content:focus-visible {
  outline: 2px solid var(--vscode-accent);
  outline-offset: -2px;
}
.tree-node-content.is-selected {
  background: var(--vscode-list-activeSelectionBackground);
}
.tree-node-content.is-dragging {
  opacity: 0.5;
}
.tree-node-content.is-drag-over {
  background: var(--vscode-list-activeSelectionBackground);
  border-color: var(--vscode-accent);
}
.tree-node-arrow {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  margin-right: 4px;
  color: var(--prism-muted);
}
.chevron-icon {
  transform: rotate(0deg);
  color: var(--prism-muted);
  transition: transform 150ms var(--prism-ease);
}
.chevron-icon.expanded {
  transform: rotate(90deg);
}
.tree-node-spacer {
  width: 16px;
  height: 16px;
}
.tree-node-icon {
  flex-shrink: 0;
  margin: 0 7px;
  font-size: 15px;
}
.tree-node-label-group {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 6px;
  min-width: 0;
  flex: 1;
}
.tree-node-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--prism-text);
}
.tree-node-connection-status {
  padding: 3px 6px;
  border-radius: var(--prism-radius-small);
  background: var(--prism-warning-bg);
  color: var(--prism-warning);
  font-size: 10px;
  line-height: 1.3;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.tree-node-input {
  flex: 1;
  width: 100%;
  min-width: 0;
  padding: 4px 7px;
  border: 1px solid var(--vscode-accent);
  border-radius: var(--prism-radius-small);
  background: var(--prism-control);
  color: var(--prism-text);
  font: inherit;
  font-size: 13px;
}
.tree-node-input:focus-visible {
  outline: 2px solid var(--vscode-accent);
  outline-offset: 1px;
}
.tree-node-actions {
  display: flex;
  flex-shrink: 0;
  gap: 4px;
  margin-left: auto;
  opacity: 0;
  transition: opacity 120ms var(--prism-ease);
}
.tree-node-content:hover .tree-node-actions,
.tree-node-content:focus-within .tree-node-actions,
.tree-node-actions.menu-visible {
  opacity: 1;
}
.tree-node-children {
  margin-left: 0;
}
.vscode-icon-button {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: var(--prism-radius-small);
  background: transparent;
  color: var(--prism-muted);
  cursor: pointer;
  touch-action: manipulation;
  transition:
    background-color 120ms var(--prism-ease),
    color 120ms var(--prism-ease);
}
.vscode-icon-button:focus-visible {
  outline: 2px solid var(--vscode-accent);
  outline-offset: 1px;
}
.vscode-icon-button i {
  font-size: 14px;
}
.action-menu-wrapper {
  position: relative;
}
.more-button {
  opacity: 1;
}
.action-dropdown {
  position: fixed;
  z-index: 10000;
  min-width: 168px;
  max-width: calc(100vw - 16px);
  max-height: calc(100dvh - 16px);
  overflow-y: auto;
  padding: 5px;
  background: color-mix(in srgb, var(--prism-surface-raised) 91%, transparent);
  border: 1px solid var(--prism-border);
  border-radius: var(--prism-radius-panel);
  box-shadow: var(--prism-shadow);
  backdrop-filter: blur(22px) saturate(1.2);
}
.action-item {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 34px;
  gap: 10px;
  padding: 7px 10px;
  border: 0;
  border-radius: var(--prism-radius-small);
  background: transparent;
  color: var(--prism-text);
  text-align: left;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  touch-action: manipulation;
  transition:
    background-color 120ms var(--prism-ease),
    color 120ms var(--prism-ease);
}
.action-item:focus-visible {
  outline: 2px solid var(--vscode-accent);
  outline-offset: -2px;
  background: var(--vscode-list-hoverBackground);
}
.action-item.danger {
  color: var(--prism-danger);
}
.action-item.danger:focus-visible {
  background: var(--prism-danger-bg);
}
.action-divider {
  height: 1px;
  margin: 5px;
  background: var(--prism-border);
}
.action-item i {
  width: 16px;
  font-size: 14px;
  text-align: center;
}
@media (hover: hover) and (pointer: fine) {
  .tree-node-content:hover:not(.is-selected) {
    background: var(--vscode-list-hoverBackground);
  }
  .vscode-icon-button:hover {
    background: var(--vscode-list-hoverBackground);
    color: var(--prism-text);
  }
  .action-item:hover {
    background: var(--vscode-list-hoverBackground);
  }
  .action-item.danger:hover {
    background: var(--prism-danger-bg);
  }
}
@media (hover: none), (pointer: coarse) {
  .tree-node-actions {
    opacity: 1;
  }
}
@media (prefers-reduced-motion: reduce) {
  .chevron-icon {
    transition: none;
  }
}
html[data-motion='off'] .chevron-icon,
html[data-transitions='off'] .chevron-icon {
  transition: none;
}
</style>
