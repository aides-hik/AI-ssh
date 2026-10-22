# AGENTS.md

## 本地启动

### 环境要求

- Node.js 26.12.1，与 `.node-version` 和 CI 一致
- pnpm 12，仓库固定使用 `pnpm@12.15.0`；Node.js 26 不再内置 Corepack，可用 `npm install -g pnpm@12.15.0` 安装
- 首次运行先在仓库根目录执行 `pnpm install`
- 服务端只读取 `packages/server/.env`；可参考根目录 `.env.example` 准备配置，禁止提交真实密钥

### 同时启动客户端和服务端

在仓库根目录执行：

```bash
pnpm dev
```

该命令会先构建 database workspace，再并行启动服务端和桌面端：

- 服务端默认地址：`http://127.0.0.1:3000`
- 服务端健康检查：`http://127.0.0.1:3000/health`
- 桌面端 Vite 地址：`http://127.0.0.1:5173`
- Electron 主进程由 Vite 开发服务自动启动

也可以分别启动：

```bash
pnpm dev:server
pnpm dev:desktop
```

只启动桌面端前，至少先执行一次：

```bash
pnpm build:database
pnpm dev:desktop
```

### 本地启动排查

- `pnpm dev:server` 会先清理占用的服务端端口，并在 `9229` 开启 Node 调试端口。
- 桌面端本地功能无需账号或服务端；AI 功能请先在设置中配置自己的模型服务。
- 当前 Electron 为 `45.0.0`，`better-sqlite3` 13 使用 Node-API，随 npm 包提供 `prebuilds/<platform>-<arch>.node`，无需按 Electron ABI 下载或编译。
- 执行 `pnpm --filter @ai-ssh/desktop run rebuild` 校验目标平台和架构的绑定；本机目标还会验证 SQLite 查询。`rebuild` 保留为兼容脚本名，实际不编译源码。
- 原生绑定由 `apps/desktop/scripts/rebuild-native.js` 和打包后的架构检查统一验证。不要恢复 `prebuild-install` 的旧 Electron ABI 下载流程或 `electron-rebuild` 源码编译流程。重新安装依赖前先退出所有 Electron 客户端，避免 Windows 锁定 `.node` 文件。
- 需要在本地模拟生产客户端时使用 `pnpm --filter @ai-ssh/desktop prod:desktop`；它会构建并直接启动应用，但不会生成安装包。

### 提交前验证

按修改范围运行：

```bash
pnpm --filter @ai-ssh/server test
pnpm --filter @ai-ssh/desktop test
pnpm --filter @ai-ssh/database test
pnpm --filter @ai-ssh/server type-check
pnpm --filter @ai-ssh/desktop type-check
pnpm --filter @ai-ssh/database type-check
pnpm --filter @ai-ssh/shared type-check
pnpm lint
```

TypeScript 采用官方双版本并行方案：`@typescript/native` 提供 TypeScript 7 的 `tsc`；`typescript` 别名指向 `@typescript/typescript6`，仅为 `vue-tsc` 与 ESLint 提供编译器 API。升级时同时保留原生 CLI 与 Vue 模板类型检查，不要直接删除兼容层。

不要为了验证客户端在本地执行根 `pnpm build`，该命令仅构建共享包、数据库包和服务端。客户端代码可用 `pnpm --filter @ai-ssh/desktop exec vite build` 验证；`pnpm build:desktop` 和 workspace 的 `build:*` 打包命令统一交给 GitHub Actions。

## 客户端发布

### 1. 统一修改版本号

这是一个 monorepo 项目，发布新版本前需要**统一修改所有包的版本号**：

- 根 `package.json`
- `apps/desktop/package.json`
- `packages/server/package.json`
- `packages/database/package.json`
- `packages/shared/package.json`

确保所有包的版本号一致后再进行下一步。

同时更新 `CHANGELOG.md` 对应版本内容，Release workflow 会从中提取发布说明。

### 2. 提交并发布 tag

版本修改、测试和类型检查通过后，提交并推送 `main`，再创建并推送与版本一致的 tag：

```bash
git tag vX.Y.Z
git push origin main
git push origin vX.Y.Z
```

不要让 tag 指向未包含版本号或发布修复的旧提交。除非用户明确要求，否则不要自动提交、推送或创建 tag。

### 3. GitHub Actions 打包

发布 tag 后，GitHub Actions 会自动触发打包流程：

- 工作流文件：`.github/workflows/release.yml`
- 触发规则：推送 `v*` tag，也支持手动输入版本号触发
- 构建矩阵：Windows x64、macOS x64、macOS arm64、Linux x64
- 客户端生产 API 地址来自 GitHub Actions Variables 中的 `DESKTOP_VITE_API_BASE_URL`
- `TARGET_ARCH` 必须与矩阵架构一致，尤其不能混用 macOS x64 和 arm64 的 SQLite 原生绑定

**注意**：不要在本地执行 `pnpm build`、`electron-builder`
等打包命令，全部由 GitHub Actions 完成。

### 4. 发布验收

发布不能以 Release 页面已创建作为完成标准，必须等待全部矩阵任务成功，并确认 Release 至少包含：

- Windows x64 安装程序
- macOS Intel x64 DMG
- macOS Apple Silicon arm64 DMG
- Linux AppImage
- Linux DEB
- 各平台自动更新 manifest

如果某个平台失败，只修复构建原因并重新发布新的补丁版本；不要覆盖已发布 tag，也不要强推 tag。

## Prisma 约定

项目只保留两份按数据库类型划分的 Prisma schema：

- `packages/database/prisma/schema-postgresql.prisma`：服务端 PostgreSQL 唯一 schema
- `packages/database/prisma/schema-sqlite.prisma`：桌面端本地 SQLite 唯一 schema

禁止再新增或恢复第二份 PostgreSQL schema（例如旧的
`schema.prisma`），避免模型漂移导致“代码里有模型但运行库没建表”。

执行数据库相关命令时，必须显式使用对应 schema：

- PostgreSQL：`pnpm db:generate`、`pnpm db:push`、`pnpm db:migrate`、`pnpm db:migrate:deploy`
- SQLite 客户端生成：由 `pnpm --filter @ai-ssh/database build` 或
  `pnpm db:generate` 统一处理

修改 PostgreSQL 数据模型时，必须同时检查：

- `packages/database/prisma/schema-postgresql.prisma`
- `packages/database/migrations/`

不要只改客户端生成产物目录
`packages/database/src/generated/*`；生成产物不是源文件。

## 服务端发布

### 发布前检查

- 确认 `packages/server/package.json` 与其他 workspace 版本一致。
- 确认 `packages/server/.env.production` 存在且配置正确；该文件只用于部署，不得提交。
- 如果修改 PostgreSQL 模型，先按 Prisma 约定检查 schema 和 migrations。
- 运行服务端测试与类型检查，必要时先验证数据库和 Redis 连接。

### 一键部署

使用项目内置部署脚本一键部署：

```bash
node deploy/deploy-server.mjs
```

部署脚本职责：

- `deploy/deploy.config.mjs` - 服务器配置（host、port、目录）
- `deploy/deploy-server.mjs` - 部署执行（打包 → 上传 → 解压 → PM2 重启）

部署流程自动完成：

1. 本地通过 `esbuild` 打包 server bundle，并注入当前 `APP_VERSION`
2. 打包成 `.tar.gz` 归档
3. 上传到服务器 `/www/wwwroot/ai-ssh-assistant/server/releases/<timestamp>/`
4. 上传生产环境变量到共享目录，并连接共享日志和上传目录
5. 将 `current` 软链接切换到新版本
6. 重启并保存 PM2 进程 `ai-ssh-assistant-server`

**注意**：不要在本地执行 `pnpm build` 再手动 scp，用部署脚本一键完成。

### 部署后验收

部署脚本成功不代表发布验收完成。至少检查：

```text
http://127.0.0.1:3000/health
```

验收要求：

- HTTP 状态为 `200`
- 返回版本号与本次发布版本一致
- 数据库状态为 `healthy`
- Redis 状态为 `healthy`
- PM2 进程 `ai-ssh-assistant-server` 为 `online`
- 登录接口可正常调用
- 若启用了自托管 AI，`/api/v1/ai/official/status` 能返回部署者配置的模型

部署配置和生产 `.env` 含服务器信息或密钥，必须保持 Git 忽略；不得把密码、Token、API Key 写入 `AGENTS.md`、提交记录或日志摘要。
