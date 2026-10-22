import assert from 'node:assert/strict'
import test from 'node:test'
import { chatService } from './chat.service.ts'

test('session updates enforce the context range and preserve other settings', async () => {
  const values = new Map<string, string>()
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value)
    }
  })
  try {
    await chatService.updateSession('boundary', {
      title: '中文会话', config: { contextWindow: 0, enableStreaming: false, custom: 'retained' }
    })
    const first = await chatService.getSession('boundary')
    assert.equal(first?.config?.contextWindow, 1)
    assert.equal(first?.config?.enableStreaming, false)
    assert.equal(first?.title, '中文会话')

    for (const [value, expected] of [[100, 50], [-5, 1], [7.9, 7], ['', 50], ['invalid', 50]] as const) {
      await chatService.updateSession('boundary', { config: { contextWindow: value } })
      const session = await chatService.getSession('boundary')
      assert.equal(session?.config?.contextWindow, expected)
      assert.equal(session?.config?.custom, 'retained')
      assert.equal(session?.config?.enableStreaming, false)
    }
    assert.equal(await chatService.getSession('other').then(session => session?.title), '')
  } finally {
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  }
})
