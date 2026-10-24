<template>
  <div class="server-env-doc-editor">
    <!-- 编辑器头部 -->
    <div class="editor-header">
      <div class="header-left">
        <i class="bi bi-file-earmark-text"></i>
        <h3>{{ connectionInfo?.name || '服务器环境文档' }}</h3>
      </div>
      <div class="header-actions">
        <button @click="handleSave" class="prism-button prism-button--primary" :disabled="saving">
          <i class="bi bi-save" :class="{ spinning: saving }"></i>
          {{ saving ? '保存中...' : '保存' }}
        </button>
        <button @click="handleClose" class="prism-button">
          <i class="bi bi-x"></i>
          关闭
        </button>
      </div>
    </div>

    <!-- 编辑器内容 -->
    <div class="editor-content">
      <div ref="editorContainer" class="monaco-editor-container"></div>
    </div>

    <!-- 状态提示 -->
    <div v-if="saveStatus" class="save-status" :class="saveStatus.type" role="status">
      <i :class="saveStatus.icon"></i>
      {{ saveStatus.message }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import * as monaco from 'monaco-editor'
import '@/config/monaco-workers'
import '@/assets/styles/monaco-glass.css'
import { applyPrismMonacoTheme, observePrismMonacoTheme } from '@/config/monaco-theme'
import { docStorageService } from '@/services/doc-storage.service'

interface Props {
  connectionId: string
  connectionInfo?: {
    name: string
    host: string
    port: number
    username: string
  }
}

const props = defineProps<Props>()

const emit = defineEmits<{
  close: []
  saved: [doc: any]
}>()

const editorContainer = ref<HTMLElement>()
let editor: monaco.editor.IStandaloneCodeEditor | null = null
let disposeTheme = () => {}
const saving = ref(false)
const saveStatus = ref<{ type: 'success' | 'error'; icon: string; message: string } | null>(null)

// 加载或创建文档
const loadDocument = async () => {
  try {
    // 尝试读取现有文档
    let doc = await docStorageService.readServerEnvDoc(props.connectionId)

    if (!doc && props.connectionInfo) {
      // 如果不存在，生成模板
      const template = docStorageService.generateServerEnvTemplate(props.connectionInfo)
      doc = await docStorageService.saveServerEnvDoc(props.connectionId, template)
    }

    if (editor && doc) {
      editor.setValue(doc.content)
    }
  } catch (error) {
    console.error('[ServerEnvDocEditor] 加载文档失败:', error)
    if (editor) {
      editor.setValue('# 服务器环境文档\n\n加载失败，请重试。')
    }
  }
}

// 保存文档
const handleSave = async () => {
  if (!editor) return

  saving.value = true
  saveStatus.value = null

  try {
    const content = editor.getValue()
    const doc = await docStorageService.saveServerEnvDoc(props.connectionId, content)

    saveStatus.value = {
      type: 'success',
      icon: 'bi bi-check-circle-fill',
      message: '文档已保存'
    }

    emit('saved', doc)

    // 3秒后清除状态提示
    setTimeout(() => {
      saveStatus.value = null
    }, 3000)
  } catch (error: any) {
    console.error('[ServerEnvDocEditor] 保存文档失败:', error)
    saveStatus.value = {
      type: 'error',
      icon: 'bi bi-x-circle-fill',
      message: `保存失败: ${error.message}`
    }
  } finally {
    saving.value = false
  }
}

// 关闭编辑器
const handleClose = () => {
  emit('close')
}

// 初始化编辑器
onMounted(async () => {
  if (!editorContainer.value) return

  // 创建编辑器
  editor = monaco.editor.create(editorContainer.value, {
    value: '# 加载中...',
    language: 'markdown',
    theme: applyPrismMonacoTheme(),
    extraEditorClassName: 'prism-editor',
    automaticLayout: true,
    minimap: { enabled: true },
    fontSize: 14,
    lineNumbers: 'on',
    scrollBeyondLastLine: false,
    wordWrap: 'on',
    tabSize: 2,
    insertSpaces: true,
    folding: true,
    renderWhitespace: 'selection'
  })
  disposeTheme = observePrismMonacoTheme(editor)

  // 加载文档
  await loadDocument()

  // 聚焦编辑器
  editor.focus()
})

onBeforeUnmount(() => {
  disposeTheme()
  editor?.dispose()
})
</script>

<style scoped>
.server-env-doc-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  position: relative;
  background: var(--prism-surface);
  color: var(--prism-text);
  font-family: var(--prism-font);
}

.editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--vscode-panel-border);
  background: transparent;
  gap: 12px;
  flex-wrap: wrap;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.header-left i {
  font-size: 20px;
  color: var(--vscode-accent);
}

.header-left h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--vscode-fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.header-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.editor-content {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.monaco-editor-container {
  width: 100%;
  height: 100%;
}

.save-status {
  position: absolute;
  bottom: 16px;
  right: 16px;
  max-width: calc(100% - 32px);
  padding: 10px 14px;
  border-radius: var(--prism-radius-control);
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  z-index: 1000;
  box-shadow: var(--prism-shadow);
  border: 1px solid var(--prism-border);
  backdrop-filter: blur(20px);
}

.save-status.success {
  background: color-mix(in srgb, var(--prism-success) 12%, var(--prism-surface-raised));
  color: var(--prism-success);
}

.save-status.error {
  background: color-mix(in srgb, var(--prism-danger) 12%, var(--prism-surface-raised));
  color: var(--prism-danger);
}

.spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
