<template>
  <div class="about-view">
    <div class="about-content">
      <header class="about-heading">
        <span class="about-mark" aria-hidden="true"><i class="bi bi-diamond-half" /></span>
        <div>
          <h1>{{ $t('welcome.appTitle') }}</h1>
          <p>智能的 SSH 连接和管理工具</p>
        </div>
        <span class="version-badge">版本 {{ appVersion }}</span>
      </header>
      <section class="about-panel" aria-labelledby="about-app-title">
        <h2 id="about-app-title">关于应用</h2>
        <p>
          {{ $t('welcome.appTitle') }}集成 SSH 连接管理、远程终端、文件传输和 AI
          智能助手，帮助您在一处继续服务器上的工作。
        </p>
        <AboutAppActions />
      </section>
      <section class="about-panel" aria-labelledby="about-stack-title">
        <h2 id="about-stack-title">技术栈</h2>
        <dl class="about-details stack-details">
          <div>
            <dt>前端框架</dt>
            <dd>Vue + TypeScript</dd>
          </div>
          <div>
            <dt>桌面框架</dt>
            <dd>Electron</dd>
          </div>
          <div>
            <dt>界面样式</dt>
            <dd>液态玻璃 · CSS</dd>
          </div>
          <div>
            <dt>构建工具</dt>
            <dd>Vite</dd>
          </div>
        </dl>
      </section>
      <section class="about-panel" aria-labelledby="about-system-title">
        <h2 id="about-system-title">系统信息</h2>
        <dl class="about-details">
          <div>
            <dt>操作系统</dt>
            <dd>{{ systemInfo.platform }}</dd>
          </div>
          <div>
            <dt>架构</dt>
            <dd>{{ systemInfo.arch }}</dd>
          </div>
          <div>
            <dt>Node.js 版本</dt>
            <dd>{{ systemInfo.nodeVersion }}</dd>
          </div>
          <div>
            <dt>Electron 版本</dt>
            <dd>{{ systemInfo.electronVersion }}</dd>
          </div>
        </dl>
        <p v-if="!isDesktop" class="about-runtime-note">完整系统信息可在桌面应用中查看。</p>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { APP_VERSION } from '@ai-ssh/shared'
import AboutAppActions from '@/components/common/AboutAppActions.vue'

const appVersion = ref(APP_VERSION)
const isDesktop = !!window.electronAPI
const systemInfo = ref({ platform: '—', arch: '—', nodeVersion: '—', electronVersion: '—' })

onMounted(async () => {
  if (window.electronAPI?.getVersion) {
    try {
      appVersion.value = await window.electronAPI.getVersion()
    } catch {
      // Use the build version if the native query is unavailable.
    }
  }
  if (window.electronAPI?.system?.getSystemInfo) {
    try {
      systemInfo.value = await window.electronAPI.system.getSystemInfo()
    } catch {
      // Keep unavailable values explicit instead of showing stale sample data.
    }
  }
})
</script>

<style scoped>
.about-view {
  height: 100%;
  min-height: 0;
  overflow: auto;
  padding: clamp(20px, 4vw, 48px);
  color: var(--prism-text);
  font-family: var(--prism-font);
}
.about-content {
  width: min(760px, 100%);
  margin: 0 auto;
}
.about-heading {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
  margin-bottom: 28px;
}
.about-mark {
  display: grid;
  place-items: center;
  width: 60px;
  height: 60px;
  border-radius: 18px;
  color: var(--vscode-accent);
  background: var(--liquid-selected);
  border: 1px solid var(--liquid-rim);
  box-shadow: inset 0 1px var(--liquid-inner-light);
  font-size: var(--prism-font-29);
}
.about-heading h1 {
  margin: 0;
  font-size: var(--prism-font-28);
  font-weight: 600;
  letter-spacing: -0.5px;
}
.about-heading p {
  margin: 6px 0 0;
  font-size: var(--prism-font-13);
  color: var(--prism-muted);
}
.version-badge {
  margin-left: auto;
  padding: 7px 12px;
  border: 1px solid var(--prism-border);
  border-radius: 999px;
  color: var(--vscode-accent);
  background: var(--liquid-selected);
  font-size: var(--prism-font-12);
}
.about-panel {
  padding: clamp(20px, 3vw, 28px);
  margin-bottom: 18px;
  background: var(--prism-surface);
  border: 1px solid var(--liquid-rim);
  border-radius: var(--prism-radius-panel);
  box-shadow: var(--prism-shadow);
  backdrop-filter: blur(22px) saturate(140%);
}
.about-panel h2 {
  margin: 0 0 18px;
  font-size: var(--prism-font-16);
  font-weight: 600;
}
.about-panel p {
  font-size: var(--prism-font-13);
  line-height: 1.8;
  margin: 0;
  color: var(--prism-muted);
}
.about-details {
  margin: 0;
}
.about-details > div {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  padding: 10px 0;
}
.about-details > div + div {
  border-top: 1px solid var(--prism-border);
}
.about-details dt {
  color: var(--prism-muted);
  font-size: var(--prism-font-13);
  font-weight: 400;
}
.about-details dd {
  color: var(--prism-text);
  margin: 0;
  font-size: var(--prism-font-13);
  overflow-wrap: anywhere;
  text-align: right;
}
.stack-details {
  display: grid;
  grid-template-columns: 1fr 1fr;
  column-gap: 28px;
}
.stack-details > div {
  display: block;
  border: 0 !important;
}
.stack-details dd {
  text-align: left;
  margin-top: 5px;
}
.about-panel .about-runtime-note {
  margin-top: 14px;
  font-size: var(--prism-font-12);
}
@media (max-width: 600px) {
  .about-heading {
    gap: 12px;
  }
  .version-badge {
    margin-left: 0;
  }
  .stack-details {
    grid-template-columns: 1fr;
  }
}
</style>
