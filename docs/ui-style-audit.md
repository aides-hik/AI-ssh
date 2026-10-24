# Prism 全界面风格核查清单

核查日期：2026-10-24。范围为 `apps/desktop/src` 的 **40 个生产 Vue 源组件**（原 39 个加本次共享悬停提示）、它们导入的 CSS、运行时渲染内容，以及桌面端系统选择器的边界。

`src/design-preview/DesignPreview.vue` 和 `src/design-preview/LiquidWorkspace.vue` 是设计实验入口，不计入生产组件数。核查使用真实 `main.ts → App.vue → router` 与组件导入关系，没有把设计预览或模拟 HTML 当成正式前端。

## 统一基准与状态定义

- 玻璃材质、明暗配色、语义状态、字体、圆角、阴影、控件和弹窗来自 `src/assets/styles/ui-foundation.css`、`liquid-glass.css`。
- 设置页面的导航、面板、表单、开关和窄屏布局统一由 `settings-foundation.css` 管理，避免 Vue scoped 样式无法继承导致的遗漏。
- 可点击控件有 hover、pressed、disabled 和键盘 focus 状态；弹窗、浮层与可收起区域保留已有交互，尊重系统减少动态效果及应用动画开关。
- 下表的“已统一”表示**已核查并完成源代码处理**；“无需材质”表示没有自身可见面板。它不代表每种业务状态均已在真实服务端、真实账号或所有操作系统上运行验收。最终运行验证记录见本文末尾。

静态导入图中，**28 个组件可由生产入口到达，12 个属于备用组件或仅被备用组件引用**。备用组件也已检查，没有为展示它们新增产品入口。

## 生产源组件库存

| # | 源组件（相对 `apps/desktop/src/`） | 实际入口 / 可达性 | 风格处理与验证入口 | 保留例外 |
| --- | --- | --- | --- | --- |
| 1 | `App.vue` | `main.ts`，全部路由共享 | 已统一；标题栏、工作区标签、侧栏展开/收起、窄屏遮罩、底部状态栏 | 应用标志的 SVG 固有色；全屏模式按原逻辑隐藏原生壳层 |
| 2 | `views/WelcomeView.vue` | `#/ssh`，`#/` 重定向至此 | 已统一；欢迎页、设置入口、新建连接、导入按钮、导入反馈；空会话操作卡片也跟随明暗主题，不再作为固定深色终端例外 | 只有真实终端画布保留自己的阅读背景，此页没有终端画布 |
| 3 | `views/TerminalView.vue` | `#/terminal`；打开 SSH 连接后带连接上下文 | 已统一；连接状态、右键菜单及快捷命令子菜单、AI 分栏、收起按钮、文档编辑浮层、断线与本地编辑反馈 | xterm 的不透明终端画布与 ANSI 调色板 |
| 4 | `views/FileManagerView.vue` | `#/file-manager`；连接树“文件管理” | 已统一；工具栏、路径、文件表格、搜索/空/加载状态、新建目录、上传管理、下载管理、选择与删除反馈 | 系统文件/文件夹选择和保存对话框 |
| 5 | `views/SettingsView.vue` | `#/settings`，支持 `?section=…` | 已统一；外观、AI 服务商、AI 助手、更新、存储、SSH、终端、高级、关于；添加模型弹窗；成功/警告/错误通知 | 真正的系统目录打开、更新安装行为由 Electron 执行 |
| 6 | `views/SessionSettingsView.vue` | `#/session-settings`；已选择聊天会话后显示表单 | 已统一；读取中/无会话/读取失败、基本信息、高级配置、自动保存状态、左导航 | 无会话时显示明确空状态，不显示可编辑却无法保存的假表单 |
| 7 | `views/PromptOptimizerView.vue` | `#/prompt-optimizer` | 已统一；三步导航、输入、生成/测试/优化按钮、空回复占位、复制、保存和重置确认 | 提示词与模型回复保留可选取的等宽/正文内容样式 |
| 8 | `views/AboutView.vue` | `#/about` | 已统一；应用信息、技术栈、系统信息玻璃面板；系统信息读取失败显示 `—`，不显示旧样本值 | 系统版本为真实运行数据；网页模式明确说明桌面信息不可用 |
| 9 | `views/NotFoundView.vue` | 任意不存在的 hash 路由 | 已统一；404 面板、返回工作台、返回上一页及实际存在的快捷入口 | 无 |
| 10 | `views/ContextMenuDemo.vue` | 备用；无生产 route/import | 已统一；示例面板、按钮、菜单危险项；可通过测试挂载后点击或右击各示例；原生 `alert` 已移除 | 属组件演示，不新增生产导航 |
| 11 | `components/layout/AppTitleBar.vue` | `App.vue` | 已统一；文件/查看/帮助菜单、模型下拉与搜索、无模型状态、主题切换、快捷键弹窗、窗口按钮 | Windows 窗口控制行为；退出与文件选择由操作系统执行 |
| 12 | `components/layout/AppSidebar.vue` | `App.vue` | 已统一；树目录、搜索、空/错误/加载、连接新增编辑、目录输入弹窗与右键菜单 | SSH 连接与导入导出所需的系统能力 |
| 13 | `components/layout/AppStatusBar.vue` | `App.vue` | 已统一；本地工作空间、真实资源信息、临时状态消息、通知入口 | 资源读数保留真实数值，不在浏览器编造桌面统计 |
| 14 | `components/ssh/SSHTreeNode.vue` | `AppSidebar.vue`，递归树；备用文件弹窗也引用 | 已统一；文件夹/连接节点、选择/禁用、递归缩进、右键操作 | 树层级是信息结构，不用相同圆角消除缩进 |
| 15 | `components/ssh/SSHConnectionDialog.vue` | `AppSidebar.vue` 新建/编辑连接 | 已统一；基础字段、密码/私钥/Agent 切换、隐藏密钥、测试/保存、错误与成功状态 | 私钥文本内容、系统文件选择行为 |
| 16 | `components/ssh/FileManagerModal.vue` | 备用；无生产 import | 已统一；弹窗框架、工具栏、路径、表格、目录创建/重命名、加载/空/错误、传输操作；需测试挂载 | 系统选择器；不等同于已执行全部远程文件操作 |
| 17 | `components/terminal/AutocompletePopup.vue` | `TerminalView.vue` 自动补全 | 已统一；建议面板、选中状态、键盘提示，终端输入有建议时显示 | 补全内容与命令名称保留等宽语义 |
| 18 | `components/terminal/ShortcutCommandsModal.vue` | 终端右键 → 快捷命令 → 管理快捷命令 | 已统一；搜索/排序、空/有命令列表、导入导出、编辑子弹窗、危险删除确认 | 导入的文件输入和导出下载属于系统能力 |
| 19 | `components/docs/ServerEnvDocEditor.vue` | 终端 AI 操作菜单 → 服务器环境文档 | 已统一；头部、保存/关闭、成功/错误反馈；Monaco 的菜单、查找、命令、悬停和建议等辅助界面也使用共享玻璃主题，包含 ShadowRoot 内菜单 | Monaco 的不透明代码编辑区、行号和语法高亮 |
| 20 | `components/chat/AIChatOpenCodeStyle.vue` | `TerminalView.vue` AI 分栏 | 已统一；无模型/空会话、消息、工具时间线、思考、错误卡、运行状态、上下文菜单、输入区、复制与跳转最新 | Markdown/代码块/工具输出是内容，不改写 ANSI 或语法 token 的含义 |
| 21 | `components/chat/ReasoningSlider.vue` | AI 对话输入区的思考程度选择器 | 已统一；弹层、刻度、文字、焦点/拖动/禁用和减少动态效果 | 用户此前指定的 Codex 形态：蓝紫轨道、星点、白色滑块；外围材质仍随应用主题 |
| 22 | `components/settings/SettingsAppearance.vue` | `SettingsView.vue` 外观章节 | 已统一；主题、颜色方案、字体、语言选择，独立组件也使用共享设置样式；展开列表也使用共享玻璃 picker | 不支持可定制 select 的旧浏览器保留原生回退 |
| 23 | `components/settings/SettingsAiProviders.vue` | `SettingsView.vue` AI 服务商章节 | 已统一；服务商目录、搜索/分类、核对状态、模型列表、凭据输入、刷新/测试、无模型与参数展开动画 | 官方文档是外部链接；可用性与价格不是风格验证结果 |
| 24 | `components/settings/ModelParameters.vue` | 服务商模型行 → 展开参数 | 已统一；协议说明、思考刻度、温度/Top P/输出限制、恢复默认、禁用态；轨道使用主题 accent | 可用档位和字段依模型能力变化；保留白色实体滑块 |
| 25 | `components/settings/SettingsAbout.vue` | 备用；实际关于章节在 `SettingsView.vue` | 已统一；共享章节、标签与版本徽标；需独立测试挂载 | 不引入第二个关于入口 |
| 26 | `components/settings/SettingsAdvanced.vue` | 备用；实际高级章节在 `SettingsView.vue` | 已统一；共享布局、select、开关与 focus；需独立测试挂载 | 原有备用示例状态没有接入生产持久化 |
| 27 | `components/settings/SettingsAiAssistant.vue` | 备用；实际助手章节在 `SettingsView.vue` | 已统一；共享输入/范围/下拉与章节布局；需独立测试挂载 | 历史模型示例仍属于备用代码，生产模型来自服务商目录 |
| 28 | `components/settings/SettingsPermission.vue` | 备用；无生产 import | 已统一；规则列表、语义 allow/deny/ask、危险提示、添加/删除、保存状态；重置使用共享确认弹窗 | 规则字符串是代码内容，不执行预览命令 |
| 29 | `components/settings/SettingsSsh.vue` | 备用；实际 SSH 章节在 `SettingsView.vue` | 已统一；共享数值输入、开关、标签与响应布局；需独立测试挂载 | 无 |
| 30 | `components/settings/SettingsStorage.vue` | 备用；实际存储章节在 `SettingsView.vue` | 已统一；共享徽标、数值输入、危险操作按钮与确认；需独立测试挂载 | 清理缓存是破坏性动作，验收只在隔离测试存储执行 |
| 31 | `components/LanguageSwitcher.vue` | `SettingsAppearance.vue` | 已统一；语言 select、当前语言、focus/disabled 对比；展开列表跟随共享玻璃 picker | 不支持可定制 select 的旧浏览器保留原生回退 |
| 32 | `components/common/LiquidSurface.vue` | 应用壳、标题栏、欢迎页、连接弹窗 | 已统一材质基元；检查光学边缘、主题背景、光效、减少动态效果/透明效果 | 光学 shader 的高光/阴影基色是材质参数，不是业务状态色 |
| 33 | `components/common/GlobalModals.vue` | `App.vue`；`window.$modal` | 已统一；alert/confirm/prompt、输入、危险操作、焦点约束、Esc/取消/提交 | 桌面 OS 选择器不经此组件 |
| 34 | `components/common/ConfirmDialog.vue` | `useDialog.ts` 动态挂载 `$confirm` | 已统一；普通/危险确认、消息、操作按钮、焦点与关闭 | 该入口虽然没有静态父组件模板，仍属于生产 UI |
| 35 | `components/common/NotificationContainer.vue` | `App.vue`；`window.$notification`/`$alert` | 已统一；success/error/warning/info、标题/正文、操作按钮、关闭、倒计时和进出动效 | 后台事件使用通知；未有真实通知时不模拟未读资源 |
| 36 | `components/common/ContextMenu.vue` | 仅备用 `ContextMenuDemo.vue` 引用 | 已统一；图标/快捷键/分隔线/disabled/danger/键盘导航；生产页面的自有菜单也在各组件中单独核查 | 备用不代表生产终端或文件菜单自动由它实现 |
| 37 | `components/common/ThemeSwitcher.vue` | 备用；现有主题入口在标题栏及设置 | 已统一；主题图标按钮、focus/hover/press；需独立测试挂载 | 不新增主题切换入口 |
| 38 | `components/common/ProviderIcon.vue` | 备用；无生产 import | 无需材质；只是对 `ProviderIconSvg` 的薄包装，尺寸与可访问名称保留 | 官方服务商标志 |
| 39 | `components/common/ProviderIconSvg.vue` | 只被备用 `ProviderIcon.vue` 引用 | 无需材质；内嵌 SVG、继承色、尺寸和 aria-label 已检查 | 官方 Google/Meta 标志固有配色；未知服务商图标继承 `currentColor` |
| 40 | `components/common/PrismTooltip.vue` | `App.vue`，统一接收 `data-prism-tooltip` | 共享玻璃提示；鼠标、键盘、禁用控件、动态内容、长文、视口限制、原生 modal 的 top layer 及退出清理 | 不改写操作系统文件选择/保存框 |

## 源码遗漏检查

本次检查不仅按 route 截图，也搜索了所有生产 Vue/CSS 与运行时生成节点的源代码：

1. `transition: all`、没有显式属性的 transition、旧的 2–4px 控件圆角、固定灰蓝和固定错误/成功颜色。
2. renderer 的原生 `alert`/`confirm`、`showMessageBox`、系统文件选择/保存 API。
3. `createElement`、Vue `h/render`、`innerHTML`、`insertAdjacentHTML`、`v-html`、canvas 和第三方编辑器。
4. 所有组件的 import 关系，区分真实生产页面、动态挂载页面、备用组件和设计实验。

薄轨道、滚动条、代码标记或选中指示条允许使用 2–4px 小圆角；这些不是遗留的输入框或按钮。阴影和实体白色 thumb 允许有材质所需的固定白/黑；业务告警和交互状态使用语义 token。

### 动态生成与外部渲染边界

| 来源 | 实际渲染内容 | 核查处理 |
| --- | --- | --- |
| `composables/useDialog.ts` 的 `createElement` + `h/render` | `$confirm` 的挂载容器和 `ConfirmDialog` | 空容器没有旧样式；真实内容使用统一弹窗组件及焦点管理 |
| `SettingsView.vue` 通知 | 原先手动 append 到 `body` 的文字节点 | 改接全局通知；未挂载全局容器时使用本地可样式化 `role=status`，避免 scoped CSS 失效；warning 不再误用 error 样式 |
| `AIChatOpenCodeStyle.vue` 的 `v-html` | 模型回复、推理与工具输出的 Markdown | 外围正文、表格、引用、代码容器由 `chat-workspace.css` 处理；语法高亮保留其阅读语义，亮主题使用对应高对比色 |
| `ProviderIconSvg.vue` 的 `v-html` | 仓库内置的官方 SVG 标志 | 不包含任意应用表单；标志固有色列为有意例外 |
| `utils/glass-optics.ts` 的 canvas | 液态玻璃光学纹理 | 非独立面板；其材质高光/阴影不是需要语义 token 的业务状态 |
| `ShortcutCommandsModal.vue` 创建 `a/input` | JSON 下载和文件导入选择器 | 属临时下载/系统选择器，不渲染第二套 HTML 表单 |
| `TerminalView.vue` / xterm | 终端 canvas/DOM、ANSI 输出 | 不对程序输出涂玻璃或覆盖 ANSI；工具栏、状态、上下文菜单已经统一 |
| `ServerEnvDocEditor.vue` / Monaco | 文本编辑、语法、选择/建议/编辑器菜单 | 代码画布和语法继承 `vs` / `vs-dark`；自定义 Prism 辅助界面主题，玻璃样式同步注入其菜单 ShadowRoot，查找等布局由 Monaco 继续管理 |
| Electron `dialog.showOpenDialog/showSaveDialog` | 上传、下载、导入导出、私钥选择 | OS 原生外观；不伪造系统对话框 |
| Electron `app:show-message-box` | 保留的原生桥接 API | API 声明本身不是可见页面；本次 renderer 常规确认统一走 `$confirm` / `$modal` |

## 验证记录

本文件的静态核查不能替代运行验证，也没有假定提交前的旧测试结果覆盖本次所有 UI 修改。

已执行的定向检查：

- 设置、次级页面及全部 `components/settings` 的 ESLint：**0 errors，20 个既有 TypeScript 风格 warnings**。日志：`tmp/preview/ui-settings-lint.log`。
- 上述职责文件的 `git diff --check`：无空白错误；Git 的 Windows CRLF 提示不是 UI 测试结果。
- 39 个源组件与引用关系已枚举，文档表格逐项匹配源码，无漏项或不存在的文件。
- 12 个备用组件已在隐藏的 Windows Electron 中，通过正在运行的真实 Vite 入口动态导入原始 `.vue` 并 `createApp` 挂载；使用正式全局 CSS、主题服务、i18n 和弹窗插件，没有重写组件 HTML。**91 项断言通过，48 张截图**覆盖亮/暗主题及 390/1000px，记录横向溢出、控件尺寸/配色、10px 输入圆角以及菜单边界与键盘操作。证据：`tmp/preview/spare-components-dev3/result.json`。
- 备用挂载的文件管理使用真实 preload IPC 与仅接收 `synthetic-spare-fixture` 的本地 `ssh:list-files` fixture；无外部网络、页面错误、未处理 Promise 或原生弹窗。挂载检查发现的 `FileManagerModal` 初始化 watcher 调用尚未声明的 `loadFiles` 问题已修复，并在第三轮验证中通过。
- 通用 `ContextMenu` 单独检查了亮/暗及窄屏材质、窗口边界 clamp、↑/↓ 跳过 disabled、Home/End 与 Esc 关闭；不能用终端自有右键菜单的结果代替它。
- 设置导航的快速交互专项：**27 项断言通过**。亮/暗主题各以 450ms 间隔连续点击全部 9 节、45ms 间隔快速反向切换、手动滚到底和短“关于”章节的选中状态均保持正确。旧计时器提前解除下一次滚动锁的问题已修复，三个设置类页面同步处理目标夹取、滚动稳定判断和卸载清理。证据：`tmp/preview/settings-nav-dev3/result.json`。

备用组件的这些记录属于**组件挂载验收**，不表示它们已加入产品路由，也不表示已执行远程上传、下载、清缓存或真实 AI 调用。

本次集成验证：

| 验证 | 结果 / 证据 |
| --- | --- |
| 全桌面测试 | **262/262 通过**；`tmp/preview/ui-unification-tests.log` |
| Vue / TypeScript 类型检查 | **通过**；`tmp/preview/ui-unification-typecheck.log` |
| 全仓 lint | **0 errors，648 warnings**；`tmp/preview/ui-unification-lint.log`。未把 warnings 说成全部消除 |
| 正式前端 Vite 构建 | **通过**；`pnpm --filter @ai-ssh/desktop exec vite build`；`tmp/preview/ui-unification-build.log`。未生成安装包 |
| Windows 真实 Electron 亮 / 暗主题 | **377/377 通过，123 张状态截图**；全部 8 个路由、9 个设置章节及 1440 / 390px 布局；正式 main / preload / 生产 renderer，使用隔离配置，没有页面错误、原生弹窗或外部请求；`tmp/preview/ui-unification-production5/result.json` |
| 正常宽度 / 窄屏、侧栏展开收起 | **73/73 侧栏回归通过**；`tmp/preview/ui-unification-sidebar-final/result.json`，检查宽度连续变化、反向切换、键盘焦点、移动侧栏与真实 xterm resize |
| 弹窗焦点 / Esc / 连续反向操作 / 减少动态效果 | 已验证焦点进入与恢复、Tab 约束、Esc、输入法组合保护、嵌套确认层级及 reduced / off；另有 **14/14** 生产专项通过，真实鼠标验证通知暂停/恢复与退出销毁；`tmp/preview/ui-unification-focused1/result.json` |
| loading / empty / error / disabled / success 状态 | 已覆盖设置、SSH 表单、终端 / 文件管理外围、快捷命令、环境编辑器、公共弹窗和通知；聊天丰富状态另有 **60/60** 专项通过。业务数据来自本地 fixture，未调用外部服务 |

远程 SSH / SFTP、大模型计费与账号权限、Windows 系统选择器、macOS 和 Linux 的真实业务验收需要另行明确记录；仅有风格截图或本地 fixture 不能声明这些外部功能全部验证通过。

补充专项证据：

- 正式生产全量验收最终为 **377/377**。先前 production4 的 3 项失败来自检查工具：嵌套确认错误地要求底层按钮也接收点击，以及通知退出等待时间没有留下调度余量。仅修正检查工具后，production5 使用同一份已冻结构建全量通过；另以 focused1 的 **14/14** 专项独立验证顶层命中、底层阻挡及真实鼠标暂停/恢复，未忽略失败项。
- **27/27** 设置连续导航专项：快速点击/反向切换、短章节与底部选中、亮暗主题；`tmp/preview/settings-nav-dev3/result.json`。
- **60/60** 聊天丰富状态专项：真实 Vue 源组件、工具卡片/键盘展开、生成/流式/历史/错误、代码和表格、480–1440px、亮暗主题与动画关闭；`tmp/preview/ui-unification-chat-all1/result.json`。使用隔离开发入口的本地 fixture，不冒充真实模型响应。
- 设置模型弹窗 Teleport 避免容器查询裁切；共享确认层级高于快捷命令主/编辑弹窗；中文输入法组合期间不让 Esc/Enter 误关或提交全局输入弹窗；通知支持可读标题、真实倒计时、悬停/焦点暂停及监听/计时器清理。

动效复核：

| 原表现 | 本次表现 | 原因与证据 |
| --- | --- | --- |
| 不同组件各自使用 `transition: all`、重复进入动画 | 控件只过渡颜色/边框/阴影；共享确认层遮罩与内容同为 180ms，通知仅透明度/位移 | 避免继承可见性与布局属性产生意外动画；源扫描与真实 Electron 检查 |
| 侧栏展开/收起可能被新样式覆盖 | 保留 220ms 宽度或移动抽屉过渡，拖动即时；关闭立即 inert | 73 项侧栏专项覆盖中间帧、反向、调整宽度与 xterm resize |
| 一般/嵌套弹窗各用极大 z-index | 主弹窗 10000、编辑层 10100、共享确认层 10200、通知 11000 | 避免快捷命令危险确认藏在父弹窗后；明暗主题实际命中检查 |
| 减少动态效果与应用关闭动画覆盖不一致 | 共享弹窗减少动态时 80ms 淡入淡出；关闭时直接切换；通知倒计时保留实际时间语义但停止动画 | 专项模拟系统减少动态效果与应用开关，检查 computed styles 与实际交互 |

动效复核结论：**Approve（通过）**。适用于本次 Windows 界面、明暗主题及窄屏范围；侧栏、弹窗、菜单、通知与设置导航已验证，未将样式验收扩大为外部服务或安装包验收。

## 下拉选项补查

用户指出 AI 助手的“命令自动执行风险等级”展开列表未统一。此前核查覆盖了选择框关闭状态，却将展开列表作为平台原生外观例外处理，因此前述全量通过记录不能作为选项列表已统一的证据。

本次补查全部 **14 处单选框**：设置正式入口 10 处、SSH 认证 1 处、备用组件 3 处。共享样式在支持 `appearance: base-select` 与 `::picker(select)` 的运行环境中统一框体箭头、玻璃选项面板、圆角、选中标记、悬停/键盘焦点、长文本换行和视口边界；沿用原来的 select、值类型、键盘与保存事件。清除 Bootstrap/禁用状态的重复背景箭头及 SSH/语言组件的选项背景覆盖，未新增第二套选择器状态逻辑。

选项面板使用原生 top layer，避免设置容器或弹窗裁切。开关为 120ms 淡入淡出，关闭应用动画或系统减少动态效果时直接切换；系统减少透明效果时使用实体面板。

本次补查重新运行桌面测试 **262/262 通过**、相关 Vue 文件 lint **0 errors / 3 warnings**（既有 `any` 类型警告），正式 Vite 构建通过。日志分别为 `tmp/preview/select-picker-tests.log`、`select-picker-lint.log`、`select-picker-build.log`。

隐藏真实 Windows Electron 专项在开发预览与正式生产 renderer 中分别 **117/117 通过**、各 15 张截图；无页面错误、原生错误弹窗或外网请求。覆盖风险列表的亮/暗、1440/390px、顶部/底部防裁切、真实鼠标与键盘、0/2/5 数字值保存及页面重新挂载、英文长文本、关闭/减少动画，以及主题/语言/服务商分类/能力/价格和 SSH 认证的实际展开与选择。报告：`tmp/preview/select-picker-dev2/result.json`、`tmp/preview/select-picker-production1/result.json`。此前 dev1 唯一失败来自检查工具将实际私钥路径 input 误认成 textarea，已按真实组件修正并重新全量验证。

## 隐藏交互状态再次核查

用户追问是否还有遗漏后，重新从“展开、悬停、键盘、输入错误、第三方内部弹层”检查，而不是仅重复路由截图。**确实发现了此前没有覆盖的状态**；前述 377 项路由集成检查和 117 项下拉专项不能证明这些状态此前已经统一。

| 补查发现 | 已处理内容 |
| --- | --- |
| 原生 `title` 悬停提示仍使用浏览器外观 | 17 个既有组件的 59 处原生属性迁移到共享 `PrismTooltip`，补齐 13 处图标按钮的可访问名称；支持鼠标、键盘、长文本、禁用控件、动态内容和原生 modal 的 top layer；激活控件时清除旧提示，避免键盘打开菜单后遮挡菜单项 |
| SSH / 新增模型的原生校验气泡、模型参数的 `reportValidity()` | 保留 required / min / max / step 与原生有效性约束，改为共享行内错误；关联 ARIA、聚焦首个错误、纠正即清除；输入法组合期间不误提交。全局 prompt 同样保留 email 等类型校验，空的普通文本仍可提交 |
| Monaco 自己生成的菜单、查找、命令面板、建议和悬停界面 | 继承原代码区与语法颜色，仅将辅助界面接入 Prism 主题；菜单 ShadowRoot 使用同一份样式，body 外挂悬停面板也覆盖；主题及 accent 变化会同步，编辑器销毁时清理监听和样式 |
| 欢迎页交互卡片此前错误地归入固定深色终端例外 | 实际操作卡片、说明、入口、边框与状态改为跟随明暗主题的玻璃和文字 token |
| 自动补全键盘提示 / 滚动条引用了不存在的变量，部分关闭 / 排序按钮 hover 也无有效变量 | 改为已定义的共享 control / border / muted / list-hover token，并实际挂载原始自动补全 SFC 检查长列表和滚动 |
| 文件危险操作 hover、上传状态文字的对比不足 | 调整单项 / 批量删除、传输取消、关闭窗口及备用文件弹窗的危险态前景；上传 hover 不再把 accent 文字叠在 accent 背景上 |
| Bootstrap 备用范围控件只有 accent，没有实际轨道样式；Tailwind 表单绘制的未选中框仍为白底 | 为真实轨道、thumb、focus / disabled 设置主题样式；复选框 / 单选框接入共享底色、边框、accent 与禁用态并清除固定蓝色 focus ring；根主题还显式设置对应的 `color-scheme`。未把 `color-scheme` 的 computed 值当成自绘控件实际变暗的证据 |

补查仍使用 Windows 的真实 Electron main / preload 和正式 Vue 前端；业务上下文由本地 fixture 提供，使用独立配置并阻止外部请求。需要直接挂载备用组件、自动补全或编辑器建议 provider 的项目标为开发入口专项，没有把它们写成生产路由操作。

新增专项证据：

| 核查 | 实际范围 / 证据 |
| --- | --- |
| 欢迎卡片、危险按钮 hover、上传状态及快捷命令 | 正式生产 renderer **41/41**，10 张截图；`tmp/preview/ui-states-recheck-production1/result.json` |
| 上述状态加原始自动补全 SFC | 开发入口 **53/53**，14 张截图，包含长列表、键盘提示与滚动条；`tmp/preview/ui-states-recheck-dev4/result.json` |
| 编辑器建议 / 文档 hover / 大量查找结果提示 | 开发入口原始编辑器及本地 provider fixture **72/72**，19 张截图；`tmp/preview/monaco-glass-dev6/result.json` |
| 行内错误及 Tailwind 复选框 / 单选框 | 开发入口 **132/132**，8 张截图；覆盖错误约束、持久化保护、输入法、暗色实际底色、选中 / 半选、真实点击 / Space / Tab、disabled 及隐藏开关兼容；`tmp/preview/inline-validation-dev-checkbox3/result.json` |
| 行内错误及控件最终生产复验 | **132/132**，8 张截图；正式 main / preload / file renderer，暗色未选框为实际深底、选中框使用实际 app accent；`tmp/preview/inline-validation-production-final3/result.json` |
| 编辑器辅助界面最终生产复验 | **51/51**，14 张截图、12 种状态；真实右键 / Ctrl+F / F1 检查亮暗及 1440 / 390px、非法正则、无匹配 disabled、菜单焦点和视口边界；`tmp/preview/monaco-glass-production3/result.json` |
| 开发预览全路由和交互复验 | **381/381**，123 张截图；公共 click 使用真实鼠标事件，点击前检查实际命中，不让脚本直接 `.click()` 绕过遮挡；`tmp/preview/ui-reaudit-dev-pointer4/result.json` |
| 共享悬停提示最终生产复验 | **50/50**，5 张截图；包括真实鼠标 / Enter / Space、程序激活、焦点与悬停跨控件、禁用 / 长文 / 动态内容 / modal / 减少动态效果与清理；`tmp/preview/tooltip-production2/result.json` |
| 最终生产全路由和交互复验 | **381/381**，123 张状态截图；8 个路由、9 个设置章节、亮暗及 1440 / 390px；正式 main / preload / file renderer、真实鼠标命中检查、弹层关闭与嵌套层级，无页面错误或外部请求；`tmp/preview/ui-reaudit-production2/result.json` |

本轮第一份生产集成报告 `ui-reaudit-production1` 有 14 项点击命中失败，未作为通过结果。其一是实际产品问题：键盘或程序激活不会触发 `pointerdown`，原提示保留并遮住新菜单，现已在 `click` 时清除。其余串扰涉及检查工具将第一下 Escape（实际只关闭滑块提示）当成了弹层关闭，后续仍对底层浮层检查点击。最终检查改为分别断言提示关闭、再关闭弹层并等待节点移除；公共点击采用真实鼠标和命中检测，并等待有动画的退出完成。只排除仍在退出的旧 provider 节点，永久遮挡会报错，没有删除命中断言。包含这些修复的最终正式构建全量 381 项通过。

当前桌面测试重新执行 **262/262 通过**（`tmp/preview/ui-reaudit-tests-final.log`），Vue 类型检查通过（`tmp/preview/ui-reaudit-typecheck-final.log`）。本轮全桌面 `src` ESLint 为 **0 errors / 278 warnings**（`tmp/preview/ui-reaudit-lint.log`），新增提示组件、校验与编辑器主题文件定向复查为 0 errors / 0 warnings（`tmp/preview/ui-reaudit-lint-final.log`）；这两项范围均不等同于全仓 lint。

最终正式 Vite renderer 构建通过，日志为 `tmp/preview/ui-reaudit-build-final.log`；没有执行本地安装包构建。

截至最终复验，在上述已核查组件和交互范围内未再发现同类风格遗漏。这是有明确范围的源码与运行记录，不是对未遍历业务数据、未来修改或所有操作系统的零遗漏保证。

原生文件选择 / 保存窗口、真实终端 ANSI 内容、代码画布与语法高亮、服务商品牌标志保留各自有意的外观边界。本次没有重新验收真实 SSH / SFTP、计费模型调用、安装包、macOS 或 Linux；不能由这些 UI 检查推导“所有功能均正常”。
