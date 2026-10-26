# 界面设计预览

在仓库根目录运行 `pnpm preview:design`，打开
`http://127.0.0.1:5173/design-preview.html#liquid`。该入口只启动浏览器开发服务，不启动 Electron 或后端。

五套方案可独立切换。终端命令、文件、AI 回复与新建连接均使用示例数据；点击“选中此方向”只将偏好保存在当前浏览器，不会改变正式应用的设置。正式应用已采用液态玻璃方向，可通过同一开发服务的
`/` 入口查看；真实 SSH 与文件功能需在 Electron 桌面环境运行。

正式界面的网页预览会提供“演示服务器 · UI 测试”。点击连接可查看模拟终端与文件，
点击终端的“已连接”状态可断开并测试导航收起。连接、终端和文件数据仅保存在当前页面内存中，刷新即可重置。
这层演示适配只由 `vite.design.config.mts` 加载，不进入正式桌面入口。

网页预览还会添加独立的“Prism 演示模型”服务商，保留已有配置与模型选择。
输入框右下角可切换四个模拟模型：Pro（关闭、低、中、高、极高、最高）、Lite（低、中、高）、
Think（仅关闭 / 开启）、Chat（无推理调节）；多档推理模型保留默认设置。模型选择与推理偏好保存在当前浏览器，刷新后保留。
演示模型的请求由预览入口在本地返回模拟回复，可用来确认所选模型与推理强度，不调用真实模型服务。

液态玻璃使用原创的圆角边缘位移图和 SVG
`feDisplacementMap`，将折射应用于独立背景层，文字与终端正文保持清晰。图像最长边为 512px，按几何尺寸缓存；只在尺寸或圆角变化时重新生成。Chromium 使用背景折射，其他引擎使用磨砂回退。

“清透 / 柔雾”调整模糊与着色；“折射”开关独立控制光学效果。关闭动效或启用系统减少动态效果后，停用指针跟随和空间形变，保留静态材质。

视觉研究参考：

- [rdev/liquid-glass-react](https://github.com/rdev/liquid-glass-react)：边缘折射与弹性互动。
- [Amir-Abushanab/liquid-glass-js](https://github.com/Amir-Abushanab/liquid-glass-js)：独立光学层与控件交互。
- [iyinchao/liquid-glass-studio](https://github.com/iyinchao/liquid-glass-studio)：折射、高光和形态研究。

原型代码没有引入上述项目的运行时依赖。

正式应用复用 `src/components/common/LiquidSurface.vue` 与
`src/utils/glass-optics.ts`，原型与正式版共享折射实现。正式外观样式位于
`src/assets/styles/liquid-glass.css`：冰蓝画布、透光导航与工具栏，终端正文使用独立的不透明深蓝底色。深浅主题继承已有偏好，动效同时遵守应用开关和系统减少动态效果。
