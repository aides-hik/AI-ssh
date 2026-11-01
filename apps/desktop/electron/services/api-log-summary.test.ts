import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { summarizeApiPayload, summarizeApiUrl, summarizeApiError } from './api-log-summary'

test('diagnostics omit nested credentials, request text and URL authentication without mutating input', () => {
  const input = { password: 'password-fixture', refresh_token: 'refresh-fixture', nested: {
    privateKey: 'private-key-fixture', headers: { 'X-Custom': 'header-fixture' },
    messages: [{ content: 'terminal-output-fixture' }], unknownString: 'unclassified-secret', success: true
  } }
  const before = JSON.stringify(input)
  const output = JSON.stringify(summarizeApiPayload(input))
  for (const secret of ['password-fixture', 'refresh-fixture', 'private-key-fixture', 'header-fixture', 'terminal-output-fixture', 'unclassified-secret']) {
    assert.equal(output.includes(secret), false)
  }
  assert.equal(JSON.stringify(input), before)
  assert.equal(summarizeApiUrl('https://user:password@example.test/private-token?key=query-secret#fragment'), 'https://example.test/[path omitted]')
  const cyclic: { self?: unknown } = {}
  cyclic.self = cyclic
  assert.doesNotThrow(() => JSON.stringify(summarizeApiPayload(cyclic)))
})

test('diagnostics do not echo dynamic dictionary keys or custom error names', () => {
  const key = 'dictionary-key-secret-fixture'
  const output = JSON.stringify(summarizeApiPayload({ data: { [key]: { success: true } } }))
  assert.equal(output.includes(key), false, 'An object key can itself contain request or response content')
  const error = new Error('private-message-fixture')
  error.name = 'custom-name-secret-fixture'
  assert.equal(summarizeApiError(error), 'Error')
  assert.equal(summarizeApiError(new TypeError('private-message-fixture')), 'TypeError')
  let reads = 0
  const withGetter = { get data() { reads++; throw new Error('getter-secret-fixture') } }
  assert.doesNotThrow(() => JSON.stringify(summarizeApiPayload(withGetter)))
  assert.equal(reads, 0, 'Logging must not execute accessors')
})

test('real API login, register, refresh and error handlers never log password or token content', async () => {
  const source = await readFile(new URL('../ipc/api-handlers.ts', import.meta.url), 'utf8')
  const javascript = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
  const logs: unknown[][] = []
  let fail = false
  const dependencies: Record<string, unknown> = {
    electron: { app: { isPackaged: true }, ipcMain: { handle: (key: string, handler: (...args: unknown[]) => Promise<unknown>) => handlers.set(key, handler) } },
    'node-fetch': async () => {
      if (fail) {
        const error = new Error('request failed: https://user:password-fixture@example.test/?key=query-fixture')
        error.name = 'custom-name-secret-fixture'
        throw error
      }
      return { status: 200, json: async () => ({ success: true, data: { accessToken: 'access-fixture', refreshToken: 'refresh-fixture' } }) }
    },
    '../../src/config/api-environment': { getApiBaseUrlByMode: () => 'https://example.test/api/v1' },
    '../services/api-log-summary': { summarizeApiPayload, summarizeApiUrl, summarizeApiError }
  }
  new Function('require', 'exports', 'console', javascript)(
    (name: string) => { assert(name in dependencies); return dependencies[name] }, {},
    { log: (...args: unknown[]) => logs.push(args), error: (...args: unknown[]) => logs.push(args) }
  )
  await handlers.get('api:auth:login')!({}, { email: 'fixture@example.test', password: 'password-fixture' })
  await handlers.get('api:auth:register')!({}, { email: 'fixture@example.test', username: 'fixture', password: 'password-fixture' })
  await handlers.get('api:auth:refresh')!({}, 'refresh-fixture')
  await handlers.get('api:auth:verify')!({}, 'access-fixture')
  await handlers.get('api:request')!({}, { endpoint: '/secret-path?key=query-fixture', method: 'POST', data: { arbitrary: 'body-fixture', headers: { 'X-Custom': 'header-fixture' } } })
  await handlers.get('api:request')!({}, { endpoint: '/test', method: 'method-secret-fixture', data: { 'dictionary-key-secret-fixture': true } })
  fail = true
  await handlers.get('api:auth:login')!({}, { email: 'fixture@example.test', password: 'password-fixture' })
  const output = JSON.stringify(logs)
  for (const secret of ['password-fixture', 'refresh-fixture', 'access-fixture', 'query-fixture', 'body-fixture', 'header-fixture', 'secret-path', 'method-secret-fixture', 'dictionary-key-secret-fixture', 'custom-name-secret-fixture']) {
    assert.equal(output.includes(secret), false, `Diagnostic output leaked ${secret}`)
  }
  assert(output.includes('request failed'))
  assert(output.includes('request success'))
})
