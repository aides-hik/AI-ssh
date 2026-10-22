import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

// Installation is restricted to disposable GitHub-hosted Windows workers.
assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Package installation verification is CI-only')
assert.equal(process.env.RUNNER_OS, 'Windows')
assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted', 'Use a disposable GitHub-hosted worker')
assert.equal(process.platform, 'win32')
assert.ok(process.env.RUNNER_TEMP)

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const desktopRoot = path.resolve(scriptDirectory, '..')
const packageJson = JSON.parse(await readFile(path.join(desktopRoot, 'package.json'), 'utf8'))
const releaseRoot = path.join(desktopRoot, 'release', packageJson.version)
const sandbox = path.join(path.resolve(process.env.RUNNER_TEMP), 'aissh-package-validation')
const resultsDirectory = path.join(sandbox, 'results')
const installationDirectory = path.join(sandbox, 'installed')
const executableName = 'AI SSH Assistant.exe'
const runtimeProbe = path.join(scriptDirectory, 'ci-check-packaged-runtime.cjs')
await mkdir(resultsDirectory, { recursive: true })

const result = { version: packageJson.version, success: false, checks: {} }
const log = (name, data) => writeFile(path.join(resultsDirectory, name), data)

async function run(executable, args, name, env = process.env) {
  return await new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    const child = spawn(executable, args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; child.kill() }, 120_000)
    child.stdout.on('data', data => { stdout += data })
    child.stderr.on('data', data => { stderr += data })
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('close', async code => {
      clearTimeout(timer)
      try {
        await Promise.all([log(`${name}.stdout.log`, stdout), log(`${name}.stderr.log`, stderr)])
        if (timedOut) reject(new Error(`${name} timed out; see verification logs`))
        else if (code === 0) resolve()
        else reject(new Error(`${name} exited with ${code}; see verification logs`))
      } catch (error) {
        reject(error)
      }
    })
  })
}

async function unusedPort() {
  const server = createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}

async function waitForRemoval(file) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      await stat(file)
    } catch (error) {
      if (error.code === 'ENOENT') return
      throw error
    }
    await delay(250)
  }
  throw new Error('Uninstall did not remove the installation directory')
}

async function connectDebugger(url) {
  const socket = new WebSocket(url)
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error('CDP connection timed out')) }, 10_000)
    socket.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
    socket.addEventListener('error', error => { clearTimeout(timer); reject(error) }, { once: true })
  })
  let sequence = 0
  const requests = new Map()
  const exceptions = []
  socket.addEventListener('close', () => {
    for (const request of requests.values()) {
      clearTimeout(request.timer)
      request.reject(new Error('CDP connection closed'))
    }
    requests.clear()
  })
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data)
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails)
    const request = requests.get(message.id)
    if (!request) return
    requests.delete(message.id)
    clearTimeout(request.timer)
    if (message.error) request.reject(new Error(JSON.stringify(message.error)))
    else request.resolve(message.result)
  })
  return {
    exceptions,
    close: () => socket.close(),
    send(method, params = {}) {
      const id = ++sequence
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { requests.delete(id); reject(new Error(`CDP ${method} timed out`)) }, 20_000)
        requests.set(id, { resolve, reject, timer })
        socket.send(JSON.stringify({ id, method, params }))
      })
    }
  }
}

async function verifyApplicationLaunch(executable, name, phase, profile) {
  const logPrefix = `${name}-${phase}`
  await mkdir(path.join(profile, 'Roaming'), { recursive: true })
  await mkdir(path.join(profile, 'Local'), { recursive: true })
  const port = await unusedPort()
  const env = { ...process.env, NODE_ENV: 'production', APPDATA: path.join(profile, 'Roaming'), LOCALAPPDATA: path.join(profile, 'Local') }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(executable, [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  let startupError
  child.once('error', error => { startupError = error })
  child.stdout.on('data', data => { output += data })
  child.stderr.on('data', data => { output += data })
  let debuggerClient
  try {
    const deadline = Date.now() + 60_000
    while (!debuggerClient && Date.now() < deadline) {
      if (startupError) throw startupError
      assert.equal(child.exitCode, null, `${name} exited before opening its window`)
      try {
        const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) })).json()
        const page = pages.find(target => target.type === 'page' && target.url.startsWith('file:'))
        if (page) debuggerClient = await connectDebugger(page.webSocketDebuggerUrl)
      } catch {
        // Electron may still be creating its renderer and debugging endpoint.
      }
      if (!debuggerClient) await delay(250)
    }
    assert.ok(debuggerClient, `${name} did not open a packaged renderer`)
    await debuggerClient.send('Runtime.enable')
    let ready = false
    while (!ready && Date.now() < deadline) {
      const evaluation = await debuggerClient.send('Runtime.evaluate', { expression: 'Boolean(document.querySelector(".welcome-page") && window.electronAPI)', returnByValue: true })
      ready = evaluation.result?.value === true
      if (!ready) await delay(250)
    }
    assert.ok(ready, `${name} renderer did not reach the welcome page`)
    const evaluation = await debuggerClient.send('Runtime.evaluate', {
      expression: `(async () => {
        const api = window.electronAPI;
        const marker = ${JSON.stringify(`${name}-settings-persisted`)};
        const previous = await api.settings.get('local-user');
        if (${JSON.stringify(phase)} === 'seed') {
          const saved = await api.settings.save('local-user', { ...previous, __ciPackageMarker: marker });
          if (!saved.success) throw new Error('Settings IPC save failed');
        } else if (previous?.__ciPackageMarker !== marker) {
          throw new Error('Settings did not survive the application restart');
        }
        return { userData: await api.getPath('userData'), version: await api.getVersion(),
          settings: await api.settings.get('local-user'), connections: await api.ssh.getConnections() };
      })()`,
      awaitPromise: true,
      returnByValue: true
    })
    assert.ok(!evaluation.exceptionDetails, JSON.stringify(evaluation.exceptionDetails))
    const state = evaluation.result.value
    assert.equal(state.version, packageJson.version)
    assert.ok(Array.isArray(state.connections))
    assert.ok(state.settings?.appearance)
    assert.equal(state.settings.__ciPackageMarker, `${name}-settings-persisted`, 'Settings IPC did not persist the marker')
    const relativeProfile = path.relative(profile, state.userData)
    assert.ok(!relativeProfile.startsWith('..') && !path.isAbsolute(relativeProfile), 'Application used an unisolated profile')
    assert.deepEqual(debuggerClient.exceptions, [], 'Renderer raised an unhandled exception')
    await log(`${logPrefix}-ui.json`, JSON.stringify({ success: true, pid: child.pid, phase, ...state }, null, 2))
    const screenshot = await debuggerClient.send('Page.captureScreenshot', { format: 'png' })
    await log(`${logPrefix}.png`, Buffer.from(screenshot.data, 'base64'))
    await debuggerClient.send('Runtime.evaluate', { expression: 'setTimeout(() => window.electronAPI.quit(), 0); true' }).catch(() => {})
    await Promise.race([
      new Promise(resolve => { if (child.exitCode !== null) resolve(); else child.once('exit', resolve) }),
      delay(10_000)
    ])
    assert.equal(child.exitCode, 0, `${name} did not exit cleanly after the ${phase} check`)
  } finally {
    debuggerClient?.close()
    if (child.exitCode === null) {
      await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(5000)])
      if (child.exitCode === null) child.kill()
    }
    await log(`${logPrefix}-application.log`, output)
  }
}

async function verifyApplication(executable, name) {
  const packageRoot = path.join(path.dirname(executable), 'resources', 'app')
  const runtimeResult = path.join(resultsDirectory, `${name}-runtime.json`)
  await run(executable, [runtimeProbe, packageRoot, runtimeResult], `${name}-runtime`, { ...process.env, ELECTRON_RUN_AS_NODE: '1' })
  const runtime = JSON.parse(await readFile(runtimeResult, 'utf8'))
  assert.equal(runtime.success, true)
  assert.equal(runtime.electron, packageJson.devDependencies.electron, 'Packaged Electron version differs from the dependency pin')
  const profile = path.join(sandbox, `${name}-profile`)
  // The second launch must read the first launch's SQLite settings without saving.
  for (const phase of ['seed', 'verify']) await verifyApplicationLaunch(executable, name, phase, profile)
}

let installationAttempted = false
try {
  const installer = path.join(releaseRoot, `AI-SSH-Assistant-${packageJson.version}-setup-x64.exe`)
  assert.ok((await stat(installer)).size > 1024 * 1024, 'Installer is absent or unexpectedly small')
  const header = await readFile(installer)
  assert.equal(header.subarray(0, 2).toString(), 'MZ', 'Installer is not a Windows executable')
  result.checks.installer = true
  await verifyApplication(path.join(releaseRoot, 'win-unpacked', executableName), 'unpacked')
  result.checks.unpacked = true
  // NSIS requires /D to be last; keep this disposable install path free of spaces.
  assert.ok(!/\s/.test(installationDirectory), 'The NSIS verification directory must not contain whitespace')
  installationAttempted = true
  await run(installer, ['/S', '/currentuser', `/D=${installationDirectory}`], 'install')
  const installedExecutable = path.join(installationDirectory, executableName)
  assert.ok((await stat(installedExecutable)).size > 0)
  result.checks.installed = true
  await verifyApplication(installedExecutable, 'installed')
  result.checks.installedLaunch = true
} catch (error) {
  result.error = error.stack || error.message
  process.exitCode = 1
} finally {
  if (installationAttempted) {
    try {
      const entries = await readdir(installationDirectory)
      const uninstaller = entries.find(file => /^uninstall.*\.exe$/i.test(file))
      assert.ok(uninstaller, 'Installed package has no uninstaller')
      await run(path.join(installationDirectory, uninstaller), ['/S', '/currentuser'], 'uninstall')
      await waitForRemoval(installationDirectory)
      result.checks.uninstalled = true
    } catch (error) {
      result.uninstallError = error.stack || error.message
      process.exitCode = 1
    }
  }
  result.success = Object.values(result.checks).length === 5 && Object.values(result.checks).every(Boolean)
  await log('summary.json', JSON.stringify(result, null, 2))
  if (!result.success) process.exitCode = 1
  console.log(JSON.stringify(result, null, 2))
}
