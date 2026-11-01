import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

// Run the component's real queue handlers with controlled transfer completion.
async function loadHandlers(names: string[], dependencies: Record<string, any>) {
  dependencies = { uploadGeneration: 0, ...dependencies }
  const declarationsToLoad = [...names]
  for (const helper of ['getLocalDirname', 'getLocalBasename', 'joinLocalDownloadPath']) {
    if (!declarationsToLoad.includes(helper) && !(helper in dependencies)) declarationsToLoad.push(helper)
  }
  const source = await readFile(new URL('./FileManagerView.vue', import.meta.url), 'utf8')
  const script = source.match(/<script[^>]*>([\s\S]*?)<\/script>/)![1]
  const parsed = ts.createSourceFile('file-manager.ts', script, ts.ScriptTarget.Latest, true)
  const declarations = declarationsToLoad.map(name => {
    if (name === '$routeWatcher') {
      const statement = parsed.statements.find(statement => ts.isExpressionStatement(statement) &&
        ts.isCallExpression(statement.expression) && statement.expression.expression.getText(parsed) === 'watch')
      assert(statement, 'Missing actual route watcher')
      return statement.getText(parsed)
    }
    const statement = parsed.statements.find(statement => ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.some(declaration => declaration.name.getText(parsed) === name))
    assert(statement, `Missing actual handler ${name}`)
    return statement.getText(parsed)
  }).join('\n')
  const js = ts.transpileModule(declarations, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS
  } }).outputText
  return new Function(...Object.keys(dependencies), js + `\nreturn {${names.filter(name => name !== '$routeWatcher').join(',')}}`)(...Object.values(dependencies))
}

function uploadState() {
  const tasks = [{ id: 'z', connectionId: 'ssh-one', name: 'z.txt', localPath: 'C:/z.txt', remotePath: '/home/test/z.txt', status: 'pending', cancelled: false, progress: 0 },
    { id: 'a', connectionId: 'ssh-one', name: 'a.txt', localPath: 'C:/a.txt', remotePath: '/home/test/a.txt', status: 'pending', cancelled: false, progress: 0 }]
  const calls: any[] = []
  const alerts: string[] = []
  const errors: any[] = []
  const state = {
    currentConnectionId: { value: 'ssh-one' }, currentPath: { value: '/home/test' },
    uploadTasks: { value: tasks }, console: { error: (...args: any[]) => errors.push(args) },
    startRealProgressTracking: () => ({ stop() {} }),
    nativeTransferRequests: new Set<string>(),
    isTransferCancellation: () => false,
    getRemoteDirname: (value: string) => value.slice(0, value.lastIndexOf('/')),
    normalizeRemotePath: (value: string) => value,
    joinRemotePath: (base: string, relative: string) => `${base}/${relative}`,
    ensureParentDirectories: async () => {}, ensureRemoteDirectoryExists: async () => {},
    refreshMutatedDirectory: async () => {}, $alert: (message: string) => alerts.push(message),
    window: { electronAPI: { ssh: {
      uploadFile: async (...args: any[]) => { calls.push(args) },
      createDirectory: async (_id: string, _remotePath: string) => {}
    } } }
  }
  return { state, tasks, calls, alerts, errors, target: { connectionId: 'ssh-one', directory: '/home/test' } }
}

test('drag upload sorting preserves each file task and transfer cancellation id', async () => {
  const fixture = uploadState()
  const handlers = await loadHandlers(['uploadDroppedFilesAsync', 'isUploadTaskCancelled', 'updateUploadTaskStatus'], fixture.state)
  await handlers.uploadDroppedFilesAsync({ files: fixture.tasks.map(task => ({ localPath: task.localPath, relativePath: task.name })), directories: new Set() }, fixture.tasks, fixture.target)
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
  await handlers.ensureParentDirectories('test', '/home/test/nested/file.txt', new Set(['/home/test']))
  assert.deepEqual(created, ['/home/test/nested'])
})

test('cancelled active downloads do not retry, complete, or log an unexpected error', async () => {
  const tasks = { value: [{ id: 'download-1', connectionId: 'ssh-one', localPath: 'C:/temp/file.txt', remotePath: '/file.txt', name: 'file.txt', status: 'pending', cancelled: false }] }
  let transfers = 0
  let stopped = 0
  const errors: any[] = []
  const dependencies = {
    downloadTasks: tasks, isDownloadCancelled: false, currentConnectionId: { value: 'ssh-one' },
    nativeTransferRequests: new Set<string>(),
    isTransferCancellation: () => false,
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

function displayedDirectoryState() {
  const refreshes: unknown[] = []
  const state = {
    displayedConnectionId: { value: 'ssh-original' }, displayedPath: { value: '/srv/app' },
    currentConnectionId: { value: 'ssh-original' }, currentPath: { value: '/navigation-pending' },
    pathInput: { value: '/typed-not-submitted' }, selectedFiles: { value: [] as any[] }, downloadGeneration: 0,
    isTransferCancellation: () => false,
    refreshMutatedDirectory: async (target: unknown) => { refreshes.push(target) },
    $alert: (_message: string) => {}, console: { error() {}, warn() {} },
    window: { electronAPI: { fs: {} as any, ssh: {} as any } }
  }
  const navigateAway = () => {
    state.currentConnectionId.value = 'ssh-other'
    state.displayedConnectionId.value = 'ssh-other'
    state.displayedPath.value = '/elsewhere'
    state.currentPath.value = '/elsewhere'
  }
  return { state, navigateAway, refreshes }
}

test('single downloads use the displayed directory and retain the source across the save dialog', async () => {
  const fixture = displayedDirectoryState()
  const calls: unknown[][] = []
  fixture.state.window.electronAPI.fs.showSaveDialog = async () => {
    fixture.navigateAway()
    return 'C:/saved/config.json'
  }
  const handlers = await loadHandlers(['captureDirectoryTarget', 'downloadFile'], {
    ...fixture.state, isDownloadCancelled: false,
    addDownloadTask: async (...args: unknown[]) => { calls.push(args) }
  })
  await handlers.downloadFile({ name: 'config.json', type: 'file', size: 42 })
  assert.deepEqual(calls, [['ssh-original', 'config.json', 'file', '/srv/app/config.json', 'C:/saved/config.json', 42, 0]])
})

test('bulk downloads snapshot the selected entries before the directory chooser and recursive awaits', async () => {
  const fixture = displayedDirectoryState()
  fixture.state.selectedFiles.value = [
    { name: 'first', type: 'directory', size: 0 }, { name: 'second.txt', type: 'file', size: 9 }
  ]
  const calls: unknown[][] = []
  fixture.state.window.electronAPI.fs.showOpenDialog = async () => {
    fixture.navigateAway()
    fixture.state.selectedFiles.value = [{ name: 'wrong.txt', type: 'file', size: 1 }]
    return ['C:/saved']
  }
  const handlers = await loadHandlers(['captureDirectoryTarget', 'handleBulkDownload'], {
    ...fixture.state, isDownloadCancelled: false,
    addDownloadTask: async (...args: unknown[]) => { calls.push(args) }
  })
  await handlers.handleBulkDownload()
  assert.deepEqual(calls.map(call => call.slice(0, 4)), [
    ['ssh-original', 'first', 'directory', '/srv/app/first'],
    ['ssh-original', 'second.txt', 'file', '/srv/app/second.txt']
  ])
})

test('dialog uploads capture the shown host and directory before choosing or inspecting local files', async () => {
  const fixture = displayedDirectoryState()
  fixture.state.window.electronAPI.fs.showOpenDialog = async () => {
    fixture.navigateAway()
    return ['C:/one.txt', 'C:/two.txt']
  }
  fixture.state.window.electronAPI.fs.getStats = async () => ({ size: 5 })
  const queued: any[] = []
  const handlers = await loadHandlers(['captureDirectoryTarget', 'joinRemotePath', 'normalizeRemotePath', 'handleUpload'], {
    ...fixture.state, uploadTasks: { value: [] },
    uploadFilesFromDialogAsync: async (_paths: string[], tasks: unknown[]) => { queued.push(...tasks) }
  })
  await handlers.handleUpload()
  assert.deepEqual(queued.map(task => [task.connectionId, task.remotePath]), [
    ['ssh-original', '/srv/app/one.txt'], ['ssh-original', '/srv/app/two.txt']
  ])
})

test('collecting dropped files cannot move their captured destination to a newly opened tab', async () => {
  const fixture = displayedDirectoryState()
  const queued: any[] = []
  let captured: unknown
  const handlers = await loadHandlers(['captureDirectoryTarget', 'joinRemotePath', 'normalizeRemotePath', 'processUploadDrop'], {
    ...fixture.state, uploadTasks: { value: [] },
    collectDroppedFiles: async () => {
      fixture.navigateAway()
      return { files: [{ localPath: 'C:/nested/a.txt', relativePath: 'nested/a.txt', size: 1 }], directories: new Set(['nested']) }
    },
    uploadDroppedFilesAsync: async (_payload: unknown, tasks: unknown[], target: unknown) => {
      queued.push(...tasks)
      captured = target
    }
  })
  await handlers.processUploadDrop({})
  assert.deepEqual(queued.map(task => [task.connectionId, task.remotePath]), [['ssh-original', '/srv/app/nested/a.txt']])
  assert.deepEqual(captured, { connectionId: 'ssh-original', directory: '/srv/app' })
  assert(Object.isFrozen(captured))
})

test('queued drag uploads keep the original host and paths when navigation changes between files', async () => {
  const fixture = uploadState()
  const directories: unknown[][] = []
  fixture.state.ensureRemoteDirectoryExists = async (...args: any[]) => { directories.push(args.slice(0, 2)) }
  fixture.state.window.electronAPI.ssh.uploadFile = async (...args: any[]) => {
    fixture.calls.push(args)
    fixture.state.currentConnectionId.value = 'ssh-other'
    fixture.state.currentPath.value = '/elsewhere'
  }
  const handlers = await loadHandlers(['uploadDroppedFilesAsync', 'isUploadTaskCancelled', 'updateUploadTaskStatus'], fixture.state)
  await handlers.uploadDroppedFilesAsync({ files: fixture.tasks.map(task => ({ localPath: task.localPath, relativePath: task.name })), directories: new Set(['nested']) }, fixture.tasks, fixture.target)
  assert.deepEqual(fixture.calls.map(call => call.slice(0, 3)), [
    ['ssh-one', 'C:/a.txt', '/home/test/a.txt'], ['ssh-one', 'C:/z.txt', '/home/test/z.txt']
  ])
  assert.deepEqual(directories, [['ssh-one', '/home/test/nested']])
})

test('dialog upload queue ignores subsequent active connection changes', async () => {
  const fixture = uploadState()
  fixture.state.window.electronAPI.ssh.uploadFile = async (...args: any[]) => {
    fixture.calls.push(args)
    fixture.state.currentConnectionId.value = 'ssh-other'
    fixture.state.currentPath.value = '/elsewhere'
  }
  const handlers = await loadHandlers(['uploadFilesFromDialogAsync', 'isUploadTaskCancelled', 'updateUploadTaskStatus'], fixture.state)
  await handlers.uploadFilesFromDialogAsync(fixture.tasks.map(task => task.localPath), fixture.tasks)
  assert.deepEqual(fixture.calls.map(call => call[0]), ['ssh-one', 'ssh-one'])
})

test('recursive scans and their generated download tasks keep one source server', async () => {
  const fixture = displayedDirectoryState()
  const listed: string[][] = []
  const started: any[] = []
  fixture.state.window.electronAPI.ssh.listFiles = async (id: string, directory: string) => {
    listed.push([id, directory])
    fixture.navigateAway()
    return { success: true, files: directory === '/srv/app' ? [
      { name: 'root.txt', type: 'file', size: 1 }, { name: 'child', type: 'directory' }
    ] : [{ name: 'nested.txt', type: 'file', size: 2 }] }
  }
  const handlers = await loadHandlers(['collectAndAddDownloadTasks'], {
    ...fixture.state, isDownloadCancelled: false, downloadTasks: { value: [] },
    executeDownloadTask: async (task: unknown) => { started.push(task) }
  })
  assert.equal(await handlers.collectAndAddDownloadTasks('ssh-original', '/srv/app', 'C:/saved'), 2)
  assert.deepEqual(listed, [['ssh-original', '/srv/app'], ['ssh-original', '/srv/app/child']])
  assert.deepEqual(started.map(task => [task.connectionId, task.remotePath]), [
    ['ssh-original', '/srv/app/root.txt'], ['ssh-original', '/srv/app/child/nested.txt']
  ])
})

test('downloads keep their task host across local-directory preparation and never replay uncertain failures', async () => {
  const fixture = displayedDirectoryState()
  const task = { id: 'download', connectionId: 'ssh-original', name: 'a.txt', remotePath: '/srv/app/a.txt', localPath: 'C:/saved/a.txt', status: 'pending' }
  const tasks = { value: [task] }
  const calls: any[][] = []
  fixture.state.window.electronAPI.ssh.downloadFile = async (...args: any[]) => {
    calls.push(args)
    throw new Error('无法确认远端文件替换结果')
  }
  const handlers = await loadHandlers(['executeDownloadTask', 'updateTaskStatus'], {
    ...fixture.state, downloadTasks: tasks, isDownloadCancelled: false,
    nativeTransferRequests: new Set(), checkAndAutoCleanup() {},
    startRealProgressTracking: () => ({ stop() {} }),
    ensureDirectoryExists: async () => { fixture.navigateAway() }
  })
  await handlers.executeDownloadTask(task)
  assert.deepEqual(calls, [['ssh-original', '/srv/app/a.txt', 'C:/saved/a.txt', 'download']])
  assert.equal(tasks.value[0].status, 'error')
})

test('delete confirmation retains the original displayed target and opaque file identity', async () => {
  const fixture = displayedDirectoryState()
  const calls: unknown[][] = []
  fixture.state.window.electronAPI.ssh.deleteFile = async (...args: unknown[]) => { calls.push(args) }
  const handlers = await loadHandlers(['captureDirectoryTarget', 'deleteFile'], {
    ...fixture.state, $confirm: async () => { fixture.navigateAway(); return true }
  })
  await handlers.deleteFile({ name: 'secret.txt', type: 'file', identity: 'opaque-original' })
  assert.deepEqual(calls, [['ssh-original', '/srv/app/secret.txt', false, 'opaque-original']])
  assert.deepEqual(fixture.refreshes, [{ connectionId: 'ssh-original', directory: '/srv/app' }])
})

test('bulk deletion freezes selection and host across confirmation and each awaited delete', async () => {
  const fixture = displayedDirectoryState()
  fixture.state.selectedFiles.value = [
    { name: 'a', type: 'file', identity: 'opaque-a' }, { name: 'b', type: 'directory', identity: 'opaque-b' }
  ]
  const calls: unknown[][] = []
  fixture.state.window.electronAPI.ssh.deleteFile = async (...args: unknown[]) => {
    calls.push(args)
    fixture.state.selectedFiles.value = [{ name: 'wrong', type: 'file' }]
    fixture.navigateAway()
  }
  const handlers = await loadHandlers(['captureDirectoryTarget', 'handleBulkDelete'], {
    ...fixture.state, $confirm: async () => true
  })
  await handlers.handleBulkDelete()
  assert.deepEqual(calls, [
    ['ssh-original', '/srv/app/a', false, 'opaque-a'], ['ssh-original', '/srv/app/b', true, 'opaque-b']
  ])
})

test('new folders use the directory captured when their dialog opened', async () => {
  const fixture = displayedDirectoryState()
  const calls: unknown[][] = []
  fixture.state.window.electronAPI.ssh.createDirectory = async (...args: unknown[]) => { calls.push(args) }
  const dependencies = {
    ...fixture.state, createFolderTarget: { value: null }, newFolderName: { value: '' },
    showCreateFolderDialog: { value: false }, nextTick: (callback: () => void) => callback(),
    folderNameInput: { value: null }
  }
  const handlers = await loadHandlers(['captureDirectoryTarget', 'createFolder', 'confirmCreateFolder'], dependencies)
  handlers.createFolder()
  fixture.navigateAway()
  dependencies.newFolderName.value = 'new-folder'
  await handlers.confirmCreateFolder()
  assert.deepEqual(calls, [['ssh-original', '/srv/app/new-folder']])
})

test('cross-tab file drags preserve their source host rather than the drop target host', async () => {
  const fixture = displayedDirectoryState()
  const data = new Map<string, string>()
  const calls: unknown[][] = []
  fixture.state.window.electronAPI.fs.showOpenDialog = async () => ['C:/saved']
  const handlers = await loadHandlers(['captureDirectoryTarget', 'handleFileDragStart', 'handleDownloadDrop'], {
    ...fixture.state, DRAG_DOWNLOAD_MIME: 'remote-files', isFileSelected: () => false,
    isDownloadCancelled: false, addDownloadTask: async (...args: unknown[]) => { calls.push(args) }
  })
  handlers.handleFileDragStart({ dataTransfer: { setData: (type: string, value: string) => data.set(type, value) } }, { name: 'a.txt', type: 'file', size: 5 })
  fixture.navigateAway()
  await handlers.handleDownloadDrop(data.get('remote-files'))
  assert.deepEqual(calls, [['ssh-original', 'a.txt', 'file', '/srv/app/a.txt', 'C:/saved/a.txt', 5, 0]])
})

test('cancellation rejected during final commit leaves the task running until its real result arrives', async () => {
  for (const upload of [true, false]) {
    const task = { id: 'active', status: upload ? 'uploading' : 'downloading', cancelled: false }
    const tasks = { value: [task] }
    const handlers = await loadHandlers([
      'requestTransferCancellation', upload ? 'cancelUploadTask' : 'cancelDownload',
      upload ? 'updateUploadTaskStatus' : 'updateTaskStatus'
    ], {
      nativeTransferRequests: new Set(['active']), uploadTasks: tasks, downloadTasks: tasks,
      checkAndAutoCleanup() {}, window: { electronAPI: { ssh: { cancelTransfer: async () => false } } }
    })
    await (upload ? handlers.cancelUploadTask('active') : handlers.cancelDownload('active'))
    assert.equal(tasks.value[0].status, upload ? 'uploading' : 'downloading')
    assert.equal(tasks.value[0].cancelled, false)
  }
})

test('accepted cancellation stops an active task, while queued tasks cancel synchronously', async () => {
  const tasks = { value: [{ id: 'active', status: 'uploading', cancelled: false }, { id: 'queued', status: 'pending', cancelled: false }] }
  const cancelled: string[] = []
  const handlers = await loadHandlers(['requestTransferCancellation', 'cancelUploadTask', 'updateUploadTaskStatus'], {
    nativeTransferRequests: new Set(['active']), uploadTasks: tasks,
    window: { electronAPI: { ssh: { cancelTransfer: async (id: string) => { cancelled.push(id); return true } } } }
  })
  const queued = handlers.cancelUploadTask('queued')
  assert.equal(tasks.value[1].status, 'cancelled')
  await queued
  await handlers.cancelUploadTask('active')
  assert.deepEqual(cancelled, ['active'])
  assert(tasks.value.every(task => task.cancelled))
})

test('cached file views ignore another host and terminal routes, then restore their own route path', async () => {
  const route = { path: '/file-manager', query: { connectionId: 'ssh-original', path: '%2Fsrv%2Fapp', name: 'Original', nodeId: 'node-one' } }
  const routeSnapshot = { value: { ...route.query } }
  const currentConnectionId = { value: '' }
  const currentPath = { value: '/' }
  const pathInput = { value: '/' }
  const connectionStatus = { value: 'disconnected' }
  const loads: string[][] = []
  let notify = () => {}
  const handlers = await loadHandlers(['isOwnRoute', 'syncRouteState', '$routeWatcher'], {
    route, ownerConnectionId: 'ssh-original', ownerNodeId: 'node-one', routeSnapshot,
    actualConnectionId: { get value() { return routeSnapshot.value.connectionId } },
    currentConnectionId, currentPath, pathInput, connectionStatus,
    hasInitializedRouteState: { value: false },
    loadFiles: () => { loads.push([currentConnectionId.value, currentPath.value]) },
    watch: (_source: unknown, callback: () => void) => { notify = callback }
  })
  handlers.syncRouteState()
  route.query = { ...route.query, connectionId: 'ssh-other', name: 'Other', path: '%2Fwrong' }
  notify()
  assert.equal(currentConnectionId.value, 'ssh-original')
  assert.equal(currentPath.value, '/srv/app')
  assert.equal(routeSnapshot.value.name, 'Original')
  route.path = '/terminal'
  route.query = { ...route.query, connectionId: 'ssh-original', path: '%2Fterminal-path' }
  notify()
  assert.equal(currentPath.value, '/srv/app')
  route.path = '/file-manager'
  route.query.path = '%2Fsrv%2Fnew'
  notify()
  assert.equal(currentPath.value, '/srv/new')
  assert.equal(pathInput.value, '/srv/new')
  assert.deepEqual(loads, [['ssh-original', '/srv/app'], ['ssh-original', '/srv/new']])
})

test('completion invalidates the original listing without refreshing an unrelated current directory', async () => {
  const cache = new Map([['ssh-original:/srv/app', {}], ['ssh-other:/elsewhere', {}]])
  let loads = 0
  const handlers = await loadHandlers(['getFileListCacheKey', 'invalidateFileListCache', 'refreshMutatedDirectory'], {
    fileListCache: cache, currentConnectionId: { value: 'ssh-other' }, currentPath: { value: '/elsewhere' },
    loadFiles: async () => { loads++ }
  })
  await handlers.refreshMutatedDirectory({ connectionId: 'ssh-original', directory: '/srv/app' })
  assert.equal(cache.has('ssh-original:/srv/app'), false)
  assert.equal(cache.has('ssh-other:/elsewhere'), true)
  assert.equal(loads, 0)
})

test('native overwrite cancellation is shown as cancelled rather than failure', async () => {
  const fixture = displayedDirectoryState()
  const task = { id: 'download', connectionId: 'ssh-original', name: 'a.txt', remotePath: '/srv/app/a.txt', localPath: 'C:/saved/a.txt', status: 'pending' }
  const tasks = { value: [task] }
  fixture.state.window.electronAPI.ssh.downloadFile = async () => {
    throw new Error("Error invoking remote method 'ssh:download-file': TRANSFER_CANCELLED: 已取消文件传输")
  }
  const state = Object.fromEntries(Object.entries(fixture.state).filter(([name]) => name !== 'isTransferCancellation'))
  const handlers = await loadHandlers(['isTransferCancellation', 'executeDownloadTask', 'updateTaskStatus'], {
    ...state, downloadTasks: tasks, isDownloadCancelled: false,
    nativeTransferRequests: new Set(), checkAndAutoCleanup() {},
    startRealProgressTracking: () => ({ stop() {} }), ensureDirectoryExists: async () => {}
  })
  await handlers.executeDownloadTask(task)
  assert.equal(tasks.value[0].status, 'cancelled')
})

test('automatic completed cleanup retains failure reasons and cancelled transfer targets', async () => {
  const tasks = { value: [
    { id: 'ok', status: 'completed' },
    { id: 'failure', status: 'error', remotePath: '/original/a.txt', error: '无法确认远端文件替换结果' },
    { id: 'cancelled', status: 'cancelled', remotePath: '/original/b.txt' }
  ] }
  const handlers = await loadHandlers(['clearCompletedTasks'], { downloadTasks: tasks, isDownloadCancelled: false })
  handlers.clearCompletedTasks()
  assert.deepEqual(tasks.value.map(task => task.id), ['failure', 'cancelled'])
  assert.equal(tasks.value[0].error, '无法确认远端文件替换结果')
  assert.equal(tasks.value[0].remotePath, '/original/a.txt')
})

test('a cancelled old folder scan stays invalid after a new download resets the cancellation flag', async () => {
  const fixture = displayedDirectoryState()
  const tasks = { value: [] as any[] }
  const started: any[] = []
  let finishScan: (value: unknown) => void = () => {}
  fixture.state.window.electronAPI.ssh.listFiles = async () => new Promise(resolve => { finishScan = resolve })
  fixture.state.window.electronAPI.fs.showSaveDialog = async () => 'C:/saved/new.txt'
  const handlers = await loadHandlers([
    'captureDirectoryTarget', 'collectAndAddDownloadTasks', 'addDownloadTask', 'cancelAllDownloads', 'downloadFile'
  ], {
    ...fixture.state, downloadTasks: tasks, isDownloadCancelled: false,
    checkAndAutoCleanup() {}, cancelDownload: async () => {},
    executeDownloadTask: async (task: unknown) => { started.push(task) }
  })
  const oldScan = handlers.collectAndAddDownloadTasks('ssh-original', '/old', 'C:/saved/old')
  handlers.cancelAllDownloads()
  await handlers.downloadFile({ name: 'new.txt', type: 'file', size: 1 })
  finishScan({ success: true, files: [{ name: 'old.txt', type: 'file', size: 2 }] })
  assert.equal(await oldScan, 0)
  assert.deepEqual(started.map(task => task.remotePath), ['/srv/app/new.txt'])
  assert.deepEqual(tasks.value.map(task => task.remotePath), ['/srv/app/new.txt'])
})

test('cancelling during remote directory preparation prevents subsequent mkdir and upload calls', async () => {
  const fixture = uploadState()
  const task = { ...fixture.tasks[0], name: 'one/two/a.txt', remotePath: '/home/test/one/two/a.txt' }
  fixture.state.uploadTasks.value = [task]
  const created: string[] = []
  const state = Object.fromEntries(Object.entries(fixture.state).filter(([name]) =>
    !['ensureParentDirectories', 'ensureRemoteDirectoryExists', 'normalizeRemotePath', 'getRemoteDirname'].includes(name)))
  fixture.state.window.electronAPI.ssh.createDirectory = async (_id: string, remotePath: string) => {
    created.push(remotePath)
    fixture.state.uploadTasks.value = fixture.state.uploadTasks.value.map(item => ({ ...item, cancelled: true, status: 'cancelled' }))
  }
  const handlers = await loadHandlers([
    'normalizeRemotePath', 'getRemoteDirname', 'ensureParentDirectories', 'ensureRemoteDirectoryExists',
    'uploadDroppedFilesAsync', 'isUploadTaskCancelled', 'updateUploadTaskStatus'
  ], state)
  await handlers.uploadDroppedFilesAsync({ files: [{ localPath: task.localPath, relativePath: task.name }], directories: new Set() }, [task], fixture.target)
  assert.deepEqual(created, ['/home/test/one'])
  assert.equal(fixture.calls.length, 0)
  assert.equal(fixture.state.uploadTasks.value[0].status, 'cancelled')
})

test('POSIX directory names containing a backslash remain the displayed upload destination', async () => {
  const fixture = displayedDirectoryState()
  fixture.state.displayedPath.value = '/srv/back\\slash'
  fixture.state.window.electronAPI.fs.showOpenDialog = async () => ['C:/a.txt']
  fixture.state.window.electronAPI.fs.getStats = async () => ({ size: 1 })
  const queued: any[] = []
  const handlers = await loadHandlers(['captureDirectoryTarget', 'joinRemotePath', 'normalizeRemotePath', 'handleUpload'], {
    ...fixture.state, uploadTasks: { value: [] },
    uploadFilesFromDialogAsync: async (_paths: string[], tasks: unknown[]) => { queued.push(...tasks) }
  })
  await handlers.handleUpload()
  assert.equal(queued[0].remotePath, '/srv/back\\slash/a.txt')
})

test('cancelling all uploads invalidates an earlier file chooser before it can inspect or enqueue files', async () => {
  const fixture = displayedDirectoryState()
  const selection = Promise.withResolvers<string[]>()
  let stats = 0, uploads = 0
  fixture.state.window.electronAPI.fs.showOpenDialog = () => selection.promise
  fixture.state.window.electronAPI.fs.getStats = async () => { stats++; return { size: 1 } }
  const handlers = await loadHandlers(['captureDirectoryTarget', 'joinRemotePath', 'normalizeRemotePath', 'handleUpload', 'cancelAllUploads'], {
    ...fixture.state, uploadTasks: { value: [] }, cancelUploadTask() {},
    uploadFilesFromDialogAsync: async () => { uploads++ }
  })
  const selecting = handlers.handleUpload()
  handlers.cancelAllUploads()
  selection.resolve(['C:/old.txt'])
  await selecting
  assert.equal(stats, 0)
  assert.equal(uploads, 0)
})

test('cancelled drop collection cannot enqueue its old batch but a later fresh drop can upload', async () => {
  const fixture = displayedDirectoryState()
  const collection = Promise.withResolvers<unknown>()
  const tasks = { value: [] as any[] }
  let uploads = 0
  const payload = { files: [{ localPath: 'C:/old.txt', relativePath: 'old.txt', size: 1 }], directories: new Set() }
  const handlers = await loadHandlers(['captureDirectoryTarget', 'joinRemotePath', 'normalizeRemotePath', 'processUploadDrop', 'cancelAllUploads'], {
    ...fixture.state, uploadTasks: tasks, cancelUploadTask() {},
    collectDroppedFiles: () => collection.promise,
    uploadDroppedFilesAsync: async () => { uploads++ }
  })
  const collecting = handlers.processUploadDrop({})
  handlers.cancelAllUploads()
  collection.resolve(payload)
  await collecting
  assert.equal(uploads, 0)
  assert.deepEqual(tasks.value, [])
  await handlers.processUploadDrop({})
  assert.equal(uploads, 1)
  assert.equal(tasks.value.length, 1)
})

test('failed directory creation is not cached and a later explicit retry really attempts it again', async () => {
  for (const local of [true, false]) {
    let calls = 0
    const cache = new Set<string>()
    const pending = new Map<string, Promise<void>>()
    const createDirectory = () => {
      if (++calls === 1) throw new Error('Permission denied')
      return Promise.resolve(true)
    }
    const handlers = await loadHandlers(local ? ['ensureDirectoryExists'] : ['normalizeRemotePath', 'ensureRemoteDirectoryExists'], {
      createdDirectories: cache, directoryCreationPromises: pending,
      window: { electronAPI: { fs: { createDirectory }, ssh: { createDirectory } } }
    })
    const create = () => local ? handlers.ensureDirectoryExists('/saved') : handlers.ensureRemoteDirectoryExists('ssh', '/saved', cache)
    await assert.rejects(create(), /Permission denied/)
    assert.equal(cache.size, 0)
    assert.equal(pending.size, 0)
    await create()
    assert.equal(calls, 2)
    assert.equal(cache.has('/saved'), true)
  }
})

test('local download paths handle mixed Windows separators and preserve literal POSIX backslashes', async () => {
  const handlers = await loadHandlers(['getLocalDirname', 'joinLocalDownloadPath'], {})
  assert.equal(handlers.getLocalDirname('C:\\saved/nested/file.txt'), 'C:\\saved/nested')
  assert.equal(handlers.getLocalDirname('C:\\file.txt'), 'C:\\')
  assert.equal(handlers.getLocalDirname('C:/file.txt'), 'C:/')
  assert.equal(handlers.getLocalDirname('/file.txt'), '/')
  assert.equal(handlers.getLocalDirname('/saved/back\\slash.txt'), '/saved')
  assert.equal(handlers.joinLocalDownloadPath('/saved', 'back\\slash.txt'), '/saved/back\\slash.txt')
  for (const name of ['..', '../escape', 'back\\slash.txt', 'report:stream', 'NUL.txt', 'trailing.', 'trailing ']) {
    assert.throws(() => handlers.joinLocalDownloadPath('C:\\saved', name), /无法安全保存/)
  }
})

test('recursive Windows downloads reject unrepresentable server names before starting an incorrect destination', async () => {
  const fixture = displayedDirectoryState()
  const tasks = { value: [] as any[] }
  let name = ''
  let started = 0
  fixture.state.window.electronAPI.ssh.listFiles = async () => ({ success: true, files: [{ name, type: 'file', size: 1 }] })
  const handlers = await loadHandlers(['collectAndAddDownloadTasks'], {
    ...fixture.state, downloadTasks: tasks, isDownloadCancelled: false,
    executeDownloadTask: async () => { started++ }
  })
  for (name of ['..', '../outside', 'back\\slash.txt', 'file:stream', 'CON']) {
    await assert.rejects(handlers.collectAndAddDownloadTasks('ssh-original', '/remote', 'C:\\saved'), /无法安全保存/)
  }
  assert.equal(started, 0)
  assert.deepEqual(tasks.value, [])
})

test('same-path concurrent uploads accept only their own native request progress', async () => {
  const fixture = uploadState()
  const tasks = ['one', 'two'].map(id => ({ ...fixture.tasks[0], id, localPath: 'C:/same.txt', remotePath: '/same.txt' }))
  fixture.state.uploadTasks.value = tasks
  const listeners = new Set<(event: unknown) => void>()
  const gate = { one: Promise.withResolvers<void>(), two: Promise.withResolvers<void>() }
  fixture.state.window.electronAPI.ssh.uploadFile = async (_connectionId: string, _local: string, _remote: string, requestId: 'one' | 'two') => gate[requestId].promise
  const handlers = await loadHandlers(['uploadFilesFromDialogAsync', 'isUploadTaskCancelled', 'updateUploadTaskStatus', 'startRealProgressTracking'], {
    ...Object.fromEntries(Object.entries(fixture.state).filter(([key]) => key !== 'startRealProgressTracking')),
    window: { electronAPI: { ...fixture.state.window.electronAPI, on: (_name: string, listener: (event: unknown) => void) => {
      listeners.add(listener); return () => listeners.delete(listener)
    } } }
  })
  const one = handlers.uploadFilesFromDialogAsync(['C:/same.txt'], [tasks[0]])
  const two = handlers.uploadFilesFromDialogAsync(['C:/same.txt'], [tasks[1]])
  for (const listener of listeners) listener({ requestId: 'one', id: 'ssh-one', localPath: 'C:/same.txt', remotePath: '/same.txt', progress: 42 })
  assert.equal(fixture.state.uploadTasks.value.find(task => task.id === 'one')?.progress, 42)
  assert.equal(fixture.state.uploadTasks.value.find(task => task.id === 'two')?.progress, 0)
  gate.one.resolve(); gate.two.resolve()
  await Promise.all([one, two])
  assert.equal(listeners.size, 0)
})

test('upload relative names preserve POSIX backslashes and cannot escape through parent segments', async () => {
  const handlers = await loadHandlers(['joinRemotePath', 'normalizeRemotePath'], {})
  assert.equal(handlers.joinRemotePath('/srv/app', 'back\\slash.txt'), '/srv/app/back\\slash.txt')
  assert.throws(() => handlers.joinRemotePath('/srv/app', '../outside'), /上传相对路径无效/)
})

test('dialog uploads preserve literal POSIX backslashes in the selected source filename', async () => {
  const fixture = displayedDirectoryState()
  fixture.state.window.electronAPI.fs.showOpenDialog = async () => ['/saved/back\\slash.txt']
  fixture.state.window.electronAPI.fs.getStats = async () => ({ size: 5 })
  const queued: any[] = []
  const handlers = await loadHandlers(['captureDirectoryTarget', 'joinRemotePath', 'normalizeRemotePath', 'handleUpload'], {
    ...fixture.state, uploadTasks: { value: [] },
    uploadFilesFromDialogAsync: async (_paths: string[], tasks: unknown[]) => { queued.push(...tasks) }
  })
  await handlers.handleUpload()
  assert.equal(queued[0].name, 'back\\slash.txt')
  assert.equal(queued[0].remotePath, '/srv/app/back\\slash.txt')
  assert.equal(queued[0].localPath, '/saved/back\\slash.txt')
})

test('clearing completed uploads retains failure reasons and cancelled destinations', async () => {
  const tasks = { value: [{ id: 'ok', status: 'completed' },
    { id: 'failed', status: 'error', remotePath: '/original', error: 'disk full' },
    { id: 'cancelled', status: 'cancelled', remotePath: '/original-cancelled' }] }
  const handlers = await loadHandlers(['clearCompletedUploadTasks'], { uploadTasks: tasks })
  handlers.clearCompletedUploadTasks()
  assert.deepEqual(tasks.value.map(task => task.id), ['failed', 'cancelled'])
  assert.equal(tasks.value[0].error, 'disk full')
})
