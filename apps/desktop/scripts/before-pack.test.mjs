import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

const hookDirectory = fileURLToPath(new URL('../build-scripts/', import.meta.url))
const releaseDirectory = path.resolve(hookDirectory, '../release')

async function loadHook() {
  const removals = []
  const module = { exports: {} }
  const source = await readFile(path.join(hookDirectory, 'before-pack.js'), 'utf8')
  runInNewContext(source, {
    __dirname: hookDirectory,
    module,
    console: { log() {}, error() {} },
    require(name) {
      if (name === 'path') return path
      if (name === 'fs') return {
        existsSync: () => true,
        rmSync: (directory) => removals.push(directory)
      }
      throw new Error(`Unexpected dependency: ${name}`)
    }
  })
  return { hook: module.exports, removals }
}

test('before-pack cleans only an application output below the desktop release directory', async () => {
  const { hook, removals } = await loadHook()
  const output = path.join(releaseDirectory, '1.0.0', 'win-unpacked')
  await hook({ electronPlatformName: 'win32', appOutDir: output })
  assert.deepEqual(removals, [output])
})

test('before-pack rejects the release root and paths outside it before removing anything', async () => {
  const { hook, removals } = await loadHook()
  for (const output of [releaseDirectory, path.dirname(releaseDirectory), `${releaseDirectory}-other`]) {
    await assert.rejects(hook({ electronPlatformName: 'win32', appOutDir: output }), /Refusing to clean/)
  }
  assert.deepEqual(removals, [])
})
