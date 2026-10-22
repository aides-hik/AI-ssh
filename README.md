# AI SSH Assistant

一个把 SSH 终端、远程文件管理和 AI 助手放在同一窗口中的桌面应用，基于 Electron、Vue 3 和 TypeScript 开发。

**桌面端可独立运行，无需注册账号，也无需部署后端。** 添加自己的 SSH 服务器即可使用终端和文件管理；需要 AI 时，再配置自己的模型服务或本地 Ollama。自动更新默认关闭，由维护者自行配置更新源。

## 能做什么

| 功能 | 说明 |
| --- | --- |
| SSH 连接管理 | 管理服务器和分组，使用密码连接远程服务器 |
| 远程终端 | 多标签终端、命令自动补全、快捷命令 |
| 文件管理 | 通过 SFTP 浏览目录、上传和下载文件、创建目录和删除文件 |
| AI 助手 | 解释命令、分析输出，并通过工具调用辅助操作已连接的服务器 |
| 自定义模型 | 配置 OpenAI 兼容服务的地址、API Key 和模型，也可接入 Ollama 的兼容接口 |
| 本地设置 | 保存连接信息、模型配置和应用偏好，提供中文、英文及主题切换 |

AI 工具调用会实际操作服务器。当前主聊天的工具执行尚未接入“安全权限”规则，也不会逐次弹窗确认，请使用权限范围合适的 SSH 账号。

## 快速开始：运行桌面端

### 1. 准备环境

- Node.js **20 或更高版本**。
- pnpm **8.12.0**，与根目录 `packageManager` 保持一致。
- Git；首次安装依赖和原生模块时需要网络连接。

```bash
git clone https://github.com/aides-hik/AI-ssh.git
cd AI-ssh

corepack enable
corepack prepare pnpm@8.12.0 --activate
pnpm --version
```

确认最后输出 `8.12.0`。如果当前 Node.js 环境没有 Corepack，可以使用 `npm install -g pnpm@8.12.0` 安装指定版本。项目脚本会继续调用 `pnpm`，因此要确保当前终端中的 `pnpm` 也是这个版本。

### 2. 安装并启动

在仓库根目录执行：

```bash
pnpm install --frozen-lockfile
pnpm build:database
pnpm --filter @ai-ssh/desktop run rebuild
pnpm dev:desktop
```

`build:database` 会生成 Prisma 客户端并构建数据库包，桌面端使用本地 SQLite，**此步骤不需要运行 PostgreSQL 或 Redis**。`run rebuild` 为当前 Electron 准备匹配的 SQLite 原生绑定；执行前请退出已经打开的客户端。

启动后会自动打开 Electron 窗口。Vite 页面默认位于 `http://127.0.0.1:5173`；浏览器可用于查看界面，完整的 SSH、SFTP 和本地数据库功能需要在 Electron 窗口中使用。

依赖和数据库包准备好后，日常开发只需执行 `pnpm dev:desktop`。仅使用桌面端时，无需创建服务端 `.env`。

### 3. 连接第一台服务器

1. 在左侧点击“新建文件夹”，在文件夹菜单中选择“新建连接”。
2. 填写名称、服务器地址、端口（通常为 `22`）和用户名，选择“密码”并输入密码。
3. 点击“测试连接”，成功后点击“创建”，再从连接菜单选择“连接”。
4. 从连接菜单选择“文件管理”，浏览远程目录并上传、下载文件。

当前私钥路径读取和 SSH Agent 接入尚未完善，首次使用按上述密码认证流程配置。远程文件需要编辑时，可在终端选中文件路径后右键选择“本地编辑”，用系统关联程序编辑下载的副本，保存后由应用同步到远端。

## 配置 AI

当前主聊天使用 **OpenAI Chat Completions 兼容协议**，需要接口支持流式输出和工具调用。设置页面虽然列出了多种服务商，但主聊天尚未完整接入 Anthropic、Google 等原生协议；请使用提供兼容协议的端点。

1. 打开“设置 → AI 服务商”，选择“自定义 OpenAI 兼容”。
2. 填写服务商提供的 API 基础地址和 API Key。
3. 点击“添加模型”，填写服务端实际提供的模型 ID 和显示名称，并启用服务商及模型。
4. 执行“测试连接”，在窗口顶部的模型选择器中选中模型，再使用 AI 对话。

填写的是**模型服务地址**，与本项目可选后端的 `VITE_API_BASE_URL` 是两个不同配置。OpenAI 兼容服务的地址通常包含 `/v1`，具体以服务提供方要求为准；不要填写某次请求的 `/chat/completions` 完整路径。

使用本地 Ollama 时，先启动 Ollama 并准备好支持工具调用的模型，然后仍通过“自定义 OpenAI 兼容”配置：

| 字段 | 填写内容 |
| --- | --- |
| API 基础地址 | `http://127.0.0.1:11434/v1` |
| API Key | 本地未启用认证时填写占位值 `ollama`，用于满足客户端配置要求 |
| 模型 ID | 手动添加本机实际安装的模型名称，包含需要的标签 |

内置 Ollama 配置项与主聊天的协议衔接尚未完善，上述方式通过其兼容接口使用。

模型服务的访问权限、额度和费用由你选择的服务商决定。使用外部模型时，对话内容以及参与分析的终端输出会发送到所配置的模型服务。

## 数据保存在什么地方

桌面端默认使用本地存储：

- SSH 连接等结构化数据保存在 Electron 用户数据目录下的 `local.db`。
- AI 服务商配置和部分应用偏好保存在应用的本地存储中。
- 本地笔记和部分文档修改备份保存在用户数据目录下的 `docs/`。备份本地数据时，应退出客户端并复制整个用户数据目录。

当前服务器环境文档保存于**远端登录用户的 `~/env.md`**，需要单独备份；复制本机用户数据目录不会包含这份远端文件。

可通过“设置 → 数据存储 → 打开存储目录”定位实际目录。路径由 Electron 的 `app.getPath('userData')` 决定，开发版与安装版的目录名称可能不同。

当前实现中，SSH 凭据和 AI API Key 没有统一的应用层加密保护。本地数据库、用户数据目录和导出的连接文件都应按敏感数据保管，不要提交到仓库或直接分享。

## 可选：运行自托管服务端

此部分用于需要后端 API 的开发或自托管场景。当前服务端提供账号认证 API 和可选的自托管 AI 代理；桌面端的 SSH、SFTP 和自定义模型使用不依赖这些 API。

### 1. 准备 PostgreSQL 和 Redis

可以使用已有服务，也可以在安装并启动 Docker 后，仅启动仓库中的两个依赖服务：

```bash
docker compose up -d postgres redis
```

数据库名、用户名和密码见 [docker-compose.yml](./docker-compose.yml) 的 `postgres.environment`，默认端口分别为 `5432` 和 `6379`。它们是本地开发示例配置，服务端 `.env` 中的连接信息必须与实际服务一致。

当前 Compose 文件中的其他服务引用了仓库未提供的部署文件，因此这里仅使用 `postgres` 和 `redis`。

### 2. 创建服务端配置

将根目录 [.env.example](./.env.example) 复制为 `packages/server/.env`，填写自己的配置。服务端启动脚本在 `packages/server` 下运行，只读取该目录的 `.env`。

| 配置项 | 要求 |
| --- | --- |
| `DATABASE_URL` | 可连接的 PostgreSQL 数据库，包含正确的用户、密码、端口和数据库名 |
| `REDIS_HOST`、`REDIS_PORT` | Redis 地址，示例为本机 `6379` |
| `REDIS_PASSWORD` | Redis 设置了密码时填写 |
| `JWT_SECRET`、`SESSION_SECRET` | 分别设置自己的随机值，至少 32 个字符 |
| `ENCRYPTION_KEY` | 恰好 32 个字符 |
| `HOST`、`PORT` | 本地示例为 `127.0.0.1`、`3000` |
| `CORS_ORIGIN` | 允许访问 API 的前端来源，多个来源用逗号分隔 |

示例值用于说明格式，真实密钥只放在被 Git 忽略的本地环境文件中。

### 3. 启动并检查

完成桌面端依赖安装与数据库包构建后，在根目录执行：

```bash
# 仅启动服务端
pnpm dev:server

# 或者同时启动服务端和桌面端
pnpm dev
```

`pnpm dev` 会先构建数据库包，再并行启动两端。服务端默认启用 `AUTO_MIGRATE`；当前仓库没有 Prisma 迁移目录时，会根据 PostgreSQL schema 执行 `db push`，因此数据库必须可连接且账号具有建表权限。已有生产数据库应自行安排迁移，并按需要设置 `AUTO_MIGRATE=false`。

| 地址 | 用途 |
| --- | --- |
| `http://127.0.0.1:3000/health` | 健康检查，应返回 HTTP 200，且 `services.database`、`services.redis` 均为 `healthy` |
| `http://127.0.0.1:3000/docs` | API 文档，仅在开发环境且 `ENABLE_DOCS=true` 时提供 |
| `http://127.0.0.1:5173` | 桌面端的 Vite 开发页面 |

`dev:server` 会终止占用 `3000`、`9229` 端口的进程，并开启 `9229` 调试端口。即使修改了服务端 `PORT`，清理列表仍然固定；启动前确认这两个端口没有其他需要保留的服务。

可选 AI 代理通过 `OFFICIAL_AI_ENABLED`、`OFFICIAL_AI_BASE_URL`、`OFFICIAL_AI_API_KEY` 和 `OFFICIAL_AI_MODELS` 配置，模型列表用逗号分隔，默认关闭。这组变量名及 `/api/v1/ai/official` 路径是兼容命名，上游服务由部署者自行提供。相关 API 需要服务端 JWT 认证，也不会自动出现在桌面端的模型选择器中。

## 客户端配置与更新

需要修改客户端 API 地址或配置更新源时，参考 [apps/desktop/.env.example](./apps/desktop/.env.example)，在 `apps/desktop/.env.local` 中设置开发配置，生产构建则使用相应构建环境变量。修改后重新启动开发服务或重新构建客户端。

| 构建配置 | 作用 |
| --- | --- |
| `VITE_API_BASE_URL` | 自托管后端的根地址，默认 `http://127.0.0.1:3000`；无需附加 `/api/v1` |
| `VITE_UPDATE_REPOSITORY` | 更新源 GitHub 仓库，格式为 `owner/repository` |
| `VITE_UPDATE_MANIFEST_URL` | 自定义更新 manifest 地址，支持 `{platform}`、`{arch}` 占位符，优先于仓库配置 |

Electron 主进程还支持通过启动进程的环境变量设置 `AI_SSH_API_BASE_URL`、`AI_SSH_UPDATE_REPOSITORY` 和 `AI_SSH_UPDATE_MANIFEST_URL`。这些运行时变量需要传给 Electron 进程，不是填在 Vite 环境文件中。

未指定更新源时，不进行更新检查。配置 GitHub 更新源后，需要在该仓库的 Release 中提供对应平台的 `update-manifest-{platform}-{arch}.json` 及安装文件。

## 开发与发布

### 目录结构

```text
apps/desktop/          Electron 主进程、预加载脚本和 Vue 界面
packages/database/    本地 SQLite、服务端 PostgreSQL 与数据访问层
packages/server/      可选的 Fastify 服务端
packages/shared/      共享类型和工具
.github/workflows/    持续集成与客户端打包
docs/                 设计记录和补充文档
```

数据库源文件按类型分开维护：

- `packages/database/prisma/schema-sqlite.prisma`：桌面端本地 SQLite。
- `packages/database/prisma/schema-postgresql.prisma`：服务端 PostgreSQL。

数据库生成命令为 `pnpm db:generate`；操作 PostgreSQL 前应向命令进程提供正确的 `DATABASE_URL`。不要直接修改 `packages/database/src/generated/` 下的生成文件。数据库与部署约定见 [AGENTS.md](./AGENTS.md)。

### 常用验证命令

```bash
pnpm --filter @ai-ssh/desktop type-check
pnpm --filter @ai-ssh/server type-check
pnpm --filter @ai-ssh/database type-check
pnpm --filter @ai-ssh/shared type-check
pnpm --filter @ai-ssh/server test
```

桌面端目前使用 Node.js 内置测试运行器，没有统一的 `test` 脚本。可以指定测试文件运行，例如：

```bash
node --import tsx --test apps/desktop/src/utils/standalone-providers.test.ts apps/desktop/electron/services/update-service.test.ts
```

### 预览生产版本与生成安装包

本地需要验证生产模式时执行以下命令，它会构建并启动桌面应用，不生成安装包：

```bash
pnpm --filter @ai-ssh/desktop run prod:desktop
```

安装包统一通过 GitHub Actions 的 [Release 工作流](./.github/workflows/release.yml) 构建。不要在本地执行根 `pnpm build`、`pnpm build:desktop` 或 `electron-builder` 来验证普通改动。

发布时先统一根目录及四个 workspace 包的版本号，更新 [CHANGELOG.md](./CHANGELOG.md)，完成测试和类型检查，再将提交及对应的 `vX.Y.Z` tag 推送到仓库。也可以在 Actions 中手动运行 Release 并输入版本号；tag 必须指向包含该版本代码的提交。

构建目标为 Windows x64、macOS x64、macOS arm64、Linux x64，产物包含 Windows 安装程序、两种架构的 DMG、Linux AppImage 和 DEB，以及更新 manifest。发布后检查全部矩阵任务和附件是否齐全。

GitHub 仓库 Variables 支持 `DESKTOP_VITE_API_BASE_URL`、`DESKTOP_UPDATE_REPOSITORY`、`DESKTOP_UPDATE_MANIFEST_URL`，用于写入客户端构建配置。推送 `main` 只触发常规构建，不会自动发布安装包。

## 常见问题

### 页面能打开，但 SSH 或文件功能不可用

确认使用的是自动打开的 Electron 窗口。直接访问 Vite 地址的普通浏览器没有 Electron IPC 能力。

### 提示找不到数据库包或 Prisma 客户端

在仓库根目录执行 `pnpm build:database`，成功后重新启动桌面端。数据库包源文件变化后也需要重新构建。

### 提示 `better-sqlite3`、`NODE_MODULE_VERSION` 或原生绑定错误

先退出所有 Electron 客户端，再执行：

```bash
pnpm --filter @ai-ssh/desktop run rebuild
```

项目使用 Electron `29.4.6`，重建脚本通过 `prebuild-install` 下载对应平台和架构的绑定。这里的 `run` 不要省略，以免调用 pnpm 自带的 `rebuild` 命令。

Windows 下若下载时出现跨盘 `EXDEV` 错误，可在 PowerShell 中将缓存放到当前项目所在磁盘后重试：

```powershell
$env:npm_config_cache = Join-Path (Get-Location) 'node_modules/.cache/npm'
pnpm --filter @ai-ssh/desktop run rebuild
```

### 安装依赖时卡在 `cpu-features` 编译

该模块用于 SSH 的可选 CPU 特性检测。若本地缺少编译环境，可以先跳过依赖安装脚本，再补齐独立桌面运行所需的客户端生成和原生文件：

```bash
pnpm install --frozen-lockfile --ignore-scripts
node apps/desktop/node_modules/electron/install.js
pnpm build:database
pnpm --filter @ai-ssh/desktop run rebuild
```

此方式用于桌面端启动排查；后续使用其他需要安装脚本的依赖时，仍应单独完成相应安装。

### Electron 安装不完整或没有下载可执行文件

若安装时跳过了依赖脚本，可在根目录手动执行 Electron 安装脚本，然后重新准备 SQLite 绑定：

```bash
node apps/desktop/node_modules/electron/install.js
pnpm --filter @ai-ssh/desktop run rebuild
```

### AI 连接测试失败，或模型没有出现在选择器中

检查服务地址、API Key、模型名称及服务商网络访问情况；确认模型已启用。使用 Ollama 时检查本地服务是否启动、模型是否已安装。聊天可用而工具调用失败时，确认该模型和接口支持工具调用。

### 服务端报配置或数据库连接错误

确认配置文件位于 `packages/server/.env`，检查必填值长度及数据库、Redis 的实际地址和端口。仅需要终端和文件管理时，可以直接使用 `pnpm dev:desktop`。
