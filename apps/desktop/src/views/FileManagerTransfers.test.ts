import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

// Run the component's real queue handlers with controlled transfer completion.
async function loadHandlers(names: string[], dependencies: Record<string, any>) {
  const source = await readFile(new URL('./FileManagerView.vue', import.meta.url), 'utf8')
  const script = source.match(/<script[^>]*>([\s\S]*?)<\/script>/)![1]
  const parsed = ts.createSourceFile('file-manager.ts', script, ts.ScriptTarget.Latest, true)
  const declarations = names.map(name => {
    const statement = parsed.statements.find(statement => ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.some(declaration => declaration.name.getText(parsed) === name))
    assert(statement, `Missing actual handler ${name}`)
    return statement.getText(parsed)
  }).join('\n')
  const js = ts.transpileModule(declarations, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS
  } }).outputText
  return new Function(...Object.keys(dependencies), js + `\nreturn {${names.join(',')}}`)(...Object.values(dependencies))
}

function uploadState() {
  const tasks = [{ id: 'z', name: 'z.txt', localPath: 'C:/z.txt', remotePath: '/home/test/z.txt', status: 'pending', cancelled: false },
    { id: 'a', name: 'a.txt', localPath: 'C:/a.txt', remotePath: '/home/test/a.txt', status: 'pending', cancelled: false }]
  const calls: any[] = []
  const alerts: string[] = []
  const errors: any[] = []
  const state = {
    currentConnectionId: { value: 'ssh-one' }, currentPath: { value: '/home/test' },
    uploadTasks: { value: tasks }, console: { error: (...args: any[]) => errors.push(args) },
    startRealProgressTracking: () => ({ stop() {} }),
    normalizeRemotePath: (value: string) => value,
    joinRemotePath: (base: string, relative: string) => `${base}/${relative}`,
    ensureParentDirectories: async () => {}, ensureRemoteDirectoryExists: async () => {},
    loadFiles: async () => {}, invalidateFileListCache() {}, $alert: (message: string) => alerts.push(message),
    window: { electronAPI: { ssh: { uploadFile: async (...args: any[]) => { calls.push(args) } } } }
  }
  return { state, tasks, calls, alerts, errors }
}

test('drag upload sorting preserves each file task and transfer cancellation id', async () => {
  const fixture = uploadState()
  const handlers = await loadHandlers(['uploadDroppedFilesAsync', 'isUploadTaskCancelled', 'updateUploadTaskStatus'], fixture.state)
  await handlers.uploadDroppedFilesAsync({ files: fixture.tasks.map(task => ({ localPath: task.localPath, relativePath: task.name })), directories: new Set() }, fixture.tasks)
  assert.deepEqual(fixture.calls.map(call => [call[1], call[2], call[3]]), [
    ['C:/a.txt', '/home/test/a.txt', 'a'], ['C:/z.txt', '/home/test/z.txt', 'z']
  ])
  assert(fixture.state.uploadTasks.value.every(task => task.status === 'completed'))
})

test('cancelled active and queued uploads stay cancelled and queued files never start', async () => {
  const fixture = uploadState()
  fixture.state.window.electronAPI.ssh.uploadFile = async (...args: any[]) => {
    fixture.calls.push(args)
    fixture.state.uploadTasks.value = fixture.state.uploadTasks.value.map(task => ({ ...task, cancelled: true, status: 'cancelled' }))
    throw new Error('Transfer aborted')
  }
  const handlers = await loadHandlers(['uploadFilesFromDialogAsync', 'isUploadTaskCancelled', 'updateUploadTaskStatus'], fixture.state)
  await handlers.uploadFilesFromDialogAsync(fixture.tasks.map(task => task.localPath), fixture.tasks)
  assert.equal(fixture.calls.length, 1)
  assert(fixture.state.uploadTasks.value.every(task => task.status === 'cancelled'))
  assert.deepEqual(fixture.alerts, [])
  assert.deepEqual(fixture.errors, [])
})

test('drag uploads never recreate ancestors of the current existing directory', async () => {
  const created: string[] = []
  const handlers = await loadHandlers(['normalizeRemotePath', 'getRemoteDirname', 'ensureParentDirectories', 'ensureRemoteDirectoryExists'], {
    currentConnectionId: { value: 'test' },
    window: { electronAPI: { ssh: { createDirectory: async (_id: string, directory: string) => { created.push(directory) } } } }
  })
  await handlers.ensureParentDirectories('/home/test/nested/file.txt', new Set(['/home/test']))
  assert.deepEqual(created, ['/home/test/nested'])
})

test('cancelled active downloads do not retry, complete, or log an unexpected error', async () => {
  const tasks = { value: [{ id: 'download-1', localPath: 'C:/temp/file.txt', remotePath: '/file.txt', name: 'file.txt', status: 'pending', cancelled: false }] }
  let transfers = 0
  let stopped = 0
  const errors: any[] = []
  const dependencies = {
    downloadTasks: tasks, isDownloadCancelled: false, currentConnectionId: { value: 'ssh-one' },
    ensureDirectoryExists: async () => {}, checkAndAutoCleanup() {},
    startRealProgressTracking: () => ({ stop() { stopped++ } }),
    console: { error: (...args: any[]) => errors.push(args), warn() {} },
    window: { electronAPI: { ssh: { downloadFile: async (...args: any[]) => {
      transfers++
      assert.equal(args[3], 'download-1')
      tasks.value = tasks.value.map(task => ({ ...task, cancelled: true, status: 'cancelled' }))
      throw new Error('Transfer aborted')
    } } } }
  }
  const handlers = await loadHandlers(['executeDownloadTask', 'updateTaskStatus'], dependencies)
  await handlers.executeDownloadTask(tasks.value[0])
  assert.equal(transfers, 1)
  assert.equal(stopped, 1)
  assert.equal(tasks.value[0].status, 'cancelled')
  assert.deepEqual(errors, [])
})
