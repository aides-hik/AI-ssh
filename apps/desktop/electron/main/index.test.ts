import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const currentDir = dirname(fileURLToPath(import.meta.url))
const mainPath = join(currentDir, 'index.ts')

test('main window is created only after StorageManager is initialized', async () => {
  const source = await readFile(mainPath, 'utf8')
  const readyHandler = source.match(/app\.whenReady\(\)\.then\(async \(\) => \{[\s\S]*?\n {4}\}\)/)?.[0]

  assert.ok(readyHandler, 'expected async app ready handler')
  const initializeIndex = readyHandler.indexOf('initializeStorageManager(storageManager)')
  const windowIndex = readyHandler.indexOf('this.createWindow()')

  assert.ok(initializeIndex >= 0, 'expected StorageManager initialization')
  assert.ok(windowIndex > initializeIndex, 'window must be created after storage initialization')
})

test('renderer receives IPC events before the first paint', async () => {
  const source = await readFile(mainPath, 'utf8')
  const createWindow = source.slice(source.indexOf('private createWindow(): void {'))
  const registerIndex = createWindow.indexOf('windowEvents.setMainWindow(this.mainWindow)')
  const paintIndex = createWindow.indexOf("this.mainWindow.on('ready-to-show'")
  const loadIndex = createWindow.indexOf('this.mainWindow.loadURL(')

  assert.ok(registerIndex >= 0, 'expected event destination registration')
  assert.ok(registerIndex < paintIndex, 'SSH output must not wait for ready-to-show')
  assert.ok(registerIndex < loadIndex, 'register IPC destination before loading the renderer')
})
