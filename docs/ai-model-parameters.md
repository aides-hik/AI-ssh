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

本次验证使用模拟 HTTP/SSE/分页响应，不使用真实密钥。它覆盖参数、协议、中文流式分帧、取消、默认设置和能力元数据；真实账号权限、余额与网络可用性仍以用户端连接测试结果为准。
