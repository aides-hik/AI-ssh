# 官网自托管字体

- `noto-sans-sc-subset.woff2`：Noto Sans SC 可变字体，字重 100–900。包含本次官网 HTML、模拟日志及 ASCII 所需的 513 个字符，约 130 KiB。
- `manrope-latin.woff2`：Manrope Latin 可变字体，字重 200–800，约 24 KiB。

两者均采用 SIL Open Font License 1.1，原始版权与许可分别保存在 `NotoSansSC-OFL.txt`、`Manrope-OFL.txt`，随站点分发。

字体来自 Google Fonts 的 WOFF2 分发：

- <https://fonts.google.com/noto/specimen/Noto+Sans+SC>
- <https://fonts.google.com/specimen/Manrope>
- 许可来源：<https://github.com/google/fonts/tree/main/ofl/notosanssc>、<https://github.com/google/fonts/tree/main/ofl/manrope>。

Noto Sans SC 使用 Google Fonts CSS2 的 `text=` 参数按页面文字生成子集，并保留可变字重。修改官网中文文案或模拟日志时，应重新生成子集；未包含的字符由系统中文字体回退显示。Manrope 仅负责拉丁文字，中文由 Noto Sans SC 显示，终端命令继续使用等宽字体。

浏览器仅从本站相对路径加载字体；无需访问外部字体服务。`font-display: swap` 保证字体不可用时内容仍可阅读。
