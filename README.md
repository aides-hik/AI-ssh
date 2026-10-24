# 棱镜（Prism）

产品中文名为「棱镜」，英文名为 **Prism**。应用内会根据所选语言显示对应名称；仓库地址与内部 workspace 包名保持现有命名。

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

- Node.js **26.12.1**，与 [.node-version](./.node-version) 和 CI 保持一致。
- pnpm **12.15.0**，与根目录 `packageManager` 保持一致。
- Git；首次安装依赖和原生模块时需要网络连接。

桌面运行环境为 Windows 10/11 64 位、macOS 13 或更新版本，以及兼容 Electron 的 64 位 Linux 发行版。macOS 最低版本随 Electron 45 升级到 13。

```bash
git clone https://github.com/aides-hik/AI-ssh.git
cd AI-ssh

npm install -g pnpm@12.15.0
pnpm --version
```

确认最后输出 `12.15.0`。Node.js 26 不再内置 Corepack，上述命令直接安装仓库要求的 pnpm。项目脚本也会调用 `pnpm`，因此要确保当前终端中的版本一致。

### 2. 安装并启动

在仓库根目录执行：

```bash
pnpm install --frozen-lockfile
pnpm build:database
pnpm --filter @ai-ssh/desktop run rebuild
pnpm dev:desktop
```

`build:database` 会生成 Prisma 客户端并构建数据库包，桌面端使用本地 SQLite，**此步骤不需要运行 PostgreSQL 或 Redis**。`run rebuild` 校验随 `better-sqlite3` 13 包提供的 Node-API 原生绑定及本机查询，不编译源码。重新安装依赖前请退出已经打开的客户端。

启动后会自动打开 Electron 窗口。Vite 页面默认位于 `http://127.0.0.1:5173`；浏览器可用于查看界面，完整的 SSH、SFTP 和本地数据库功能需要在 Electron 窗口中使用。

依赖和数据库包准备好后，日常开发只需执行 `pnpm dev:desktop`。仅使用桌面端时，无需创建服务端 `.env`。

### 3. 连接第一台服务器

1. 在左侧点击“新建文件夹”，在文件夹菜单中选择“新建连接”。
2. 填写名称、服务器地址、端口（通常为 `22`）和用户名，选择“密码”并输入密码。
3. 点击“测试连接”，成功后点击“创建”，再从连接菜单选择“连接”。
4. 从连接菜单选择“文件管理”，浏览远程目录并上传、下载文件。

当前私钥路径读取和 SSH Agent 接入尚未完善，首次使用按上述密码认证流程配置。远程文件需要编辑时，可在终端选中文件路径后右键选择“本地编辑”，用系统关联程序编辑下载的副本，保存后由应用同步到远端。

## 配置 AI

设置里的 AI 服务商目录按官方资料核对，区分已核对的预置、需要从账号获取的模型，以及尚未接入的专有接口。核对日期、官方文档入口和模型支持的参数可在配置面板查看；具体模型可用性仍以你的账号和服务地址为准。目录来源见 [服务商核对记录](docs/ai-provider-catalog.md)，参数规则见 [模型参数适配](docs/ai-model-parameters.md)。

终端对话支持 OpenAI Chat Completions、Responses 和 Claude 原生 Messages 协议；Gemini 终端工具调用使用 Google 官方 OpenAI 兼容接口。普通文本对话另外支持 Gemini 和 Ollama 原生协议。参与终端工具操作的模型需要支持流式输出和工具调用。

1. 打开“设置 → AI 服务商”，选择对应服务商，或“自定义 OpenAI 兼容”。
2. 填写服务商提供的 API 基础地址和 API Key。
3. 刷新账号可用模型，或点击“添加模型”填写实际模型 ID 和名称；启用服务商及所需模型。
4. 展开模型行的“参数”，可保存该模型支持的思考程度、最大输出 token、温度和 Top P。不被模型接受的参数会隐藏，留空使用默认值。
5. 执行“测试已启用模型”，在窗口顶部的模型选择器中选中模型，再使用 AI 对话。

终端对话发送按钮旁的“选择推理强度”可展开分档滑块，支持鼠标拖动和方向键调整，右上角按钮可恢复默认。可用档位依据模型及服务能力显示，部分模型只有开关或思考预算；未知或不支持调节的模型仅使用默认设置。OpenRouter 的档位来自服务返回的模型能力，可刷新模型列表更新。“默认”不发送额外思考参数，选择按服务商和模型分别保存在本机，生成中无法调整。

填写的是**模型服务地址**，与本项目可选后端的 `VITE_API_BASE_URL` 是两个不同配置。OpenAI 兼容服务的地址通常包含 `/v1`，具体以服务提供方要求为准；不要填写某次请求的 `/chat/completions` 完整路径。

使用本地 Ollama 时，先启动 Ollama 并准备好支持工具调用的模型，再选择“Ollama”并刷新本机模型：

| 字段 | 填写内容 |
| --- | --- |
| API 基础地址 | `http://127.0.0.1:11434` |
| API Key | 本地未启用认证时留空 |
| 模型 ID | 手动添加本机实际安装的模型名称，包含需要的标签 |

Ollama 普通对话使用原生接口，终端工具调用使用它的 `/v1/chat/completions` 兼容接口。仍可用“自定义 OpenAI 兼容”接入本机的 `/v1` 地址。

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

Compose 只提供本地数据库和缓存依赖，固定使用 PostgreSQL `18.6-alpine3.24` 与 Redis `8.10.2-alpine3.23`，端口只绑定到 `127.0.0.1`。服务端仍通过下面的 `pnpm dev:server` 启动；仓库没有 API 容器镜像或 Web 前端部署文件。也可使用 `pnpm docker:pull` 拉取这两个镜像、`pnpm docker:up` 启动、`pnpm docker:down` 停止。

从旧 Compose 升级时，新配置使用 `postgres18_data` 与 `redis8_data` 新数据卷；旧的 `postgres_data`、`redis_data` 卷不会自动删除或迁移。需要保留旧业务数据时，先从旧 PostgreSQL 导出，再恢复到新数据库；不要将 PostgreSQL 15 的数据目录直接挂载给 18。未恢复数据前，新环境是空库和空缓存。PostgreSQL 18 的卷挂载点已按官方镜像要求改为 `/var/lib/postgresql`。

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
pnpm --filter @ai-ssh/desktop test
pnpm --filter @ai-ssh/database test
pnpm lint
```

也可以使用 `pnpm test` 和 `pnpm type-check` 运行所有 workspace 的测试与类型检查。桌面端和数据库单元测试使用 Node.js 内置测试运行器，服务端使用 Vitest。日常 CI、手动构建的验证阶段和 Release 前置检查复用相同的测试、类型检查与构建流程。

TypeScript CLI 使用 **7.0.2** 原生编译器。Vue 模板检查及 ESLint 仍需要经典 JavaScript 编译器 API，因此按 [TypeScript 官方并行安装方案](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/) 保留 `@typescript/typescript6` **6.0.2** 兼容层：`@typescript/native` 提供 `tsc`，`typescript` 别名为 Vue 与 ESLint 提供 API。不要移除这个兼容依赖，也不要跳过 `vue-tsc` 模板检查。

### 预览生产版本与生成安装包

Windows x64 可以先执行可重复的本地集成验收：

```bash
pnpm build:shared
pnpm build:database
pnpm --filter @ai-ssh/desktop exec vite build
pnpm --filter @ai-ssh/desktop test:windows
```

测试会启动真实 Electron，使用 `tmp/windows-validation/` 下的隔离数据目录，检查界面与重启持久化、Windows 文件路径、SSH/SFTP，以及模型接口的流式响应和取消。SSH 与模型服务只监听本机临时端口，使用临时测试凭据，不连接真实服务器或消耗模型额度。每次验收的结果 JSON 和日志保留在该目录中；这组测试不会生成或安装安装包。

需要验证 Windows 安装程序时，在 GitHub Actions 手动运行 [Manual Build](./.github/workflows/manual-build.yml)，选择 `windows` 并启用测试。该流程只构建所选平台，在一次性 Windows runner 上完成安装、启动和卸载验收，再上传安装包及验收记录。当前工作区有未提交修改时，须先将要验证的版本提交并推送到所选分支；无需创建发布 tag。

本地需要验证生产模式时执行以下命令，它会构建并启动桌面应用，不生成安装包：

```bash
pnpm --filter @ai-ssh/desktop run prod:desktop
```

根 `pnpm build` 只构建共享包、数据库包与服务端。验证客户端构建可运行 `pnpm --filter @ai-ssh/desktop exec vite build`，它不会生成安装包。

安装包统一通过 GitHub Actions 的 [Release 工作流](./.github/workflows/release.yml) 构建。不要在本地执行 `pnpm build:desktop`、workspace 的 `build:*` 打包脚本或 `electron-builder` 来验证普通改动。

发布时先统一根目录及四个 workspace 包的版本号，更新 [CHANGELOG.md](./CHANGELOG.md)，完成测试和类型检查，再将提交及对应的 `vX.Y.Z` tag 推送到仓库。也可以在 Actions 中手动运行 Release 并输入版本号；tag 必须指向包含该版本代码的提交。

构建目标为 Windows x64、macOS x64、macOS arm64、Linux x64，产物包含 Windows 安装程序、两种架构的 DMG、Linux AppImage 和 DEB，以及更新 manifest。发布后检查全部矩阵任务和附件是否齐全。

GitHub 仓库 Variables 支持 `DESKTOP_VITE_API_BASE_URL`、`DESKTOP_UPDATE_REPOSITORY`、`DESKTOP_UPDATE_MANIFEST_URL`，用于写入客户端构建配置。推送 `main` 会运行测试、类型检查、lint 和不生成安装包的构建；不会自动发布安装包。

## 常见问题

### 页面能打开，但 SSH 或文件功能不可用

确认使用的是自动打开的 Electron 窗口。直接访问 Vite 地址的普通浏览器没有 Electron IPC 能力。

### 提示找不到数据库包或 Prisma 客户端

在仓库根目录执行 `pnpm build:database`，成功后重新启动桌面端。数据库包源文件变化后也需要重新构建。

### 提示 SQLite 原生绑定缺失或架构不匹配

先退出所有 Electron 客户端，再执行：

```bash
pnpm --filter @ai-ssh/desktop run rebuild
```

项目使用 Electron `45.0.0` 与 `better-sqlite3` 13。SQLite 绑定使用 Node-API，文件随 npm 包放在 `prebuilds/<platform>-<arch>.node`；无需按 Electron ABI 重新下载，也不需要本地 C++ 编译环境。脚本会校验目标架构，本机目标还会执行内存数据库查询。这里的 `run` 不要省略，以免调用 pnpm 自带的 `rebuild` 命令。

如果绑定文件缺失，重新执行 `pnpm install --frozen-lockfile`；如果使用了 `TARGET_ARCH`，确认它与目标安装包架构一致。旧版本的 `prebuild-install` 缓存配置不再适用。

### 安装依赖时卡在 `cpu-features` 编译

该模块用于 SSH 的可选 CPU 特性检测。仓库的 `pnpm-workspace.yaml` 已明确跳过 `cpu-features`、`ssh2` 和 `better-sqlite3` 的源码安装脚本，并允许 Electron 等必要依赖的安装脚本。使用固定的 pnpm 12.15.0 安装时，不需要本地 C++ 编译环境。

若曾手动使用 `--ignore-scripts` 安装，可按下面的流程补齐 Electron 可执行文件、Prisma 客户端，并验证 SQLite 绑定：

```bash
pnpm install --frozen-lockfile --ignore-scripts
node apps/desktop/node_modules/electron/install.js
pnpm build:database
pnpm --filter @ai-ssh/desktop run rebuild
```

此方式用于桌面端启动排查；通常直接使用 `pnpm install --frozen-lockfile` 即可按仓库配置运行依赖安装脚本。

### Electron 安装不完整或没有下载可执行文件

若安装时跳过了依赖脚本，可在根目录手动执行 Electron 安装脚本，然后验证 SQLite 绑定：

```bash
node apps/desktop/node_modules/electron/install.js
pnpm --filter @ai-ssh/desktop run rebuild
```

### AI 连接测试失败，或模型没有出现在选择器中

检查服务地址、API Key、模型名称及服务商网络访问情况；确认模型已启用。使用 Ollama 时检查本地服务是否启动、模型是否已安装。聊天可用而工具调用失败时，确认该模型和接口支持工具调用。

### 服务端报配置或数据库连接错误

确认配置文件位于 `packages/server/.env`，检查必填值长度及数据库、Redis 的实际地址和端口。仅需要终端和文件管理时，可以直接使用 `pnpm dev:desktop`。
