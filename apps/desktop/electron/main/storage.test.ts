import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const currentDir = dirname(fileURLToPath(import.meta.url))
const storagePath = join(currentDir, 'storage.ts')

test('StorageManager survives Electron main-process module reloads', async () => {
  const source = await readFile(storagePath, 'utf8')

  assert.match(source, /Symbol\.for\('ai-ssh-assistant\.storage-manager'\)/)
  assert.match(source, /\(globalThis as StorageGlobal\)\[storageManagerKey\] = createCredentialStorage\(instance\)/)
  assert.doesNotMatch(source, /\[storageManagerKey\]\s*=\s*instance(?:\s|;|$)/)
  assert.match(source, /const storageManagerInstance = \(globalThis as StorageGlobal\)\[storageManagerKey\]/)
  assert.doesNotMatch(source, /let storageManagerInstance/)
})

test('reloaded main storage exposes only the protected manager through its getter and proxy', async () => {
  const source = await readFile(storagePath, 'utf8')
  const javascript = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText
  const slot = Symbol.for('ai-ssh-assistant.storage-manager')
  const previous = Reflect.get(globalThis, slot)
  let protectedCalls = 0
  const raw = { create: async () => ({ leakedRawBackend: true }) }
  const protectedManager = { create: async () => { protectedCalls++; return { protected: true } } }
  type StorageModule = {
    initializeStorageManager(instance: unknown): void
    getStorageManager(): unknown
    storageManager: { create(): Promise<unknown> }
  }
  function loadModule(): StorageModule {
    const exports = {}
    new Function('require', 'exports', javascript)((name: string) => {
      assert.equal(name, '../services/credential-storage')
      return { createCredentialStorage(instance: unknown) { assert.equal(instance, raw); return protectedManager } }
    }, exports)
    return exports as StorageModule
  }
  try {
    Reflect.deleteProperty(globalThis, slot)
    const first = loadModule()
    first.initializeStorageManager(raw)
    assert.equal(first.getStorageManager(), protectedManager)
    assert.notEqual(first.getStorageManager(), raw)
    const reloaded = loadModule()
    assert.equal(reloaded.getStorageManager(), protectedManager)
    assert.deepEqual(await first.storageManager.create(), { protected: true })
    assert.deepEqual(await reloaded.storageManager.create(), { protected: true })
    assert.equal(protectedCalls, 2)
  } finally {
    if (previous === undefined) Reflect.deleteProperty(globalThis, slot)
    else Reflect.set(globalThis, slot, previous)
  }
})
