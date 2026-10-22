import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const currentDir = dirname(fileURLToPath(import.meta.url))
const llmPath = join(currentDir, 'llm.ts')

test('llm session aborts fetch and a blocked stream reader with one signal', async () => {
  const source = await readFile(llmPath, 'utf8')

  assert.doesNotMatch(source, /const controller = new AbortController\(\)/)
  assert.match(source, /signal\?\.addEventListener\('abort', cancelReader, \{ once: true \}\)/)
  assert.match(source, /reader\.cancel\(createAbortError\(\)\)/)
  assert.match(source, /if \(signal\?\.aborted\) throw createAbortError\(\)/)
})
