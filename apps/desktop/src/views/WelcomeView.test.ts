import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const currentDir = dirname(fileURLToPath(import.meta.url))
const welcomeViewPath = join(currentDir, 'WelcomeView.vue')

test('welcome view does not render the quick start section', async () => {
  const source = await readFile(welcomeViewPath, 'utf8')

  assert.doesNotMatch(source, /welcome\.quickStartTitle/)
  assert.doesNotMatch(source, /welcome\.quickStartDesc/)
  assert.doesNotMatch(source, /openSSHConnections/)
})
