/**
 * Windows production UI acceptance (no installer build).
 * Build database + `pnpm --filter @ai-ssh/desktop exec vite build` first, then:
 *   node apps/desktop/scripts/windows-ui-smoke.cjs
 * Each invocation uses a fresh profile below tmp/windows-validation and restarts
 * the real Electron main process. Clipboard contents stay in memory and are restored.
 * If Windows denies OpenClipboard, the result explicitly reports incomplete coverage.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const desktopDir = path.resolve(__dirname, '..')
const root = path.resolve(desktopDir, '../..')
const validationDir = path.join(root, 'tmp', 'windows-validation')
const mainEntry = path.join(desktopDir, 'dist-electron', 'main', 'index.js')

function writeJson(filename, value) {
  fs.writeFileSync(filename, JSON.stringify(value, null, 2) + '\n')
}

async function until(predicate, message, timeout = 15000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(message)
}

async function runPhases() {
  assert.equal(process.platform, 'win32', 'Run this acceptance check on Windows')
  assert(fs.existsSync(mainEntry), 'Build the desktop production assets first')
  const { spawn, spawnSync } = require('node:child_process')
  const { createHash } = require('node:crypto')
  const runDir = path.join(validationDir, `ui-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  fs.mkdirSync(runDir, { recursive: true })
  console.log(`Windows UI evidence: ${runDir}`)
  // Check the Windows session itself before attributing unavailable clipboard
  // access to the application. This never reads or changes clipboard contents.
  const preflight = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
    Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class ClipboardAccess { [DllImport("user32.dll", SetLastError=true)] public static extern bool OpenClipboard(IntPtr owner); [DllImport("user32.dll")] public static extern bool CloseClipboard(); }';
    $opened = [ClipboardAccess]::OpenClipboard([IntPtr]::Zero);
    $nativeError = if ($opened) { 0 } else { [Runtime.InteropServices.Marshal]::GetLastWin32Error() };
    if ($opened) { [ClipboardAccess]::CloseClipboard() | Out-Null };
    @{ available = $opened; win32Error = $nativeError } | ConvertTo-Json -Compress
  `], { windowsHide: true, encoding: 'utf8', timeout: 15000 })
  assert.equal(preflight.status, 0, 'Windows clipboard access preflight failed')
  const clipboardPreflight = JSON.parse(preflight.stdout.trim())
  assert(clipboardPreflight.available || clipboardPreflight.win32Error === 5,
    `Unexpected OpenClipboard failure: Win32 error ${clipboardPreflight.win32Error}`)
  writeJson(path.join(runDir, 'environment.json'), { clipboardPreflight })
  const summary = { success: false, coverageComplete: false, runDir,
    platform: process.platform, arch: process.arch, clipboardPreflight, phases: {} }
  try {
    for (const phase of ['seed', 'verify']) {
      const stdout = fs.openSync(path.join(runDir, `${phase}.stdout.log`), 'w')
      const stderr = fs.openSync(path.join(runDir, `${phase}.stderr.log`), 'w')
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      delete env.ELECTRON_RENDERER_URL
      const child = spawn(require('electron'), [__filename, '--phase', phase, '--run-dir', runDir], {
        cwd: desktopDir, env, windowsHide: true, stdio: ['ignore', stdout, stderr]
      })
      fs.closeSync(stdout)
      fs.closeSync(stderr)
      const code = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          child.kill()
          reject(new Error(`${phase} Electron process exceeded 120 seconds`))
        }, 120000)
        child.once('error', error => { clearTimeout(timeout); reject(error) })
        child.once('exit', code => { clearTimeout(timeout); resolve(code) })
      })
      const resultPath = path.join(runDir, `${phase}.json`)
      const result = fs.existsSync(resultPath) ? JSON.parse(fs.readFileSync(resultPath, 'utf8')) : {}
      summary.phases[phase] = result
      assert.equal(code, 0, `${phase} exited ${code}: ${result.error || `see ${phase}.stderr.log`}`)
      assert.equal(result.success, true, `${phase} did not finish successfully`)
      console.log(`${phase}: PASS (Electron process ${result.pid})`)
    }
    assert.notEqual(summary.phases.seed.pid, summary.phases.verify.pid, 'A fresh process must verify persistence')
    summary.build = Object.fromEntries([
      ['main', mainEntry],
      ['preload', path.join(desktopDir, 'dist-electron', 'preload', 'index.js')],
      ['html', path.join(desktopDir, 'dist', 'index.html')]
    ].map(([name, filename]) => [name, createHash('sha256').update(fs.readFileSync(filename)).digest('hex')]))
    summary.success = true
    summary.coverageComplete = summary.phases.verify.skipped.length === 0
    if (!summary.coverageComplete) console.log('Incomplete coverage:', summary.phases.verify.skipped)
  } catch (error) {
    summary.error = error.stack
    throw error
  } finally {
    writeJson(path.join(runDir, 'result.json'), summary)
    writeJson(path.join(validationDir, 'latest-ui-result.json'), summary)
  }
}

// This function is serialized into the isolated renderer, so all dependencies
// used here must be browser globals or data passed in `options`.
async function rendererProbe(options) {
  const check = (condition, message) => { if (!condition) throw new Error(message) }
  const waitFor = async (predicate, message) => {
    for (let i = 0; i < 400; i++) {
      if (predicate()) return
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    throw new Error(message)
  }
  await waitFor(() => document.querySelector('.welcome-page'), 'Welcome page did not mount')
  const api = window.electronAPI
  const global = document.querySelector('#app').__vue_app__.config.globalProperties
  const router = global.$router
  check(!!api?.fs?.getPathForFile, 'Preload webUtils API missing')
  check((await api.getPath('userData')) === options.profile, 'User data must use the isolated profile')
  const userId = 'local-user'
  const result = { preloadReady: true, profileIsolated: true }
  const changeSelect = (selector, value) => {
    const select = document.querySelector(selector)
    check(select, `Missing select: ${selector}`)
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
  }
  const appearance = '#section-appearance .setting-row:first-of-type select'
  const language = '#section-appearance .language-switcher select'

  if (options.phase === 'seed') {
    const folder = await api.ssh.createFolder(userId, { name: 'Windows 中文 分组' })
    const connection = await api.ssh.createConnection(userId, {
      name: 'Windows 重启连接', host: '127.0.0.1', port: 2222, username: 'smoke-user',
      authType: 'password', password: 'smoke-placeholder-only', folderId: folder.id
    })
    const original = await api.settings.get(userId)
    await api.settings.save(userId, {
      ...original, windowsValidation: options.marker,
      aiProviders: [{ id: 'windows-smoke', name: 'Local validation', enabled: false,
        endpoint: 'http://127.0.0.1:11434/v1', apiKey: 'placeholder-only', models: [] }]
    })
    await api.fs.mkdirRecursive(options.filesDir)
    await api.fs.writeFile(options.originalFile, 'Windows 中文文件\r\n')
    await api.fs.appendFile(options.originalFile, '追加内容 with spaces 🚀\r\n')
    await api.fs.copyFile(options.originalFile, options.copyFile)
    await api.fs.rename(options.copyFile, options.renamedFile)
    const contents = await api.fs.readFile(options.renamedFile)
    check(contents === options.fileContents, 'Unicode file contents changed')
    check(!(await api.fs.exists(options.copyFile)), 'Rename left the old filename')
    await api.settings.export(userId, options.settingsFile)
    await router.push('/settings')
    await waitFor(() => document.querySelector(appearance), 'Appearance settings did not mount')
    changeSelect(appearance, 'light-modern')
    changeSelect(language, 'en-US')
    await waitFor(() => localStorage.getItem('app-theme-mode') === 'light-modern' &&
      global.$i18n.locale === 'en-US', 'Settings controls did not persist theme/language')
    return { ...result, folderId: folder.id, connectionId: connection.id,
      seededConnection: true, seededSettings: true, unicodeFileOperations: true,
      themeSelected: 'light-modern', localeSelected: 'en-US' }
  }

  // These checks run before any mutation in the second process.
  const tree = await api.ssh.getTree(userId)
  const folder = tree.find(node => node.id === options.seed.folderId)
  const connection = folder?.children.find(node => node.id === options.seed.connectionId)
  check(folder?.name === 'Windows 中文 分组' && connection?.name === 'Windows 重启连接',
    'SQLite connection hierarchy did not survive process restart')
  check(connection.host === '127.0.0.1' && connection.port === 2222 &&
    connection.username === 'smoke-user' && connection.password === 'smoke-placeholder-only',
  'SQLite connection fields did not survive process restart')
  const saved = await api.settings.get(userId)
  check(saved.windowsValidation === options.marker &&
    saved.aiProviders?.[0]?.endpoint === 'http://127.0.0.1:11434/v1' &&
    saved.aiProviders[0].apiKey === 'placeholder-only', 'SQLite settings did not survive restart')
  check(document.documentElement.classList.contains('light-modern'), 'Theme did not survive restart')
  check(global.$i18n.locale === 'en-US', 'Language did not survive restart')
  check(await api.fs.readFile(options.renamedFile) === options.fileContents, 'File did not survive restart')
  const entries = await api.fs.listDirectory(options.filesDir)
  check(entries.some(entry => entry.name === '重命名 文件 🚀.txt'), 'Unicode directory listing failed')
  const stats = await api.fs.getStats(options.renamedFile)
  check(stats.isFile && stats.size > 0, 'Unicode file stat failed')
  result.connectionPersistence = true
  result.settingsPersistence = true
  result.themePersistence = true
  result.languagePersistence = true
  result.filePersistence = true
  result.unicodeDirectoryAndStat = true

  // Export/import also exercises the Windows path passed through settings IPC.
  await api.settings.save(userId, { ...saved, windowsValidation: 'changed-before-import' })
  await api.settings.import(userId, options.settingsFile)
  check((await api.settings.get(userId)).windowsValidation === options.marker, 'Settings file import failed')
  result.settingsExportImport = true

  await router.push('/settings')
  await waitFor(() => document.querySelector(appearance), 'Appearance settings did not mount')
  result.lightBackground = getComputedStyle(document.querySelector('.vscode-app')).backgroundColor
  changeSelect(appearance, 'dark-modern')
  await waitFor(() => document.documentElement.classList.contains('dark-modern'), 'Dark theme change failed')
  result.darkBackground = getComputedStyle(document.querySelector('.vscode-app')).backgroundColor
  check(result.lightBackground === 'rgb(255, 255, 255)' && result.darkBackground === 'rgb(31, 31, 31)',
    'Theme backgrounds did not render correctly')
  result.englishLabel = global.$t('activityBar.settings')
  changeSelect(language, 'zh-CN')
  await waitFor(() => global.$i18n.locale === 'zh-CN', 'Chinese locale change failed')
  result.chineseLabel = global.$t('activityBar.settings')
  check(result.englishLabel === 'Settings' && result.chineseLabel === '设置', 'Translations failed')

  await router.push('/terminal')
  await waitFor(() => document.querySelector('.terminal-container .xterm-screen'), 'Terminal did not mount')
  result.terminalMounted = true
  const module = await import(options.editorUrl)
  const editor = Object.values(module).find(value => value && typeof value.createModel === 'function' &&
    typeof value.create === 'function')
  check(editor, 'Built Monaco editor namespace missing')
  const host = document.createElement('div')
  Object.assign(host.style, { position: 'fixed', width: '600px', height: '300px', top: '40px', left: '310px' })
  document.body.append(host)
  const json = editor.createModel('{ "broken": }', 'json')
  const instance = editor.create(host, { model: json })
  const ts = editor.createModel('const broken: = true', 'typescript')
  try {
    await waitFor(() => editor.getModelMarkers({ resource: json.uri }).length > 0, 'JSON worker failed')
    result.jsonWorkerDiagnostics = editor.getModelMarkers({ resource: json.uri }).length
    instance.setModel(ts)
    await waitFor(() => editor.getModelMarkers({ resource: ts.uri }).length > 0, 'TypeScript worker failed')
    result.typescriptWorkerDiagnostics = editor.getModelMarkers({ resource: ts.uri }).length
  } finally {
    instance.dispose(); json.dispose(); ts.dispose(); host.remove()
  }
  await api.ssh.deleteConnection(userId, options.seed.connectionId)
  await api.ssh.deleteFolder(userId, options.seed.folderId)
  check((await api.ssh.getTree(userId)).length === 0, 'SQLite delete after restart failed')
  result.connectionDeleteAfterRestart = true
  await router.push('/settings')
  await waitFor(() => document.querySelector('.settings-view'), 'Settings page did not mount')
  const input = document.createElement('input')
  input.type = 'file'; input.id = 'windows-smoke-file'
  input.style.display = 'none'
  document.body.append(input)
  return result
}

async function runElectronPhase() {
  const { app, BrowserWindow, session, clipboard, ClipboardItem } = require('electron')
  const phase = process.argv[process.argv.indexOf('--phase') + 1]
  const runDir = path.resolve(process.argv[process.argv.indexOf('--run-dir') + 1])
  const relativeRun = path.relative(validationDir, runDir)
  assert(relativeRun && !relativeRun.startsWith('..') && !path.isAbsolute(relativeRun), 'Profile must stay in tmp/windows-validation')
  assert(['seed', 'verify'].includes(phase), 'Unknown smoke phase')
  process.env.ELECTRON_FORCE_PROD_RENDERER = '1'
  process.env.NODE_ENV = 'production'
  const profile = path.join(runDir, '用户 profile')
  fs.mkdirSync(profile, { recursive: true })
  app.setPath('userData', profile)
  app.setPath('sessionData', profile)
  // Keep the real native window and focus semantics without covering the user's desktop.
  const originalShow = BrowserWindow.prototype.show
  BrowserWindow.prototype.show = function () {
    this.setOpacity(0)
    return originalShow.call(this)
  }
  const filesDir = path.join(runDir, '中文 空格目录')
  const assets = path.join(desktopDir, 'dist', 'assets')
  const editorAsset = fs.readdirSync(assets).find(file => /^editor\.api-.*\.js$/.test(file))
  assert(editorAsset, 'Built Monaco editor asset missing')
  const options = {
    phase, profile, filesDir, marker: path.basename(runDir),
    originalFile: path.join(filesDir, '原始 文件.txt'),
    copyFile: path.join(filesDir, '复制 文件.txt'),
    renamedFile: path.join(filesDir, '重命名 文件 🚀.txt'),
    settingsFile: path.join(filesDir, '设置 导出.json'),
    fileContents: 'Windows 中文文件\r\n追加内容 with spaces 🚀\r\n',
    editorUrl: pathToFileURL(path.join(assets, editorAsset)).href,
    clipboardPreflight: JSON.parse(fs.readFileSync(path.join(runDir, 'environment.json'), 'utf8')).clipboardPreflight,
    ...(phase === 'verify' ? { seed: JSON.parse(fs.readFileSync(path.join(runDir, 'seed.json'), 'utf8')) } : {})
  }
  const remoteHosts = new Set()
  const rendererErrors = []
  let started = false
  let restoredClipboard = false
  let clipboardChanged = false
  let clipboardBackup
  const restoreClipboard = async () => {
    if (!clipboardChanged || !clipboardBackup || restoredClipboard) return
    if (clipboardBackup.length) await clipboard.write(clipboardBackup)
    else clipboard.clear()
    restoredClipboard = true
  }
  const fail = async error => {
    try { await restoreClipboard() } catch (restoreError) { console.error('Clipboard restore failed:', restoreError) }
    writeJson(path.join(runDir, `${phase}.json`), { success: false, phase, pid: process.pid, error: error.stack || String(error) })
    console.error(error)
    app.exit(1)
  }
  const timeout = setTimeout(() => { void fail(new Error(`${phase} smoke timed out`)) }, 100000)
  app.on('ready', () => {
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      const url = new URL(details.url)
      if (['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) remoteHosts.add(url.hostname)
      callback({})
    })
  })
  app.on('web-contents-created', (_, contents) => {
    contents.on('console-message', event => {
      if (event.level === 'error') rendererErrors.push(event.message)
    })
    contents.on('did-finish-load', async () => {
      if (started || !contents.getURL().startsWith('file:')) return
      started = true
      try {
        const result = await contents.executeJavaScript(`(${rendererProbe.toString()})(${JSON.stringify(options)})`)
        result.skipped = []
        const window = BrowserWindow.fromWebContents(contents)
        assert(window, 'Real BrowserWindow missing')
        if (phase === 'verify') {
          // CDP supplies a real disk-backed File, unlike new File() with no native path.
          contents.debugger.attach('1.3')
          try {
            const { root } = await contents.debugger.sendCommand('DOM.getDocument')
            const { nodeId } = await contents.debugger.sendCommand('DOM.querySelector', {
              nodeId: root.nodeId, selector: '#windows-smoke-file'
            })
            await contents.debugger.sendCommand('DOM.setFileInputFiles', { nodeId, files: [options.renamedFile] })
            const actualPath = await contents.executeJavaScript(
              "window.electronAPI.fs.getPathForFile(document.querySelector('#windows-smoke-file').files[0])")
            assert.equal(path.normalize(actualPath), options.renamedFile, 'Preload returned the wrong Windows file path')
            result.nativeFilePath = true
          } finally { contents.debugger.detach() }

          await contents.executeJavaScript('window.electronAPI.minimizeWindow()')
          await until(() => window.isMinimized(), 'Native window did not minimize')
          window.restore()
          await until(() => !window.isMinimized(), 'Native window did not restore')
          await contents.executeJavaScript('window.electronAPI.maximizeWindow()')
          await until(() => window.isMaximized(), 'Native window did not maximize')
          await contents.executeJavaScript('window.electronAPI.maximizeWindow()')
          await until(() => !window.isMaximized(), 'Native window did not unmaximize')
          result.windowMinimizeRestore = true
          result.windowMaximizeRestore = true

          if (options.clipboardPreflight.available) {
            // Electron 45 uses asynchronous ClipboardItems, including raw OS formats:
            // https://www.electronjs.org/docs/latest/api/clipboard
            // Materialize all formats before changing the OS clipboard; no private
            // clipboard data is logged or written to the evidence directory.
            const backup = []
            for (const item of await clipboard.read()) {
              const entries = await Promise.all(item.types.map(async type => [type, await item.getType(type)]))
              if (entries.length) backup.push(new ClipboardItem(Object.fromEntries(entries)))
            }
            clipboardBackup = backup
            try {
              window.focus()
              contents.focus()
              await until(() => window.isFocused(), 'Native window could not focus for clipboard test')
              const sample = 'Windows 剪贴板 with spaces 🚀\r\n第二行'
              clipboardChanged = true
              await clipboard.writeText(sample + ' main')
              await until(async () => await clipboard.readText() === sample + ' main', 'Native clipboard self roundtrip failed', 3000)
              const pasted = await contents.executeJavaScript('navigator.clipboard.readText()', true)
              assert.equal(pasted, sample + ' main', 'Windows → renderer clipboard failed')
              await contents.executeJavaScript(`navigator.clipboard.writeText(${JSON.stringify(sample)})`, true)
              await until(async () => await clipboard.readText() === sample, 'Renderer → Windows clipboard failed', 3000)
              result.clipboardRoundtrip = true
              result.clipboardVerified = true
            } finally { await restoreClipboard() }
            result.clipboardRestored = restoredClipboard
          } else {
            result.clipboardVerified = false
            result.clipboardSkipReason = 'Windows OpenClipboard returned ERROR_ACCESS_DENIED (5)'
            result.skipped.push({ check: 'clipboard', reason: 'Windows OpenClipboard rejected access',
              win32Error: options.clipboardPreflight.win32Error })
          }
          await contents.executeJavaScript(`(async () => {
            await window.electronAPI.fs.deleteFile(${JSON.stringify(options.originalFile)});
            if (await window.electronAPI.fs.exists(${JSON.stringify(options.originalFile)})) throw new Error('Unicode file delete failed');
          })()`)
          result.unicodeFileDelete = true
          const screenshot = await contents.capturePage()
          fs.writeFileSync(path.join(runDir, 'windows-ui.png'), screenshot.toPNG())
        }
        assert.equal(remoteHosts.size, 0, 'Unexpected network traffic during local UI validation')
        assert.equal(rendererErrors.length, 0, `Renderer console errors: ${rendererErrors.join('\n')}`)
        session.defaultSession.flushStorageData()
        await session.defaultSession.cookies.flushStore()
        writeJson(path.join(runDir, `${phase}.json`), {
          success: true, phase, pid: process.pid, versions: process.versions, ...result,
          remoteHosts: [...remoteHosts], rendererErrors
        })
        console.log(`WINDOWS_UI_${phase.toUpperCase()}_PASS`)
        clearTimeout(timeout)
        app.quit()
      } catch (error) { clearTimeout(timeout); await fail(error) }
    })
  })
  require(mainEntry)
}

if (process.versions.electron) {
  runElectronPhase().catch(error => { console.error(error); require('electron').app.exit(1) })
} else {
  runPhases().catch(error => { console.error(error); process.exitCode = 1 })
}
