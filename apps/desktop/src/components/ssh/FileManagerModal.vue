<template>
  <div v-if="visible" class="file-manager-modal-overlay" @click.self="handleClose">
    <div class="file-manager-modal" role="dialog" aria-modal="true" aria-label="文件管理">
      <!-- 标题栏 -->
      <div class="modal-header">
        <div class="modal-title">
          <i class="bi bi-folder-open"></i>
          <span>文件管理 - {{ connection?.name }}</span>
        </div>
        <button class="close-button" @click="handleClose" aria-label="关闭文件管理">
          <i class="bi bi-x"></i>
        </button>
      </div>

      <!-- 工具栏 -->
      <div class="toolbar">
        <div class="toolbar-left">
          <button class="toolbar-btn" @click="goBack" :disabled="currentPath === '/'">
            <i class="bi bi-arrow-left"></i>
            返回
          </button>
          <button class="toolbar-btn" @click="goHome">
            <i class="bi bi-house"></i>
            主目录
          </button>
          <button class="toolbar-btn" @click="refreshFiles">
            <i class="bi bi-arrow-clockwise"></i>
            刷新
          </button>
        </div>
        <div class="toolbar-right">
          <button class="toolbar-btn primary" @click="handleUpload">
            <i class="bi bi-upload"></i>
            上传文件
          </button>
          <button class="toolbar-btn" @click="createFolder">
            <i class="bi bi-folder-plus"></i>
            新建文件夹
          </button>
        </div>
      </div>

      <!-- 路径导航 -->
      <div class="path-bar">
        <i class="bi bi-folder"></i>
        <input 
          v-model="currentPath" 
          class="path-input"
          @keydown.enter="navigateToPath"
          placeholder="输入路径..."
        />
      </div>

      <!-- 文件列表 -->
      <div class="file-list-container">
        <!-- 批量操作栏 -->
        <div v-if="selectedFiles.length > 0" class="bulk-actions">
          <div class="selected-info">
            已选择 {{ selectedFiles.length }} 个文件
          </div>
          <div class="bulk-buttons">
            <button class="toolbar-btn primary" @click="handleBulkDownload">
              <i class="bi bi-download"></i>
              批量下载
            </button>
            <button class="toolbar-btn danger" @click="handleBulkDelete">
              <i class="bi bi-trash"></i>
              批量删除
            </button>
            <button class="toolbar-btn" @click="clearSelection">
              <i class="bi bi-x"></i>
              取消选择
            </button>
          </div>
        </div>

        <!-- 文件列表头部 -->
        <div class="file-list-header">
          <div class="file-col-checkbox">
            <input 
              type="checkbox" 
              :checked="isAllSelected"
              @change="toggleSelectAll"
            />
          </div>
          <div class="file-col-name">名称</div>
          <div class="file-col-size">大小</div>
          <div class="file-col-modified">修改时间</div>
          <div class="file-col-actions">操作</div>
        </div>

        <!-- 文件列表 -->
        <div class="file-list">
          <div v-if="loading" class="loading-state">
            <div class="spinner"></div>
            <span>加载中...</span>
          </div>
          
          <div v-else-if="files.length === 0" class="empty-state">
            <i class="bi bi-folder-open"></i>
            <span>此目录为空</span>
          </div>

          <div 
            v-for="file in files" 
            :key="file.name"
            :class="['file-item', { 'selected': isFileSelected(file) }]"
            @click="handleFileClick(file)"
            @dblclick="handleFileDoubleClick(file)"
          >
            <div class="file-col-checkbox" @click.stop>
              <input 
                type="checkbox" 
                :checked="isFileSelected(file)"
                @change="toggleFileSelection(file)"
              />
            </div>
            <div class="file-col-name">
              <i :class="['file-icon', getFileIcon(file)]"></i>
              <span class="file-name">{{ file.name }}</span>
            </div>
            <div class="file-col-size">
              {{ file.type === 'directory' ? '-' : formatFileSize(file.size) }}
            </div>
            <div class="file-col-modified">
              {{ formatDate(file.modifiedTime) }}
            </div>
            <div class="file-col-actions" @click.stop>
              <button 
                v-if="file.type === 'file'" 
                class="action-btn" 
                @click="downloadFile(file)"
                data-prism-tooltip="下载" aria-label="下载"
              >
                <i class="bi bi-download"></i>
              </button>
              <button 
                class="action-btn danger" 
                @click="deleteFile(file)"
                data-prism-tooltip="删除" aria-label="删除"
              >
                <i class="bi bi-trash"></i>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 状态栏 -->
      <div class="status-bar">
        <div class="status-left">
          {{ files.length }} 个项目
          <span v-if="selectedFiles.length > 0"> - 已选择 {{ selectedFiles.length }} 个</span>
        </div>
        <div class="status-right">
          {{ connection?.host }}:{{ connection?.port }}
        </div>
      </div>
    </div>
    
    <!-- 输入对话框 -->
    <div v-if="showInputDialog" class="input-dialog-overlay" @click.self="closeInputDialog">
      <div class="input-dialog" role="dialog" aria-modal="true" :aria-label="inputDialogTitle">
        <div class="input-dialog-header">
          <h3 class="text-sm font-medium text-vscode-fg">{{ inputDialogTitle }}</h3>
          <button @click="closeInputDialog" class="vscode-icon-button" aria-label="关闭输入对话框">
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
            取消
          </button>
          <button @click="confirmInputDialog" class="vscode-button primary">
            确定
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import type { SSHTreeNodeData } from './SSHTreeNode.vue'
import { $alert, $confirm } from '@/composables/useDialog'

interface FileItem {
  name: string
  type: 'file' | 'directory'
  size: number
  modifiedTime: string
  permissions?: string
}

interface Props {
  visible: boolean
  connection: SSHTreeNodeData | null
}

const props = defineProps<Props>()
const emit = defineEmits<{
  'update:visible': [value: boolean]
  close: []
}>()

// 状态
const currentPath = ref('/')
const files = ref<FileItem[]>([])
const loading = ref(false)
const selectedFiles = ref<FileItem[]>([])

// 输入对话框相关
const showInputDialog = ref(false)
const inputDialogTitle = ref('')
const inputDialogPlaceholder = ref('')
const inputDialogValue = ref('')
const inputDialogInput = ref<HTMLInputElement | null>(null)
const inputDialogCallback = ref<((value: string) => void) | null>(null)

// 计算属性
const isAllSelected = computed(() => {
  return files.value.length > 0 && selectedFiles.value.length === files.value.length
})

// 加载文件列表
const loadFiles = async () => {
  if (!props.connection || !window.electronAPI) {
    return
  }

  loading.value = true
  try {
    const result = await window.electronAPI.ssh.listFiles(
      props.connection.id,
      currentPath.value
    )
    
    if (result.success) {
      files.value = result.files
    } else {
      $alert(`加载文件列表失败: ${result.error}`)
    }
  } catch (error: any) {
    $alert(`加载文件列表失败: ${error.message}`)
  } finally {
    loading.value = false
  }
}

// 在加载函数初始化后注册即时监听，支持直接以已打开状态挂载。
watch(() => props.connection, (newConnection) => {
  if (newConnection && props.visible) {
    currentPath.value = '/'
    loadFiles()
  }
}, { immediate: true })

watch(() => props.visible, (visible) => {
  if (visible && props.connection) {
    loadFiles()
  } else {
    // 关闭时清空选择
    selectedFiles.value = []
  }
})

// 文件操作
const handleFileClick = (file: FileItem) => {
  // 单击选择文件
  if (!isFileSelected(file)) {
    selectedFiles.value = [file]
  }
}

const handleFileDoubleClick = (file: FileItem) => {
  if (file.type === 'directory') {
    navigateToDirectory(file.name)
  }
}

const navigateToDirectory = (dirName: string) => {
  if (currentPath.value === '/') {
    currentPath.value = `/${dirName}`
  } else {
    currentPath.value = `${currentPath.value}/${dirName}`
  }
  selectedFiles.value = []
  loadFiles()
}

const navigateToPath = () => {
  selectedFiles.value = []
  loadFiles()
}

const goBack = () => {
  if (currentPath.value === '/') return
  
  const parts = currentPath.value.split('/').filter(p => p)
  parts.pop()
  currentPath.value = parts.length > 0 ? '/' + parts.join('/') : '/'
  selectedFiles.value = []
  loadFiles()
}

const goHome = () => {
  currentPath.value = '/'
  selectedFiles.value = []
  loadFiles()
}

const refreshFiles = () => {
  selectedFiles.value = []
  loadFiles()
}

// 文件选择
const isFileSelected = (file: FileItem) => {
  return selectedFiles.value.some(f => f.name === file.name)
}

const toggleFileSelection = (file: FileItem) => {
  const index = selectedFiles.value.findIndex(f => f.name === file.name)
  if (index >= 0) {
    selectedFiles.value.splice(index, 1)
  } else {
    selectedFiles.value.push(file)
  }
}

const toggleSelectAll = () => {
  if (isAllSelected.value) {
    selectedFiles.value = []
  } else {
    selectedFiles.value = [...files.value]
  }
}

const clearSelection = () => {
  selectedFiles.value = []
}

// 上传文件
const handleUpload = async () => {
  if (!props.connection || !window.electronAPI) return

  try {
    const filePaths = await window.electronAPI.fs.showOpenDialog({
      title: '选择要上传的文件',
      properties: ['openFile', 'multiSelections']
    })

    if (filePaths && filePaths.length > 0) {
      loading.value = true
      for (const localPath of filePaths) {
        const fileName = localPath.split(/[/\\]/).pop() || 'file'
        const remotePath = currentPath.value === '/' 
          ? `/${fileName}` 
          : `${currentPath.value}/${fileName}`
        
        await window.electronAPI.ssh.uploadFile(
          props.connection.id,
          localPath,
          remotePath
        )
      }
      
      $alert(`成功上传 ${filePaths.length} 个文件`)
      await loadFiles()
    }
  } catch (error: any) {
    $alert(`上传失败: ${error.message}`)
  } finally {
    loading.value = false
  }
}

// 下载文件
const downloadFile = async (file: FileItem) => {
  if (!props.connection || !window.electronAPI) return

  try {
    const remotePath = currentPath.value === '/' 
      ? `/${file.name}` 
      : `${currentPath.value}/${file.name}`
    
    const localPath = await window.electronAPI.fs.showSaveDialog({
      title: '保存文件',
      defaultPath: file.name
    })

    if (localPath) {
      loading.value = true
      await window.electronAPI.ssh.downloadFile(
        props.connection.id,
        remotePath,
        localPath
      );
      $alert('下载成功')
    }
  } catch (error: any) {
    $alert(`下载失败: ${error.message}`)
  } finally {
    loading.value = false
  }
}

// 批量下载
const handleBulkDownload = async () => {
  if (selectedFiles.value.length === 0) return

  try {
    const folderPath = await window.electronAPI.fs.showOpenDialog({
      title: '选择下载目录',
      properties: ['openDirectory']
    })

    if (folderPath && folderPath.length > 0) {
      loading.value = true
      
      for (const file of selectedFiles.value) {
        if (file.type === 'file') {
          const remotePath = currentPath.value === '/' 
            ? `/${file.name}` 
            : `${currentPath.value}/${file.name}`
          const localPath = `${folderPath[0]}/${file.name}`
          
          await window.electronAPI.ssh.downloadFile(
            props.connection!.id,
            remotePath,
            localPath
          )
        }
      }
      
      $alert(`成功下载 ${selectedFiles.value.filter(f => f.type === 'file').length} 个文件`)
      selectedFiles.value = []
    }
  } catch (error: any) {
    $alert(`批量下载失败: ${error.message}`)
  } finally {
    loading.value = false
  }
}

// 删除文件
const deleteFile = async (file: FileItem) => {
  if (!(await $confirm(`确定要删除 "${file.name}" 吗？`))) return

  if (!props.connection || !window.electronAPI) return

  try {
    const remotePath = currentPath.value === '/' 
      ? `/${file.name}` 
      : `${currentPath.value}/${file.name}`
    
    loading.value = true
    await window.electronAPI.ssh.deleteFile(
      props.connection.id,
      remotePath,
      file.type === 'directory'
    )
    
    await loadFiles()
  } catch (error: any) {
    $alert(`删除失败: ${error.message}`)
  } finally {
    loading.value = false
  }
}

// 批量删除
const handleBulkDelete = async () => {
  if (selectedFiles.value.length === 0) return
  
  if (!(await $confirm(`确定要删除选中的 ${selectedFiles.value.length} 个项目吗？`))) return

  if (!props.connection || !window.electronAPI) return

  try {
    loading.value = true
    
    for (const file of selectedFiles.value) {
      const remotePath = currentPath.value === '/' 
        ? `/${file.name}` 
        : `${currentPath.value}/${file.name}`
      
      await window.electronAPI.ssh.deleteFile(
        props.connection.id,
        remotePath,
        file.type === 'directory'
      )
    }
    
    selectedFiles.value = []
    await loadFiles()
  } catch (error: any) {
    $alert(`批量删除失败: ${error.message}`)
  } finally {
    loading.value = false
  }
}

// 输入对话框方法
const showInputPrompt = (title: string, placeholder: string, callback: (value: string) => void) => {
  inputDialogTitle.value = title
  inputDialogPlaceholder.value = placeholder
  inputDialogValue.value = ''
  inputDialogCallback.value = callback
  showInputDialog.value = true
  
  // 自动聚焦输入框
  nextTick(() => {
    inputDialogInput.value?.focus()
  })
}

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

// 新建文件夹
const createFolder = async () => {
  showInputPrompt('新建文件夹', '请输入文件夹名称', async (folderName: string) => {
    if (!props.connection || !window.electronAPI) return

    try {
      const remotePath = currentPath.value === '/' 
        ? `/${folderName}` 
        : `${currentPath.value}/${folderName}`
      
      loading.value = true
      await window.electronAPI.ssh.createDirectory(
        props.connection.id,
        remotePath
      )
      
      await loadFiles()
    } catch (error: any) {
      $alert(`创建文件夹失败: ${error.message}`)
    } finally {
      loading.value = false
    }
  })
}

// 工具函数
const getFileIcon = (file: FileItem) => {
  if (file.type === 'directory') {
    return 'bi bi-folder-fill'
  }
  
  const ext = file.name.split('.').pop()?.toLowerCase()
  const iconMap: Record<string, string> = {
    'txt': 'bi bi-file-text',
    'pdf': 'bi bi-file-pdf',
    'doc': 'bi bi-file-word',
    'docx': 'bi bi-file-word',
    'xls': 'bi bi-file-excel',
    'xlsx': 'bi bi-file-excel',
    'ppt': 'bi bi-file-ppt',
    'pptx': 'bi bi-file-ppt',
    'zip': 'bi bi-file-zip',
    'rar': 'bi bi-file-zip',
    'jpg': 'bi bi-file-image',
    'jpeg': 'bi bi-file-image',
    'png': 'bi bi-file-image',
    'gif': 'bi bi-file-image',
    'mp3': 'bi bi-file-music',
    'mp4': 'bi bi-file-play',
    'avi': 'bi bi-file-play',
  }
  
  return iconMap[ext || ''] || 'bi bi-file-earmark'
}

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

const formatDate = (dateStr: string): string => {
  const date = new Date(dateStr)
  return date.toLocaleDateString('zh-CN') + ' ' + date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit'
  })
}

const handleClose = () => {
  emit('update:visible', false)
  emit('close')
}
</script>

<style scoped>
.file-manager-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--prism-overlay, color-mix(in srgb, var(--liquid-canvas) 42%, transparent));
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  animation: fadeIn 0.2s ease;
  backdrop-filter: blur(10px);
  padding: 20px;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.file-manager-modal {
  background: var(--prism-surface);
  border: 1px solid var(--liquid-rim);
  border-radius: var(--prism-radius-dialog);
  width: 90%;
  max-width: 1200px;
  height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: var(--prism-shadow-raised);
  animation: slideUp 0.3s ease;
  backdrop-filter: blur(28px) saturate(1.3);
  overflow: hidden;
  max-height: calc(100dvh - 40px);
  min-width: 0;
  color: var(--prism-text);
  font-family: var(--prism-font);
  container: file-workspace / inline-size;
}

@keyframes slideUp {
  from {
    transform: translateY(20px);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--vscode-border);
  background: transparent;
}

.modal-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: var(--prism-font-16);
  font-weight: 600;
  color: var(--vscode-fg);
}

.close-button {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: var(--prism-radius-small);
  cursor: pointer;
  color: var(--vscode-fg-muted);
  transition: background-color var(--prism-duration) var(--prism-ease), border-color var(--prism-duration) var(--prism-ease), color var(--prism-duration) var(--prism-ease), opacity var(--prism-duration) var(--prism-ease), transform var(--prism-duration) var(--prism-ease);
}

.close-button:hover {
  background: var(--vscode-bg-lighter);
  color: var(--vscode-fg);
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  border-bottom: 1px solid var(--vscode-border);
  background: transparent;
}

.toolbar-left,
.toolbar-right {
  display: flex;
  gap: 8px;
}

.toolbar-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: var(--prism-control);
  border: 1px solid var(--vscode-border);
  border-radius: var(--prism-radius-control);
  color: var(--vscode-fg);
  font-size: var(--prism-font-13);
  cursor: pointer;
  transition: background-color var(--prism-duration) var(--prism-ease), border-color var(--prism-duration) var(--prism-ease), color var(--prism-duration) var(--prism-ease), opacity var(--prism-duration) var(--prism-ease), transform var(--prism-duration) var(--prism-ease);
  min-height: 34px;
  font-family: inherit;
}

.toolbar-btn:hover:not(:disabled) {
  background: var(--vscode-bg-lighter);
  border-color: var(--vscode-accent);
}

.toolbar-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.toolbar-btn.primary {
  background: var(--vscode-button-background);
  border-color: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}

.toolbar-btn.primary:hover:not(:disabled) {
  background: var(--vscode-accent-hover);
  border-color: var(--vscode-accent-hover);
}

.toolbar-btn.danger {
  color: var(--vscode-error);
}

.toolbar-btn.danger:hover:not(:disabled) {
  background: var(--vscode-error);
  border-color: var(--vscode-error);
  color: var(--prism-surface-raised);
}

.path-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--vscode-border);
  background: transparent;
}

.path-input {
  flex: 1;
  padding: 6px 12px;
  background: var(--prism-control);
  border: 1px solid var(--vscode-border);
  border-radius: var(--prism-radius-control);
  color: var(--vscode-fg);
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: var(--prism-font-13);
  outline: none;
  min-width: 0;
  min-height: 36px;
}

.path-input:focus {
  border-color: var(--vscode-accent);
}

.file-list-container {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.bulk-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 20px;
  background: var(--prism-info-bg);
  color: var(--vscode-accent);
  gap: 12px;
  flex-wrap: wrap;
}

.selected-info {
  font-size: var(--prism-font-13);
  font-weight: 500;
}

.bulk-buttons {
  display: flex;
  gap: 8px;
}

.file-list-header {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) 90px 136px 132px;
  gap: 12px;
  padding: 10px 16px;
  background: color-mix(in srgb, var(--prism-control) 58%, transparent);
  border-bottom: 1px solid var(--vscode-border);
  font-size: var(--prism-font-12);
  font-weight: 600;
  color: var(--vscode-fg-muted);
  text-transform: none;
  letter-spacing: normal;
}

.file-list {
  flex: 1;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--vscode-border) transparent;
  min-height: 0;
  background: color-mix(in srgb, var(--prism-surface-raised) 68%, transparent);
}

.file-list::-webkit-scrollbar {
  width: 8px;
}

.file-list::-webkit-scrollbar-track {
  background: transparent;
}

.file-list::-webkit-scrollbar-thumb {
  background: var(--vscode-border);
  border-radius: var(--prism-radius-small);
}

.loading-state,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  color: var(--vscode-fg-muted);
  gap: 16px;
}

.loading-state i,
.empty-state i {
  font-size: var(--prism-font-48);
}

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--vscode-border);
  border-top-color: var(--vscode-accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.file-item {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) 90px 136px 132px;
  gap: 12px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--vscode-border);
  cursor: pointer;
  transition: background 0.1s ease;
  min-height: 44px;
}

.file-item:hover {
  background: var(--vscode-list-hoverBackground);
}

.file-item.selected {
  background: var(--vscode-list-activeSelectionBackground);
  color: var(--vscode-list-activeSelectionForeground);
}

.file-col-checkbox {
  display: flex;
  align-items: center;
  justify-content: center;
}

.file-col-name {
  display: flex;
  align-items: center;
  gap: 10px;
  overflow: hidden;
}

.file-icon {
  flex-shrink: 0;
  font-size: var(--prism-font-16);
}

.file-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--prism-font-13);
}

.file-col-size,
.file-col-modified,
.file-col-actions {
  display: flex;
  align-items: center;
  font-size: var(--prism-font-13);
  opacity: 1;
}

.file-col-actions {
  gap: 6px;
  opacity: 1;
  transition: opacity 0.15s ease;
}

.file-item:hover .file-col-actions {
  opacity: 1;
}

.action-btn {
  width: 28px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--prism-radius-small);
  cursor: pointer;
  color: var(--vscode-fg-muted);
  transition: background-color var(--prism-duration) var(--prism-ease), border-color var(--prism-duration) var(--prism-ease), color var(--prism-duration) var(--prism-ease), opacity var(--prism-duration) var(--prism-ease), transform var(--prism-duration) var(--prism-ease);
  min-width: 30px;
}

.action-btn:hover {
  background: var(--vscode-bg);
  border-color: var(--vscode-border);
  color: var(--vscode-fg);
}

.action-btn.danger:hover {
  background: var(--prism-danger-bg);
  border-color: color-mix(in srgb, var(--prism-danger) 35%, transparent);
  color: var(--vscode-button-foreground);
}

.status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 20px;
  border-top: 1px solid var(--vscode-border);
  background: transparent;
  font-size: var(--prism-font-12);
  color: var(--vscode-fg-muted);
}



/* 输入对话框样式 */
.input-dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--prism-overlay, color-mix(in srgb, var(--liquid-canvas) 42%, transparent));
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10001;
  backdrop-filter: blur(10px);
  padding: 20px;
}

.input-dialog {
  background: var(--prism-surface);
  border: 1px solid var(--liquid-rim);
  border-radius: var(--prism-radius-dialog);
  width: 400px;
  max-width: 90vw;
  box-shadow: var(--prism-shadow-raised);
  backdrop-filter: blur(28px) saturate(1.3);
  overflow: hidden;
}

.input-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--vscode-border);
}

.input-dialog-body {
  padding: 16px;
}

.input-dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--vscode-border);
}

.form-input-full {
  width: 100%;
  padding: 8px 12px;
  background: var(--prism-control);
  border: 1px solid var(--vscode-border);
  border-radius: var(--prism-radius-control);
  color: var(--vscode-fg);
  font-size: var(--prism-font-13);
  outline: none;
  min-height: 38px;
}

.form-input-full:focus {
  border-color: var(--vscode-accent);
}

.vscode-icon-button {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--prism-radius-control);
  transition: color 0.15s ease;
  color: var(--vscode-fg-muted);
  cursor: pointer;
  border: none;
  background: transparent;
}

.vscode-icon-button:hover {
  color: var(--vscode-fg);
  background: var(--vscode-bg-lighter);
}

.vscode-button {
  padding: 6px 12px;
  font-size: var(--prism-font-13);
  border: 1px solid var(--vscode-border);
  border-radius: var(--prism-radius-control);
  background: var(--vscode-bg-light);
  color: var(--vscode-fg);
  cursor: pointer;
  transition: background-color var(--prism-duration) var(--prism-ease), border-color var(--prism-duration) var(--prism-ease), color var(--prism-duration) var(--prism-ease), opacity var(--prism-duration) var(--prism-ease), transform var(--prism-duration) var(--prism-ease);
  min-height: 36px;
}

.vscode-button:hover {
  background: var(--vscode-bg-lighter);
  border-color: var(--vscode-accent);
}

.vscode-button.primary {
  background: var(--vscode-accent);
  color: var(--vscode-button-foreground);
  border-color: var(--vscode-accent);
}

.vscode-button.primary:hover {
  background: var(--vscode-accent-hover);
  border-color: var(--vscode-accent-hover);
}
/* Keep file tools usable when the workspace shares space with another pane. */
.toolbar, .toolbar-left, .toolbar-right, .status-bar, .status-right { flex-wrap: wrap; }
.toolbar-left, .toolbar-right { align-items: center; }
.file-col-checkbox input { accent-color: var(--vscode-accent); width: 15px; height: 15px; }
.toolbar-btn:focus-visible, .action-btn:focus-visible, .close-button:focus-visible,
.close-btn:focus-visible, .footer-btn:focus-visible, .task-btn:focus-visible,
.vscode-button:focus-visible, .vscode-icon-button:focus-visible, .btn-cancel:focus-visible,
.btn-confirm:focus-visible { outline: 2px solid var(--vscode-accent); outline-offset: 2px; }
button { touch-action: manipulation; }
@container file-workspace (max-width: 760px) {
  .file-list-header, .file-item { grid-template-columns: 28px minmax(0, 1fr) 76px 104px; gap: 8px; }
  .file-col-modified { display: none; }
  .file-col-actions { gap: 4px; }
  .action-btn span { display: none; }
  .action-btn { width: 32px; }
  .connection-info { min-width: 0; flex-wrap: wrap; gap: 8px; }
  .connection-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .host-info { display: none; }
  .toolbar, .path-bar { padding: 10px 12px; gap: 8px; }
}
@container file-workspace (max-width: 440px) {
  .file-list-header, .file-item { grid-template-columns: 24px minmax(0, 1fr) 74px; }
  .file-col-size { display: none; }
  .toolbar-btn { padding-inline: 9px; font-size: var(--prism-font-12); }
  .status-bar { gap: 8px; }
}
@media (hover: none) { .file-col-actions { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .file-manager-modal-overlay, .file-manager-modal, .create-folder-overlay, .create-folder-dialog,
  .upload-manager-overlay, .upload-manager-modal, .download-manager-overlay, .download-manager-modal { animation: none; }
}
@media (max-width: 600px) {
  .file-manager-modal-overlay { padding: 12px; }
  .file-manager-modal { width: 100%; height: calc(100dvh - 24px); max-height: calc(100dvh - 24px); }
  .modal-header { padding: 12px 16px; }
}
</style>

