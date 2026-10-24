import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

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
const executableName = 'Prism.exe'
const runtimeProbe = path.join(scriptDirectory, 'ci-check-packaged-runtime.cjs')
await mkdir(resultsDirectory, { recursive: true })

const result = { version: packageJson.version, success: false, checks: {} }
const log = (name, data) => writeFile(path.join(resultsDirectory, name), data)
const execFileAsync = promisify(execFile)

async function captureTimeout(pid, name, timeoutMs) {
  const snapshot = { pid, timeoutMs }
  try {
    const files = await readdir(installationDirectory, { recursive: true })
    snapshot.installation = { entries: files.length, sample: files.slice(0, 100) }
  } catch (error) {
    snapshot.installationError = error.message
  }
  try {
    snapshot.installerTemporaryDirectories = (await readdir(path.resolve(process.env.RUNNER_TEMP)))
      .filter(entry => /^ns.+\.tmp$/i.test(entry))
  } catch (error) {
    snapshot.temporaryDirectoryError = error.message
  }
  try {
    // Record only the process tree created by this verifier. Command lines and
    // environment variables may contain credentials and are intentionally omitted.
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', `
        $verificationProcesses = @(Get-CimInstance Win32_Process);
        $verificationIds = [System.Collections.Generic.HashSet[int]]::new();
        [void]$verificationIds.Add(${pid});
        do {
          $verificationCount = $verificationIds.Count;
          foreach ($verificationProcess in $verificationProcesses) {
            if ($verificationIds.Contains([int]$verificationProcess.ParentProcessId)) {
              [void]$verificationIds.Add([int]$verificationProcess.ProcessId);
            }
          }
        } while ($verificationIds.Count -ne $verificationCount);
        @{
          processes = @($verificationProcesses | Where-Object { $verificationIds.Contains([int]$_.ProcessId) } |
            Select-Object ProcessId, ParentProcessId, Name, ExecutablePath, KernelModeTime, UserModeTime);
          windows = @(Get-Process | Where-Object { $verificationIds.Contains([int]$_.Id) } |
            Select-Object Id, ProcessName, MainWindowTitle, Responding, CPU)
        } | ConvertTo-Json -Depth 4 -Compress
      `
    ], { windowsHide: true, timeout: 10_000, encoding: 'utf8', maxBuffer: 1024 * 1024 })
    snapshot.processes = JSON.parse(stdout)
  } catch (error) {
    snapshot.processError = error.message
  }
  await log(`${name}.timeout.json`, JSON.stringify(snapshot, null, 2))
  return snapshot.processes?.processes?.map(process => Number(process.ProcessId)) || []
}

async function run(executable, args, name, { env = process.env, timeoutMs = 120_000 } = {}) {
  return await new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    const child = spawn(executable, args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let timedOut = false
    let finishing = false
    let timeoutWork
    async function finish(code, startupError) {
      if (finishing) return
      finishing = true
      clearTimeout(timer)
      try {
        // Do not start uninstall while timeout diagnostics or process cleanup is
        // still running, even if killing the parent emits close immediately.
        await timeoutWork
        await Promise.all([log(`${name}.stdout.log`, stdout), log(`${name}.stderr.log`, stderr)])
        if (timedOut) reject(new Error(`${name} timed out after ${timeoutMs}ms; see verification logs`))
        else if (startupError) reject(startupError)
        else if (code === 0) resolve()
        else reject(new Error(`${name} exited with ${code}; see verification logs`))
      } catch (error) {
        reject(error)
      }
    }
    const timer = setTimeout(() => {
      timedOut = true
      timeoutWork = (async () => {
        const observedPids = await captureTimeout(child.pid, name, timeoutMs)
        const running = child.exitCode === null && child.signalCode === null
        const ownedPids = new Set(observedPids.filter(pid => pid !== child.pid))
        if (running) ownedPids.add(child.pid)
        if (ownedPids.size) {
          // NSIS can start a nested installer, PowerShell or extraction helper.
          // Terminate the complete owned tree before inspecting or uninstalling.
          const targets = [...ownedPids].flatMap(pid => ['/PID', String(pid)])
          await execFileAsync('taskkill.exe', [...targets, '/T', '/F'], {
            windowsHide: true, timeout: 10_000
          })
        }
      })().catch(async error => {
        await log(`${name}.timeout-error.log`, error.message).catch(() => {})
      }).finally(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill()
        // A descendant may inherit these pipes after its parent exits. A timed
        // out verifier must settle even if the OS never emits the parent's close.
        child.stdout.destroy()
        child.stderr.destroy()
      })
      void timeoutWork.then(() => finish(null))
    }, timeoutMs)
    child.stdout.on('data', data => { stdout += data })
    child.stderr.on('data', data => { stderr += data })
    child.once('error', error => { void finish(null, error) })
    child.once('close', code => { void finish(code) })
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
          documentTitle: document.title,
          appBrand: document.querySelector('[data-testid="app-brand"]')?.textContent?.trim(),
          settings: await api.settings.get('local-user'), connections: await api.ssh.getConnections() };
      })()`,
      awaitPromise: true,
      returnByValue: true
    })
    assert.ok(!evaluation.exceptionDetails, JSON.stringify(evaluation.exceptionDetails))
    const state = evaluation.result.value
    assert.equal(state.version, packageJson.version)
    assert.match(state.documentTitle, /Prism/, 'Window title does not show the Prism brand')
    assert.match(state.appBrand, /Prism/, 'Title bar does not show the Prism brand')
    assert.ok(Array.isArray(state.connections))
    assert.ok(state.settings?.appearance)
    assert.equal(state.settings.__ciPackageMarker, `${name}-settings-persisted`, 'Settings IPC did not persist the marker')
    assert.equal(path.resolve(state.userData), path.resolve(profile), 'Application changed the requested data directory')
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
  const shippedPackage = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'))
  // Keep Electron's runtime name stable so existing default userData paths remain valid.
  assert.equal(shippedPackage.name, '@ai-ssh/desktop', 'Application package identity changed')
  assert.equal(shippedPackage.productName, undefined, 'Display branding must not override Electron runtime name')
  const runtimeResult = path.join(resultsDirectory, `${name}-runtime.json`)
  await run(executable, [runtimeProbe, packageRoot, runtimeResult], `${name}-runtime`, { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
  const runtime = JSON.parse(await readFile(runtimeResult, 'utf8'))
  assert.equal(runtime.success, true)
  assert.equal(runtime.electron, packageJson.devDependencies.electron, 'Packaged Electron version differs from the dependency pin')
  const profile = path.join(sandbox, `${name}-profile`)
  // The second launch must read the first launch's SQLite settings without saving.
  for (const phase of ['seed', 'verify']) await verifyApplicationLaunch(executable, name, phase, profile)
}

let installationAttempted = false
try {
  const installer = path.join(releaseRoot, `Prism-${packageJson.version}-setup-x64.exe`)
  assert.ok((await stat(installer)).size > 1024 * 1024, 'Installer is absent or unexpectedly small')
  const header = await readFile(installer)
  assert.equal(header.subarray(0, 2).toString(), 'MZ', 'Installer is not a Windows executable')
  result.checks.installer = true
  await verifyApplication(path.join(releaseRoot, 'win-unpacked', executableName), 'unpacked')
  result.checks.unpacked = true
  // NSIS requires /D to be last; keep this disposable install path free of spaces.
  assert.ok(!/\s/.test(installationDirectory), 'The NSIS verification directory must not contain whitespace')
  installationAttempted = true
  await run(installer, ['/S', '/currentuser', `/D=${installationDirectory}`], 'install', { timeoutMs: 300_000 })
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
      await run(path.join(installationDirectory, uninstaller), ['/S', '/currentuser'], 'uninstall', { timeoutMs: 300_000 })
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
