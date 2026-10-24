<template>
  <div class="session-settings-view prism-settings" :aria-busy="isLoading">
    <!-- 左侧导航树 -->
    <div class="settings-sidebar">
      <div class="sidebar-header">
        <h3 class="sidebar-title">{{ $t('session.sessionSettings') }}</h3>
        <!-- 保存状态指示器 -->
        <div class="save-status" v-if="saveStatus" role="status" aria-live="polite">
          <i
            :class="[
              'bi',
              saveStatus === 'saving'
                ? 'bi-hourglass-split'
                : saveStatus === 'saved'
                  ? 'bi-check-circle'
                  : 'bi-exclamation-triangle'
            ]"
          ></i>
          <span>{{ saveStatusText }}</span>
        </div>
      </div>
      <nav class="settings-nav">
        <button
          type="button"
          v-for="section in settingsSections"
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

    <!-- 右侧内容区域 -->
    <div class="settings-content" ref="contentContainer" @scroll="onScroll">
      <div class="content-inner">
        <div v-if="isLoading" class="settings-empty-state" role="status">
          <i class="bi bi-hourglass-split" aria-hidden="true" />
          <h2>正在读取会话设置</h2>
          <p>会话配置载入后即可编辑。</p>
        </div>
        <div v-else-if="loadError || !currentSessionId" class="settings-empty-state" role="status">
          <i
            :class="loadError ? 'bi bi-exclamation-circle' : 'bi bi-chat-square-text'"
            aria-hidden="true"
          />
          <h2>{{ loadError ? '无法读取会话' : '尚未选择会话' }}</h2>
          <p>
            {{
              loadError
                ? '请重试，或返回工作台重新打开会话。'
                : '先打开一个 AI 会话，再设置它的名称和上下文。'
            }}
          </p>
          <button v-if="loadError" type="button" class="prism-button" @click="loadSessionConfig">
            重新加载
          </button>
          <router-link to="/ssh" class="prism-button prism-button--primary">返回工作台</router-link>
        </div>
        <template v-else>
          <!-- 基本信息 -->
          <section :id="'section-basic'" class="setting-section prism-settings-section">
            <h2 class="section-title">
              <i class="bi bi-info-circle"></i>
              {{ $t('session.basicInfoTitle') }}
            </h2>
            <p class="section-description">{{ $t('session.basicInfoDesc') }}</p>

            <!-- 会话名称 -->
            <div class="setting-row">
              <div class="setting-left">
                <label class="setting-label">{{ $t('session.sessionName') }}</label>
                <p class="setting-hint">{{ $t('session.sessionNameHint') }}</p>
              </div>
              <div class="setting-right">
                <input
                  :aria-label="$t('session.sessionName')"
                  v-model="sessionName"
                  type="text"
                  :placeholder="$t('session.sessionNamePlaceholder')"
                  class="form-input"
                />
              </div>
            </div>
          </section>

          <!-- 高级设置 -->
          <section :id="'section-advanced'" class="setting-section prism-settings-section">
            <h2 class="section-title">
              <i class="bi bi-gear-wide-connected"></i>
              {{ $t('session.advancedTitle') }}
            </h2>
            <p class="section-description">{{ $t('session.advancedDesc') }}</p>

            <!-- 上下文窗口 -->
            <div class="setting-row">
              <div class="setting-left">
                <label class="setting-label">{{ $t('session.contextWindow') }}</label>
                <p class="setting-hint">{{ $t('session.contextWindowHint') }}</p>
              </div>
              <div class="setting-right">
                <input
                  :aria-label="$t('session.contextWindow')"
                  v-model.number="contextWindow"
                  type="number"
                  class="form-input"
                  min="1"
                  max="50"
                  @change="contextWindow = normalizeSessionContextWindow(contextWindow)"
                />
              </div>
            </div>

            <!-- 启用流式输出 -->
            <div class="setting-row">
              <div class="setting-left">
                <label class="setting-label">{{ $t('session.enableStreaming') }}</label>
                <p class="setting-hint">{{ $t('session.enableStreamingHint') }}</p>
              </div>
              <div class="setting-right">
                <label class="toggle-switch">
                  <input
                    :aria-label="$t('session.enableStreaming')"
                    v-model="enableStreaming"
                    type="checkbox"
                  />
                  <span class="toggle-slider"></span>
                </label>
              </div>
            </div>
          </section>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, computed } from 'vue'

import { useI18n } from 'vue-i18n'
import { chatService, normalizeSessionContextWindow } from '../services/chat.service'

const { t: $t } = useI18n()

// 设置章节
const settingsSections = computed(() => [
  { id: 'basic', label: $t('session.basicInfo'), icon: 'bi bi-info-circle' },
  { id: 'advanced', label: $t('session.advancedSettings'), icon: 'bi bi-gear-wide-connected' }
])

const activeSection = ref('basic')
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

// 会话管理
const currentSessionId = ref<string>('')
const isLoading = ref(true)
const loadError = ref(false)

// 保存状态
type SaveStatus = 'saving' | 'saved' | 'error' | null
const saveStatus = ref<SaveStatus>(null)
const saveStatusText = computed(() => {
  switch (saveStatus.value) {
    case 'saving':
      return $t('session.saving')
    case 'saved':
      return $t('session.saved')
    case 'error':
      return $t('session.saveFailed')
    default:
      return ''
  }
})

// 基本信息
const sessionName = ref('')

// 高级设置
const contextWindow = ref(50)
const enableStreaming = ref(true)

// 防抖定时器
let saveTimer: ReturnType<typeof setTimeout> | null = null

// 方法
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
    activeSection.value = settingsSections.value.at(-1)?.id || activeSection.value
    return
  }

  const scrollTop = container.scrollTop
  const sections = settingsSections.value.map(s => ({
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

// 加载会话配置
const loadSessionConfig = async () => {
  isLoading.value = true
  loadError.value = false
  try {
    // 从 localStorage 获取当前会话 ID
    const sessionId = localStorage.getItem('current-session-id')
    if (!sessionId) {
      isLoading.value = false
      return
    }

    currentSessionId.value = sessionId

    // 从数据库加载会话信息
    const session = await chatService.getSession(sessionId)
    if (!session) {
      currentSessionId.value = ''
      isLoading.value = false
      return
    }

    // 填充表单
    sessionName.value = session.title || ''

    // 从 config 中加载高级设置
    if (session.config) {
      contextWindow.value = normalizeSessionContextWindow(session.config.contextWindow)
      enableStreaming.value = (session.config as any).enableStreaming !== false
    }

    isLoading.value = false
  } catch {
    currentSessionId.value = ''
    loadError.value = true
    isLoading.value = false
  }
}

// 保存会话配置（带防抖）
const saveSessionConfig = () => {
  if (!currentSessionId.value) {
    return
  }

  // 清除之前的定时器
  if (saveTimer) {
    clearTimeout(saveTimer)
  }

  // 设置新的定时器（800ms 防抖）
  saveTimer = setTimeout(async () => {
    try {
      saveStatus.value = 'saving'

      // 构建更新数据
      const updateData = {
        title: sessionName.value,
        config: {
          contextWindow: contextWindow.value,
          enableStreaming: enableStreaming.value
        }
      }

      // 保存到数据库
      await chatService.updateSession(currentSessionId.value, updateData)

      saveStatus.value = 'saved'

      // 2秒后隐藏"已保存"提示
      setTimeout(() => {
        if (saveStatus.value === 'saved') {
          saveStatus.value = null
        }
      }, 2000)
    } catch {
      saveStatus.value = 'error'

      // 3秒后隐藏错误提示
      setTimeout(() => {
        if (saveStatus.value === 'error') {
          saveStatus.value = null
        }
      }, 3000)
    }
  }, 800)
}

// 监听字段变化，自动保存
watch(
  [sessionName, contextWindow, enableStreaming],
  () => {
    if (!isLoading.value && currentSessionId.value) {
      saveSessionConfig()
    }
  },
  { deep: true }
)

// 生命周期
onMounted(async () => {
  await loadSessionConfig()
})
onBeforeUnmount(() => {
  clearTimeout(sectionScrollTimer)
  if (saveTimer) clearTimeout(saveTimer)
})
</script>

<style scoped>
.save-status {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
  font-size: 12px;
  color: var(--prism-muted);
}
.save-status i {
  font-size: 14px;
}
.save-status i.bi-hourglass-split {
  color: var(--vscode-accent);
}
.save-status i.bi-check-circle {
  color: var(--prism-success);
}
.save-status i.bi-exclamation-triangle {
  color: var(--prism-danger);
}
</style>
