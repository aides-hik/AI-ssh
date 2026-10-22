import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('dotenv', () => ({ config: vi.fn() }))

describe('self-hosted AI configuration', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('DATABASE_URL', 'postgresql://user:pass@localhost:5432/test')
    vi.stubEnv('JWT_SECRET', '12345678901234567890123456789012')
    vi.stubEnv('ENCRYPTION_KEY', '12345678901234567890123456789012')
    vi.stubEnv('SESSION_SECRET', '12345678901234567890123456789012')
    for (const key of ['OFFICIAL_AI_ENABLED', 'OFFICIAL_AI_BASE_URL', 'OFFICIAL_AI_API_KEY', 'OFFICIAL_AI_MODELS', 'OFFICIAL_AI_DAILY_LIMIT']) {
      vi.stubEnv(key, '')
      delete process.env[key]
    }
  })

  afterEach(() => vi.unstubAllEnvs())

  it('has no default upstream, models or enabled service', async () => {
    const { config } = await import('./app.config.js')
    expect(config.officialAi.enabled).toBe(false)
    expect(config.officialAi.baseUrl).toBe('')
    expect(config.officialAi.models).toEqual([])
    expect(config.officialAi.dailyLimit).toBe(0)
  })

  it('requires an explicit endpoint and models before enabling requests', async () => {
    vi.stubEnv('OFFICIAL_AI_ENABLED', 'true')
    vi.stubEnv('OFFICIAL_AI_BASE_URL', 'http://127.0.0.1:11434/v1')
    const { config } = await import('./app.config.js')
    expect(config.officialAi.enabled).toBe(false)
  })

  it('supports a deployment-provided upstream and model list', async () => {
    vi.stubEnv('OFFICIAL_AI_ENABLED', 'true')
    vi.stubEnv('OFFICIAL_AI_BASE_URL', 'http://127.0.0.1:11434/v1')
    vi.stubEnv('OFFICIAL_AI_MODELS', ' local-model, second-model, local-model, ')
    const { config } = await import('./app.config.js')
    expect(config.officialAi.enabled).toBe(true)
    expect(config.officialAi.baseUrl).toBe('http://127.0.0.1:11434/v1')
    expect(config.officialAi.models).toEqual(['local-model', 'second-model'])
  })
})
