<template>
  <div class="prompt-optimizer-view prism-settings">
    <!-- 左侧导航树 -->
    <div class="settings-sidebar">
      <div class="sidebar-header">
        <h3 class="sidebar-title">提示词优化助手</h3>
      </div>
      <nav class="settings-nav">
        <button
          type="button"
          v-for="section in optimizerSections"
          :key="section.id"
          :class="['nav-item', { active: activeSection === section.id }]"
          :aria-current="activeSection === section.id ? 'page' : undefined"
          :data-prism-tooltip="section.label"
          @click="scrollToSection(section.id)"
        >
          <i :class="['nav-icon', section.icon]"></i>
          <span class="nav-label">{{ section.label }}</span>
        </button>
      </nav>
    </div>

    <!-- 内容区域 -->
    <div class="settings-content" ref="contentContainer" @scroll="onScroll">
      <div class="content-inner">
        <!-- 步骤1: 任务描述与生成提示词 -->
        <section :id="'section-task'" class="setting-section prism-settings-section">
          <h2 class="section-title">
            <i class="bi bi-1-circle"></i>
            描述您的任务
          </h2>
          <p class="section-description">
            告诉 AI 您希望助手完成什么任务，我们将为您生成基础提示词
          </p>

          <div class="setting-row">
            <div class="task-input-container">
              <textarea
                v-model="taskDescription"
                placeholder="例如：我需要一个专业的 Python 编程助手，能够帮我解答代码问题，提供最佳实践建议..."
                class="form-textarea"
                rows="6"
                @keydown="handleTextareaKeyDown"
              ></textarea>
              <button
                @click="generatePrompt"
                :disabled="!taskDescription.trim() || isGenerating"
                class="btn-primary prism-button prism-button--primary generate-btn"
              >
                <i :class="['bi', isGenerating ? 'bi-hourglass-split' : 'bi-magic']"></i>
                {{ isGenerating ? '生成中...' : '生成基础提示词' }}
              </button>
            </div>
          </div>
        </section>

        <!-- 步骤2: 显示生成的提示词并测试 -->
        <section :id="'section-prompt'" class="setting-section prism-settings-section">
          <h2 class="section-title">
            <i class="bi bi-2-circle"></i>
            生成的提示词
          </h2>
          <p class="section-description">这是根据您的任务描述生成的系统提示词，您可以进行测试</p>

          <div class="setting-row">
            <textarea
              v-model="generatedPrompt"
              placeholder="您可以手动编辑提示词后再测试..."
              class="form-textarea prompt-display"
              rows="10"
              @keydown="handlePromptTextareaKeyDown"
            ></textarea>
          </div>

          <div class="setting-row">
            <div class="setting-left">
              <label class="setting-label">测试提示词</label>
              <p class="setting-hint">输入一个测试问题，查看 AI 的回复效果</p>
            </div>
            <div class="setting-right">
              <input
                v-model="testQuestion"
                type="text"
                placeholder="例如：如何实现一个二分查找算法？"
                class="form-input"
              />
              <button
                @click="testPrompt"
                :disabled="!testQuestion.trim() || isTesting"
                class="btn-primary prism-button prism-button--primary mt-2"
              >
                <i :class="['bi', isTesting ? 'bi-hourglass-split' : 'bi-send']"></i>
                {{ isTesting ? '测试中...' : '测试提示词' }}
              </button>
            </div>
          </div>
        </section>

        <!-- 步骤3: 测试结果与优化 -->
        <section :id="'section-test'" class="setting-section prism-settings-section">
          <h2 class="section-title">
            <i class="bi bi-3-circle"></i>
            测试结果与优化
          </h2>
          <p class="section-description">查看 AI 的回复，并获取优化建议</p>

          <div class="setting-row">
            <div class="setting-left">
              <label class="setting-label">AI 回复</label>
              <p class="setting-hint">基于当前提示词，AI 对您测试问题的回复</p>
            </div>
            <div class="setting-right">
              <div class="result-container">
                <div class="result-header">
                  <span class="result-title">回复内容</span>
                  <button
                    v-if="testResult"
                    @click="copyTestResult"
                    class="btn-copy"
                    :class="{ copied: isCopied }"
                    :data-prism-tooltip="isCopied ? '已复制' : '复制回复内容'"
                  >
                    <i :class="['bi', isCopied ? 'bi-check-lg' : 'bi-clipboard']"></i>
                    {{ isCopied ? '已复制' : '复制' }}
                  </button>
                </div>
                <div class="test-result-box" :aria-busy="isTesting">
                  <span v-if="!testResult" class="result-placeholder">{{
                    isTesting ? '正在等待模型回复…' : '测试后的 AI 回复会显示在这里。'
                  }}</span>
                  <template v-else>{{ testResult }}</template>
                </div>
              </div>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-left">
              <label class="setting-label">您的点评</label>
              <p class="setting-hint">请描述您对 AI 回复的评价和期望的改进方向</p>
            </div>
            <div class="setting-right">
              <textarea
                v-model="userFeedback"
                placeholder="例如：回复太简短了，希望能提供更详细的解释和具体的代码示例..."
                class="form-textarea"
                rows="5"
                @keydown="handleTextareaKeyDown"
              ></textarea>
              <button
                @click="optimizePrompt"
                :disabled="!userFeedback.trim() || isOptimizing"
                class="btn-primary prism-button prism-button--primary mt-2"
              >
                <i :class="['bi', isOptimizing ? 'bi-hourglass-split' : 'bi-magic']"></i>
                {{ isOptimizing ? '优化中...' : '优化提示词' }}
              </button>
            </div>
          </div>
        </section>

        <!-- 操作按钮区 -->
        <div class="action-bar">
          <button
            @click="savePrompt"
            :disabled="!generatedPrompt.trim()"
            class="btn-success prism-button prism-button--primary"
          >
            <i class="bi bi-check-circle"></i>
            保存提示词
          </button>
          <button @click="resetAll" class="btn-secondary prism-button">
            <i class="bi bi-arrow-counterclockwise"></i>
            重新开始
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import { chatCompletion } from '../services/ai-api.service'
import { settingsService } from '../services/settings.service'
import { chatService } from '../services/chat.service'
import { type AIProvider, type AIModel } from '../types/ai-providers'
import { resolveSelectedModel } from '../services/selected-model-resolver.service'
import { registerModelSelectionSyncListeners } from '../utils/model-sync-events'
import { $alert, $confirm } from '@/composables/useDialog'

// 左侧菜单配置
const optimizerSections = [
  { id: 'task', label: '任务描述', icon: 'bi bi-pencil-square' },
  { id: 'prompt', label: '生成提示词', icon: 'bi bi-file-text' },
  { id: 'test', label: '测试优化', icon: 'bi bi-check2-circle' }
]

const activeSection = ref('task')
const contentContainer = ref<HTMLElement | null>(null)
const isScrolling = ref(false)
let sectionScrollTimer: ReturnType<typeof setTimeout> | undefined
let sectionScrollTarget = 0
let sectionScrollDeadline = 0
const releaseSectionScroll = () => {
  const container = contentContainer.value
  if (
    container &&
    Math.abs(container.scrollTop - sectionScrollTarget) > 2 &&
    performance.now() < sectionScrollDeadline
  ) {
    sectionScrollTimer = setTimeout(releaseSectionScroll, 120)
    return
  }
  isScrolling.value = false
  onScroll()
}

// AI 配置
const currentProvider = ref<AIProvider | null>(null)
const currentModel = ref<AIModel | null>(null)
let unregisterModelSyncListeners: (() => void) | null = null

// 步骤1: 任务描述与生成
const taskDescription = ref('')
const isGenerating = ref(false)
const generatedPrompt = ref('')

// 步骤2: 测试提示词
const testQuestion = ref('')
const isTesting = ref(false)
const testResult = ref('')

// 步骤3: 用户点评与优化
const userFeedback = ref('')
const isOptimizing = ref(false)

// 复制功能
const isCopied = ref(false)

// 加载当前选中的 AI 模型
const loadAIModelConfiguration = async () => {
  try {
    const saved = localStorage.getItem('selectedAIModel')
    if (!saved) {
      currentProvider.value = null
      currentModel.value = null
      console.warn('[PromptOptimizer] 未找到已选择的模型')
      return false
    }

    const resolved = resolveSelectedModel(
      saved,
      (await settingsService.getSettings())?.aiProviders || []
    )
    if (!resolved) {
      currentProvider.value = null
      currentModel.value = null
      return false
    }

    currentProvider.value = resolved.provider
    currentModel.value = resolved.model
    return !!resolved.provider && !!resolved.model
  } catch (error) {
    currentProvider.value = null
    currentModel.value = null
    console.error('[PromptOptimizer] ❌ AI模型配置加载失败:', error)
    return false
  }
}

// 检查模型是否可用
const checkModelAvailable = (): boolean => {
  if (!currentProvider.value || !currentModel.value) {
    $alert('请先在设置中配置并选择 AI 模型。')
    return false
  }
  return true
}

// 方法：生成基础提示词
const generatePrompt = async () => {
  if (!checkModelAvailable()) return

  isGenerating.value = true
  try {
    const response = await chatCompletion(currentProvider.value!, currentModel.value!, {
      messages: [
        {
          role: 'system',
          content:
            '你是一个专业的提示词工程师。你的任务是根据用户描述的任务需求，生成一个高质量、清晰、有效的系统提示词（system prompt）。提示词应该明确定义 AI 助手的角色、职责和行为准则。'
        },
        {
          role: 'user',
          content: `请为以下任务生成一个专业的系统提示词：\n\n${taskDescription.value}\n\n要求：\n1. 明确定义 AI 助手的角色\n2. 说明具体的任务和职责\n3. 提供清晰的行为准则\n4. 语言简洁专业\n\n请直接返回生成的提示词内容，不要包含任何解释或其他文字。`
        }
      ],
      stream: false,
      temperature: 0.7
    })

    generatedPrompt.value = response.content.trim()
  } catch (error: any) {
    $alert(`生成失败：${error.message}`)
  } finally {
    isGenerating.value = false
  }
}

// 方法：测试提示词
const testPrompt = async () => {
  if (!checkModelAvailable()) return

  isTesting.value = true
  try {
    const response = await chatCompletion(currentProvider.value!, currentModel.value!, {
      messages: [
        {
          role: 'system',
          content: generatedPrompt.value
        },
        {
          role: 'user',
          content: testQuestion.value
        }
      ],
      stream: false,
      temperature: 0.7
    })

    testResult.value = response.content
  } catch (error: any) {
    $alert(`测试失败：${error.message}`)
  } finally {
    isTesting.value = false
  }
}

// 方法：根据用户点评优化提示词
const optimizePrompt = async () => {
  if (!checkModelAvailable()) return

  isOptimizing.value = true
  try {
    const response = await chatCompletion(currentProvider.value!, currentModel.value!, {
      messages: [
        {
          role: 'system',
          content:
            '你是一个专业的提示词工程师。你的任务是根据用户的反馈意见优化系统提示词，使其更好地满足用户的需求。'
        },
        {
          role: 'user',
          content: `请优化以下系统提示词：

【当前提示词】
${generatedPrompt.value}

【测试问题】
${testQuestion.value}

【AI 回复】
${testResult.value}

【用户点评和改进要求】
${userFeedback.value}

请基于用户的点评和改进要求，生成一个优化后的系统提示词。要求：
1. 保留原有提示词的核心功能和定位
2. 针对性地解决用户提出的问题
3. 确保优化后的提示词清晰、具体、有效
4. 直接返回优化后的完整提示词内容，不要包含任何解释或其他文字`
        }
      ],
      stream: false,
      temperature: 0.7
    })

    generatedPrompt.value = response.content.trim()

    // 清空用户点评
    userFeedback.value = ''

    // 自动重新测试优化后的提示词
    if (testQuestion.value) {
      await testPrompt()
    }
  } catch (error: any) {
    $alert(`优化失败：${error.message}`)
  } finally {
    isOptimizing.value = false
  }
}

// 方法：保存提示词
const savePrompt = async () => {
  if (!generatedPrompt.value.trim()) {
    $alert('提示词不能为空！')
    return
  }

  try {
    const currentSessionId = localStorage.getItem('current-session-id')
    if (!currentSessionId) {
      $alert('请先打开一个聊天会话，然后再保存提示词。提示词需要关联到具体的会话。')
      return
    }

    await chatService.updateSession(currentSessionId, {
      config: {
        systemPrompt: generatedPrompt.value,
        updatedAt: new Date().toISOString()
      }
    })
    window.dispatchEvent(
      new CustomEvent('session-prompt-updated', {
        detail: { sessionId: currentSessionId, systemPrompt: generatedPrompt.value }
      })
    )
    $alert('提示词已保存到当前会话的本地配置。')
  } catch (error: any) {
    $alert('❌ 保存失败：' + error.message)
  }
}

// 方法：重置所有内容
const resetAll = async () => {
  if (await $confirm('确定要重新开始吗？所有内容将被清空。')) {
    taskDescription.value = ''
    generatedPrompt.value = ''
    testQuestion.value = ''
    testResult.value = ''
    userFeedback.value = ''
  }
}

// 方法：复制测试结果
const copyTestResult = async () => {
  try {
    await navigator.clipboard.writeText(testResult.value)
    isCopied.value = true
    setTimeout(() => {
      isCopied.value = false
    }, 2000)
  } catch (error) {
    console.error('复制失败:', error)
    $alert('复制失败，请手动选择文本复制')
  }
}

// 处理 textarea 的键盘事件 - 确保回车键能正常换行
const handleTextareaKeyDown = (e: KeyboardEvent) => {
  // 允许回车键的默认行为（换行）
  // 阻止事件冒泡，防止全局监听器拦截
  if (e.key === 'Enter') {
    e.stopPropagation()
    // 不调用 preventDefault()，让默认的换行行为正常工作
  }
}

// 处理提示词 textarea 的键盘事件（与上面相同，但保留以保持兼容性）
const handlePromptTextareaKeyDown = handleTextareaKeyDown

// 左侧菜单导航方法
const scrollToSection = (sectionId: string) => {
  const element = document.getElementById(`section-${sectionId}`)
  if (element && contentContainer.value) {
    clearTimeout(sectionScrollTimer)
    isScrolling.value = true
    activeSection.value = sectionId

    const container = contentContainer.value
    const offsetTop =
      container.scrollTop +
      element.getBoundingClientRect().top -
      container.getBoundingClientRect().top -
      24

    sectionScrollTarget = Math.max(
      0,
      Math.min(offsetTop, container.scrollHeight - container.clientHeight)
    )
    sectionScrollDeadline = performance.now() + 1600
    container.scrollTo({
      top: sectionScrollTarget,
      behavior:
        document.documentElement.dataset.motion === 'off' ||
        document.documentElement.dataset.transitions === 'off' ||
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth'
    })

    sectionScrollTimer = setTimeout(releaseSectionScroll, 600)
  }
}

const onScroll = () => {
  if (isScrolling.value) {
    clearTimeout(sectionScrollTimer)
    sectionScrollTimer = setTimeout(releaseSectionScroll, 120)
    return
  }

  const container = contentContainer.value
  if (!container) return

  // A short final section cannot always reach the top of the scroll container.
  if (
    container.scrollHeight > container.clientHeight + 1 &&
    container.scrollTop + container.clientHeight >= container.scrollHeight - 2
  ) {
    activeSection.value = optimizerSections.at(-1)?.id || activeSection.value
    return
  }

  const scrollTop = container.scrollTop
  const sections = optimizerSections.map(s => ({
    id: s.id,
    element: document.getElementById(`section-${s.id}`)
  }))

  for (let i = sections.length - 1; i >= 0; i--) {
    const section = sections[i]
    if (section.element) {
      const offsetTop =
        scrollTop +
        section.element.getBoundingClientRect().top -
        container.getBoundingClientRect().top -
        60
      if (scrollTop >= offsetTop) {
        activeSection.value = section.id
        break
      }
    }
  }
}

// 监听模型切换事件
const handleModelChanged = () => {
  loadAIModelConfiguration()
}

// 生命周期
onMounted(async () => {
  await loadAIModelConfiguration()

  // 检查是否有从其他页面传递过来的提示词（例如从聊天会话的"编辑提示词"按钮）
  const editPrompt = localStorage.getItem('prompt-optimizer-edit-prompt')
  if (editPrompt) {
    generatedPrompt.value = editPrompt
    // 清除临时存储，避免下次打开时重复加载
    localStorage.removeItem('prompt-optimizer-edit-prompt')

    // 自动滚动到提示词编辑区域
    await nextTick()
    scrollToSection('prompt')
  }

  // 监听事件
  unregisterModelSyncListeners = registerModelSelectionSyncListeners(window, handleModelChanged)
})

onUnmounted(() => {
  clearTimeout(sectionScrollTimer)
  unregisterModelSyncListeners?.()
})
</script>

<style scoped>
/* ========== 任务输入容器 ========== */
.task-input-container {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.task-input-container .form-textarea {
  width: 100%;
}

.task-input-container .generate-btn {
  align-self: flex-end;
}

/* ========== 结果展示区域 ========== */
.result-container {
  width: 100%;
}

.result-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: var(--liquid-selected);
  border: 1px solid var(--vscode-border);
  border-bottom: none;
  border-radius: var(--prism-radius-control) var(--prism-radius-control) 0 0;
}

.result-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--vscode-fg-muted);
}

.btn-copy {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  font-size: 12px;
  background: transparent;
  color: var(--vscode-fg-muted);
  border: 1px solid var(--vscode-border);
  border-radius: var(--prism-radius-small);
  cursor: pointer;
  transition:
    background-color var(--prism-duration) ease,
    color var(--prism-duration) ease,
    border-color var(--prism-duration) ease;
}

.btn-copy:hover {
  background: var(--vscode-bg);
  color: var(--vscode-fg);
  border-color: var(--vscode-accent);
}

.btn-copy.copied {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  border-color: var(--vscode-button-background);
}

.btn-copy i {
  font-size: 12px;
}

.test-result-box {
  padding: 16px;
  background: var(--prism-control);
  border: 1px solid var(--vscode-border);
  border-radius: 0 0 var(--prism-radius-control) var(--prism-radius-control);
  color: var(--vscode-fg);
  font-size: 14px;
  line-height: 1.8;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 400px;
  overflow-y: auto;
  user-select: text;
  cursor: text;
}

/* ========== 操作栏 ========== */
.action-bar {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  padding: 24px 0;
  margin-top: 32px;
  border-top: 1px solid var(--prism-border);
  justify-content: center;
}

/* ========== 工具类 ========== */
.mt-2 {
  margin-top: 8px;
}

.mt-3 {
  margin-top: 12px;
}

/* ========== 滚动条 ========== */
.settings-content::-webkit-scrollbar,
.settings-nav::-webkit-scrollbar,
.test-result-box::-webkit-scrollbar {
  width: 8px;
}

.settings-content::-webkit-scrollbar-track,
.settings-nav::-webkit-scrollbar-track,
.test-result-box::-webkit-scrollbar-track {
  background: transparent;
}

.settings-content::-webkit-scrollbar-thumb,
.settings-nav::-webkit-scrollbar-thumb,
.test-result-box::-webkit-scrollbar-thumb {
  background: var(--vscode-border);
  border-radius: 4px;
}

.settings-content::-webkit-scrollbar-thumb:hover,
.settings-nav::-webkit-scrollbar-thumb:hover,
.test-result-box::-webkit-scrollbar-thumb:hover {
  background: var(--vscode-fg-muted);
}

/* ========== 动画效果 ========== */
.bi-hourglass-split {
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

.prompt-display {
  font-family: var(--vscode-editor-font-family, Consolas, monospace);
  font-size: 13px;
}
.btn-copy:focus-visible {
  outline: 2px solid var(--vscode-accent);
  outline-offset: 3px;
}
@media (prefers-reduced-motion: reduce) {
  .bi-hourglass-split {
    animation: none;
  }
}
html[data-motion='off'] .bi-hourglass-split,
html[data-transitions='off'] .bi-hourglass-split {
  animation: none;
}
.result-placeholder {
  color: var(--prism-muted);
  font-size: 12px;
}
</style>
