# AI 服务商与模型目录核对

核对日期：2026-10-23。目录保留全部 62 个历史服务商 ID，供已有配置继续关联；其中 16 个入口有官方文档可核对的聊天预设，共 34 条模型记录（含两个智谱旧入口的重复预设）。

这里的“已核对”表示核对了官方模型说明、接口和参数文档，不代表用付费账号逐个调用成功。模型授权、余额、区域、部署名称和服务商后续调整仍以用户账号为准。`verifiedAt` 表示本次目录审计日期，不表示厂商文档的发布日期。

## 状态约定

| `catalogStatus` | 数量 | 含义 |
| --- | ---: | --- |
| `verified` | 16 | 存在官方文档支持的聊天模型预设；可继续按账号刷新 |
| `dynamic` | 25 | 模型随账号、部署或网关路由变化；不猜测静态模型 ID |
| `unsupported` | 13 | 当前聊天客户端未适配原生协议、服务已退役，或属于音频/图像/视频专用服务 |
| `unverified` | 8 | 暂未找到足以确认现行公共兼容聊天接口的资料；不预填未经核实的地址和模型 |

动态入口的空模型列表是有意设计。请使用“刷新模型”或手动填写账号实际可用的模型 ID；不能由模型名称推断其工具、视觉和思考参数。原始音频、视频、文件上传等能力也不因厂商模型支持就自动成为本客户端支持的功能。

## 预设模型和参数

下表中的上下文与输出数字单位为 token。厂商仅提供 `K/M` 时，目录按十进制记载；厂商提供精确数字时保留原值。最大输出仍受本轮输入及模型总上下文限制。空白输出上限表示没有录入已核实的独立上限，交由服务判断。

| 服务商 / 模型 ID | 上下文 / 最大输出 | 视觉输入 / 工具 | 思考配置 |
| --- | --- | --- | --- |
| OpenAI `gpt-6.1-sol`、`gpt-6-astra` | 1,050,000 / 128,000 | 是 / 是 | `low, medium, high, xhigh, max`，必开，使用 Responses |
| OpenAI `gpt-6-luna` | 1,050,000 / 128,000 | 是 / 是 | 另支持 `none`；统一使用 Responses |
| Anthropic `claude-opus-5-5`、`claude-sonnet-5-5`、`claude-haiku-5-5`、`claude-fable-5-1` | 1,000,000 / 128,000 | 是 / 是 | 原生 Messages 自适应思考，`low, medium, high, xhigh, max` |
| Gemini `gemini-4-argon`、`gemini-3.8-flash` | 1,048,576 / 65,536 | 是 / 是 | `low, medium, high`；不发送不支持的 `minimal` |
| Mistral `mistral-medium-3-5`、`mistral-small-2603` | 256,000 / — | 是 / 是 | 使用服务默认值 |
| Groq `openai/gpt-oss-120b`、`openai/gpt-oss-20b` | 131,072 / 65,536 | 否 / 是 | `low, medium, high`，必开 |
| Cohere `command-a-plus-05-2026` | 128,000 / 64,000 | 是 / 是 | 使用服务默认值 |
| Cohere `command-a-03-2025` | 256,000 / 8,000 | 否 / 是 | 使用服务默认值 |
| xAI `grok-4.7` | 500,000 / — | 是 / 是 | `low, medium, high, xhigh`，必开 |
| Qwen `qwen3.8-max`、`qwen3.7-plus`、`qwen3.8-flash` | 1,000,000 / 131,072 | 是 / 是 | `enable_thinking` 开关，不虚构强度枚举 |
| DeepSeek `deepseek-flash` | 1,000,000 / 393,216 | 是 / 是 | 思考开关及 `low, high, max` |
| DeepSeek `deepseek-v4-pro` | 1,000,000 / 393,216 | 否 / 是 | 思考开关及 `low, high, max` |
| Kimi `kimi-k3` | 1,048,576 / 1,048,576 | 是 / 是 | `low, high, max`，必开；输出字段 `max_completion_tokens` |
| Kimi `kimi-k2.7-code`、`kimi-k2.7-code-highspeed` | 256,000 / — | 是 / 是 | 使用服务默认值 |
| 智谱 `glm-5.3` | 1,000,000 / 128,000 | 否 / 是 | `low, high, max`，必开 |
| 智谱 `glm-5.3-flash`、`glm-5.3-flashx` | 1,000,000 / 128,000 | 是 / 是 | `low, high, max`，必开 |
| MiniMax `MiniMax-M3.1-Flash` | 1,000,000 / — | 是 / 是 | `low, medium, high, xhigh, max`，必开 |
| MiniMax `MiniMax-M3` | 1,000,000 / — | 是 / 是 | 使用服务默认自适应思考 |
| StepFun `step-3.7-flash` | 256,000 / — | 是 / 是 | `low, medium, high`，必开 |
| Upstage `solar-pro4`、`solar-mini4` | 512,000 / 128,000 | 否 / 是 | `none, low, medium, high, xhigh, max`；服务默认关闭思考 |

旧 `chatglm` 和 `zhipuai-all` 入口保留其配置 ID，预设改为 `glm-5.3`。它们使用同一个智谱官方 v4 接口，不再保留失效的旧域名。

采样参数只在模型允许时发送。OpenAI 当前推理预设、Claude 当前预设、Gemini 当前预设、DeepSeek、Kimi 和 GLM-5.3 的目录按保守策略禁用或省略温度及 Top P；其中 Kimi K3 明确要求省略固定的采样参数，MiniMax M3 系列的采样参数固定且传入不生效。GLM Flash、Groq GPT-OSS 和 Solar 4 文档允许温度和 Top P。未核实的输出上限、模型能力和价格不伪造为确定值。价格会随地区、缓存、上下文和账号套餐变化，本次移除了过期静态价格。

Claude Haiku 在部分强度下另有关闭思考能力，Sonnet 有分段思考限制；本轮仅暴露当前客户端已适配的自适应强度，避免发送未经适配的开关组合。Mistral Large 4、Step 5 Preview 等预览模型不作为稳定预设，仍可按账号自行添加。

## 官方模型与参数来源

- OpenAI：[模型目录](https://developers.openai.com/api/docs/models)、[GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol)、[GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra)、[GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna)。
- Anthropic：[模型概览](https://platform.claude.com/docs/en/models/overview)、[思考强度](https://platform.claude.com/docs/en/build-with-claude/effort)。
- Google：[Gemini 模型目录](https://ai.google.dev/gemini-api/docs/models)、[Gemini 4 Argon](https://ai.google.dev/gemini-api/docs/models/gemini-4-argon)、[Gemini 3.8 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash)。
- Mistral：[模型目录](https://docs.mistral.ai/models)、[Medium 3.5](https://docs.mistral.ai/models/mistral-medium-3-5-26-04)、[Small 4](https://docs.mistral.ai/models/mistral-small-4-0-26-03)。
- Groq：[生产模型目录](https://console.groq.com/docs/models)、[GPT-OSS 120B](https://console.groq.com/docs/model/openai/gpt-oss-120b)、[推理与采样参数](https://console.groq.com/docs/reasoning)。
- Cohere：[模型目录](https://docs.cohere.com/docs/models)、[OpenAI 兼容 API](https://docs.cohere.com/docs/compatibility-api)。其地址为 `https://api.cohere.ai/compatibility/v1`。
- xAI：[Grok 4.7](https://docs.x.ai/developers/models/grok-4.7)。
- Qwen：[模型目录](https://help.aliyun.com/zh/model-studio/models)、[Qwen3.8 Max](https://help.aliyun.com/zh/model-studio/qwen3-8-max)、[Qwen3.7 Plus](https://help.aliyun.com/zh/model-studio/qwen3-7-plus)、[Qwen3.8 Flash](https://help.aliyun.com/zh/model-studio/qwen3-8-flash)、[深度思考](https://help.aliyun.com/zh/model-studio/deep-thinking)、[北京地域接入](https://help.aliyun.com/zh/model-studio/beijing-access-information)。新业务空间需使用专属兼容地址；旧 DashScope 兼容地址仅在其适用账号下继续有效。
- DeepSeek：[现行模型与限制](https://api-docs.deepseek.com/quick_start/pricing/)、[思考模式](https://api-docs.deepseek.com/guides/thinking_mode/)、[精确输出上限](https://api-docs.deepseek.com/api/create-chat-completion/)。旧 `deepseek-chat`、`deepseek-reasoner` 已退役，不再预置；当前 Flash 指向 V4.1 Flash。
- Kimi：[模型目录](https://platform.kimi.ai/docs/models)、[K3 参数](https://platform.kimi.ai/docs/guide/kimi-k3-quickstart)、[思考强度](https://platform.kimi.ai/docs/guide/use-reasoning-effort)。旧 Moonshot v1、Kimi K2.5 已退役；当前端点为 `https://api.moonshot.ai/v1`。
- 智谱：[GLM-5.3](https://docs.bigmodel.cn/cn/guide/models/text/glm-5.3)、[GLM-5.3 Flash / FlashX](https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash)。FlashX Legal 属于单独企业能力，未作为公共预设。
- MiniMax：[模型与文本生成](https://platform.minimax.cn/docs/guides/text-generation)、[OpenAI 兼容参数](https://platform.minimax.cn/docs/api-reference/text-openai-api)。中国站当前端点为 `https://api.minimax.cn/v1`。
- StepFun：[Step 3.7 Flash](https://platform.stepfun.ai/docs/en/guides/models/step-3.7-flash)。中国站使用 `https://api.stepfun.com/v1`，国际站使用 `https://api.stepfun.ai/v1`，两站密钥不能混用。
- Upstage：[现行模型与版本历史](https://console.upstage.ai/docs/models/history)、[思考参数](https://console.upstage.ai/docs/capabilities/generate/reasoning)、[采样参数](https://console.upstage.ai/api/chat)。旧 Solar Pro 2/3、Solar Mini 将于 2026-10-30 退役；不再预置。

## 需要动态配置的 25 个入口

| 服务商 ID | 配置依据 |
| --- | --- |
| `azure-openai` | [Azure OpenAI v1](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/switching-endpoints)：填写资源端点，模型 ID 使用部署名称 |
| `baichuan` | [百川开放平台](https://platform.baichuan-ai.com/docs-v2/api)：按账号授权填写模型 |
| `yi` | [零一万物](https://platform.lingyiwanwu.com/docs)：按账号现行目录填写模型 |
| `spark` | [讯飞 X2 Flash](https://www.xfyun.cn/doc/spark/X2-Flash.html)：使用 `/agent/v1` 和对应 API Password；其他星火模型需匹配其各自端点 |
| `hunyuan` | [腾讯混元](https://cloud.tencent.com/document/product/1729/111007)：旧平台服务已购模型；新模型按 TokenHub 控制台配置 |
| `wenxin` | [百度千帆](https://cloud.baidu.com/doc/qianfan)：v2 兼容端点及账号授权模型 |
| `sensenova` | [商汤日日新](https://platform.sensenova.cn)：以账号提供的兼容地址与模型为准 |
| `infini-ai` | [无问芯穹](https://cloud.infini-ai.com)：以账号提供的兼容地址与模型为准 |
| `doubao` | [火山方舟](https://docs.volcengine.com/docs/ark/deep-thinking?lang=zh)：已开通模型或推理接入点 `ep-…` |
| `together` | [Together serverless 模型](https://docs.together.ai/docs/serverless/models) |
| `fireworks` | [Fireworks 入门](https://docs.fireworks.ai/getting-started/quickstart)：账号模型或部署 ID |
| `openrouter` | [OpenRouter 模型元数据](https://openrouter.ai/docs/guides/overview/models)：按返回能力和支持参数配置 |
| `siliconcloud` | [硅基流动](https://docs.siliconflow.cn/docs/userguide/quickstart)：账号可用目录 |
| `huggingface` | [Hugging Face Inference Providers](https://huggingface.co/docs/inference-providers/tasks/chat-completion)：`router.huggingface.co/v1` |
| `custom-openai` | 用户自己的 OpenAI 兼容聊天端点；不设置公共默认地址 |
| `ollama` | [Ollama 本地模型列表](https://docs.ollama.com/api/tags)：由本机已下载模型决定 |
| `cloudflare` | [Workers AI OpenAI 兼容接口](https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/)：地址必须包含账号 ID |
| `ai21` | [AI21 Jamba](https://docs.ai21.com/docs/jamba-foundation-models)：按授权添加，未核实的工具能力不预置 |
| `novita` | [Novita LLM API](https://docs.novita.ai/guides/llm-api)：官方当前基础地址 `https://api.novita.ai/openai` |
| `lepton` | [Lepton](https://www.lepton.ai/docs)：使用自身部署端点 |
| `deepinfra` | [DeepInfra OpenAI API](https://deepinfra.com/docs/openai_api)：`https://api.deepinfra.com/v1/openai` |
| `modal` | [Modal vLLM 部署](https://modal.com/docs/examples/vllm_inference)：使用自身 Web Endpoint |
| `runpod` | [RunPod vLLM 兼容接口](https://docs.runpod.io/serverless/vllm/openai-compatibility)：使用自身部署地址 |
| `higress` | [Higress AI Proxy](https://higress.io/docs/latest/plugins/ai/api-provider/ai-proxy/)：使用自身网关与路由模型名 |
| `friendli` | [Friendli 模型 API](https://friendli.ai/docs/guides/model-apis/quickstart)：serverless 地址与账号目录 |

## 停止推荐或尚未适配的入口

- `github-models`：[GitHub Models 官方文档](https://docs.github.com/en/github-models)确认服务于 2026-07-30 退役。
- `perplexity`：[Agent API 兼容说明](https://docs.perplexity.ai/docs/agent-api/openai-compatibility)。当前客户端未适配新的专有 Agent 参数，暂不提供可直接使用的预设。
- `replicate`：[Predictions API](https://replicate.com/docs/reference/http)。不是通用 OpenAI 聊天端点。
- `aws-bedrock`：[Bedrock 原生 API](https://docs.aws.amazon.com/bedrock/latest/APIReference/welcome.html)需要 AWS 签名与区域认证；可自行通过已适配的兼容网关接入。
- `minimax-music`、`minimax-speech`、`stability`、`midjourney`、`elevenlabs`、`runway`、`suno`、`ideogram`、`together-image`：属于音乐、语音、图像或视频生成服务，本客户端终端对话未适配其原生请求。保留入口 ID 供历史配置识别，不再虚构通用聊天模型。

`360ai`、`taichu`、`skylark`、`yuan`、`tiangong`、`anyscale`、`octoai`、`banana` 共 8 个入口标为未核实，不声称其服务已经停止。没有足够官方资料确认的公共聊天地址和模型预设已清空，用户仍可按当前部署方文档自行配置。
