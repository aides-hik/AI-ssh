import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'

const mockOfficialGetStatus = vi.fn().mockReturnValue({
  enabled: true,
  models: [
    {
      id: 'hosted-model',
      name: 'hosted-model',
      shortName: 'hosted-model',
      enabled: true
    }
  ]
})
const mockOfficialCreateChat = vi.fn().mockResolvedValue({
  content: '自托管模型回复',
  model: 'hosted-model',
  usage: {
    promptTokens: 10,
    completionTokens: 20,
    totalTokens: 30
  }
})

vi.mock('../services/user.service.js', async () => {
  const actual = await vi.importActual<typeof import('../services/user.service.js')>(
    '../services/user.service.js'
  )
  return {
    ...actual,
    userService: {
      ...actual.userService,
      validateEmailFormat: vi.fn().mockReturnValue(true),
      findUserByEmail: vi.fn().mockResolvedValue(null),
      validatePassword: vi.fn().mockResolvedValue(false),
      updateLastLogin: vi.fn().mockResolvedValue(undefined),
      isEmailExists: vi.fn().mockResolvedValue(false),
      isUsernameExists: vi.fn().mockResolvedValue(false),
      createUser: vi.fn()
    }
  }
})

vi.mock('@fastify/rate-limit', () => ({
  default: async function rateLimitPlugin(app: any) {
    app.decorate('rateLimit', () => async function rateLimitHandler() {})
  }
}))

vi.mock('../config/database.js', () => ({
  default: {
    getInstance: () => ({
      $queryRaw: vi.fn().mockResolvedValue(1)
    })
  }
}))

vi.mock('../config/redis.js', () => ({
  default: {
    getInstance: () => ({
      on: vi.fn(),
      defineCommand: vi.fn(),
      script: vi.fn(),
      evalsha: vi.fn(),
      eval: vi.fn(),
      incr: vi.fn(),
      pttl: vi.fn(),
      pexpire: vi.fn()
    }),
    healthCheck: vi.fn().mockResolvedValue(true)
  }
}))

vi.mock('../services/official-ai-usage.service.js', () => ({
  officialAiUsageService: {
    getStatus: mockOfficialGetStatus,
    getOfficialModels: vi.fn().mockReturnValue([
      {
        id: 'hosted-model',
        name: 'hosted-model',
        shortName: 'hosted-model',
        enabled: true
      }
    ]),
    getOfficialModel: vi.fn(),
    reserveUsage: vi.fn(),
    refundUsage: vi.fn()
  }
}))

vi.mock('../services/official-ai-chat.service.js', () => ({
  officialAiChatService: {
    createChatCompletion: mockOfficialCreateChat
  }
}))

describe('App', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    process.env.NODE_ENV = 'test'
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/test'
    process.env.JWT_SECRET = '12345678901234567890123456789012'
    process.env.ENCRYPTION_KEY = '12345678901234567890123456789012'
    process.env.SESSION_SECRET = '12345678901234567890123456789012'

    const { buildApp } = await import('../app.js')
    app = await buildApp()
  })

  afterAll(async () => {
    if (app) {
      await app.close()
    }
  })

  it('serves health endpoint', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health'
    })

    expect(response.statusCode).toBe(200)
  })

  it('validates authentication payloads with the current Fastify schema compiler', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'user@example.test' }
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().message).toBe('Validation error')
  })

  it('verifies tokens issued by the current JWT plugin', async () => {
    const token = app.jwt.sign({ userId: 'user_1', username: 'tester', role: 'USER' })
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/verify',
      headers: { authorization: `Bearer ${token}` }
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data.user).toEqual({ id: 'user_1', username: 'tester', role: 'USER' })
  })

  it('does not expose removed system routes', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/system/info'
    })

    expect(response.statusCode).toBe(404)
  })

  it('does not expose version endpoint', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/version'
    })

    expect(response.statusCode).toBe(404)
  })

  it.each(['/legal/terms', '/legal/privacy'])('does not serve previous operator policy %s', async url => {
    const response = await app.inject({ method: 'GET', url })
    expect(response.statusCode).toBe(404)
  })

  it('does not accept client-provided external login profiles', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/wechat-login',
      payload: { openId: 'unverified-external-id' }
    })

    expect(response.statusCode).toBe(404)
    expect(response.json()).not.toHaveProperty('data.accessToken')
  })

  it('requires authentication for official model status', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/ai/official/status'
    })

    expect(response.statusCode).toBe(401)
    expect(mockOfficialGetStatus).not.toHaveBeenCalled()
  })

  it('serves fresh official model status for authenticated users', async () => {
    const token = app.jwt.sign({ userId: 'user_1', uuid: 'uuid_1', role: 'USER' })
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/ai/official/status',
      headers: { authorization: `Bearer ${token}` }
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store, no-cache, must-revalidate')
    expect(response.headers.pragma).toBe('no-cache')
    expect(response.json().data.models[0].id).toBe('hosted-model')
  })

  it('creates official model chat for authenticated user', async () => {
    const token = app.jwt.sign({ userId: 'user_1', uuid: 'uuid_1', role: 'USER' })
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/official/chat',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        modelId: 'hosted-model',
        messages: [{ role: 'user', content: '你好' }],
        stream: false
      }
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data.content).toBe('自托管模型回复')
    expect(mockOfficialCreateChat).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user_1',
        modelId: 'hosted-model',
        messages: [{ role: 'user', content: '你好' }],
        stream: false,
        signal: expect.any(AbortSignal)
      })
    )
  })

  it.each(['/api/v1/billing/subscription', '/api/v1/payment/sessions'])(
    'does not expose removed billing route %s',
    async url => {
      const response = await app.inject({ method: 'GET', url })
      expect(response.statusCode).toBe(404)
    }
  )
})
