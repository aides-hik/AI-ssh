# 网页预览的多服务器模拟

此目录仅由 `vite.design.config.mts` 的网页入口使用。SSH、文件及演示模型请求全部由内存适配器处理，不访问演示地址。

连接列表包含三台：

| 节点 ID | 名称 | 模拟用途 |
| --- | --- | --- |
| `preview-server` | 演示服务器 · UI 测试 | 应用服务，命令默认约 1.2 秒返回 |
| `preview-web-02` | Web 节点 02 · UI 测试 | Web 服务，命令默认约 1.8 秒返回 |
| `preview-db-01` | 数据库节点 01 · UI 测试 | 数据库，命令默认约 2.4 秒返回，磁盘占用 88% |

分别连接侧栏中的三个节点后，可在助手的操作目标中选择这些已连接主机。单台与多台主机使用相同的 `<multi_host_targets>` 清单和工具。明确要求巡检时，模型会为每个目标返回一次 `inspect_server` 调用；后续汇总以实际收到的工具结果为准，保留失败、停止和未返回结果的区别。普通单主机聊天、模型切换与推理强度演示保持文字回复。

选择一台或多台主机后发送“用 Docker Compose 部署演示项目”，可测试部署流程：先读取各节点状态，再展示 `execute_deployment_stage` 确认卡片。确认后逐台模拟拉取镜像、启动和检查；取消、停止、失败或缺失结果都会如实显示，模型不会重复提交被取消的阶段。命令输出仍由内存适配器生成，不会启动本机 Docker 或访问真实服务器。

发送“执行 docker version，查看 Docker 版本”，可测试普通命令的确认和执行：每台主机分别调用 `execute_ssh_command`，确认后生成命令阶段结果。失败、拒绝、停止或缺失退出码不会显示为成功，也不会自动重复提交。

部署检查示例除了列出容器，还包含有时间上限的 HTTP 健康检查；请求明确包含“只规划”“先分析”“不要修改”“不要执行”或“只读”时，不会提交部署阶段。

`getConnections()` 返回每条运行连接的 `id`、`nodeId`、`name`、`host`、`isConnected`、`status` 和安全的 `config` 快照。演示运行 ID 与节点 ID 相同；连接、输入缓冲、文件变更、环境文档及取消请求均按主机分别保存。

`ssh.execute(connectionId, command, requestId, { timeoutMs })` 在执行期间通过 `onExecuteOutput` 分块发送日志，事件同时携带请求 ID 和连接 ID。`timeoutMs` 默认为 300000，允许 10000–1800000 范围内的整数。标准输出和错误输出共同保留最多 128 KiB，保留完整 UTF-8 字符；超出时事件标记 `truncated`。最终结果包含已发送的输出。交互终端输入和 `executeSilent` 不触发此事件。

```js
const requestId = crypto.randomUUID()
const connectionId = 'preview-server'
const unsubscribe = window.electronAPI.ssh.onExecuteOutput(event => {
  if (event.requestId !== requestId || event.connectionId !== connectionId) return
  console.log(event.stream, event.data)
})
try {
  await window.electronAPI.ssh.execute(connectionId, 'docker version', requestId, { timeoutMs: 60000 })
} finally {
  unsubscribe()
}
```

取消、断线和超时会停止后续日志并清理待执行定时器。取消表示停止后续执行，不表示撤销已执行操作；此预览中的所有操作和日志均为内存模拟。

仅网页预览提供以下测试钩子，可在独立的浏览器 QA 环境中调用：

```js
// 让 Web 节点的命令返回明确失败，其他主机仍可完成。
window.electronAPI.preview.setCommandFailure('preview-web-02', '模拟服务查询失败')
// 恢复该节点。
window.electronAPI.preview.setCommandFailure('preview-web-02', null)
// 延长某台的执行时间，便于测试单台停止和全部停止。
window.electronAPI.preview.setExecuteDelay('preview-db-01', 8000)
// 查看正在执行的请求，不包含命令或凭据。
window.electronAPI.preview.pendingCommands()
// 模拟执行期间断线，只影响对应主机。
await window.electronAPI.ssh.disconnect('preview-web-02')
```

模拟数据会随页面刷新重置。测试不需要真实服务器或模型服务。
