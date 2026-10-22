import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const currentDir = dirname(fileURLToPath(import.meta.url))
const apiServicePath = join(currentDir, 'api.service.ts')

test('api service does not expose subscription or payment business methods', async () => {
  const source = await readFile(apiServicePath, 'utf8')

  assert.doesNotMatch(source, /getSubscription|createPaymentSession|activateSubscription/)
  assert.doesNotMatch(source, /\/billing\/|\/payment\//)
})

test('api service preserves backend error codes', async () => {
  const source = await readFile(apiServicePath, 'utf8')

  assert.match(source, /error\.code = data\.code/)
  assert.match(source, /error\.status = response\.status/)
})

test('api service clears both access and refresh tokens on logout cleanup', async () => {
  const source = await readFile(apiServicePath, 'utf8')

  assert.match(source, /localStorage\.removeItem\('refreshToken'\)/)
  assert.match(source, /sessionStorage\.removeItem\('refreshToken'\)/)
})

test('api service clears stale login state and notifies the UI after a 401 response', async () => {
  const source = await readFile(apiServicePath, 'utf8')

  assert.match(source, /if \(response\.status === 401\)/)
  assert.match(source, /this\.clearToken\(\)/)
  assert.match(source, /new CustomEvent\('auth-state-changed'/)
  assert.match(source, /detail: \{ user: null, token: null \}/)
})

test('api service logs token preview for request lifecycle debugging', async () => {
  const source = await readFile(apiServicePath, 'utf8')

  assert.match(source, /\[api\] loadToken/)
  assert.match(source, /\[api\] setToken/)
  assert.match(source, /\[api\] request start/)
  assert.match(source, /\[api\] request failed response/)
  assert.match(source, /tokenPreview: this\.token\?\.slice\(0, 16\)/)
})
