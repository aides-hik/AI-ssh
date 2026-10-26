<script setup lang="ts">
import { computed, ref } from 'vue'
import { useUpdateClient } from '@/services/update-client'

withDefaults(defineProps<{ centered?: boolean }>(), { centered: false })
const projectUrl = 'https://github.com/aides-hik/AI-ssh'
const updater = useUpdateClient()
const checking = ref(false)
const installing = ref(false)
const actionError = ref('')
const linkError = ref('')
const hasUpdater = Boolean(window.electronAPI?.updater)
const busyStatuses = new Set(['checking', 'update-available', 'probing-sources', 'downloading', 'installing'])
const busy = computed(() => checking.value || installing.value || busyStatuses.has(updater.state.value.status))
const statusText = computed(() => {
  if (actionError.value) return actionError.value
  if (!hasUpdater) return '请在桌面应用中检查更新。'
  const state = updater.state.value
  if (!state.enabled) return state.statusText || '当前安装未配置更新源。'
  if (checking.value && !busyStatuses.has(state.status)) return '正在检查更新…'
  const labels: Record<string, string> = {
    idle: '检查是否有可用的新版本。',
    checking: '正在检查更新…',
    'up-to-date': '当前已是最新版本。',
    'update-available': '已发现新版本，准备下载。',
    'probing-sources': '正在选择下载源…',
    downloading: `正在后台下载更新 ${Math.round(state.progress || 0)}%`,
    downloaded: '更新已下载，可以安装。',
    installing: '正在启动安装程序…',
    error: state.error || '检查更新失败，请重试。'
  }
  return state.statusText || labels[state.status] || '暂时无法读取更新状态。'
})
const isError = computed(() => Boolean(actionError.value) || updater.state.value.status === 'error')
const buttonLabel = computed(() => {
  if (checking.value || updater.state.value.status === 'checking') return '正在检查…'
  if (updater.state.value.status === 'downloading') return '正在下载…'
  if (updater.state.value.status === 'probing-sources') return '正在选择下载源…'
  if (installing.value || updater.state.value.status === 'installing') return '正在安装…'
  return '检查更新'
})
async function checkUpdates() {
  if (!hasUpdater || !updater.state.value.enabled || busy.value) return
  actionError.value = ''
  checking.value = true
  try {
    await updater.startBackgroundCheck()
  } catch (error) {
    actionError.value = `检查更新失败：${error instanceof Error ? error.message : String(error)}。请重试。`
  } finally {
    checking.value = false
  }
}
async function installUpdate() {
  if (busy.value || updater.state.value.status !== 'downloaded') return
  actionError.value = ''
  installing.value = true
  try {
    await updater.installDownloadedUpdate()
  } catch (error) {
    actionError.value = `无法安装更新：${error instanceof Error ? error.message : String(error)}。请重试。`
  } finally {
    installing.value = false
  }
}
async function openProject(event: MouseEvent) {
  const openExternal = window.electronAPI?.shell?.openExternal || window.electronAPI?.system?.openExternal
  if (!openExternal) return
  event.preventDefault()
  linkError.value = ''
  try {
    await openExternal(projectUrl)
  } catch {
    linkError.value = '未能打开浏览器，请复制上方项目地址访问。'
  }
}
</script>

<template>
  <div class="about-app-actions" :class="{ 'is-centered': centered }">
    <div class="about-app-action-row">
      <a class="about-project-link" :href="projectUrl" target="_blank" rel="noopener noreferrer" @click="openProject">
        <i class="bi bi-github" aria-hidden="true"></i>
        <span><strong>GitHub 项目</strong><small>github.com/aides-hik/AI-ssh</small></span>
        <i class="bi bi-box-arrow-up-right" aria-hidden="true"></i>
      </a>
      <div class="about-update-controls">
        <button type="button" class="about-check-update" :disabled="!hasUpdater || !updater.state.value.enabled || busy" :aria-busy="busy" @click="checkUpdates">
          <i class="bi bi-arrow-repeat" :class="{ 'is-checking': checking || updater.state.value.status === 'checking' }" aria-hidden="true"></i>
          {{ buttonLabel }}
        </button>
        <button v-if="updater.state.value.status === 'downloaded'" type="button" class="about-install-update" :disabled="busy" @click="installUpdate">
          <i class="bi bi-download" aria-hidden="true"></i>安装更新
        </button>
      </div>
    </div>
    <p class="about-update-feedback" :class="{ 'is-error': isError }" role="status" aria-live="polite" aria-atomic="true">{{ statusText }}</p>
    <p v-if="linkError" class="about-link-error" role="alert">{{ linkError }}</p>
  </div>
</template>

<style scoped>
.about-app-actions { min-width: 0; margin-top: 20px; padding-top: 18px; border-top: 1px solid var(--prism-border); color: var(--prism-text); font-family: var(--prism-font); }
.about-app-action-row { display: flex; align-items: center; flex-wrap: wrap; gap: 14px 20px; }
.about-project-link { display: flex; align-items: center; gap: 10px; min-width: 0; max-width: 100%; color: var(--prism-text); text-decoration: none; border-radius: 6px; }
.about-project-link > i:first-child { flex: none; font-size: var(--prism-font-22); }
.about-project-link > span { display: grid; gap: 2px; min-width: 0; }
.about-project-link strong { font-size: var(--prism-font-12); font-weight: 550; }
.about-project-link small { color: var(--prism-muted); font-size: var(--prism-font-11); overflow-wrap: anywhere; }
.about-project-link > i:last-child { flex: none; color: var(--prism-muted); font-size: var(--prism-font-11); }
.about-project-link:hover strong { color: var(--vscode-accent); }
.about-update-controls { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-left: auto; }
.about-update-controls button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 35px; padding: 7px 12px; border: 1px solid var(--liquid-rim); border-radius: var(--prism-radius-control, 10px); background: var(--liquid-selected); box-shadow: inset 0 1px var(--liquid-inner-light); color: var(--vscode-accent); font: 500 var(--prism-font-12)/1.5 var(--prism-font); cursor: pointer; }
.about-update-controls button:hover:not(:disabled) { background: color-mix(in srgb, var(--vscode-accent) 14%, var(--liquid-selected)); }
.about-update-controls button:disabled { opacity: 0.6; cursor: default; }
.about-project-link:focus-visible,.about-update-controls button:focus-visible { outline: 2px solid var(--vscode-accent); outline-offset: 4px; }
.about-app-actions .about-update-feedback,.about-app-actions .about-link-error { margin: 12px 0 0; color: var(--prism-muted); font-size: var(--prism-font-11); line-height: 1.7; overflow-wrap: anywhere; }
.about-app-actions .is-error,.about-app-actions .about-link-error { color: var(--vscode-error, #d45b5b); }
.about-app-actions.is-centered .about-app-action-row { justify-content: center; }
.about-app-actions.is-centered .about-update-controls { margin-left: 0; }
.about-app-actions.is-centered .about-project-link { text-align: left; }
.is-checking { animation: about-update-spin 1.1s linear infinite; }
@keyframes about-update-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .is-checking { animation: none; } }
@media (max-width: 540px) { .about-update-controls { margin-left: 0; } }
</style>
