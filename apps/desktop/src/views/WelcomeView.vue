<script setup lang="ts">
import { inject, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import LiquidSurface from '@/components/common/LiquidSurface.vue'
import { useApp } from '@/composables/useApp'
import { useTheme } from '@/composables/useTheme'
import { sshService } from '@/services/ssh.service'

const { t } = useI18n()
const app = useApp()
const theme = useTheme()
const openSettings = inject<(section?: string) => void>('openSettings', () => app.openSettings())
const importing = ref(false)
const importMessage = ref('')
const importError = ref(false)

function createConnection() {
  window.dispatchEvent(new CustomEvent('ssh-create-connection'))
}

async function importConnections() {
  if (importing.value) return
  importMessage.value = ''
  importError.value = false
  if (!window.electronAPI) {
    importMessage.value = '请在桌面应用中选择并导入连接配置文件。'
    return
  }
  importing.value = true
  try {
    const result = await sshService.importConnections()
    if (!result.canceled) {
      window.dispatchEvent(new CustomEvent('ssh-connections-imported'))
      importMessage.value = t('ssh.importResult', {
        imported: result.imported || 0,
        skipped: result.skipped || 0,
        invalid: result.invalid || 0
      })
    }
  } catch (error: unknown) {
    importError.value = true
    importMessage.value = error instanceof Error ? error.message : t('ssh.importFailed')
  } finally {
    importing.value = false
  }
}
</script>

<template>
  <div class="welcome-page">
    <div class="welcome-shell">
      <header class="welcome-heading">
        <div>
          <div class="welcome-location">
            工作空间 <i class="bi bi-chevron-right" aria-hidden="true" /> 开始
          </div>
          <h1>SSH 工作台</h1>
          <p>连接服务器，打开你的下一处工作空间。</p>
        </div>
        <LiquidSurface
          as="button"
          type="button"
          class="welcome-settings"
          :radius="22"
          :strength="44"
          :blur="0.35"
          :motion="theme.animations.value"
          aria-label="打开应用设置"
          @click="openSettings()"
          ><i class="bi bi-sliders2" aria-hidden="true" /><span>设置</span></LiquidSurface
        >
      </header>

      <div class="welcome-layout">
        <section class="welcome-session" aria-labelledby="welcome-session-title">
          <div class="welcome-session-bar">
            <span><i class="bi bi-terminal" aria-hidden="true" />终端</span
            ><span>尚未打开会话</span>
          </div>
          <div class="welcome-session-empty">
            <div class="welcome-connection-art" aria-hidden="true">
              <svg viewBox="0 0 176 94" fill="none">
                <path
                  d="M16 62H53C66 62 63 33 76 33H115C128 33 123 62 137 62H160"
                  stroke="currentColor"
                  stroke-opacity=".2"
                />
                <path
                  d="M16 71H51C73 71 64 23 82 23H112C135 23 120 71 143 71H160"
                  stroke="currentColor"
                  stroke-opacity=".1"
                />
                <circle cx="16" cy="62" r="3" fill="currentColor" fill-opacity=".24" />
                <circle cx="160" cy="62" r="3" fill="currentColor" fill-opacity=".24" /></svg
              ><span><i class="bi bi-hdd-network" /></span>
            </div>
            <h2 id="welcome-session-title">从一次连接开始</h2>
            <p>从左侧选择已保存的连接，<br />或添加一台新的服务器。</p>
            <div class="welcome-session-actions">
              <button
                type="button"
                class="welcome-create"
                data-welcome-action="create-connection"
                @click="createConnection"
              >
                <i class="bi bi-plus-lg" aria-hidden="true" />新建连接
              </button>
              <button
                type="button"
                class="welcome-import"
                data-welcome-action="import-connections"
                :disabled="importing"
                :aria-busy="importing"
                @click="importConnections"
              >
                <i class="bi bi-box-arrow-in-down" aria-hidden="true" />{{
                  importing ? '正在导入…' : '导入配置'
                }}
              </button>
            </div>
            <p
              v-if="importMessage"
              class="welcome-import-message"
              :class="{ 'has-error': importError }"
              role="status"
            >
              {{ importMessage }}
            </p>
          </div>
          <div class="welcome-session-foot">
            <span><i class="bi bi-key" aria-hidden="true" />密码 / 私钥 / SSH Agent</span
            ><span>SSH + SFTP</span>
          </div>
        </section>

        <aside class="welcome-guidance" aria-label="工作台使用说明">
          <section class="welcome-workflow">
            <h2>一处连接，继续工作</h2>
            <div class="welcome-workflow-item">
              <span><i class="bi bi-terminal" aria-hidden="true" /></span>
              <div>
                <h3>远程终端</h3>
                <p>连接后打开终端，多标签保留不同的工作现场。</p>
              </div>
            </div>
            <div class="welcome-workflow-item">
              <span><i class="bi bi-folder2-open" aria-hidden="true" /></span>
              <div>
                <h3>文件管理</h3>
                <p>在连接的右键菜单中打开文件管理，浏览和传输远程文件。</p>
              </div>
            </div>
          </section>
          <section class="welcome-ai">
            <span class="welcome-ai-icon"><i class="bi bi-stars" aria-hidden="true" /></span>
            <h2>让 AI 帮你想下一步</h2>
            <p>添加自己的模型服务，在终端中询问命令、解释输出。</p>
            <button
              type="button"
              data-welcome-action="configure-ai"
              @click="openSettings('ai-providers')"
            >
              配置模型服务<i class="bi bi-arrow-up-right" aria-hidden="true" />
            </button>
          </section>
        </aside>
      </div>

      <footer class="welcome-footer">
        <i class="bi bi-laptop" aria-hidden="true" /><span>本地工作空间</span
        ><span class="welcome-footer-divider" />连接配置保存在此设备
      </footer>
    </div>
  </div>
</template>

<style scoped>
.welcome-page {
  height: 100%;
  min-width: 0;
  overflow: auto;
  container-type: inline-size;
  color: var(--vscode-fg);
  font-family: var(--prism-font);
}
.welcome-shell {
  width: min(1060px, 100%);
  min-height: 100%;
  margin: 0 auto;
  padding: 42px 38px 24px;
  display: flex;
  flex-direction: column;
}
.welcome-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 31px;
}
.welcome-location {
  color: var(--vscode-fg-muted);
  font-size: var(--prism-font-11);
  display: flex;
  align-items: center;
  gap: 9px;
  margin-bottom: 9px;
}
.welcome-location > i {
  font-size: var(--prism-font-8);
  opacity: 0.7;
}
.welcome-heading h1 {
  margin: 0;
  color: var(--vscode-fg);
  font-size: var(--prism-font-30);
  font-weight: 600;
  line-height: 1.35;
  letter-spacing: -0.7px;
}
.welcome-heading p {
  margin: 8px 0 0;
  font-size: var(--prism-font-12);
  line-height: 1.7;
  color: var(--vscode-fg-muted);
}
.welcome-settings {
  --liquid-tint: color-mix(in srgb, var(--vscode-bg-light) 12%, transparent);
  --liquid-rim: color-mix(in srgb, var(--vscode-border) 40%, #ffffff66);
  color: var(--vscode-fg-muted);
  padding: 11px 15px;
  flex: 0 0 auto;
}
.welcome-settings :deep(.liquid-surface__content) {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--prism-font-11);
}
.welcome-settings i {
  font-size: var(--prism-font-14);
}
.welcome-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 213px;
  gap: 29px;
  align-items: start;
}
.welcome-session {
  display: flex;
  flex-direction: column;
  min-width: 0;
  color: var(--prism-text);
  background: color-mix(in srgb, var(--prism-surface) 60%, transparent);
  border: 1px solid var(--liquid-rim);
  border-radius: 21px;
  box-shadow: var(--prism-shadow);
  backdrop-filter: blur(0.5px) saturate(112%);
  overflow: hidden;
}
.welcome-session-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 15px 20px;
  border-bottom: 1px solid var(--prism-border);
  font-size: var(--prism-font-11);
  line-height: 1.4;
  background: var(--liquid-selected);
}
.welcome-session-bar > span:first-child {
  display: flex;
  align-items: center;
  gap: 9px;
}
.welcome-session-bar > span:first-child > i {
  color: var(--vscode-accent);
  font-size: var(--prism-font-13);
}
.welcome-session-bar > span:last-child {
  color: var(--prism-muted);
  font-size: var(--prism-font-10);
}
.welcome-session-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 27px 18px 50px;
  min-height: 345px;
  text-align: center;
}
.welcome-connection-art {
  position: relative;
  width: 176px;
  height: 94px;
  margin: 0 0 18px;
  color: var(--vscode-accent);
  flex: 0 0 auto;
}
.welcome-connection-art > svg {
  position: absolute;
  width: 100%;
  height: 100%;
  inset: 0;
}
.welcome-connection-art > span {
  position: absolute;
  top: 19px;
  left: 62px;
  width: 52px;
  height: 52px;
  display: grid;
  place-items: center;
  color: var(--vscode-accent);
  font-size: var(--prism-font-23);
  border: 1px solid var(--liquid-rim);
  border-radius: 16px;
  background: var(--liquid-selected);
  box-shadow: var(--prism-shadow);
}
.welcome-session h2 {
  margin: 0;
  color: var(--prism-text);
  font-size: var(--prism-font-21);
  font-weight: 500;
  line-height: 1.5;
  letter-spacing: -0.3px;
}
.welcome-session-empty > p {
  color: var(--prism-muted);
  font-size: var(--prism-font-11);
  line-height: 1.9;
  margin: 10px 0 24px;
}
.welcome-session-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 10px;
}
.welcome-session-actions button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 17px;
  font-family: inherit;
  font-size: var(--prism-font-11);
  line-height: 1.5;
  border-radius: var(--prism-radius-control);
  cursor: pointer;
  touch-action: manipulation;
  min-height: 38px;
  transition:
    background-color var(--prism-duration) ease,
    border-color var(--prism-duration) ease,
    color var(--prism-duration) ease;
}
.welcome-create {
  color: var(--vscode-button-foreground);
  background: var(--vscode-accent);
  border: 1px solid var(--vscode-accent);
  box-shadow: inset 0 1px #ffffff20;
}
.welcome-import {
  color: var(--prism-text);
  background: var(--prism-control);
  border: 1px solid var(--prism-border);
}
.welcome-session-actions button:disabled {
  opacity: 0.6;
  cursor: progress;
}
.welcome-session-empty > .welcome-import-message {
  margin: 20px 0 0;
  max-width: 340px;
  color: var(--prism-info);
  font-size: var(--prism-font-10);
  overflow-wrap: anywhere;
}
.welcome-session-empty > .welcome-import-message.has-error {
  color: var(--prism-danger);
}
.welcome-session-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  border-top: 1px solid var(--prism-border);
  padding: 10px 20px;
  color: var(--prism-muted);
  font-size: var(--prism-font-9);
}
.welcome-session-foot > span:first-child {
  display: flex;
  align-items: center;
  gap: 6px;
}
.welcome-guidance {
  padding-top: 8px;
  min-width: 0;
}
.welcome-guidance h2 {
  font-size: var(--prism-font-13);
  font-weight: 600;
  color: var(--vscode-fg);
  margin: 0;
  line-height: 1.6;
}
.welcome-workflow {
  padding: 0 0 27px;
  border-bottom: 1px solid var(--vscode-border-subtle, var(--vscode-border));
}
.welcome-workflow-item {
  display: flex;
  align-items: flex-start;
  gap: 11px;
  margin-top: 24px;
}
.welcome-workflow-item > span {
  width: 23px;
  flex: 0 0 auto;
  color: color-mix(in srgb, var(--vscode-accent) 65%, var(--vscode-fg-muted));
  font-size: var(--prism-font-17);
  line-height: 1.4;
}
.welcome-workflow-item h3 {
  font-size: var(--prism-font-11);
  font-weight: 600;
  margin: 0;
  line-height: 1.7;
  color: var(--vscode-fg);
}
.welcome-guidance p {
  color: var(--vscode-fg-muted);
  font-size: var(--prism-font-11);
  line-height: 1.9;
  margin: 5px 0 0;
}
.welcome-ai {
  padding-top: 24px;
}
.welcome-ai-icon {
  font-size: var(--prism-font-20);
  display: inline-flex;
  color: color-mix(in srgb, var(--vscode-accent) 70%, var(--vscode-fg-muted));
  margin-bottom: 11px;
}
.welcome-ai p {
  margin-top: 8px;
}
.welcome-ai button {
  display: flex;
  align-items: center;
  gap: 15px;
  color: var(--vscode-accent);
  font-size: var(--prism-font-11);
  padding: 0;
  margin-top: 16px;
  border: 0;
  background: none;
  cursor: pointer;
  min-height: 27px;
  touch-action: manipulation;
}
.welcome-ai button i {
  font-size: var(--prism-font-10);
}
.welcome-footer {
  color: var(--vscode-fg-muted);
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
  font-size: var(--prism-font-10);
  margin-top: auto;
  padding: 29px 0 0;
  opacity: 0.85;
  line-height: 1.7;
}
.welcome-footer > i {
  font-size: var(--prism-font-13);
  margin-right: 1px;
}
.welcome-footer-divider {
  width: 1px;
  height: 10px;
  background: var(--vscode-border);
  margin: 0 3px;
}
.welcome-page button:focus-visible {
  outline: 2px solid var(--vscode-accent);
  outline-offset: 4px;
}
.welcome-session button:focus-visible {
  outline-color: var(--vscode-accent);
}
@media (hover: hover) and (pointer: fine) {
  .welcome-settings:hover {
    color: var(--vscode-accent);
  }
  .welcome-create:hover {
    background: var(--vscode-accent-hover);
  }
  .welcome-import:not(:disabled):hover {
    background: var(--vscode-list-hoverBackground);
    color: var(--prism-text);
  }
  .welcome-ai button:hover {
    text-decoration: underline;
    text-underline-offset: 4px;
  }
}
@container (max-width: 850px) {
  .welcome-shell {
    padding: 30px 27px 22px;
  }
  .welcome-layout {
    grid-template-columns: minmax(0, 1fr) 188px;
    gap: 23px;
  }
  .welcome-session h2 {
    font-size: var(--prism-font-19);
  }
  .welcome-session-actions {
    gap: 8px;
  }
  .welcome-session-actions button {
    padding: 9px 12px;
  }
}
@container (max-width: 670px) {
  .welcome-shell {
    padding: 26px 22px 22px;
  }
  .welcome-heading {
    margin-bottom: 24px;
  }
  .welcome-heading h1 {
    font-size: var(--prism-font-27);
  }
  .welcome-layout {
    grid-template-columns: minmax(0, 1fr);
    gap: 28px;
  }
  .welcome-session-empty {
    padding-bottom: 32px;
    min-height: 315px;
  }
  .welcome-guidance {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 25px;
    padding-top: 0;
  }
  .welcome-workflow {
    padding: 0;
    border-bottom: 0;
  }
  .welcome-ai {
    padding-top: 0;
  }
  .welcome-workflow-item {
    margin-top: 16px;
  }
}
@container (max-width: 390px) {
  .welcome-shell {
    padding: 23px 16px;
  }
  .welcome-heading {
    gap: 12px;
  }
  .welcome-heading h1 {
    font-size: var(--prism-font-24);
  }
  .welcome-heading p {
    font-size: var(--prism-font-11);
  }
  .welcome-settings {
    padding: 10px;
  }
  .welcome-settings :deep(.liquid-surface__content) > span {
    display: none;
  }
  .welcome-session-bar {
    padding-inline: 15px;
  }
  .welcome-session h2 {
    font-size: var(--prism-font-18);
  }
  .welcome-session-foot {
    padding-inline: 15px;
  }
  .welcome-guidance {
    grid-template-columns: minmax(0, 1fr);
    gap: 23px;
  }
  .welcome-ai {
    border-top: 1px solid var(--vscode-border);
    padding-top: 21px;
  }
}
</style>
