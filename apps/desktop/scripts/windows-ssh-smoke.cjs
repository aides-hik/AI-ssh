/**
 * Real SSH/SFTP integration through the production Electron preload.
 * Run after building the database and Vite assets:
 *   node apps/desktop/scripts/windows-ssh-smoke.cjs
 * To exercise IPC before the first-paint handler, set
 * WINDOWS_SSH_SMOKE_DELAY_READY=6000. The same protocol checks must still pass.
 * Only a disposable localhost SSH fixture is contacted. Results and profiles live
 * under tmp/windows-validation; the fixture never executes operating-system commands.
 */
const path = require('node:path')
const fs = require('node:fs')
const { spawn } = require('node:child_process')

if (!process.versions.electron) {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  const child = spawn(require('electron'), [__filename], { env, stdio: 'inherit', windowsHide: true })
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill())
  child.on('error', error => { console.error(error); process.exitCode = 1 })
  child.on('exit', code => { process.exitCode = code ?? 1 })
} else {
  run().catch(error => { console.error(error); require('electron').app.exit(1) })
}

async function run() {
  const { app, BrowserWindow, globalShortcut, session: electronSession } = require('electron')
  const { Server, utils: { sftp: { OPEN_MODE, STATUS_CODE } } } = require('ssh2')
  const { generateKeyPairSync, randomBytes } = require('node:crypto')
  const root = path.resolve(__dirname, '../../..')
  const outputRoot = path.join(root, 'tmp/windows-validation')
  const resultPath = path.join(outputRoot, 'ssh-smoke-latest.json')
  const runRoot = path.join(outputRoot, `ssh-${Date.now()}-${process.pid}`)
  const remoteRoot = path.join(runRoot, 'remote')
  const profile = path.join(runRoot, 'profile')
  for (const directory of [remoteRoot, profile]) fs.mkdirSync(directory, { recursive: true })
  fs.mkdirSync(path.join(remoteRoot, 'home/smoke'), { recursive: true })
  const payload = '真实 SSH / SFTP 中文文件\n'.repeat(4000)
  const uploadPath = path.join(runRoot, 'upload-中文.txt')
  const downloadPath = path.join(runRoot, 'download-中文.txt')
  fs.writeFileSync(uploadPath, payload)

  const key = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'pkcs1', format: 'pem' }
  }).privateKey
  const password = randomBytes(24).toString('hex')
  const clients = new Set()
  const protocol = { authenticated: 0, pty: 0, resize: 0, exec: 0, cancelled: 0, sftp: {} }
  const started = Date.now()
  const timeline = []
  const mark = (event, details = {}) => timeline.push({ elapsedMs: Date.now() - started, event, ...details })
  let finished = false
  let checked = false
  const remoteHosts = new Set()
  const readyToShowDelayMs = Number(process.env.WINDOWS_SSH_SMOKE_DELAY_READY || 0)
  if (!Number.isFinite(readyToShowDelayMs) || readyToShowDelayMs < 0 || readyToShowDelayMs > 30000) {
    throw new Error('WINDOWS_SSH_SMOKE_DELAY_READY must be between 0 and 30000 milliseconds')
  }

  function remoteFile(remotePath) {
    const normalized = path.posix.normalize(String(remotePath)).replace(/^\/+/, '')
    const candidate = path.resolve(remoteRoot, normalized)
    const relative = path.relative(remoteRoot, candidate)
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Fixture path escapes its root')
    return candidate
  }

  function attributes(filename) {
    const stats = fs.statSync(filename)
    return { mode: stats.mode, size: stats.size, uid: 0, gid: 0, atime: Math.floor(stats.atimeMs / 1000), mtime: Math.floor(stats.mtimeMs / 1000) }
  }

  function attachSftp(stream) {
    const handles = new Map()
    let handleId = 0
    function allocate(value) {
      const handle = Buffer.alloc(4)
      handle.writeUInt32BE(++handleId)
      handles.set(handleId, value)
      return handle
    }
    function getHandle(handle) {
      const value = handle.length === 4 && handles.get(handle.readUInt32BE())
      if (!value) throw new Error('Invalid SFTP handle')
      return value
    }
    function on(event, handler) {
      stream.on(event, (requestId, ...args) => {
        protocol.sftp[event] = (protocol.sftp[event] || 0) + 1
        try { handler(requestId, ...args) } catch (error) {
          stream.status(requestId, error.code === 'ENOENT' ? STATUS_CODE.NO_SUCH_FILE : STATUS_CODE.FAILURE, error.message)
        }
      })
    }
    on('OPEN', (requestId, filename, flags) => {
      let mode = flags & OPEN_MODE.WRITE ? (flags & OPEN_MODE.READ ? fs.constants.O_RDWR : fs.constants.O_WRONLY) : fs.constants.O_RDONLY
      if (flags & OPEN_MODE.CREAT) mode |= fs.constants.O_CREAT
      if (flags & OPEN_MODE.TRUNC) mode |= fs.constants.O_TRUNC
      if (flags & OPEN_MODE.EXCL) mode |= fs.constants.O_EXCL
      if (flags & OPEN_MODE.APPEND) mode |= fs.constants.O_APPEND
      stream.handle(requestId, allocate({ fd: fs.openSync(remoteFile(filename), mode, 0o600) }))
    })
    on('READ', (requestId, handle, offset, length) => {
      const buffer = Buffer.alloc(Math.min(length, 1024 * 1024))
      const count = fs.readSync(getHandle(handle).fd, buffer, 0, buffer.length, offset)
      if (count) stream.data(requestId, buffer.subarray(0, count))
      else stream.status(requestId, STATUS_CODE.EOF)
    })
    on('WRITE', (requestId, handle, offset, data) => {
      fs.writeSync(getHandle(handle).fd, data, 0, data.length, offset)
      stream.status(requestId, STATUS_CODE.OK)
    })
    on('CLOSE', (requestId, handle) => {
      const entry = getHandle(handle)
      if (entry.fd !== undefined) fs.closeSync(entry.fd)
      handles.delete(handle.readUInt32BE())
      stream.status(requestId, STATUS_CODE.OK)
    })
    for (const event of ['STAT', 'LSTAT']) on(event, (requestId, filename) => stream.attrs(requestId, attributes(remoteFile(filename))))
    on('FSTAT', (requestId, handle) => {
      const stats = fs.fstatSync(getHandle(handle).fd)
      stream.attrs(requestId, { mode: stats.mode, size: stats.size, uid: 0, gid: 0, atime: 0, mtime: 0 })
    })
    on('OPENDIR', (requestId, filename) => {
      const directory = remoteFile(filename)
      const entries = fs.readdirSync(directory).map(name => ({ filename: name, longname: name, attrs: attributes(path.join(directory, name)) }))
      stream.handle(requestId, allocate({ entries }))
    })
    on('READDIR', (requestId, handle) => {
      const entry = getHandle(handle)
      if (entry.entries.length) stream.name(requestId, entry.entries.splice(0))
      else stream.status(requestId, STATUS_CODE.EOF)
    })
    on('REALPATH', (requestId, filename) => {
      remoteFile(filename)
      stream.name(requestId, [{ filename: path.posix.resolve('/', filename), longname: filename, attrs: {} }])
    })
    on('MKDIR', (requestId, filename) => { fs.mkdirSync(remoteFile(filename)); stream.status(requestId, STATUS_CODE.OK) })
    on('RMDIR', (requestId, filename) => { fs.rmdirSync(remoteFile(filename)); stream.status(requestId, STATUS_CODE.OK) })
    on('REMOVE', (requestId, filename) => { fs.unlinkSync(remoteFile(filename)); stream.status(requestId, STATUS_CODE.OK) })
    on('RENAME', (requestId, oldName, newName) => { fs.renameSync(remoteFile(oldName), remoteFile(newName)); stream.status(requestId, STATUS_CODE.OK) })
    on('FSETSTAT', requestId => stream.status(requestId, STATUS_CODE.OK))
    on('SETSTAT', requestId => stream.status(requestId, STATUS_CODE.OK))
    stream.on('close', () => {
      for (const entry of handles.values()) if (entry.fd !== undefined) fs.closeSync(entry.fd)
      handles.clear()
    })
  }

  const server = new Server({ hostKeys: [key] }, client => {
    clients.add(client)
    client.on('error', error => console.error('SSH fixture connection:', error.message))
    client.on('close', () => clients.delete(client))
    client.on('authentication', context => {
      if (context.method === 'password' && context.username === 'smoke' && context.password === password) context.accept()
      else context.reject()
    })
    client.on('ready', () => {
      protocol.authenticated++
      let interactiveShell
      client.on('session', accept => {
        const session = accept()
        let terminalType
        let cancellableStream
        session.on('signal', (acceptSignal, _reject, info) => {
          if (cancellableStream && ['INT', 'SIGINT'].includes(info.name)) {
            protocol.cancelled++
            cancellableStream.exit(130)
            cancellableStream.end()
          }
          acceptSignal?.()
        })
        session.on('pty', (acceptPty, _reject, info) => {
          terminalType = info.term
          protocol.pty++
          acceptPty()
        })
        session.on('window-change', (acceptResize, _reject, info) => {
          if (info.cols === 100 && info.rows === 40) protocol.resize++
          acceptResize?.()
        })
        session.on('shell', (acceptShell, rejectShell) => {
          // Exercise the desktop's documented SFTP fallback when GNU find/stat are unavailable.
          if (terminalType === 'dumb') return rejectShell()
          const stream = acceptShell()
          interactiveShell = stream
          mark('fixture-shell')
          stream.write('欢迎 SSH 终端\r\n')
          stream.on('data', data => {
            const input = data.toString('utf8')
            mark('fixture-pty-input', { bytes: data.length })
            const cwd = input.match(/__OC_CWD_BEGIN__([^\\']+)/)
            if (cwd) stream.write(`__OC_CWD_BEGIN__${cwd[1]}\n/home/smoke\n__OC_CWD_END__${cwd[1]}:0\n`)
            else stream.write(`PTY 回显：${input}`)
          })
          stream.on('end', () => stream.end())
        })
        session.on('exec', (acceptExec, _reject, info) => {
          protocol.exec++
          const stream = acceptExec()
          const command = info.command
          if (command === 'smoke-cancel') {
            cancellableStream = stream
            stream.write('等待取消\n')
            // Signal actual exec readiness through the existing interactive channel.
            // A fixed sleep can race a slow SSH handshake or channel allocation.
            interactiveShell.write('__SMOKE_CANCEL_READY__\r\n')
            return
          }
          if (command === 'smoke-stream') {
            stream.write('开始执行\n')
            // Let each live batch cross the actual SSH transport before changing
            // streams. ssh2 may otherwise buffer separate stdout writes together.
            setTimeout(() => {
              stream.stderr.write('预期的过程警告\n')
              setTimeout(() => {
                stream.write('rate:95%')
                stream.exit(0)
                stream.end()
              }, 80)
            }, 80)
            return
          }
          if (command === 'smoke-exec') stream.write('命令输出：你好，世界\n')
          else if (command === 'smoke-stderr') stream.stderr.write('预期的标准错误\n')
          else if (command === 'pwd' || command === 'printf \'%s\' "$HOME"') stream.write('/home/smoke')
          else if (command.startsWith('LC_ALL=C find ')) stream.write('SFTP_FALLBACK_REQUIRED')
          else if (command.includes('__OC_DELETE_OK__')) {
            const encoded = command.match(/^printf '%s' '([A-Za-z0-9+/=]+)'/)
            if (!encoded) throw new Error('Unexpected fixture deletion command')
            const filename = remoteFile(Buffer.from(encoded[1], 'base64').toString('utf8'))
            if (fs.statSync(filename).isDirectory()) fs.rmdirSync(filename)
            else fs.unlinkSync(filename)
            stream.write('__OC_DELETE_OK__')
          } else stream.stderr.write('Unsupported fixture command')
          stream.exit(command === 'smoke-stderr' ? 1 : 0)
          stream.end()
        })
        session.on('sftp', acceptSftp => attachSftp(acceptSftp()))
      })
    })
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const port = server.address().port

  async function finish(success, details) {
    if (finished) return
    finished = true
    clearTimeout(timer)
    for (const client of clients) client.end()
    const fixturePortClosed = await new Promise(resolve => {
      const closeTimeout = setTimeout(() => resolve(false), 1000)
      server.close(() => { clearTimeout(closeTimeout); resolve(true) })
    })
    success = success && fixturePortClosed
    const result = { success, ...details, protocol, timeline, readyToShowDelayMs, fixturePort: port, fixturePortClosed, remoteHosts: [...remoteHosts], versions: { electron: process.versions.electron, node: process.versions.node }, runRoot, resultPath }
    fs.writeFileSync(resultPath, JSON.stringify(result, null, 2))
    console.log(`WINDOWS_SSH_SMOKE_${success ? 'PASS' : 'FAIL'} ${JSON.stringify(result)}`)
    app.exit(success ? 0 : 1)
  }

  process.env.ELECTRON_FORCE_PROD_RENDERER = '1'
  process.env.NODE_ENV = 'production'
  app.setPath('userData', profile)
  app.setPath('sessionData', profile)
  BrowserWindow.prototype.show = function () {}
  BrowserWindow.prototype.showInactive = function () {}
  BrowserWindow.prototype.focus = function () {}
  globalShortcut.register = () => false
  const originalWindowOn = BrowserWindow.prototype.on
  BrowserWindow.prototype.on = function (event, listener) {
    if (event === 'ready-to-show' && readyToShowDelayMs) {
      return originalWindowOn.call(this, event, (...args) => setTimeout(() => listener.apply(this, args), readyToShowDelayMs))
    }
    return originalWindowOn.call(this, event, listener)
  }
  const timer = setTimeout(() => finish(false, { error: 'SSH integration timed out' }), 60000)
  app.on('ready', () => {
    electronSession.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      const url = new URL(details.url)
      if (['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) remoteHosts.add(url.hostname)
      callback({ cancel: ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) })
    })
  })
  app.on('web-contents-created', (_, contents) => {
    contents.on('ready-to-show', () => mark('contents-ready-to-show'))
    contents.on('did-finish-load', async () => {
      if (checked || !contents.getURL().startsWith('file:')) return
      checked = true
      mark('did-finish-load')
      try {
        const result = await contents.executeJavaScript(`(${probe.toString()})(${JSON.stringify({ port, password, uploadPath, downloadPath, payload })})`)
        if (result.failure) throw new Error(result.failure)
        if (fs.readFileSync(downloadPath, 'utf8') !== payload) throw new Error('Downloaded bytes differ from upload fixture')
        if (!protocol.sftp.READDIR || !protocol.sftp.WRITE || !protocol.sftp.READ || !protocol.sftp.RENAME || !protocol.resize || !protocol.cancelled) throw new Error('Expected SSH/SFTP protocol operations were not observed')
        if (remoteHosts.size) throw new Error('Renderer attempted an external request')
        await finish(true, result)
      } catch (error) { await finish(false, { error: error.stack || String(error) }) }
    })
  })
  app.on('browser-window-created', (_, window) => {
    window.on('ready-to-show', () => mark('window-ready-to-show'))
  })
  require(path.join(root, 'apps/desktop/dist-electron/main/index.js'))
}

async function probe(input) {
  const api = window.electronAPI
  let id
  let terminal = ''
  let stage = 'renderer-ready'
  const cleanup = []
  const check = (condition, message) => { if (!condition) throw new Error(message) }
  const until = async predicate => {
    for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 50)) }
    throw new Error('SSH renderer probe timed out')
  }
  try {
    await until(() => document.querySelector('.welcome-page'))
    const config = { name: 'Local protocol fixture', host: '127.0.0.1', port: input.port, username: 'smoke', password: input.password, keepAlive: false, timeout: 5 }
    check((await api.ssh.testConnection(config)).success, 'Password handshake failed')
    const connected = await api.ssh.connect(config)
    check(connected.status === 'connected', connected.message)
    id = connected.id
    stage = 'pty-output'
    cleanup.push(api.on(`ssh:output:${id}`, text => { terminal += text }))
    terminal += await api.ssh.getInitialOutput(id)
    await api.ssh.write(id, '输入中文\r')
    await until(() => terminal.includes('PTY 回显：输入中文'))
    stage = 'resize'
    await api.ssh.resize(id, 100, 40)
    stage = 'current-directory'
    const cwd = await api.ssh.getCurrentDirectory(id)
    check(cwd.success && cwd.output === '/home/smoke', 'PTY current-directory probe failed')
    stage = 'exec'
    const exec = await api.ssh.execute(id, 'smoke-exec')
    check(exec.success && exec.output.includes('你好，世界'), 'SSH exec Chinese output failed')
    const stderr = await api.ssh.execute(id, 'smoke-stderr')
    check(!stderr.success && stderr.error.includes('预期的标准错误'), 'SSH stderr propagation failed')
    stage = 'live-exec-output'
    const liveOutput = []
    cleanup.push(api.ssh.onExecuteOutput(event => {
      if (event.requestId === 'windows-smoke-stream' && event.connectionId === id) liveOutput.push(event)
    }))
    const streamed = await api.ssh.execute(id, 'smoke-stream', 'windows-smoke-stream', { timeoutMs: 10000 })
    check(streamed.success && streamed.exitCode === 0 && streamed.output === '开始执行\nrate:95%' &&
      streamed.stdout === streamed.output && streamed.stderr === '预期的过程警告\n',
    'Non-PTY exec changed raw output or treated a stderr warning as failure')
    await until(() => liveOutput.some(event => event.data.includes('rate:95%')))
    check(JSON.stringify(liveOutput.map(({ stream, data }) => ({ stream, data }))) === JSON.stringify([
      { stream: 'stdout', data: '开始执行\n' },
      { stream: 'stderr', data: '预期的过程警告\n' },
      { stream: 'stdout', data: 'rate:95%' }
    ]), `Live stdout/stderr IPC output was missing, corrupted or reordered: ${JSON.stringify(liveOutput)}`)
    stage = 'cancellation'
    const pending = api.ssh.execute(id, 'smoke-cancel', 'windows-smoke-cancel').then(() => false, error => /abort/i.test(String(error)))
    await until(() => terminal.includes('__SMOKE_CANCEL_READY__'))
    check(await api.ssh.cancelExecute('windows-smoke-cancel'), 'SSH cancellation was not accepted')
    check(await pending, 'SSH cancellation did not reject the execution')
    stage = 'sftp'
    const directory = '/home/smoke/文件目录'
    const remotePath = `${directory}/测试文件.txt`
    check((await api.ssh.createDirectory(id, directory)).success, 'SFTP mkdir failed')
    check((await api.ssh.uploadFile(id, input.uploadPath, remotePath)).success, 'SFTP upload failed')
    const listed = await api.ssh.listFiles(id, directory)
    check(listed.success && listed.files.some(file => file.name === '测试文件.txt'), 'SFTP directory listing failed')
    check((await api.ssh.downloadFile(id, remotePath, input.downloadPath)).success, 'SFTP download failed')
    const envText = '# SSH protocol fixture\n中文环境文档\n'
    await api.ssh.writeEnvDoc(id, envText)
    const envDocument = await api.ssh.readEnvDoc(id)
    check(envDocument.content === envText, 'SFTP atomic rename/read failed')
    await api.ssh.deleteFile(id, remotePath, false)
    check((await api.ssh.listFiles(id, directory)).files.length === 0, 'Remote delete failed')
    await api.ssh.deleteFile(id, directory, true)
    await api.ssh.deleteFile(id, '/home/smoke/env.md', false)
    const connections = await api.ssh.getConnections()
    check(connections.some(connection => connection.id === id), 'Connected session missing from IPC list')
    check(!connections.some(connection => 'password' in connection), 'IPC exposed a password')
    await api.ssh.disconnect(id)
    check(!(await api.ssh.getConnections()).some(connection => connection.id === id), 'SSH disconnect did not clear session')
    id = undefined
    return { passwordAuthentication: true, ptyChinese: true, resize: true, execChinese: true, stderr: true,
      liveOutputOrder: true, rawExecOutput: true, stderrWarningSuccess: true,
      cancellation: true, sftpDirectoryListing: true, uploadDownloadBytes: new TextEncoder().encode(input.payload).byteLength, atomicRename: true, remoteDelete: true, disconnected: true }
  } catch (error) {
    return { failure: `${error.stack || String(error)}; stage=${stage}; terminal=${JSON.stringify(terminal)}` }
  } finally {
    for (const dispose of cleanup) dispose()
    if (id) await api.ssh.disconnect(id)
  }
}
