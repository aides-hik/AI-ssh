# 棱镜 Prism 新一轮投稿文案

整理日期：2026-10-26。以下为各渠道投稿定稿；实际提交结果与链接以[渠道记录表](./channel-tracker.csv)为准。产品功能依据当前项目 README，截图与动图如采用浏览器预览，须保留模拟数据标记。

## 中国独立开发者项目列表的程序员版

### Issue 标题

【项目自荐 · 程序员版】棱镜 Prism：集成 AI 助手与多机巡检的 SSH 桌面工作台

### Issue 正文

希望将以下项目加入程序员版，面向自己管理服务器的开发者。

#### aides-hik - [GitHub](https://github.com/aides-hik)

- :white_check_mark: [棱镜 Prism](https://aides-hik.github.io/AI-ssh/)：SSH 桌面工作台，将终端、SFTP 文件管理和 AI 助手放在同一窗口，支持多服务器巡检和按阶段确认的 Docker / Compose 部署，提供 Windows、macOS、Linux 安装包，无需注册或部署项目后端，AI 使用自配模型服务或本地 Ollama — [项目与教程](https://github.com/aides-hik/AI-ssh)

安装包：[最新 Release](https://github.com/aides-hik/AI-ssh/releases/latest)。

专用巡检和读取工具直接执行；自定义命令、部署阶段及服务器环境文档修改先展示目标和内容，确认后执行。使用外部模型时，对话与参与分析的终端输出会发送给所配置的模型服务，相关费用由服务商决定。

## Console.dev 邮件推荐

### 邮件主题

Tool suggestion: Prism — SSH, SFTP and AI-assisted multi-server checks

### 邮件正文

Hi Console team,

I maintain Prism, a desktop SSH workspace for developers who manage their own servers. It brings a terminal, SFTP file management and an AI assistant into one window. Installers are available for Windows, macOS and Linux, and the desktop app works without a Prism account or backend deployment.

The workflow I would like to suggest for a review is checking several connected hosts, comparing their CPU, memory, disk, service and port information, then reviewing a proposed command before running it. Dedicated inspection and read tools run directly; custom commands, deployment stages and server environment document changes require approval of the exact targets and contents. Docker / Compose deployment stages include verification commands and live output.

Users bring their own model service or a local Ollama model with tool-calling support. Model charges depend on the chosen provider. When an external model is used, the relevant conversation and terminal output are sent to that service.

Website: https://aides-hik.github.io/AI-ssh/

Source and documentation: https://github.com/aides-hik/AI-ssh

Installers: https://github.com/aides-hik/AI-ssh/releases/latest

Thank you for considering it for a developer-tool review.

aides-hik

## 小众软件发现频道

### 主题标题

【开发者自荐】棱镜 Prism：在 SSH 终端旁直接分析输出、巡检多台服务器

### 正文

**软件名称：** 棱镜（Prism）

**应用平台：** Windows 10/11 x64、macOS 13 及以上（Intel / Apple Silicon）、Linux x64。

**推荐类型：** 开发者自荐。

**注册要求：** 桌面端使用 SSH、文件管理和自配模型无需注册账号，无需部署项目后端。

**费用说明：** AI 使用自己配置的模型服务，费用和额度由所选服务商决定；也可以连接支持工具调用的本地 Ollama 模型。

我在做一个把远程终端、文件管理和 AI 放在同一窗口的桌面工具，叫棱镜 Prism。想邀请平时自己管理几台服务器的朋友试用，尤其想了解首次连接、模型配置和巡检流程是否顺手。

它的基本用法是先添加自己的 SSH 连接，打开终端或 SFTP 文件管理。密码、私钥和 SSH Agent 三种认证方式都支持。只需要终端和文件功能时，可以先不配置 AI。

AI 助手放在终端旁，可以解释命令、分析输出，并对选中的多台已连接主机做巡检。比如检查磁盘、内存和监听端口，再按主机查看结果。需要部署 Docker / Compose 项目时，可以按阶段查看目标、脚本、验证命令和实时输出。

操作确认有明确区分：专用巡检和读取工具直接运行；自定义命令、部署阶段和服务器环境文档修改，先展示具体目标与内容，由用户确认。建议先在自己的测试服务器体验一次完整流程，并核对实际结果。

连接和模型配置默认保存在本机。使用外部模型时，相关对话和参与分析的终端输出会发送到该模型服务，选择模型前请按自己的数据使用要求配置。

- [官网与介绍](https://aides-hik.github.io/AI-ssh/)
- [安装包下载](https://github.com/aides-hik/AI-ssh/releases/latest)
- [详细教程与项目](https://github.com/aides-hik/AI-ssh)
- [问题反馈](https://github.com/aides-hik/AI-ssh/issues)

欢迎告诉我：你原本想完成什么任务、在哪一步卡住，以及最希望改进的一件事。反馈截图请遮盖主机地址、账号、密码、私钥和 API Key。

### 配图说明

附主界面和多机巡检截图；若使用现有网页预览截图，保留画面顶部的“界面预览 · 模拟服务器与模型数据”标记，并在图旁注明该图展示界面流程，不代表真实服务器执行结果。上传前核对论坛当前图片要求。

## DevTools Daily Directory

### Name

Prism

### Website

https://aides-hik.github.io/AI-ssh/

### Short description

A desktop SSH workspace with SFTP, an AI assistant and multi-server checks.

### Description

Prism brings SSH terminals, SFTP file management and an AI assistant into one desktop workspace for developers managing their own servers. It supports multi-host inspection and staged Docker / Compose deployment with verification commands and live logs. Dedicated inspection and read tools run directly; custom commands and deployment stages require approval of their exact targets and contents. Installers are available for Windows, macOS and Linux. No Prism account or backend deployment is required. Users configure their own model provider or a tool-capable local Ollama model. External model use sends the relevant conversation and terminal output to that provider; model charges depend on the selected service.

### Categories to consider

Developer Tools, DevOps, SSH, AI. Select only categories offered by the form that accurately describe the product.

### Download

https://github.com/aides-hik/AI-ssh/releases/latest

### 邮件申请目录审核

当在线表单无法完成时，可向官方联系地址 `hello@devtoolsdaily.com` 推荐产品，主题为 `Directory review request: Prism, an SSH workspace with AI-assisted server checks`。完整英文邮件见[投稿载荷](./additional-submission-payloads.json)的 `directoryEmail`。

邮件仅申请编辑审核，不代表已经进入表单队列或获得收录；记录状态时按实际回信判断。

## DevHunt

### Name

Prism

### Website

https://aides-hik.github.io/AI-ssh/

### Tagline

SSH, SFTP and AI-assisted server checks in one desktop workspace

### Description

Manage your own servers with SSH terminals, SFTP and an AI assistant in one desktop app. Prism can inspect selected connected hosts, summarize results by server and run staged Docker / Compose deployments with live output and verification commands. Read tools run directly; custom commands and deployment stages show their exact targets and contents for approval. Available for Windows, macOS and Linux, without a Prism account or backend. Bring your own model service or a tool-capable local Ollama model. External model charges and data processing depend on the service you configure.

### Category

DevOps; AI if multiple applicable categories are supported. Do not label the project Open Source without an established project license.

### Listing option

Use the free directory listing. Paid launch, boost and advertising are separate options and are outside this submission's scope.

## Product Hunt

### Name

Prism

### Tagline

SSH, SFTP and AI server checks in one desktop workspace

### Website

https://aides-hik.github.io/AI-ssh/

### Description

Prism combines SSH, SFTP and an AI assistant for developers managing their own servers. Inspect connected hosts and approve custom commands or staged deployments. Windows, macOS and Linux. Bring your own model provider or local Ollama model.

### Maker comment

Hi everyone, I maintain Prism, a desktop workspace that keeps SSH terminals, file management and AI assistance together.

The workflow is to connect your servers, select the hosts to inspect, compare their results and review any custom command before running it. Dedicated inspection and read tools run directly. Custom commands, deployment stages and server environment document changes require approval of their targets and contents.

The desktop app works without a Prism account or backend deployment. You configure your own model service or a local Ollama model that supports tool calling. Model charges depend on the provider, and external model use sends the relevant conversation and terminal output to that service.

I would especially appreciate feedback on first-time setup and the transition from inspecting a problem to choosing the next command. Downloads and documentation are on the website.

### Media

Use accurate current screenshots. If a screenshot or animation comes from the browser preview, retain its visible simulated-data label. Do not describe preview results as a real server operation or a benchmark.
