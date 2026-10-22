import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getApiBaseUrlByMode, getApiOriginByMode } from './api-environment'

const currentDir = dirname(fileURLToPath(import.meta.url))
const filePath = join(currentDir, 'api-environment.ts')

test('api environment defaults to the local backend in every mode', async () => {
  const source = await readFile(filePath, 'utf8')

  assert.match(source, /const DEFAULT_API_ORIGIN = 'http:\/\/127\.0\.0\.1:3000'/)
  assert.match(source, /export function getRendererApiOrigin\(/)
  assert.match(source, /export function getApiOriginByMode\(/)
  assert.match(source, /export function getApiBaseUrlByMode\(/)
})

test('electron API respects an explicit origin in development and production', () => {
  const original = process.env.VITE_API_BASE_URL
  const originalRuntime = process.env.AI_SSH_API_BASE_URL
  try {
    delete process.env.VITE_API_BASE_URL
    delete process.env.AI_SSH_API_BASE_URL
    assert.equal(getApiOriginByMode(false), 'http://127.0.0.1:3000')
    assert.equal(getApiOriginByMode(true), 'http://127.0.0.1:3000')
    process.env.VITE_API_BASE_URL = ' http://127.0.0.1:3001/ '
    assert.equal(getApiOriginByMode(false), 'http://127.0.0.1:3001')
    assert.equal(getApiBaseUrlByMode(false), 'http://127.0.0.1:3001/api/v1')
    assert.equal(getApiOriginByMode(true), 'http://127.0.0.1:3001')
    process.env.AI_SSH_API_BASE_URL = 'https://api.example.test/self-hosted/'
    assert.equal(getApiBaseUrlByMode(true), 'https://api.example.test/self-hosted/api/v1')
  } finally {
    if (original === undefined) delete process.env.VITE_API_BASE_URL
    else process.env.VITE_API_BASE_URL = original
    if (originalRuntime === undefined) delete process.env.AI_SSH_API_BASE_URL
    else process.env.AI_SSH_API_BASE_URL = originalRuntime
  }
})
