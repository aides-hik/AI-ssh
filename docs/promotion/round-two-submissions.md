# 棱镜 Prism 第二轮新增渠道投稿定稿

整理日期：2026-10-27。本文只记录可复用材料，提交与收录状态以[渠道记录表](./channel-tracker.csv)为准。机器载荷见[JSON](./round-two-submission-payloads.json)。不据本文推定任何渠道已投稿或通过。

2026-10-27 提交结果：[潮流周刊评论](https://github.com/tw93/Weekly/discussions/22#discussioncomment-19212111)与[独立开发变现周刊 Issue #458](https://github.com/ljinkai/weekly/issues/458)已发布，均已核对作者及正文，待编辑收录。其余三处尚未完成：汇智网无邮箱连接，Fazier 与独立开发前线缺少可操作的登录入口。汇智网另有[EML 邮件草稿](./hubwiz-review-draft.eml)，打开草稿不代表已发送。

## Tw93 潮流周刊

入口：https://github.com/tw93/weekly/discussions/22

在既有推荐讨论下回复：

作者自荐一下：我是 aides-hik，在做棱镜 Prism，一个把 SSH 终端、SFTP 文件管理和 AI 助手放在同一窗口的桌面工作台，适合自己管理几台 VPS 或自托管应用的开发者。

想解决的场景是：连接服务器后，在终端旁分析输出，对选中的多台已连接主机检查 CPU、内存、磁盘、服务和端口，再按主机查看结果。Docker / Compose 部署可以分阶段查看脚本、实时输出和验证步骤。

操作范围有明确区分：专用巡检和读取工具直接运行；自定义命令、部署阶段及服务器环境文档修改，会先展示具体目标和内容，由用户确认。

提供 Windows、macOS、Linux 安装包。桌面功能和自配模型无需 Prism 账号或项目后端；模型可用自己的服务或支持工具调用的本地 Ollama。使用外部模型时，相关对话和终端输出会发送到所配置的服务，费用由服务商决定。

[官网与上手](https://aides-hik.github.io/AI-ssh/) · [项目与教程](https://github.com/aides-hik/AI-ssh) · [安装包](https://github.com/aides-hik/AI-ssh/releases/latest)

欢迎编辑独立评估，也想听听首次连接、配置模型和多机巡检的使用反馈。作者自荐，文字经 AI 辅助整理。

## 独立开发变现周刊

入口：https://github.com/ljinkai/weekly/issues

### 标题

【产品自荐】棱镜 Prism：面向自管 VPS 的 SSH、SFTP 与 AI 工作台

### 正文

大家好，我是 aides-hik，自荐正在维护的桌面工具「棱镜 Prism」，面向自己管理少量服务器、部署个人项目的独立开发者。

Prism 把 SSH 终端、SFTP 文件管理和 AI 助手放在同一窗口。日常可以连接 VPS、查看远程文件、分析终端输出，也能对选中的多台已连接主机检查 CPU、内存、磁盘、服务和端口。Docker / Compose 部署按阶段展示脚本、实时输出和验证步骤。

专用巡检和读取工具直接执行；自定义命令、部署阶段与服务器环境文档修改，先展示具体目标及内容，经用户确认后执行。

支持 Windows、macOS、Linux。使用桌面功能和自配模型无需注册 Prism 账号或部署项目后端。AI 接用户自己的模型服务，或支持工具调用的本地 Ollama；使用外部模型时，相关对话与终端输出会发送到该服务，费用取决于服务商。

- [官网与上手](https://aides-hik.github.io/AI-ssh/)
- [项目与教程](https://github.com/aides-hik/AI-ssh)
- [安装包下载](https://github.com/aides-hik/AI-ssh/releases/latest)
- [问题与反馈](https://github.com/aides-hik/AI-ssh/issues)

希望收集首次连接、模型配置和服务器巡检流程的实际反馈，帮助确定下一步改进。作者自荐，文字经 AI 辅助整理。

## 汇智网 Software 2.0：工具评测推荐

收件地址：support@hubwiz.com

邮件主题：工具评测推荐｜棱镜 Prism：SSH、SFTP 与本地模型辅助多机巡检

汇智网 Software 2.0 编辑您好：

我是 aides-hik，正在维护桌面 SSH 工作台「棱镜 Prism」。看到贵站接受 Agent、自动化、本地模型相关内容及工具实测，想推荐 Prism 供编辑独立评估是否适合做工具评测。

Prism 将 SSH 终端、SFTP 文件管理与 AI 助手放在同一窗口，面向自己管理少量服务器的开发者。可围绕“连接测试服务器 → 配置支持工具调用的本地 Ollama 模型 → 检查选中主机的 CPU、内存、磁盘、服务与端口 → 查看并确认后续自定义命令”体验。Docker / Compose 部署另有分阶段脚本、实时输出与验证步骤。

专用巡检和读取工具直接执行；自定义命令、部署阶段及服务器环境文档修改，会先展示具体目标和内容，经用户确认后执行。桌面功能及自配模型不要求 Prism 账号或部署项目后端，支持 Windows、macOS、Linux。

AI 需用户自行配置模型服务或支持工具调用的本地 Ollama。使用外部模型时，相关对话与终端输出会发给所配置的服务，模型费用由服务商决定。

官网与上手：https://aides-hik.github.io/AI-ssh/
项目与教程：https://github.com/aides-hik/AI-ssh
安装包：https://github.com/aides-hik/AI-ssh/releases/latest
问题反馈：https://github.com/aides-hik/AI-ssh/issues

这封邮件是作者提供工具供编辑评测的推荐，并非已完成的实测稿件。目前推广截图和动图是有显著标记的界面预览，使用模拟服务器及模型数据；真实服务器实操视频尚未录制，未提供性能或效果结论。若贵站认为适合，欢迎按编辑标准独立测试和评价。

项目也已向开发者周刊及工具目录自荐；本邮件未提交同一篇已发表文章。文字经 AI 辅助整理。

谢谢！
aides-hik
https://github.com/aides-hik

## Fazier 产品字段

入口：https://fazier.com/submit

- 名称：Prism
- Tagline：SSH, SFTP and AI-assisted server checks in one desktop workspace
- 官网：https://aides-hik.github.io/AI-ssh/
- 项目与教程：https://github.com/aides-hik/AI-ssh
- 下载：https://github.com/aides-hik/AI-ssh/releases/latest
- 平台：Windows、macOS、Linux
- 作者：aides-hik
- 方案：Basic / Free；免费方案要求产品官网首页或页脚放置其徽章/反链，提交前核实。未授权购买升级套餐。

### Description

Prism brings SSH terminals, SFTP file management and an AI assistant into one desktop workspace for developers managing their own servers. Inspect selected connected hosts and review staged Docker / Compose deployments with live output and verification commands. Dedicated inspection and read tools run directly; custom commands, deployment stages and server environment document changes show their targets and contents for approval. No Prism account or project backend is required. Bring your own model service or a local Ollama model with tool-calling support. External model use sends relevant conversation and terminal output to the configured service; model fees depend on the provider.

## 独立开发前线产品字段

入口：https://indiefront.cn/dashboard/products/new/

- 名称：棱镜 Prism
- 一句话介绍：将 SSH 终端、SFTP 文件管理和 AI 助手放在同一窗口的桌面工作台
- 官网：https://aides-hik.github.io/AI-ssh/
- 项目与教程：https://github.com/aides-hik/AI-ssh
- 下载：https://github.com/aides-hik/AI-ssh/releases/latest
- 平台：Windows、macOS、Linux
- 作者：aides-hik

### 产品介绍

面向自己管理几台 VPS 或自托管应用的开发者，集成 SSH、SFTP 与 AI 助手，支持选中主机的多机巡检及分阶段确认的 Docker / Compose 部署。专用巡检和读取工具直接执行；自定义命令、部署阶段及服务器环境文档修改先展示目标与内容，经用户确认后执行。Windows、macOS、Linux 均提供安装包，桌面功能及自配模型无需 Prism 账号或项目后端。AI 需配置自己的模型服务或支持工具调用的本地 Ollama；使用外部模型时，相关对话与终端输出会发给该服务，费用取决于服务商。

## 填表与素材说明

- 产品授权方式尚未明确，不擅自选择 Open Source、MIT 等许可或承诺免费使用授权。
- 现有截图和动图使用已标记的模拟服务器与模型数据；保留可见标记，不描述为真实巡检或部署成果。
- 独立开发前线需登录核实完整表单和费用。Fazier 免费方案需核实反链要求；没有提交回执前均不记为已投稿。

