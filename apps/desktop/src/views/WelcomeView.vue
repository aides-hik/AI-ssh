<template>
  <div class="welcome-page">
    <div class="welcome-shell">
      <main class="welcome-main">
        <header class="welcome-header">
          <h1 class="welcome-title">AI SSH</h1>
          <p class="welcome-subtitle">
            集成 AI Agent 的终端，兼具传统 SSH 连接与高效文件管理功能。
          </p>
        </header>

        <section class="overview-grid">
          <div class="subscription-card">
            <div class="subscription-card__header">
              <div>
                <span class="subscription-card__badge">核心能力</span>
                <h2 class="subscription-card__title">独立运行的 SSH 与 AI 工具</h2>
                <p class="subscription-card__text">无需账号，直接连接服务器；AI 功能使用您配置的模型服务。</p>
              </div>
            </div>

            <div class="subscription-card__body">
              <div class="feature-item">
                <div class="feature-item__icon"><i class="bi bi-terminal"></i></div>
                <h3 class="feature-item__title">SSH 终端</h3>
                <p class="feature-item__text">毫秒级响应的远程连接，支持多标签与自定义主题。</p>
              </div>

              <div class="feature-item">
                <div class="feature-item__icon"><i class="bi bi-cpu"></i></div>
                <h3 class="feature-item__title">AI Agent</h3>
                <p class="feature-item__text">内置智能助手，自动补全命令并解释报错原因。</p>
              </div>

              <div class="feature-item">
                <div class="feature-item__icon"><i class="bi bi-folder2-open"></i></div>
                <h3 class="feature-item__title">文件管理</h3>
                <p class="feature-item__text">直观的 SFTP 管理界面，支持拖拽上传与在线编辑。</p>
              </div>
            </div>
          </div>

          <aside class="trial-card">
            <i class="bi bi-stars trial-card__accent text-3xl"></i>
            <h3 class="trial-card__title">配置自己的 AI</h3>
            <p class="trial-card__text">在设置中添加模型服务的地址和密钥，或连接本地 Ollama，然后在标题栏选择模型。</p>
          </aside>
        </section>

        <section class="highlights-section">
          <h3 class="highlights-section__title">功能亮点</h3>
          <div class="highlights-grid">
            <article class="highlight-card">
              <div class="highlight-card__header">
                <i class="bi bi-robot highlight-card__accent"></i>
                <div class="highlight-card__title">AI 命令辅助</div>
              </div>
              <p class="highlight-card__text">
                输入自然语言，自动生成复杂的 Shell 指令。支持实时纠错与性能优化建议。
              </p>
            </article>

            <article class="highlight-card">
              <div class="highlight-card__header">
                <i class="bi bi-keyboard highlight-card__accent"></i>
                <div class="highlight-card__title">极致终端体验</div>
              </div>
              <p class="highlight-card__text">
                基于 Xterm.js 构建，支持 256 色、TrueColor 以及超大数据量无感滚动流。
              </p>
            </article>

            <article class="highlight-card">
              <div class="highlight-card__header">
                <i class="bi bi-shield-check highlight-card__accent"></i>
                <div class="highlight-card__title">本地安全同步</div>
              </div>
              <p class="highlight-card__text">
                加密存储您的 SSH 配置、私钥与 AI
                设置，所有敏感信息仅存储在本地，不上传云端，确保极致安全。
              </p>
            </article>
          </div>
        </section>
      </main>
    </div>
  </div>
</template>

<style scoped>
.welcome-page {
  font-family: 'Microsoft Yahei', 'PingFang SC', sans-serif;
  height: 100%;
  overflow-y: auto;
  background: var(--vscode-bg);
  color: var(--vscode-fg);
}

.welcome-shell {
  display: flex;
  justify-content: center;
  align-items: flex-start;
  min-height: 100%;
  padding: 3rem 1rem;
}

.welcome-main {
  width: 100%;
  max-width: 72rem;
}

.welcome-header {
  margin-bottom: 2.5rem;
}

.welcome-title,
.subscription-card__title,
.trial-card__title,
.highlights-section__title,
.feature-item__title,
.highlight-card__title {
  color: var(--vscode-fg);
}

.welcome-title {
  font-size: 2.25rem;
  line-height: 1.1;
  font-weight: 800;
  margin: 0 0 0.75rem;
}

.welcome-subtitle,
.subscription-card__text,
.subscription-card__label,
.feature-item__text,
.trial-card__text,
.highlight-card__text {
  color: var(--vscode-fg-muted);
}

.welcome-subtitle {
  max-width: 42rem;
  font-size: 1.125rem;
  line-height: 1.7;
  margin: 0;
}

.subscription-card,
.trial-card,
.highlight-card {
  background: var(--vscode-bg-light);
  border: 1px solid var(--vscode-border);
  border-radius: 0.75rem;
}

.overview-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1.5rem;
}

.subscription-card {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.subscription-card__header {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  justify-content: space-between;
  padding: 2rem;
  border-bottom: 1px solid var(--vscode-border-subtle);
}

.subscription-card__badge,
.trial-card__pill {
  display: inline-flex;
  align-items: center;
  padding: 0.15rem 0.65rem;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--vscode-accent);
  background: color-mix(in srgb, var(--vscode-accent) 12%, transparent);
}

.subscription-card__title {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 700;
}

.subscription-card__title--small {
  font-size: 1.125rem;
}

.subscription-card__text,
.subscription-card__label {
  margin: 0.25rem 0 0;
}

.subscription-card__meta {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.subscription-card__body {
  display: grid;
  gap: 2rem;
  padding: 2rem;
  background: color-mix(in srgb, var(--vscode-bg) 70%, var(--vscode-bg-light) 30%);
}

.feature-item {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.feature-icon-box {
  width: 2.5rem;
  height: 2.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 0.5rem;
  background: color-mix(in srgb, var(--vscode-accent) 12%, transparent);
  color: var(--vscode-accent);
}

.feature-item__title,
.highlight-card__title,
.trial-card__title,
.highlights-section__title {
  margin: 0;
  font-weight: 700;
}

.feature-item__text,
.highlight-card__text,
.trial-card__text {
  margin: 0;
  line-height: 1.7;
}

.trial-card {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 2rem;
  padding: 2rem;
}

.trial-card__progress-wrap {
  position: relative;
  padding-top: 0.25rem;
}

.trial-card__progress-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}

.trial-card__accent,
.highlight-card__accent {
  color: var(--vscode-accent);
}

.trial-card__track {
  overflow: hidden;
  height: 0.5rem;
  display: flex;
  border-radius: 999px;
  background: color-mix(in srgb, var(--vscode-accent) 12%, transparent);
}

.trial-card__bar {
  background: var(--vscode-accent);
}

.trial-card__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--vscode-border-subtle);
}

.trial-card__value {
  color: var(--vscode-fg);
}

.trial-card__button {
  width: 100%;
  padding: 0.75rem 1rem;
  border: none;
  border-radius: 0.5rem;
  background: var(--vscode-accent);
  color: var(--vscode-button-foreground);
  font-weight: 600;
  cursor: pointer;
}

.trial-card__button:hover {
  background: var(--vscode-accent-hover);
}

.highlights-section {
  grid-column: 1 / -1;
  margin-top: 2rem;
}

.highlights-section__title {
  margin-bottom: 1.5rem;
  font-size: 1.125rem;
}

.highlights-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1.5rem;
}

.highlight-card {
  padding: 1.5rem;
  transition: border-color 0.2s ease;
}

.highlight-card:hover {
  border-color: var(--vscode-accent);
}

.highlight-card__header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.text-primary {
  color: var(--vscode-accent);
}

.bg-primary {
  background-color: var(--vscode-accent);
}

.border-primary {
  border-color: var(--vscode-accent);
}

@media (min-width: 768px) {
  .overview-grid {
    grid-template-columns: 2fr 1fr;
  }

  .subscription-card__header {
    flex-direction: row;
    align-items: center;
  }

  .subscription-card__meta {
    align-items: flex-end;
  }

  .subscription-card__body {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .highlights-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
</style>
