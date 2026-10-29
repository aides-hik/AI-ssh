# 棱镜 Prism 官网

中文静态产品官网，默认地址为 <https://aides-hik.github.io/AI-ssh/>。无需安装前端生产依赖、构建桌面端或部署后端。

## 文件与交互

- `index.html`、`styles.css`、`assets/`：产品页面、响应式样式、当前品牌图标及分享封面。
- `main.js`：产品示意场景切换和模拟部署确认。页面使用始终可见的移动导航；脚本也兼容可选的折叠菜单。
- `../scripts/check-site.mjs`：使用 Node.js 内置模块检查资源、锚点、项目子路径、可直接阅读的内容及 JavaScript 语法。
- `../scripts/build-site.mjs`：将官网复制到忽略目录 `../tmp/prism-site/`，并在构建时解析最新正式版的真实下载附件。
- `../.github/workflows/pages.yml`：仅验证和发布官网，不执行桌面应用构建、不创建 tag、不修改应用版本。

产品示意使用 `data-demo-root` 容器、`data-demo-tabs` 标签容器、`data-demo-tab` 按钮和 `data-demo-panel` 面板。无 JavaScript 时，三个面板都可直接阅读；脚本初始化后提供标签切换。支持方向键、Home、End 和 Tab，FAQ 使用原生 `details`/`summary`。部署确认只展示预设模拟日志，不连接服务器、调用模型或执行命令。CSS 尊重 `prefers-reduced-motion`。

所有本地资源使用相对路径，以兼容 GitHub Pages 的 `/AI-ssh/` 项目路径。更换域名或仓库名时，还需更新 canonical、Open Graph、站点地图和下载仓库配置。

## 字体与动画

中文使用自托管的 Noto Sans SC 可变字体，西文搭配 Manrope，命令和终端保持等宽字体。WOFF2 与原始 OFL 许可位于 `assets/fonts/`，总字体体积约 154 KiB；首屏预加载并使用 `font-display: swap`。中文字体按现有文案生成子集，更新中文内容时需要同步子集，细节见 `assets/fonts/README.md`。

首屏采用分层入场，功能、步骤和下载卡片在进入视口时一次性显现，支持卡片悬停和场景切换反馈。滚动动画使用浏览器原生 IntersectionObserver 与 Web Animations API，内容默认可见，禁用脚本或浏览器不支持时仍可完整阅读。系统开启“减少动态效果”时关闭动画；浏览过程中切换该偏好会立即停止滚动动画。锚点跳转和键盘聚焦优先呈现内容。

## 下载策略

源 HTML 始终保留 <https://github.com/aides-hik/AI-ssh/releases/latest> 作为下载兜底。发布时，构建进程读取最新正式 Release，为 Windows、两种 macOS 架构、AppImage 和 DEB 匹配真实附件，再把链接写入发布产物。

元数据读取失败或某个平台缺少附件时，保留对应的永久入口。浏览器无需请求 GitHub API，禁用 JavaScript 也可下载。构建只接受本仓库的 HTTPS Release 附件地址，不改写源码里的默认下载链接。新 Release 发布后会触发官网更新。

## 本地验证与构建

使用仓库规定的 Node.js 版本，在仓库根目录执行：

```sh
node scripts/check-site.mjs
node scripts/build-site.mjs
node scripts/check-site.mjs tmp/prism-site
```

只有构建中的最新 Release 查询需要网络。GitHub Actions 使用自动签发的只读 `GITHUB_TOKEN` 查询公开附件；本地没有令牌也可运行，遇到 API 限流会保留下载兜底。需要离线验收链接生成时，可向构建脚本传入一个 Release API JSON 文件路径。

用静态 HTTP 服务托管 `tmp/prism-site/`，或将它挂载到 `/AI-ssh/`。人工验收包括桌面和窄屏排版、键盘场景切换、模拟部署、FAQ、禁用 JavaScript、减少动态效果及下载入口。

## GitHub Pages 发布

首次启用时，仓库维护者在 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。之后修改官网文件并推送主分支、发布新 Release，或手动运行 **Prism website** 工作流，均可更新官网。PR 只验证，不发布。

工作流使用官方 `configure-pages`、`upload-pages-artifact` 和 `deploy-pages` actions，只上传 `tmp/prism-site/` 中的静态官网。部署任务申请 `pages: write` 与 `id-token: write`，使用自动签发的工作流令牌；持续发布无需个人令牌。Release 事件读取默认分支上的最新官网源码，不回退到旧 tag 中的页面。

首次创建 Pages 站点不能仅依赖普通工作流的 `GITHUB_TOKEN`。官方 `configure-pages` 的 `enablement` 需要另外具备相应权限的管理员 PAT 或 GitHub App token，因此工作流保留 `enablement: false`，不读取保存的个人密钥。

如果首次发布在 **Configure Pages** 步骤失败，先确认上述 Source 设置，再从 Actions 页面重新运行失败的 **Prism website** 工作流；也可在修改官网文件后推送主分支重新触发。开启 Pages 本身不会自动重跑之前失败的任务。以工作流部署任务成功、官网地址返回 HTTP 200 且样式和资源加载正常作为上线完成标准。

参考：<https://github.com/actions/configure-pages/blob/main/action.yml>；<https://github.com/actions/starter-workflows/blob/main/pages/static.yml>。

## 内容维护

产品事实以根 README 和当前实现为准。不要使用旧品牌截图充当新版截图，不添加未经证实的用户评价、使用量、性能、安全或许可证承诺。当前支持密码、私钥和 SSH Agent 认证；敏感凭据通过操作系统安全存储加密后写入本机数据库，密文受机器或系统用户约束。使用外部模型时，参与分析的对话和终端输出会发送到配置的模型服务。
