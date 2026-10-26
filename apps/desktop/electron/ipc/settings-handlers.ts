import { ipcMain } from 'electron'
import { getStorageManager } from '../main/storage'
import { readFile, writeFile } from 'node:fs/promises'
import { stripCredentials } from '../../src/utils/credential-fields'

const DEFAULT_SETTINGS = {
  aiProviders: [],
  theme: 'dark',
  language: 'zh-CN',
  appearance: { theme: 'light', fontSize: 14, fontFamily: 'Consolas' },
  editor: { tabSize: 2, wordWrap: true, minimap: true },
  terminal: { fontSize: 14, fontFamily: 'Consolas', cursorStyle: 'block' },
  shortcuts: {},
  storageMode: 'local'
}

let pending: Promise<unknown> = Promise.resolve()
function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const result = pending.then(operation, operation)
  pending = result.catch(() => undefined)
  return result
}

function assertSettings(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('设置文件格式无效，请选择 JSON 设置文件。')
  }
}

async function loadSettings(userId = 'local-user') {
  const row = await getStorageManager().findUnique('UserSettings', { where: { userId } })
  // Decryption errors must propagate: defaults could overwrite locked settings.
  // An empty store must not masquerade as saved preferences during migration.
  return row?.data ?? { aiProviders: [] }
}

async function saveSettings(userId: string, settings: unknown) {
  if (!userId) throw new Error('缺少本地用户信息，请重新打开应用。')
  assertSettings(settings)
  const storage = getStorageManager()
  const existing = await storage.findUnique('UserSettings', { where: { userId } })
  if (existing) await storage.update('UserSettings', { where: { userId }, data: { data: settings } })
  else await storage.create('UserSettings', { userId, data: settings })
  return { success: true }
}

ipcMain.handle('settings:get', (_, userId?: string) => serialized(() => loadSettings(userId)))
ipcMain.handle('settings:save', (_, userId: string, settings: unknown) => serialized(() => saveSettings(userId, settings)))
ipcMain.handle('settings:reset', (_, userId = 'local-user') => serialized(() =>
  saveSettings(userId, { ...structuredClone(DEFAULT_SETTINGS), credentialStorageVersion: 1 })))

ipcMain.handle('settings:export', (_, userId: string, exportPath: string) => serialized(async () => {
  const settings = stripCredentials(await loadSettings(userId))
  await writeFile(exportPath, JSON.stringify(settings, null, 2), { encoding: 'utf8', mode: 0o600 })
  return { success: true }
}))

ipcMain.handle('settings:import', (_, userId: string, importPath: string) => serialized(async () => {
  const contents = await readFile(importPath, 'utf8')
  let settings: unknown
  try { settings = JSON.parse(contents) }
  catch { throw new Error('设置文件不是有效的 JSON，请检查文件后重试。') }
  assertSettings(settings)
  // Legacy exports with credentials are accepted and immediately protected.
  await saveSettings(userId, settings)
  return { success: true, settings: await loadSettings(userId) }
}))
