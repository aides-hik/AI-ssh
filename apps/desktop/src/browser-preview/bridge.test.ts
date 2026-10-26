import assert from 'node:assert/strict'
import test from 'node:test'
import { createBrowserPreviewBridge, type PreviewExecuteOutput } from './bridge'
import type { UpdateClientState } from '../services/update-client'

test('browser preview update checks are explicitly simulated, share in-flight work and notify subscribers', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const preview = createBrowserPreviewBridge(0)
  const states: UpdateClientState[] = []
  const unsubscribe = preview.onUpdaterStateChange(state => states.push(state))
  const initial = await preview.updater.getState()
  initial.enabled = false
  assert.equal((await preview.updater.getState()).enabled, true)
  const first = preview.updater.startBackgroundCheck()
  assert.equal(preview.updater.startBackgroundCheck(), first)
  assert.equal(states[0].status, 'checking')
  assert.match(states[0].statusText || '', /网页预览.*模拟/)
  context.mock.timers.tick(1200)
  const completed = await first
  assert.equal(completed.status, 'up-to-date')
  assert.match(completed.statusText || '', /桌面应用.*真实更新/)
  assert.ok(completed.lastCheckedAt)
  assert.equal(states.length, 2)
  unsubscribe()
  const next = preview.updater.startBackgroundCheck()
  context.mock.timers.tick(1200)
  await next
  assert.equal(states.length, 2)
  assert.equal(await preview.updater.installDownloadedUpdate(), false)
})

test('browser preview seeds an editable demo without storing real connections', async () => {
  const preview = createBrowserPreviewBridge(0)
  const nodes = await preview.ssh.getTree()
  assert.equal(nodes[0].id, 'preview-server')
  assert.deepEqual(nodes.map(node => node.id), ['preview-server', 'preview-web-02', 'preview-db-01'])
  nodes[0].name = 'changed snapshot'
  assert.equal((await preview.ssh.getTree())[0].name, '演示服务器 · UI 测试')
  const folder = await preview.ssh.createFolder('local-user', { name: 'Test folder' })
  await preview.ssh.createConnection('local-user', { name: 'Test connection', folderId: folder.id })
  assert.equal((await preview.ssh.getTree()).find(node => node.id === folder.id)?.children?.[0].name, 'Test connection')
  await preview.ssh.deleteFolder('local-user', folder.id)
  assert.equal((await preview.ssh.getTree()).length, 3)
  assert.equal((await createBrowserPreviewBridge(0).ssh.getTree()).length, 3)
})

test('preview connects and disconnects through the same runtime snapshot and events as Electron', async () => {
  const preview = createBrowserPreviewBridge(0, 0)
  const events: unknown[] = []
  const unsubscribe = preview.onConnectionStatusChange(event => events.push(event))
  assert.deepEqual(await preview.ssh.getConnections(), [])
  const connection = await preview.ssh.connect({
    id: 'preview-server',
    host: 'demo.prism.local',
    username: 'demo',
    port: 22
  })
  assert.equal(connection.status, 'connected')
  assert.equal((await preview.ssh.getConnections())[0].isConnected, true)
  assert.match(await preview.ssh.getInitialOutput(connection.id), /UI 演示终端/)
  await preview.ssh.disconnect(connection.id)
  assert.equal((await preview.ssh.getConnections())[0].isConnected, false)
  assert.deepEqual(events.map(event => ({ id: (event as { id: string }).id, status: (event as { status: string }).status })), [
    { id: connection.id, status: 'connected' },
    { id: connection.id, status: 'disconnected' }
  ])
  assert.equal((events[0] as { host: string }).host, 'demo.prism.local')
  assert.equal((events[0] as { name: string }).name, '演示服务器 · UI 测试')
  unsubscribe()
  await preview.ssh.connect(connection)
  assert.equal(events.length, 2)
})

test('demo terminal and files are simulated and reject access after disconnect', async () => {
  const preview = createBrowserPreviewBridge(0, 0)
  const { id } = await preview.ssh.connect({
    id: 'preview-server',
    host: 'demo.prism.local',
    username: 'demo',
    port: 22
  })
  let output = ''
  preview.on(`ssh:output:${id}`, chunk => {
    output += String(chunk)
  })
  await preview.ssh.write(id, 'pwz\x7fd\r')
  assert.match(output, /\/home\/demo/)
  const result = await preview.ssh.execute(id, 'touch actual-file')
  assert.match(result.output, /不会执行真实命令/)
  const files = await preview.ssh.listFiles(id, '/home/demo')
  assert.equal(
    files.files.some(file => file.name === 'README.md'),
    true
  )
  await preview.ssh.disconnect(id)
  await assert.rejects(preview.ssh.listFiles(id, '/home/demo'), /已断开/)
})

test('preview multi-host commands run independently and cancelling one does not stop the others', async () => {
  const preview = createBrowserPreviewBridge(0, 30)
  const nodes = await preview.ssh.getTree()
  for (const node of nodes) {
    assert.ok(node.host)
    await preview.ssh.connect({ id: node.id, host: node.host, name: node.name, username: 'demo', port: 22 })
  }
  assert.equal((await preview.ssh.getConnections()).filter(connection => connection.isConnected).length, 3)
  const command = "printf '\n--- PRISM_INSPECT_SYSTEM ---\n'; uname -a; printf '\n--- PRISM_INSPECT_DISK ---\n'; df -h"
  const first = preview.ssh.execute('preview-server', command, 'request-app')
  const second = preview.ssh.execute('preview-web-02', command, 'request-web')
  const third = preview.ssh.execute('preview-db-01', command, 'request-db')
  const secondOutcome = second.then(() => 'unexpected success', error => error.name)
  assert.equal(preview.preview.pendingCommands().length, 3)
  assert.equal(await preview.ssh.cancelExecute('request-web'), true)
  assert.equal(await secondOutcome, 'AbortError')
  const [app, database] = await Promise.all([first, third])
  assert.equal(app.success, true)
  assert.equal(database.success, true)
  assert.match(app.output, /prism-demo/)
  assert.match(database.output, /prism-db-01/)
  assert.match(database.output, /88%/)
  assert.equal(preview.preview.pendingCommands().length, 0)
  assert.equal(await preview.ssh.cancelExecute('request-web'), false)
})

test('preview disconnection only cancels that host and fixtures can simulate a command failure', async () => {
  const preview = createBrowserPreviewBridge(0, 20)
  for (const node of (await preview.ssh.getTree()).slice(0, 2)) {
    assert.ok(node.host)
    await preview.ssh.connect({ id: node.id, host: node.host, username: 'demo', port: 22 })
  }
  const disconnected = preview.ssh.execute('preview-server', 'hostname', 'disconnect-me').catch(error => error.message)
  preview.preview.setCommandFailure('preview-web-02', '模拟服务查询失败')
  const failed = preview.ssh.execute('preview-web-02', 'hostname', 'fail-me')
  await preview.ssh.disconnect('preview-server')
  assert.match(await disconnected, /已断开/)
  const result = await failed
  assert.equal(result.success, false)
  assert.equal(result.exitCode, 1)
  assert.equal(result.stderr, '模拟服务查询失败')
  preview.preview.setCommandFailure('preview-web-02', null)
  assert.match((await preview.ssh.execute('preview-web-02', 'hostname')).output, /prism-web-02/)
})

test('preview terminal input, file edits and environment documents stay scoped to the selected host', async () => {
  const preview = createBrowserPreviewBridge(0, 0)
  for (const node of (await preview.ssh.getTree()).slice(0, 2)) {
    assert.ok(node.host)
    await preview.ssh.connect({ id: node.id, host: node.host, username: 'demo', port: 22 })
  }
  const output: Record<string, string> = { 'preview-server': '', 'preview-web-02': '' }
  for (const id of Object.keys(output)) preview.on(`ssh:output:${id}`, text => { output[id] += String(text) })
  await preview.ssh.write('preview-server', 'host')
  await preview.ssh.write('preview-web-02', 'whoami\r')
  await preview.ssh.write('preview-server', 'name\r')
  assert.match(output['preview-server'], /prism-demo/)
  assert.doesNotMatch(output['preview-web-02'], /prism-demo/)
  await preview.ssh.deleteFile('preview-server', '/home/demo/README.md')
  assert.equal((await preview.ssh.listFiles('preview-server', '/home/demo')).files.some(file => file.name === 'README.md'), false)
  assert.equal((await preview.ssh.listFiles('preview-web-02', '/home/demo')).files.some(file => file.name === 'README.md'), true)
  await preview.ssh.writeEnvDoc('preview-server', '# Host one only')
  assert.equal((await preview.ssh.readEnvDoc('preview-server')).content, '# Host one only')
  assert.match((await preview.ssh.readEnvDoc('preview-web-02')).content, /web-02\.prism\.local/)
})

test('Compose preview simulates per-host startup and health output and preserves failure and stop behavior', async () => {
  const preview = createBrowserPreviewBridge(0, 0)
  for (const node of (await preview.ssh.getTree()).slice(0, 2)) {
    assert.ok(node.host)
    await preview.ssh.connect({ id: node.id, host: node.host, username: 'demo', port: 22 })
  }
  const command = 'mkdir -p /home/demo/projects/prism-demo\ncd /home/demo/projects/prism-demo\ndocker compose pull\ndocker compose up -d'
  const app = await preview.ssh.execute('preview-server', command)
  const web = await preview.ssh.execute('preview-web-02', command)
  assert.match(app.output, /prism-demo/)
  assert.match(web.output, /prism-web-02/)
  assert.match(app.output, /未执行真实命令/)
  assert.match((await preview.ssh.execute('preview-server', 'docker compose ps --all')).output, /healthy/)
  const health = await preview.ssh.execute('preview-server', 'docker compose ps --all\ncurl --fail --silent --show-error --max-time 15 http://127.0.0.1:8080/health')
  assert.equal(health.exitCode, 0)
  assert.match(health.output, /"status":"ok"/)
  assert.match((await preview.ssh.execute('preview-server', 'docker --version')).output, /UI preview/)
  preview.preview.setCommandFailure('preview-web-02', '模拟镜像拉取失败')
  const failed = await preview.ssh.execute('preview-web-02', command)
  assert.equal(failed.success, false)
  assert.equal(failed.exitCode, 1)
  assert.match(failed.error || '', /镜像拉取失败/)
  preview.preview.setExecuteDelay('preview-server', 1000)
  const stopped = preview.ssh.execute('preview-server', command, 'stop-compose').catch(error => error.name)
  assert.equal(await preview.ssh.cancelExecute('stop-compose'), true)
  assert.equal(await stopped, 'AbortError')
})

test('preview streams Compose progress before completion and final stdout matches the emitted chunks', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const preview = createBrowserPreviewBridge(0, 1200)
  await preview.ssh.connect({ id: 'preview-server', host: 'demo.prism.local', username: 'demo', port: 22 })
  const events: PreviewExecuteOutput[] = []
  const off = preview.ssh.onExecuteOutput(event => events.push(event))
  let complete = false
  const pending = preview.ssh.execute('preview-server', 'docker compose pull\ndocker compose up -d', 'stream-compose', { timeoutMs: 60000 })
  void pending.then(() => { complete = true })
  assert.equal(events.length, 0)
  context.mock.timers.tick(500)
  assert.equal(complete, false)
  assert.ok(events.length > 0)
  assert.match(events.map(event => event.data).join(''), /拉取镜像/)
  assert.ok(events.every(event => event.requestId === 'stream-compose' && event.connectionId === 'preview-server' && event.stream === 'stdout'))
  context.mock.timers.tick(700)
  const result = await pending
  assert.equal(result.success, true)
  assert.equal(events.map(event => event.data).join(''), result.stdout)
  assert.equal(result.stdout.includes('\ufffd'), false)
  const count = events.length
  off()
  const later = preview.ssh.execute('preview-server', 'docker version', 'later')
  context.mock.timers.tick(1200)
  await later
  assert.equal(events.length, count)
})

test('preview live events keep concurrent hosts separate and cancellation clears all later chunks', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const preview = createBrowserPreviewBridge(0, 1200)
  for (const node of (await preview.ssh.getTree()).slice(0, 2)) {
    assert.ok(node.host)
    await preview.ssh.connect({ id: node.id, host: node.host, username: 'demo', port: 22 })
  }
  const events: PreviewExecuteOutput[] = []
  preview.ssh.onExecuteOutput(event => events.push(event))
  const first = preview.ssh.execute('preview-server', 'docker compose up -d', 'live-a').catch(error => error.name)
  const second = preview.ssh.execute('preview-web-02', 'docker compose up -d', 'live-b')
  context.mock.timers.tick(350)
  assert.ok(events.some(event => event.requestId === 'live-a'))
  assert.ok(events.some(event => event.requestId === 'live-b'))
  assert.ok(events.every(event => event.connectionId === (event.requestId === 'live-a' ? 'preview-server' : 'preview-web-02')))
  await preview.ssh.cancelExecute('live-a')
  const cancelledChunks = events.filter(event => event.requestId === 'live-a').length
  context.mock.timers.tick(2000)
  assert.equal(await first, 'AbortError')
  assert.equal((await second).success, true)
  assert.equal(events.filter(event => event.requestId === 'live-a').length, cancelledChunks)
  assert.deepEqual(preview.preview.pendingCommands(), [])
  const beforeInteractive = events.length
  await preview.ssh.write('preview-server', 'docker version\r')
  await preview.ssh.executeSilent('preview-server', 'docker version')
  assert.equal(events.length, beforeInteractive)
})

test('preview disconnection cancels output timers and stderr failures remain in the final result', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const preview = createBrowserPreviewBridge(0, 1200)
  await preview.ssh.connect({ id: 'preview-server', host: 'demo.prism.local', username: 'demo', port: 22 })
  const events: PreviewExecuteOutput[] = []
  preview.ssh.onExecuteOutput(event => events.push(event))
  const pending = preview.ssh.execute('preview-server', 'docker compose up -d', 'disconnect-live').catch(error => error.message)
  context.mock.timers.tick(350)
  await preview.ssh.disconnect('preview-server')
  const count = events.length
  context.mock.timers.tick(2000)
  assert.match(await pending, /已断开/)
  assert.equal(events.length, count)
  await preview.ssh.connect({ id: 'preview-server', host: 'demo.prism.local', username: 'demo', port: 22 })
  preview.preview.setCommandFailure('preview-server', '模拟镜像拉取失败')
  const failed = preview.ssh.execute('preview-server', 'docker compose up -d', 'failed-live')
  context.mock.timers.tick(1200)
  const result = await failed
  const stderr = events.filter(event => event.requestId === 'failed-live' && event.stream === 'stderr').map(event => event.data).join('')
  assert.equal(result.success, false)
  assert.equal(result.exitCode, 1)
  assert.equal(result.stderr, stderr)
  assert.match(stderr, /镜像拉取失败/)
})

test('preview validates timeouts before dispatch and a timed out execution stops emitting output', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const preview = createBrowserPreviewBridge(0, 20000)
  await preview.ssh.connect({ id: 'preview-server', host: 'demo.prism.local', username: 'demo', port: 22 })
  for (const timeoutMs of [0, 9999, 1800001, NaN, Infinity, 15000.5]) {
    await assert.rejects(preview.ssh.execute('preview-server', 'docker version', 'invalid-timeout', { timeoutMs }), /命令超时/)
  }
  assert.deepEqual(preview.preview.pendingCommands(), [])
  const events: PreviewExecuteOutput[] = []
  preview.ssh.onExecuteOutput(event => events.push(event))
  const pending = preview.ssh.execute('preview-server', 'docker compose up -d', 'timeout-live', { timeoutMs: 10000 })
  await assert.rejects(preview.ssh.execute('preview-server', 'hostname', 'timeout-live'), /请求已存在/)
  context.mock.timers.tick(10000)
  const result = await pending
  assert.equal(result.success, false)
  assert.match(result.error || '', /超时/)
  const count = events.length
  context.mock.timers.tick(30000)
  assert.equal(events.length, count)
  assert.deepEqual(preview.preview.pendingCommands(), [])
})
