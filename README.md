# AI SSH Assistant

基于 Electron、Vue 和 AI 的 SSH 远程服务器管理工具。桌面端可独立运行，无需账号登录。

## 功能

- SSH 连接管理，支持密码和私钥认证。
- 实时终端、远程文件浏览和 SFTP 传输。
- 自定义 AI 服务，支持 OpenAI 兼容接口、Anthropic、Google 和 Ollama 等。
- SSH 连接、密钥、模型配置和会话保存在本地。

## 本地启动

需要 Node.js 20 或更高版本，使用仓库固定的 pnpm 8.12.0。

```bash
corepack pnpm install
corepack pnpm build:database
corepack pnpm dev:desktop
```

Vite 预览地址为 `http://127.0.0.1:5173`，Electron 窗口会自动打开。完整的 SSH、文件传输和本地存储功能请在 Electron 中使用。

首次使用时，在侧栏添加 SSH 连接，在“设置 → AI 配置”中填写自己的模型服务地址与 API Key，或连接本地 Ollama。项目不再提供原作者账号、内置托管模型、支付或反馈服务。

若 Electron SQLite 绑定缺失，先退出所有客户端，再执行：

```bash
corepack pnpm --filter @ai-ssh/desktop run rebuild
```

## 可选自托管服务

桌面端本地功能无需后端。需要使用通用后端 API 时，参考 `.env.example` 准备 `packages/server/.env`，配置自己的 PostgreSQL 和 Redis 后启动：

```bash
corepack pnpm dev
```

默认 API 为 `http://127.0.0.1:3000`，健康检查为 `/health`。可使用 `VITE_API_BASE_URL` 配置自己的 API 地址。

自动更新默认关闭。维护自己的发布渠道时，使用 `VITE_UPDATE_REPOSITORY` 或 `VITE_UPDATE_MANIFEST_URL` 显式指定更新源；Electron 运行时也支持对应的 `AI_SSH_UPDATE_*` 配置。

客户端安装包由 `.github/workflows/release.yml` 在 GitHub Actions 构建，不在本地执行根 `pnpm build` 或 `electron-builder`。

更多启动与数据库约定见 [AGENTS.md](./AGENTS.md)。
