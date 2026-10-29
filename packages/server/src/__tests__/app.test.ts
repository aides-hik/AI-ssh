import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'

vi.mock('dotenv', () => ({ config: vi.fn() }))

const fixture = vi.hoisted(() => ({
  user: { id: 'user_1', uuid: 'uuid_1', username: 'tester', email: 'user@example.test',
    role: 'USER', isActive: true, avatar: null, createdAt: new Date(), updatedAt: new Date() },
  sessions: new Map<string, { id: string; userId: string; expiresAt: Date; revokedAt: Date | null }>(),
  redisHealthy: true,
  databaseUnavailable: false
}))

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
      findUserByEmail: vi.fn(async () => fixture.user),
      validatePassword: vi.fn().mockResolvedValue(true),
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
      $queryRaw: vi.fn().mockResolvedValue(1),
      authSession: {
        create: vi.fn(async ({ data }) => {
          const session = { id: `session_${fixture.sessions.size}`, ...data, revokedAt: null }
          fixture.sessions.set(session.id, session)
          return session
        }),
        findFirst: vi.fn(async ({ where }) => {
          if (fixture.databaseUnavailable) throw new Error('Database unavailable')
          const session = fixture.sessions.get(where.id)
          return session && session.userId === where.userId && !session.revokedAt &&
            session.expiresAt > where.expiresAt.gt && fixture.user.isActive
            ? { user: { ...fixture.user } } : null
        }),
        updateMany: vi.fn(async ({ where, data }) => {
          if (fixture.databaseUnavailable) throw new Error('Database unavailable')
          const session = fixture.sessions.get(where.id)
          if (!session || session.userId !== where.userId || session.revokedAt) return { count: 0 }
          session.revokedAt = data.revokedAt
          return { count: 1 }
        })
      }
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
    healthCheck: vi.fn(async () => fixture.redisHealthy)
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

  beforeEach(() => {
    fixture.sessions.clear()
    fixture.user.isActive = true
    fixture.user.username = 'tester'
    fixture.user.role = 'USER'
    fixture.redisHealthy = true
    fixture.databaseUnavailable = false
    vi.clearAllMocks()
  })

  async function login() {
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login',
      payload: { email: 'user@example.test', password: 'fixture123' } })
    expect(response.statusCode).toBe(200)
    return response.json().data as { accessToken: string; refreshToken: string }
  }

  it('serves health endpoint', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health'
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().status).toBe('healthy')
  })

  it('reports HTTP 503 and an unhealthy aggregate when Redis is unavailable', async () => {
    fixture.redisHealthy = false
    const response = await app.inject({ method: 'GET', url: '/health' })
    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({ status: 'unhealthy', services: { database: 'healthy', redis: 'unhealthy' } })
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
    const { accessToken: token } = await login()
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/verify',
      headers: { authorization: `Bearer ${token}` }
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data.user).toEqual({ id: 'user_1', username: 'tester', role: 'USER' })
  })

  it('rejects refresh tokens at protected endpoints and access tokens at refresh', async () => {
    const { accessToken, refreshToken } = await login()
    const protectedResponse = await app.inject({ method: 'GET', url: '/api/v1/auth/verify',
      headers: { authorization: `Bearer ${refreshToken}` } })
    expect(protectedResponse.statusCode).toBe(401)
    const refreshResponse = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh',
      payload: { refreshToken: accessToken } })
    expect(refreshResponse.statusCode).toBe(401)
    const legacyToken = app.jwt.sign({ userId: fixture.user.id, role: 'ADMIN' })
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/verify',
      headers: { authorization: `Bearer ${legacyToken}` } })).statusCode).toBe(401)
  })

  it('refreshes current account claims and rejects disabled or expired sessions', async () => {
    const { refreshToken } = await login()
    fixture.user.username = 'updated'
    fixture.user.role = 'ADMIN'
    const refresh = () => app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken } })
    const response = await refresh()
    expect(response.statusCode).toBe(200)
    expect(app.jwt.verify(response.json().data.accessToken)).toMatchObject({ type: 'access',
      userId: fixture.user.id, uuid: fixture.user.uuid, email: fixture.user.email, username: 'updated', role: 'ADMIN' })
    const verify = () => app.inject({ method: 'GET', url: '/api/v1/auth/verify',
      headers: { authorization: `Bearer ${response.json().data.accessToken}` } })
    expect((await verify()).json().data.user).toMatchObject({ username: 'updated', role: 'ADMIN' })
    fixture.user.isActive = false
    expect((await refresh()).statusCode).toBe(401)
    expect((await verify()).statusCode).toBe(401)
    fixture.user.isActive = true
    fixture.sessions.values().next().value!.expiresAt = new Date(0)
    expect((await refresh()).statusCode).toBe(401)
    expect((await verify()).statusCode).toBe(401)
  })

  it('fails closed instead of trusting a signed token when session storage is unavailable', async () => {
    const { accessToken, refreshToken } = await login()
    fixture.databaseUnavailable = true
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/verify',
      headers: { authorization: `Bearer ${accessToken}` } })).statusCode).toBe(503)
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/refresh',
      payload: { refreshToken } })).statusCode).toBe(401)
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/logout',
      headers: { authorization: `Bearer ${accessToken}` } })).statusCode).toBe(503)
  })

  it('logout revokes both token types for that session while another device remains signed in', async () => {
    const first = await login()
    const second = await login()
    const verify = (token: string) => app.inject({ method: 'GET', url: '/api/v1/auth/verify',
      headers: { authorization: `Bearer ${token}` } })
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/logout',
      headers: { authorization: `Bearer ${first.accessToken}` } })).statusCode).toBe(200)
    expect((await verify(first.accessToken)).statusCode).toBe(401)
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/refresh',
      payload: { refreshToken: first.refreshToken } })).statusCode).toBe(401)
    expect((await verify(second.accessToken)).statusCode).toBe(200)
  })

  it('rejects expired JWTs, unknown sessions and mismatched session ownership', async () => {
    const { accessToken } = await login()
    const claims = app.jwt.verify(accessToken) as Record<string, unknown>
    for (const token of [
      app.jwt.sign({ type: 'access', userId: fixture.user.id, sessionId: 'missing' }),
      app.jwt.sign({ type: 'access', userId: 'another_user', sessionId: claims.sessionId }),
      app.jwt.sign({ type: 'access', userId: fixture.user.id, sessionId: claims.sessionId }, { expiresIn: -1 })
    ]) {
      expect((await app.inject({ method: 'GET', url: '/api/v1/auth/verify',
        headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(401)
    }
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
    const { accessToken: token } = await login()
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
    const { accessToken: token } = await login()
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
