import type { AIProvider, AIModel } from '../types/ai-providers'
import { chatCompletion, ModelResponseIncompleteError } from './ai-api.service'
import { getRuntimeProviderId, normalizeAIEndpoint } from '../utils/model-capabilities'

export interface TestResult {
  success: boolean
  message: string
  latency?: number
  error?: string
}

/** Tests use the same transport and parameter adapter as real chat requests. */
export async function testProviderConnection(provider: AIProvider, modelId?: string): Promise<TestResult> {
  const runtime = getRuntimeProviderId(provider)
  if (!provider.endpoint.trim()) return { success: false, message: '端点 URL 未配置', error: '缺少端点配置' }
  if (!provider.apiKey && runtime !== 'ollama') return { success: false, message: '请先输入 API Key', error: 'API Key 为空' }
  const started = Date.now()
  try {
    if (runtime === 'ollama' && !modelId) {
      const base = normalizeAIEndpoint(provider.endpoint).replace(/\/v1$/, '')
      const response = await fetch(`${base}/api/tags`, {
        headers: provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {},
        signal: AbortSignal.timeout(5000)
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      const data = await response.json()
      const latency = Date.now() - started
      return { success: true, message: `连接成功！找到 ${Array.isArray(data.models) ? data.models.length : 0} 个本地模型，响应时间: ${latency}ms`, latency }
    }
    if (!modelId) return { success: false, message: '请提供要测试的模型 ID', error: '缺少模型 ID' }
    const model: AIModel = provider.models?.find(item => item.id === modelId) || {
      id: modelId, name: modelId, providerId: provider.id, contextWindow: 0,
      capabilities: { text: true, image: false, vision: false, functionCall: false }
    }
    // A one-token probe falsely fails on models that budget thinking and output together.
    // 64 tokens is bounded and sufficient to verify protocol acceptance; an empty capped response is valid.
    await chatCompletion(provider, model, {
      messages: [{ role: 'user', content: 'Reply OK.' }], maxTokens: 64,
      signal: AbortSignal.timeout(30000), stream: false
    })
    const latency = Date.now() - started
    return { success: true, message: `连接成功！响应时间: ${latency}ms`, latency }
  } catch (error) {
    if (error instanceof ModelResponseIncompleteError && error.reason === 'max_output_tokens') {
      const latency = Date.now() - started
      return { success: true, message: `连接成功，已达到连接测试的输出上限，响应时间: ${latency}ms`, latency }
    }
    return { success: false, message: '连接失败', error: error instanceof Error ? error.message : '网络错误或超时' }
  }
}
