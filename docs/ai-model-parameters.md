# AI 模型参数与请求协议

核对日期：2026-10-23。模型目录和官方链接见 [ai-provider-catalog.md](ai-provider-catalog.md)。模型是否向某个账号开放，以「刷新模型」实际返回的列表为准。

## 配置优先级

每次调用的显式参数优先于 `AIModel.requestConfig`，再回退到旧版 `AIProvider.config` 中的同名参数。缺省值不发送，交给模型服务决定。设置中的「恢复默认」只清除用户参数，不会修改 API Key、端点或模型能力。

`AIModel.parameters` 是服务端或官方目录提供的能力；`AIModel.requestConfig` 是用户的模型默认参数。它们独立保存。刷新目录需保留用户 `requestConfig`、自定义模型和启用状态。

通用参数适配入口是 `src/utils/model-capabilities.ts`。普通聊天、连接测试、终端工具调用共享这一适配逻辑，调用端可以显式选择官方兼容协议。

## 协议差异

| 服务/模型 | 协议与输出限制字段 | 思考控制与采样约束 |
| --- | --- | --- |
| OpenAI Responses 模型 | `/responses`，`max_output_tokens` | `reasoning.effort`；推理启用时省略 `temperature`/`top_p`。仅模型允许并显式选择 `none` 时可恢复采样。 |
| OpenAI Chat Completions 推理模型 | `/chat/completions`，`max_completion_tokens` | `reasoning_effort`；按具体模型列出合法档位，不从任意别名猜测。 |
| 普通 OpenAI 兼容模型 | `/chat/completions`，通常 `max_tokens` | 按已声明能力发送；模型指定的 `maxTokensParameter` 优先。 |
| Claude 原生 | `/messages`，必填 `max_tokens` | 新模型 `output_config.effort`；旧版 adaptive 模型加 `thinking.type=adaptive`。旧预算模型使用 `budget_tokens`，必须至少 1024 且小于 `max_tokens`。Claude 新模型省略采样；旧模型不同时发送温度与 Top P。 |
| Gemini 原生 | `models/{id}:generateContent`，`generationConfig.maxOutputTokens` | `generationConfig.thinkingConfig`；2.5 使用预算，后续模型使用档位。API Key 放请求头，不拼进 URL。 |
| Gemini OpenAI 兼容 | `/v1beta/openai/chat/completions`，`max_tokens` | `reasoning_effort`；不会混入原生 `generationConfig`。 |
| DeepSeek | `/chat/completions`，`max_tokens` | 开关 `thinking.type`，档位 `low/high/max`。不提供被服务端重映射的 `medium/xhigh` 档位。 |
| Qwen | `/chat/completions`，`max_tokens` | 只为明确支持的模型发送 `enable_thinking`；预算或档位不跨模型假定。 |
| OpenRouter | `/chat/completions`，`max_tokens` | `reasoning.effort`；模型接口的 `supported_parameters` 决定工具、温度、Top P，`top_provider.max_completion_tokens` 决定输出上限。 |
| Ollama | `/api/chat`，`options.num_predict` | 温度与 Top P 位于 `options`；模型发现使用 `/api/tags`。 |

MiniMax M3.1 Flash、GLM、Kimi、Grok 等兼容接口可复用顶层 `reasoning_effort`，但能力和档位必须来自各自官方说明；这并不意味着它们使用 OpenAI Responses。

最大输出 token 数不等于上下文长度；未知上限显示为未知，不使用名称或 `max_tokens` 猜测上下文。用户值按实际输出上限裁切。官方目录没有覆盖的模型，保留服务默认思考参数，并允许用户使用服务端支持的基础配置。

## 模型发现

- Anthropic 使用真实 `/v1/models` 接口并跟随 `after_id` 分页，不返回旧 Claude 3 固定列表。
- Gemini 使用 `/v1beta/models` 并跟随 `nextPageToken`，保留 `inputTokenLimit` 与 `outputTokenLimit`。
- OpenRouter 按接口元数据判断工具、输入/输出模态和参数，不因名称里含 `gpt`/`claude` 就覆盖明确的否定信息。
- 自定义 OpenAI 兼容端点可以刷新；继承厂商协议的自定义服务商通过 `runtimeProviderId` 选择对应发现接口。
- Ollama 安装模型通过 `/api/tags` 获取，再用 `/api/show` 读取真实工具、视觉和上下文能力；不支持详情的旧服务仍保留模型列表。
- 非法响应、循环分页或 HTTP 错误明确返回失败，保留已有用户配置。

## 工具调用异常排查

聊天中出现 `<｜DSML｜calls>`、`<｜DSML｜invoke>` 等原始标记，说明模型接口把工具协议放进了普通回答，不能据此认为服务器操作已执行。终端助手使用 `AIChatOpenCodeStyle → SessionProcessor → LLMSession`，工具请求直接发送到用户配置的模型接口。

- 检查所选模型是否支持并已启用「工具调用」。只有 `capabilities.functionCall` 为真时，客户端才发送工具名称、参数 schema 和 `tool_choice`；自定义模型或未知别名不能仅凭模型名称认定支持。
- 自部署服务必须使用与模型版本匹配的聊天模板和工具解析器，把模型内部 DSML 转成标准 `tool_calls`。例如 vLLM 的 DeepSeek V4 配置使用 `--tool-call-parser deepseek_v4 --enable-auto-tool-choice`，其他模型、框架按各自文档配置：[vLLM DeepSeek V4 部署说明](https://vllm.ai/blog/2026-04-24-deepseek-v4)、[DeepSeek 工具调用接口](https://api-docs.deepseek.com/guides/tool_calls/)。
- 客户端会拦截代码示例以外的原始 DSML（包括跨流式分块的标记），只对该异常响应尝试一次原生工具调用纠正；异常文本不进入模型历史，已经完成的工具轮次保留。纠正仍异常或没有返回原生调用时明确报错，不标记为完成。
- 纠正请求继续携带原始工具 schema，不从 DSML 猜参数或直接执行。例如 `inspect_server` 同时需要 `targetId` 和 `checks`；只有目标编号仍不足以执行巡检。原生调用继续经过参数、目标和操作审批检查。

工具事件在完整响应通过检查后才交给执行层：空调用、重复或变化的调用 ID、含糊的并行索引、未注册工具、非法参数 JSON、畸形输出结构、未完成的响应都会报错。没有工具调用且只有空白或推理内容的响应也不会标记完成。部分本地兼容接口缺少 ID 或索引时，仅在能明确区分调用的情况下兼容处理；SSE 同时支持 LF、CRLF 和 CR，收到完成事件后即使 HTTP 连接仍打开也会结束读取。界面使用独立的执行编号，避免不同轮次复用同一个模型调用 ID 时覆盖旧记录；模型历史仍使用原始 ID 配对结果。

工具执行使用 Zod 解析后的参数，默认值和转换实际生效。停止请求会中断只读审批等待，迟到的批准不会执行；批准后重新核对所选 SSH 连接，巡检必须取得真实的零退出码才能记为成功。工具错误或取消不会被模型后续结束消息覆盖为成功。

上下文缓存按模型、接口、目标、会话、工具能力和协议隔离。重开会话、切换协议或关闭工具能力时，缺少原始签名的工具记录作为带参数、主机和结果的摘要回放，不伪造原生调用；同轮的重复或孤立记录也降级为摘要。工具元数据落盘时仅保留主机 ID 和名称，私有推理和签名仍只留在内存。

## 真实联调（2026-11-01）

通过真实 Electron 界面、用户现有本地 `deepseek-v4.1-flash` 模型接口及用户核对指纹后的 SSH 会话完成联调。未在文档中记录密钥、模型端点或服务器地址。

| 场景 | 结果与依据 |
| --- | --- |
| 原生工具调用 | 模型返回规范调用，`inspect_server` 包含正确目标及 `cpu/memory/disk/services` 四项参数。 |
| 真实巡检 | 四项观察标记完整，SSH 返回 `exitCode: 0`，模型读取结果后完成总结。 |
| 拒绝与批准 | 拒绝后远程执行次数为零；批准后标记命令只执行一次并返回零退出码。 |
| 等待审批时停止 | 点击弹窗内「停止本次请求」，审批关闭、整轮中止，未发出远程执行请求。 |
| 执行中停止 | 在短暂等待命令输出起始标记后点击停止；取消 IPC 获确认、测试命令进程消失，结束标记未输出，界面显示停止。 |
| 生成中停止 | 收到首段文字后点击停止；模型 HTTP 请求中止，文字停止追加，发送按钮恢复。 |
| 停止后继续 | 新请求重新经过审批并成功执行，返回零退出码。 |

联调发现并修正当前模型配置中关闭的工具能力；仅在真实原生工具探测通过后启用，凭据保持不变。同时补充确切型号的默认能力识别，仍尊重模型列表中明确的禁用元数据。审批弹窗新增独立的整轮停止按钮，「取消本阶段」继续只拒绝当前阶段。

## 官方核对来源

- [OpenAI GPT-6 使用与参数兼容](https://developers.openai.com/api/docs/guides/latest-model)
- [OpenAI Responses 创建接口](https://developers.openai.com/api/reference/resources/responses/methods/create)
- [Claude Models API](https://platform.claude.com/docs/en/api/models/list)
- [Claude effort](https://platform.claude.com/docs/en/build-with-claude/effort)
- [Claude Opus 5.5 迁移与采样限制](https://platform.claude.com/docs/en/models/opus-5-5/migration-guide)
- [Gemini OpenAI 兼容与 thinking 映射](https://ai.google.dev/gemini-api/docs/openai)
- [Gemini 模型元数据与分页](https://ai.google.dev/api/models)
- [DeepSeek Chat Completions 参数](https://api-docs.deepseek.com/api/create-chat-completion/)
- [Qwen 深度思考](https://www.alibabacloud.com/help/en/model-studio/deep-thinking)
- [MiniMax 文本模型与双协议示例](https://platform.minimax.cn/docs/guides/text-generation)
- [OpenRouter 模型能力字段](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties)
- [Ollama 模型列表](https://docs.ollama.com/api/tags)
- [Ollama 官方 OpenAPI：模型详情](https://github.com/ollama/ollama/blob/main/docs/openapi.yaml)

自动化回归使用模拟 HTTP/SSE/分页响应，不使用真实密钥，覆盖参数、协议、中文流式分帧、取消、默认设置和能力元数据。上述真实联调另使用用户明确指定的现有配置；它验证该模型与该次 SSH 会话，不替代其他服务或主机的连接测试。
