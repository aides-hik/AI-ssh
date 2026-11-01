import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import type { UpdateClientState } from './services/update-client'

const currentDir = dirname(fileURLToPath(import.meta.url))
const appViewPath = join(currentDir, 'App.vue')

test('file manager routes use connection-aware keep-alive keys', async () => {
  const source = await readFile(appViewPath, 'utf8')

  assert.match(
    source,
    /if \(route\.path\.startsWith\('\/file-manager'\) && route\.query\.connectionId\) \{/
  )
  assert.doesNotMatch(
    source,
    /const currentPath = route\.query\.path \? `-\$\{route\.query\.path\}` : ''/
  )
  assert.match(source, /return `file-manager-\$\{route\.query\.connectionId\}`/)
})

test('active tab path stays synced with the current route so file manager tabs restore latest directory', async () => {
  const source = await readFile(appViewPath, 'utf8')

  assert.match(source, /const route = useRoute\(\)/)
  assert.match(source, /watch\(\s*\(\) => route\.fullPath,/)
  assert.match(
    source,
    /const routeTabEntry = openTabsList\.value\.find\(tab => isSameTabRoute\(tab\.path, route\.fullPath\)\)/
  )
  assert.match(source, /routeTabEntry\.path = route\.fullPath/)
  assert.match(source, /const isSameTabRoute = \(tabPath: string, currentFullPath: string\) => \{/)
})

async function updaterNotifications() {
  const source = await readFile(appViewPath, 'utf8')
  const script = source.match(/<script setup[^>]*>([\s\S]*?)<\/script>/)?.[1]
  assert(script)
  const parsed = ts.createSourceFile('app.ts', script, ts.ScriptTarget.Latest, true)
  const names = ['installPreparedUpdate', 'handleUpdaterState']
  const functions = names.map(name => {
    const node = parsed.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === name)
    assert(node)
    return node.getText(parsed)
  })
  const javascript = ts.transpileModule(`let updateInstallNotificationId: string | undefined; let notifiedUpdateVersion: string | undefined;\n${functions.join('\n')}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText
  const notices: Array<{ actions: Array<{ handler: () => Promise<void> }> }> = []
  const errors: string[] = []
  const removed: string[] = []
  const notification = { add: (notice: typeof notices[number]) => { notices.push(notice); return `n${notices.length}` },
    remove: (id: string) => removed.push(id), error: (message: string) => errors.push(message) }
  const window = { $notification: notification as typeof notification | undefined }
  let installs = 0
  let failure = false
  const seen = new Set<string>()
  const updater = { state: { value: { enabled: true, status: 'downloaded', currentVersion: '1', availableVersion: '2' } as UpdateClientState },
    installDownloadedUpdate: async () => { installs++; if (failure) throw new Error('launch failed') },
    shouldShowInstallPrompt: (state: UpdateClientState) => {
      if (state.status !== 'downloaded' || !state.availableVersion || seen.has(state.availableVersion)) return false
      seen.add(state.availableVersion); return true
    } }
  const handlers = new Function('updater', 'window', `${javascript}\nreturn { handleUpdaterState }`)(updater, window) as {
    handleUpdaterState: (state: UpdateClientState) => void
  }
  return { ...handlers, updater, window, notification, notices, errors, removed,
    installs: () => installs, fail: () => { failure = true } }
}

test('updater notifications wait for the notification host and dismiss stale install actions', async () => {
  const ui = await updaterNotifications()
  ui.window.$notification = undefined
  ui.handleUpdaterState(ui.updater.state.value)
  ui.window.$notification = ui.notification
  ui.handleUpdaterState(ui.updater.state.value)
  ui.handleUpdaterState(ui.updater.state.value)
  assert.equal(ui.notices.length, 1)
  ui.updater.state.value = { ...ui.updater.state.value, status: 'checking' }
  ui.handleUpdaterState(ui.updater.state.value)
  assert.deepEqual(ui.removed, ['n1'])
  await ui.notices[0].actions[0].handler()
  assert.equal(ui.installs(), 0)
})

test('an install notification handles launcher failures and reports a retry route', async () => {
  const ui = await updaterNotifications()
  ui.handleUpdaterState(ui.updater.state.value)
  ui.fail()
  await assert.doesNotReject(ui.notices[0].actions[0].handler())
  assert.equal(ui.installs(), 1)
  assert.match(ui.errors[0], /launch failed.*设置中重试/)
})
