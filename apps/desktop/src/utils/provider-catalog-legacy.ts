// Migration baseline from Prism 1.9.1. Used only to distinguish old presets from user models.
export const LEGACY_PROVIDER_CATALOG: Record<string, { endpoint: string; models: string[] }> = {
  "openai": {
    "endpoint": "https://api.openai.com/v1",
    "models": [
      "gpt-4-turbo",
      "gpt-4",
      "gpt-4-vision-preview",
      "gpt-3.5-turbo"
    ]
  },
  "azure-openai": {
    "endpoint": "https://YOUR_RESOURCE.openai.azure.com",
    "models": [
      "gpt-4",
      "gpt-35-turbo"
    ]
  },
  "anthropic": {
    "endpoint": "https://api.anthropic.com/v1",
    "models": [
      "claude-3-opus-20240229",
      "claude-3-sonnet-20240229",
      "claude-3-haiku-20240307"
    ]
  },
  "google": {
    "endpoint": "https://generativelanguage.googleapis.com/v1beta",
    "models": [
      "models/gemini-1.5-pro",
      "models/gemini-1.5-flash",
      "models/gemini-pro"
    ]
  },
  "mistral": {
    "endpoint": "https://api.mistral.ai/v1",
    "models": [
      "mistral-large-latest",
      "mistral-medium-latest",
      "mistral-small-latest"
    ]
  },
  "groq": {
    "endpoint": "https://api.groq.com/openai/v1",
    "models": [
      "llama-3.1-70b-versatile",
      "mixtral-8x7b-32768",
      "gemma2-9b-it"
    ]
  },
  "perplexity": {
    "endpoint": "https://api.perplexity.ai",
    "models": [
      "llama-3.1-sonar-large-128k-online",
      "llama-3.1-sonar-small-128k-online"
    ]
  },
  "cohere": {
    "endpoint": "https://api.cohere.ai/v1",
    "models": [
      "command-r-plus",
      "command-r"
    ]
  },
  "xai": {
    "endpoint": "https://api.x.ai/v1",
    "models": [
      "grok-beta"
    ]
  },
  "qwen": {
    "endpoint": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "models": [
      "qwen-max",
      "qwen-plus",
      "qwen-turbo",
      "qwen-vl-plus"
    ]
  },
  "deepseek": {
    "endpoint": "https://api.deepseek.com/v1",
    "models": [
      "deepseek-chat",
      "deepseek-coder"
    ]
  },
  "moonshot": {
    "endpoint": "https://api.moonshot.cn/v1",
    "models": [
      "moonshot-v1-128k",
      "moonshot-v1-32k",
      "moonshot-v1-8k"
    ]
  },
  "zhipu": {
    "endpoint": "https://open.bigmodel.cn/api/paas/v4",
    "models": [
      "glm-4",
      "glm-4v",
      "glm-3-turbo"
    ]
  },
  "baichuan": {
    "endpoint": "https://api.baichuan-ai.com/v1",
    "models": [
      "Baichuan4",
      "Baichuan3-Turbo"
    ]
  },
  "minimax": {
    "endpoint": "https://api.minimaxi.com/v1",
    "models": [
      "MiniMax-M2.7",
      "MiniMax-M2.7-highspeed"
    ]
  },
  "yi": {
    "endpoint": "https://api.lingyiwanwu.com/v1",
    "models": [
      "yi-large",
      "yi-medium",
      "yi-vision"
    ]
  },
  "stepfun": {
    "endpoint": "https://api.stepfun.com/v1",
    "models": [
      "step-1-256k",
      "step-1-flash",
      "step-1v-32k"
    ]
  },
  "spark": {
    "endpoint": "https://spark-api.xf-yun.com/v1",
    "models": [
      "spark-max",
      "spark-pro",
      "spark-lite"
    ]
  },
  "hunyuan": {
    "endpoint": "https://api.hunyuan.cloud.tencent.com/v1",
    "models": [
      "hunyuan-pro",
      "hunyuan-standard",
      "hunyuan-lite"
    ]
  },
  "wenxin": {
    "endpoint": "https://aip.baidubce.com/rpc/2.0/ai_custom/v1",
    "models": [
      "ernie-4.0",
      "ernie-3.5",
      "ernie-bot-turbo"
    ]
  },
  "360ai": {
    "endpoint": "https://api.360.cn/v1",
    "models": [
      "360gpt-pro",
      "360gpt-turbo"
    ]
  },
  "sensenova": {
    "endpoint": "https://api.sensenova.cn/v1",
    "models": [
      "SenseChat-5",
      "SenseChat-Turbo"
    ]
  },
  "taichu": {
    "endpoint": "https://api.taichu.ia.ac.cn/v1",
    "models": [
      "taichu-2.0"
    ]
  },
  "skylark": {
    "endpoint": "https://api.skylark.com/v1",
    "models": [
      "skylark-chat"
    ]
  },
  "chatglm": {
    "endpoint": "https://open.bigmodel.cn/api/paas/v3",
    "models": [
      "chatglm_turbo"
    ]
  },
  "minimax-music": {
    "endpoint": "https://api.minimax.chat/v1/music",
    "models": [
      "music-01"
    ]
  },
  "infini-ai": {
    "endpoint": "https://api.infini-ai.com/v1",
    "models": [
      "Qwen2-72B-Instruct",
      "Llama-3-70B-Instruct"
    ]
  },
  "zhipuai-all": {
    "endpoint": "https://open.bigmodel.cn/api/paas/v4",
    "models": [
      "glm-4-air",
      "glm-4-airx",
      "glm-4-flash"
    ]
  },
  "doubao": {
    "endpoint": "https://ark.cn-beijing.volces.com/api/v3",
    "models": [
      "doubao-pro-32k",
      "doubao-lite-32k"
    ]
  },
  "yuan": {
    "endpoint": "https://api.inspur.com/v1",
    "models": [
      "Yuan2-102B"
    ]
  },
  "tiangong": {
    "endpoint": "https://sky-api.singularity-ai.com/v1",
    "models": [
      "SkyChat-MegaVerse"
    ]
  },
  "together": {
    "endpoint": "https://api.together.xyz/v1",
    "models": [
      "meta-llama/Llama-3-70b-chat-hf",
      "mistralai/Mixtral-8x22B-Instruct-v0.1"
    ]
  },
  "fireworks": {
    "endpoint": "https://api.fireworks.ai/inference/v1",
    "models": [
      "accounts/fireworks/models/llama-v3p1-70b-instruct",
      "accounts/fireworks/models/mixtral-8x7b-instruct"
    ]
  },
  "openrouter": {
    "endpoint": "https://openrouter.ai/api/v1",
    "models": [
      "openai/gpt-4-turbo",
      "anthropic/claude-3-opus",
      "meta-llama/llama-3-70b-instruct"
    ]
  },
  "siliconcloud": {
    "endpoint": "https://api.siliconflow.cn/v1",
    "models": [
      "Qwen/Qwen2-72B-Instruct",
      "deepseek-ai/DeepSeek-V2-Chat"
    ]
  },
  "huggingface": {
    "endpoint": "https://api-inference.huggingface.co/models",
    "models": [
      "meta-llama/Meta-Llama-3-70B-Instruct",
      "mistralai/Mixtral-8x7B-Instruct-v0.1"
    ]
  },
  "replicate": {
    "endpoint": "https://api.replicate.com/v1",
    "models": [
      "meta/llama-2-70b-chat"
    ]
  },
  "custom-openai": {
    "endpoint": "https://api.example.com/v1",
    "models": []
  },
  "ollama": {
    "endpoint": "http://localhost:11434",
    "models": []
  },
  "aws-bedrock": {
    "endpoint": "https://bedrock-runtime.{region}.amazonaws.com",
    "models": [
      "anthropic.claude-3-opus-20240229-v1:0",
      "anthropic.claude-3-sonnet-20240229-v1:0",
      "meta.llama3-70b-instruct-v1:0",
      "cohere.command-r-plus-v1:0"
    ]
  },
  "cloudflare": {
    "endpoint": "https://api.cloudflare.com/client/v4/accounts/{account_id}/ai",
    "models": [
      "@cf/meta/llama-3-8b-instruct",
      "@cf/mistral/mistral-7b-instruct-v0.1",
      "@cf/qwen/qwen1.5-7b-chat-awq"
    ]
  },
  "github-models": {
    "endpoint": "https://models.inference.ai.azure.com",
    "models": [
      "gpt-4o",
      "Meta-Llama-3.1-70B-Instruct",
      "Mistral-large"
    ]
  },
  "ai21": {
    "endpoint": "https://api.ai21.com/studio/v1",
    "models": [
      "jamba-instruct",
      "j2-ultra"
    ]
  },
  "novita": {
    "endpoint": "https://api.novita.ai/v3",
    "models": [
      "meta-llama/llama-3.1-70b-instruct",
      "mistralai/mixtral-8x7b-instruct"
    ]
  },
  "upstage": {
    "endpoint": "https://api.upstage.ai/v1",
    "models": [
      "solar-1-mini-chat",
      "solar-pro"
    ]
  },
  "lepton": {
    "endpoint": "https://api.lepton.ai/v1",
    "models": [
      "llama3-70b",
      "mixtral-8x7b"
    ]
  },
  "anyscale": {
    "endpoint": "https://api.endpoints.anyscale.com/v1",
    "models": [
      "meta-llama/Meta-Llama-3-70B-Instruct",
      "mistralai/Mixtral-8x7B-Instruct-v0.1"
    ]
  },
  "deepinfra": {
    "endpoint": "https://api.deepinfra.com/v1/openai",
    "models": [
      "meta-llama/Meta-Llama-3.1-70B-Instruct",
      "mistralai/Mixtral-8x22B-Instruct-v0.1"
    ]
  },
  "octoai": {
    "endpoint": "https://text.octoai.run/v1",
    "models": [
      "meta-llama-3-70b-instruct",
      "mixtral-8x7b-instruct"
    ]
  },
  "modal": {
    "endpoint": "https://api.modal.com/v1",
    "models": [
      "llama-3-70b"
    ]
  },
  "runpod": {
    "endpoint": "https://api.runpod.ai/v2",
    "models": [
      "llama3-70b-instruct"
    ]
  },
  "banana": {
    "endpoint": "https://api.banana.dev/v1",
    "models": [
      "llama-2-70b"
    ]
  },
  "higress": {
    "endpoint": "https://api.higress.io/v1",
    "models": [
      "qwen-turbo"
    ]
  },
  "friendli": {
    "endpoint": "https://api.friendli.ai/v1",
    "models": [
      "mixtral-8x7b-instruct-v0-1"
    ]
  },
  "minimax-speech": {
    "endpoint": "https://api.minimax.chat/v1/t2a",
    "models": [
      "speech-01"
    ]
  },
  "stability": {
    "endpoint": "https://api.stability.ai/v1",
    "models": [
      "stable-diffusion-xl",
      "stable-diffusion-3"
    ]
  },
  "midjourney": {
    "endpoint": "https://api.midjourney.com/v1",
    "models": [
      "mj-6"
    ]
  },
  "elevenlabs": {
    "endpoint": "https://api.elevenlabs.io/v1",
    "models": [
      "eleven_multilingual_v2"
    ]
  },
  "runway": {
    "endpoint": "https://api.runwayml.com/v1",
    "models": [
      "gen-2"
    ]
  },
  "suno": {
    "endpoint": "https://api.suno.ai/v1",
    "models": [
      "chirp-v3"
    ]
  },
  "ideogram": {
    "endpoint": "https://api.ideogram.ai/v1",
    "models": [
      "ideogram-v1"
    ]
  },
  "together-image": {
    "endpoint": "https://api.together.xyz/v1",
    "models": [
      "stabilityai/stable-diffusion-xl-base-1.0"
    ]
  }
}
