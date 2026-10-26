<template>
  <div class="not-found-view">
    <section class="not-found-panel" aria-labelledby="not-found-title">
      <span class="not-found-icon" aria-hidden="true"><i class="bi bi-signpost-split" /></span>
      <p class="not-found-code">404</p>
      <h1 id="not-found-title">页面未找到</h1>
      <p class="not-found-description">这个页面不存在或已被移动。检查地址，或返回工作台继续。</p>
      <div class="not-found-actions">
        <button type="button" @click="goHome" class="prism-button prism-button--primary">
          返回工作台
        </button>
        <button type="button" @click="goBack" class="prism-button">返回上一页</button>
      </div>
      <nav class="not-found-links" aria-label="常用页面">
        <router-link to="/ssh"
          ><i class="bi bi-hdd-network" aria-hidden="true" />SSH 工作台</router-link
        >
        <router-link to="/settings"
          ><i class="bi bi-sliders2" aria-hidden="true" />设置</router-link
        >
      </nav>
    </section>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'
const router = useRouter()
const goHome = () => {
  router.push('/')
}
const goBack = () => {
  if (typeof window !== 'undefined' && window.history.length > 1) router.back()
  else router.push('/')
}
</script>

<style scoped>
.not-found-view {
  height: 100%;
  min-height: 0;
  overflow: auto;
  display: grid;
  place-items: center;
  padding: 32px 20px;
  color: var(--prism-text);
  font-family: var(--prism-font);
}
.not-found-panel {
  width: min(480px, 100%);
  padding: clamp(26px, 5vw, 44px);
  text-align: center;
  border: 1px solid var(--liquid-rim);
  border-radius: var(--prism-radius-panel);
  background: var(--prism-surface);
  box-shadow: var(--prism-shadow);
  backdrop-filter: blur(22px) saturate(140%);
}
.not-found-icon {
  font-size: var(--prism-font-34);
  color: var(--vscode-accent);
}
.not-found-code {
  margin: 18px 0 4px;
  font-size: var(--prism-font-13);
  color: var(--prism-muted);
}
.not-found-panel h1 {
  font-size: var(--prism-font-24);
  font-weight: 600;
  margin: 0;
}
.not-found-description {
  color: var(--prism-muted);
  margin: 14px 0 26px;
  font-size: var(--prism-font-13);
  line-height: 1.8;
}
.not-found-actions {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 10px;
}
.not-found-links {
  margin-top: 28px;
  padding-top: 22px;
  border-top: 1px solid var(--prism-border);
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 24px;
}
.not-found-links a {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--vscode-accent);
  text-decoration: none;
  font-size: var(--prism-font-12);
}
.not-found-links a:focus-visible {
  outline: 2px solid var(--vscode-accent);
  outline-offset: 5px;
  border-radius: var(--prism-radius-small);
}
@media (hover: hover) and (pointer: fine) {
  .not-found-links a:hover {
    text-decoration: underline;
    text-underline-offset: 4px;
  }
}
</style>
