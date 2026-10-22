import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const currentDir = dirname(fileURLToPath(import.meta.url))
const appTitleBarPath = join(currentDir, 'AppTitleBar.vue')

test('about menu action opens a new tab instead of replacing the current route', async () => {
  const source = await readFile(appTitleBarPath, 'utf8')
  const match = source.match(/case 'show-about':[\s\S]*?break/)

  assert.ok(match, 'expected show-about menu action to exist')

  const aboutCase = match[0]
  assert.match(aboutCase, /openNewTab\(/)
  assert.doesNotMatch(aboutCase, /router\.push\('\/about'\)/)
})

test('file menu owns connection import and export actions', async () => {
  const source = await readFile(appTitleBarPath, 'utf8')

  assert.match(source, /id: 'file'.*titlebar\.menuFile/)
  assert.match(source, /case 'import-connections':/)
  assert.match(source, /sshService\.importConnections\(\)/)
  assert.match(source, /ssh-connections-imported/)
  assert.match(source, /case 'export-connections':/)
  assert.match(source, /sshService\.exportConnections\(\)/)
})
