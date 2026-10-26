<template>
  <Teleport to="body">
    <div v-if="visible" class="modal-wrapper">
      <div class="modal-content" role="dialog" aria-modal="true" aria-label="快捷命令">
      <div class="modal-header">
        <h3 class="modal-title">
          <i class="bi bi-lightning-charge"></i>
          快捷命令
        </h3>
        <button class="btn-close" @click="handleClose" aria-label="关闭快捷命令">
          <i class="bi bi-x"></i>
        </button>
      </div>

      <div class="modal-body">
        <!-- 搜索栏 -->
        <div class="search-bar">
          <i class="bi bi-search"></i>
          <input
            v-model="searchKeyword"
            type="text"
            placeholder="搜索命令..."
            class="search-input"
          />
        </div>

        <!-- 统计信息 -->
        <div class="stats-bar">
          <span class="stat-item">
            <i class="bi bi-lightning"></i>
            共 {{ filteredCommands.length }} 个命令
          </span>
          <div class="sort-options">
            <button
              :class="['sort-btn', { active: sortBy === 'frequency' }]"
              @click="sortBy = 'frequency'"
              data-prism-tooltip="按使用频率排序"
            >
              <i class="bi bi-sort-numeric-down"></i>
              使用频率
            </button>
            <button
              :class="['sort-btn', { active: sortBy === 'time' }]"
              @click="sortBy = 'time'"
              data-prism-tooltip="按创建时间排序"
            >
              <i class="bi bi-clock-history"></i>
              创建时间
            </button>
          </div>
        </div>

        <!-- 命令列表 -->
        <div class="commands-list">
          <div
            v-if="filteredCommands.length === 0"
            class="empty-state"
          >
            <i class="bi bi-inbox"></i>
            <p>{{ searchKeyword ? '未找到匹配的命令' : '还没有快捷命令' }}</p>
            <p class="empty-hint">在终端中选中命令后右键选择"收藏为快捷命令"</p>
          </div>

          <div
            v-for="command in filteredCommands"
            :key="command.id"
            class="command-item"
            @click="handleUseCommand(command)"
          >
            <div class="command-info">
              <div class="command-header">
                <code class="command-text">{{ command.command }}</code>
                <div class="command-meta">
                  <span v-if="command.usedCount > 0" class="usage-badge">
                    <i class="bi bi-arrow-repeat"></i>
                    {{ command.usedCount }}
                  </span>
                </div>
              </div>
              <div v-if="command.description" class="command-description">
                {{ command.description }}
              </div>
              <div v-if="command.tags && command.tags.length > 0" class="command-tags">
                <span v-for="tag in command.tags" :key="tag" class="tag">
                  {{ tag }}
                </span>
              </div>
              <div class="command-footer">
                <span class="created-time">
                  {{ formatTime(command.createdAt) }}
                </span>
                <span v-if="command.lastUsedAt" class="last-used">
                  最后使用: {{ formatTime(command.lastUsedAt) }}
                </span>
              </div>
            </div>
            <div class="command-actions">
              <button
                class="action-btn btn-edit"
                @click.stop="handleEdit(command)"
                data-prism-tooltip="编辑" aria-label="编辑"
              >
                <i class="bi bi-pencil"></i>
              </button>
              <button
                class="action-btn btn-delete"
                @click.stop="handleDelete(command)"
                data-prism-tooltip="删除" aria-label="删除"
              >
                <i class="bi bi-trash"></i>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn-secondary" @click="handleClose">
          关闭
        </button>
        <button class="btn-primary" @click="handleExport">
          <i class="bi bi-download"></i>
          导出
        </button>
        <button class="btn-primary" @click="handleImport">
          <i class="bi bi-upload"></i>
          导入
        </button>
      </div>
      </div>
    </div>

    <!-- 编辑弹窗 -->
    <div v-if="editingCommand" class="edit-modal-wrapper">
      <div class="modal-content modal-small" role="dialog" aria-modal="true" aria-label="编辑快捷命令">
        <div class="modal-header">
          <h3 class="modal-title">编辑快捷命令</h3>
          <button class="btn-close" @click="cancelEdit" aria-label="关闭编辑快捷命令">
            <i class="bi bi-x"></i>
          </button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>命令</label>
            <textarea
              v-model="editForm.command"
              class="form-control"
              rows="3"
            ></textarea>
          </div>
          <div class="form-group">
            <label>描述（可选）</label>
            <input
              v-model="editForm.description"
              type="text"
              class="form-control"
              placeholder="添加描述..."
            />
          </div>
          <div class="form-group">
            <label>标签（可选，用逗号分隔）</label>
            <input
              v-model="editForm.tagsText"
              type="text"
              class="form-control"
              placeholder="如: docker, 部署, 常用"
            />
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" @click="cancelEdit">取消</button>
          <button class="btn-primary" @click="saveEdit">保存</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { shortcutCommandService, type ShortcutCommand } from '@/services/shortcut-command.service'
import { $alert, $confirm } from '@/composables/useDialog'

interface Props {
  visible: boolean
  connectionId?: string
}

interface Emits {
  (e: 'close'): void
  (e: 'use-command', command: string): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

// 数据
const commands = ref<ShortcutCommand[]>([])
const searchKeyword = ref('')
const sortBy = ref<'frequency' | 'time'>('frequency')
const editingCommand = ref<ShortcutCommand | null>(null)
const editForm = ref({
  command: '',
  description: '',
  tagsText: ''
})

// 计算属性
const filteredCommands = computed(() => {
  let list = commands.value

  // 搜索过滤
  if (searchKeyword.value) {
    list = shortcutCommandService.search(searchKeyword.value, props.connectionId)
  }

  // 排序
  if (sortBy.value === 'frequency') {
    list = [...list].sort((a, b) => b.usedCount - a.usedCount)
  } else {
    list = [...list].sort((a, b) => b.createdAt - a.createdAt)
  }

  return list
})

// 监听 visible 变化，刷新数据
watch(() => props.visible, (newVal) => {
  if (newVal) {
    loadCommands()
  }
})

// ESC 键关闭弹窗
const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    if (editingCommand.value) {
      cancelEdit()
    } else if (props.visible) {
      handleClose()
    }
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleKeydown)
})

// 方法
const loadCommands = () => {
  commands.value = shortcutCommandService.getAll(props.connectionId)
}

const handleClose = () => {
  emit('close')
}

const handleUseCommand = (command: ShortcutCommand) => {
  shortcutCommandService.recordUsage(command.id, props.connectionId)
  emit('use-command', command.command)
  emit('close')
}

const handleEdit = (command: ShortcutCommand) => {
  editingCommand.value = command
  editForm.value = {
    command: command.command,
    description: command.description || '',
    tagsText: command.tags?.join(', ') || ''
  }
}

const cancelEdit = () => {
  editingCommand.value = null
  editForm.value = {
    command: '',
    description: '',
    tagsText: ''
  }
}

const saveEdit = () => {
  if (!editingCommand.value) return

  const tags = editForm.value.tagsText
    .split(',')
    .map(t => t.trim())
    .filter(t => t.length > 0)

  shortcutCommandService.update(
    editingCommand.value.id,
    {
      command: editForm.value.command,
      description: editForm.value.description || undefined,
      tags: tags.length > 0 ? tags : undefined
    },
    props.connectionId
  )

  loadCommands()
  cancelEdit()
}

const handleDelete = async (command: ShortcutCommand) => {
  if (await $confirm(`确定要删除快捷命令 "${command.command}" 吗？`)) {
    shortcutCommandService.delete(command.id, props.connectionId)
    loadCommands()
  }
}

const handleExport = () => {
  const data = shortcutCommandService.export(props.connectionId)
  const blob = new Blob([data], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const timestamp = Date.now()
  const connId = props.connectionId ? `_${props.connectionId}` : ''
  a.download = `shortcut-commands${connId}_${timestamp}.json`
  a.click()
  URL.revokeObjectURL(url)
}

const handleImport = () => {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'application/json'
  input.onchange = (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (e) => {
      const data = e.target?.result as string
      if (shortcutCommandService.import(data, props.connectionId)) {
        loadCommands();
        
        $alert('导入成功！')
      } else {
        $alert('导入失败，请检查文件格式')
      }
    }
    reader.readAsText(file)
  }
  input.click()
}

const formatTime = (timestamp: number): string => {
  const date = new Date(timestamp)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  
  // 小于1分钟
  if (diff < 60 * 1000) {
    return '刚刚'
  }
  // 小于1小时
  if (diff < 60 * 60 * 1000) {
    return `${Math.floor(diff / 60 / 1000)} 分钟前`
  }
  // 小于1天
  if (diff < 24 * 60 * 60 * 1000) {
    return `${Math.floor(diff / 60 / 60 / 1000)} 小时前`
  }
  // 小于7天
  if (diff < 7 * 24 * 60 * 60 * 1000) {
    return `${Math.floor(diff / 24 / 60 / 60 / 1000)} 天前`
  }
  
  // 格式化为日期
  return date.toLocaleDateString('zh-CN')
}

// 初始加载
if (props.visible) {
  loadCommands()
}
</script>

<style scoped>
.modal-wrapper {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: var(--prism-z-dialog);
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--prism-overlay, color-mix(in srgb, var(--liquid-canvas) 42%, transparent));
  backdrop-filter: blur(10px);
  padding: 20px;
  font-family: var(--prism-font);
}

.edit-modal-wrapper {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: var(--prism-z-nested-dialog);
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--prism-overlay, color-mix(in srgb, var(--liquid-canvas) 42%, transparent));
  backdrop-filter: blur(10px);
  padding: 20px;
  font-family: var(--prism-font);
}

.modal-content {
  background: var(--prism-surface);
  border-radius: var(--prism-radius-dialog);
  box-shadow: var(--prism-shadow-raised);
  border: 1px solid var(--liquid-rim);
  width: 800px;
  max-width: 90vw;
  max-height: calc(100dvh - 40px);
  display: flex;
  flex-direction: column;
  position: relative;
  backdrop-filter: blur(28px) saturate(1.3);
  overflow: hidden;
  color: var(--prism-text);
}

.modal-small {
  width: 500px;
  max-width: 100%;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--vscode-border);
}

.modal-title {
  margin: 0;
  font-size: var(--prism-font-18);
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--vscode-fg);
}

.btn-close {
  background: none;
  border: none;
  font-size: var(--prism-font-20);
  cursor: pointer;
  color: var(--vscode-fg-muted);
  padding: 0;
  border-radius: var(--prism-radius-control);
  transition: background-color var(--prism-duration) var(--prism-ease), border-color var(--prism-duration) var(--prism-ease), color var(--prism-duration) var(--prism-ease), opacity var(--prism-duration) var(--prism-ease), transform var(--prism-duration) var(--prism-ease);
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
}

.btn-close:hover {
  background: var(--vscode-list-hoverBackground);
  color: var(--vscode-fg);
}

.modal-body {
  padding: 20px;
  overflow-y: auto;
  flex: 1;
}

.search-bar {
  position: relative;
  margin-bottom: 16px;
}

.search-bar i {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--vscode-fg-muted);
}

.search-input {
  width: 100%;
  padding: 8px 12px 8px 36px;
  border: 1px solid var(--vscode-border);
  border-radius: var(--prism-radius-control);
  background: var(--prism-control);
  color: var(--vscode-fg);
  font-size: var(--prism-font-14);
  min-height: 38px;
}

.search-input:focus {
  outline: none;
  border-color: var(--vscode-accent);
}

.stats-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  padding: 8px 12px;
  background: color-mix(in srgb, var(--prism-control) 50%, transparent);
  border-radius: var(--prism-radius-control);
  gap: 12px;
  flex-wrap: wrap;
}

.stat-item {
  font-size: var(--prism-font-13);
  color: var(--vscode-fg-muted);
  display: flex;
  align-items: center;
  gap: 6px;
}

.sort-options {
  display: flex;
  gap: 4px;
}

.sort-btn {
  padding: 4px 10px;
  border: 1px solid var(--vscode-border);
  background: var(--vscode-bg);
  color: var(--vscode-fg-muted);
  border-radius: var(--prism-radius-small);
  cursor: pointer;
  font-size: var(--prism-font-12);
  display: flex;
  align-items: center;
  gap: 4px;
  transition: background-color var(--prism-duration) var(--prism-ease), border-color var(--prism-duration) var(--prism-ease), color var(--prism-duration) var(--prism-ease), opacity var(--prism-duration) var(--prism-ease), transform var(--prism-duration) var(--prism-ease);
  min-height: 32px;
}

.sort-btn:hover {
  background: var(--vscode-list-hoverBackground);
  color: var(--vscode-fg);
}

.sort-btn.active {
  background: var(--prism-info-bg);
  color: var(--vscode-accent);
  border-color: color-mix(in srgb, var(--vscode-accent) 30%, transparent);
}

.commands-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: var(--vscode-fg-muted);
}

.empty-state i {
  font-size: var(--prism-font-48);
  margin-bottom: 16px;
  opacity: 0.5;
}

.empty-state p {
  margin: 8px 0;
}

.empty-hint {
  font-size: var(--prism-font-13);
  opacity: 0.7;
}

.command-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 12px;
  border: 1px solid var(--vscode-border);
  border-radius: var(--prism-radius-control);
  background: var(--prism-control);
  cursor: pointer;
  transition: background-color var(--prism-duration) var(--prism-ease), border-color var(--prism-duration) var(--prism-ease), color var(--prism-duration) var(--prism-ease), opacity var(--prism-duration) var(--prism-ease), transform var(--prism-duration) var(--prism-ease);
}

.command-item:hover {
  background: var(--vscode-list-hoverBackground);
  border-color: var(--vscode-accent);
  transform: none;
  box-shadow: none;
}

.command-info {
  flex: 1;
  min-width: 0;
}

.command-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.command-text {
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: var(--prism-font-13);
  color: var(--vscode-fg);
  background: var(--prism-surface-raised);
  padding: 4px 8px;
  border-radius: var(--prism-radius-small);
  word-break: break-all;
}

.command-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: 8px;
}

.usage-badge {
  font-size: var(--prism-font-11);
  padding: 2px 8px;
  background: var(--vscode-accent);
  color: var(--vscode-button-foreground);
  border-radius: 10px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.command-description {
  font-size: var(--prism-font-13);
  color: var(--vscode-fg-muted);
  margin-bottom: 8px;
}

.command-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}

.tag {
  font-size: var(--prism-font-11);
  padding: 2px 8px;
  background: var(--vscode-bg);
  color: var(--vscode-fg-muted);
  border-radius: 10px;
  border: 1px solid var(--vscode-border);
}

.command-footer {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: var(--prism-font-11);
  color: var(--vscode-fg-muted);
}

.command-actions {
  display: flex;
  gap: 4px;
  margin-left: 12px;
}

.action-btn {
  padding: 0;
  border: none;
  background: transparent;
  color: var(--vscode-fg-muted);
  border-radius: var(--prism-radius-small);
  cursor: pointer;
  transition: background-color var(--prism-duration) var(--prism-ease), border-color var(--prism-duration) var(--prism-ease), color var(--prism-duration) var(--prism-ease), opacity var(--prism-duration) var(--prism-ease), transform var(--prism-duration) var(--prism-ease);
  font-size: var(--prism-font-14);
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
}

.action-btn:hover {
  background: var(--vscode-bg);
  color: var(--vscode-fg);
}

.btn-delete:hover {
  color: var(--prism-danger);
  background: var(--prism-danger-bg);
}

.modal-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 16px 20px;
  border-top: 1px solid var(--vscode-border);
}

.btn-primary,
.btn-secondary {
  padding: 8px 16px;
  border-radius: var(--prism-radius-control);
  border: none;
  cursor: pointer;
  font-size: var(--prism-font-14);
  display: flex;
  align-items: center;
  gap: 6px;
  transition: background-color var(--prism-duration) var(--prism-ease), border-color var(--prism-duration) var(--prism-ease), color var(--prism-duration) var(--prism-ease), opacity var(--prism-duration) var(--prism-ease), transform var(--prism-duration) var(--prism-ease);
}

.btn-primary {
  background: var(--vscode-accent);
  color: var(--vscode-button-foreground);
}

.btn-primary:hover {
  background: var(--vscode-accent-hover);
}

.btn-secondary {
  background: var(--vscode-bg-lighter);
  color: var(--vscode-fg);
  border: 1px solid var(--vscode-border);
}

.btn-secondary:hover {
  background: var(--vscode-list-hoverBackground);
}

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  margin-bottom: 6px;
  font-size: var(--prism-font-13);
  font-weight: 500;
  color: var(--vscode-fg);
}

.form-control {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--vscode-border);
  border-radius: var(--prism-radius-control);
  background: var(--prism-control);
  color: var(--vscode-fg);
  font-size: var(--prism-font-14);
  font-family: inherit;
  min-height: 38px;
}

.form-control:focus {
  outline: none;
  border-color: var(--vscode-accent);
}

textarea.form-control {
  resize: vertical;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
}
button { touch-action: manipulation; }
button:focus-visible { outline: 2px solid var(--vscode-accent); outline-offset: 2px; }
.btn-primary, .btn-secondary { min-height: 36px; border-radius: var(--prism-radius-control); font-family: inherit; }
.modal-body { min-height: 0; }
.modal-footer, .sort-options, .command-footer { flex-wrap: wrap; }
@media (max-width: 600px) {
  .modal-wrapper, .edit-modal-wrapper { padding: 12px; }
  .modal-content, .modal-small { width: 100%; max-width: 100%; max-height: calc(100dvh - 24px); }
  .modal-header, .modal-body, .modal-footer { padding: 14px 16px; }
  .modal-title { font-size: var(--prism-font-16); }
  .command-item { gap: 8px; }
  .command-actions { margin-left: 0; }
  .command-header { flex-wrap: wrap; gap: 8px; }
}
</style>

