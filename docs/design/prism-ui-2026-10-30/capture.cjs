/*
 * Capture the isolated Prism design prototype and export editable SVG layers.
 * Run from the repository root: node docs/design/prism-ui-2026-10-30/capture.cjs
 * Uses a local Electron/Chrome runtime, a disposable profile and no external network.
 */
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { createRequire } = require('node:module')
const { pathToFileURL } = require('node:url')

const designRoot = __dirname
const repositoryRoot = path.resolve(designRoot, '../../..')
const routes = ['workspace', 'connections', 'terminal', 'files', 'settings', 'motion']

if (!process.versions.electron) {
  const { spawn } = require('node:child_process')
  const requireDesktop = createRequire(path.join(repositoryRoot, 'apps/desktop/package.json'))
  const electronRoot = path.dirname(requireDesktop.resolve('electron/package.json'))
  const executableNames = { win32: 'electron.exe', darwin: 'Electron.app/Contents/MacOS/Electron', linux: 'electron' }
  const electron = path.join(electronRoot, 'dist', executableNames[process.platform] || 'electron')
  if (fs.existsSync(electron)) {
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    const child = spawn(electron, [__filename], { env, stdio: 'inherit', windowsHide: true })
    child.on('error', error => { console.error(error.message); process.exitCode = 1 })
    child.on('exit', code => { process.exitCode = code ?? 1 })
  } else captureWithChrome().catch(error => { console.error(error.stack || String(error)); process.exitCode = 1 })
} else {
  capture().catch(error => {
    console.error(error.stack || String(error))
    require('electron').app.exit(1)
  })
}

async function capture() {
  const { app, BrowserWindow, session } = require('electron')
  const output = path.join(repositoryRoot, 'tmp/design-capture', `prism-${Date.now()}-${process.pid}`)
  fs.mkdirSync(output, { recursive: true })
  app.setPath('userData', path.join(output, 'profile'))
  app.setPath('sessionData', path.join(output, 'session'))
  await app.whenReady()
  const blockedNetwork = new Set()
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const remote = /^(?:https?|wss?):/i.test(details.url)
    if (remote) blockedNetwork.add(new URL(details.url).hostname)
    callback({ cancel: remote })
  })
  const window = new BrowserWindow({
    width: 1600, height: 1100, useContentSize: true, show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false }
  })
  const entry = path.join(designRoot, 'index.html')
  assert(fs.existsSync(entry), 'The design index.html must exist before capture')
  await window.loadURL(pathToFileURL(entry).href + '#workspace')
  await window.webContents.executeJavaScript(`document.fonts.ready.then(() => true)`)
  await window.webContents.executeJavaScript(`(()=>{const style=document.createElement('style');style.id='capture-disable-motion';style.textContent='*,*::before,*::after{transition:none!important;animation:none!important;scroll-behavior:auto!important;caret-color:transparent!important}';document.head.appendChild(style);return true})()`)
  await captureScreens({
    evaluate: code => window.webContents.executeJavaScript(code),
    screenshot: async bounds => (await window.webContents.capturePage(bounds)).toPNG()
  }, { electron: process.versions.electron, chrome: process.versions.chrome }, blockedNetwork)
  window.destroy()
  app.quit()
}

async function captureWithChrome() {
  const { spawn } = require('node:child_process')
  const browser = [process.env.PRISM_CAPTURE_BROWSER,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
  ].find(file => file && fs.existsSync(file))
  assert(browser, 'A local Chrome, Edge or Electron executable is required; no browser download is attempted')
  const profile = path.join(repositoryRoot, 'tmp/design-capture', `prism-chrome-${Date.now()}-${process.pid}`)
  fs.mkdirSync(profile, { recursive: true })
  const child = spawn(browser, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--disable-sync', '--disable-component-update', '--disable-default-apps', '--disable-extensions',
    '--metrics-recording-only', '--hide-scrollbars', '--window-size=1600,1100', 'about:blank'
  ], { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] })
  let client
  const timer = setTimeout(() => child.kill(), 120000)
  try {
    const portFile = path.join(profile, 'DevToolsActivePort')
    await until(async () => fs.existsSync(portFile), 'The isolated browser did not expose its local debug port', 20000)
    const port = Number(fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0])
    const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json()
    client = await connectCDP(target.webSocketDebuggerUrl)
    const blockedNetwork = new Set()
    client.on('Fetch.requestPaused', async event => {
      try {
        const url = new URL(event.request.url)
        if (['127.0.0.1', 'localhost'].includes(url.hostname)) await client.send('Fetch.continueRequest', { requestId: event.requestId })
        else {
          blockedNetwork.add(url.hostname)
          await client.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' })
        }
      } catch {}
    })
    await client.send('Page.enable')
    await client.send('Runtime.enable')
    await client.send('Fetch.enable', { patterns: [{ urlPattern: 'http://*' }, { urlPattern: 'https://*' }, { urlPattern: 'ws://*' }, { urlPattern: 'wss://*' }] })
    await client.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false })
    const evaluate = async expression => {
      const result = await client.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true })
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
      return result.result.value
    }
    const entryURL = process.env.PRISM_CAPTURE_URL || 'http://127.0.0.1:4180/'
    await client.send('Page.navigate', { url: entryURL + '#workspace' })
    await until(async () => evaluate(`document.documentElement.dataset.ready==='true' && Boolean(document.querySelector('.app'))`), 'The design prototype did not become ready', 15000)
    await evaluate(`document.fonts.ready.then(()=>true)`)
    await evaluate(`(()=>{const style=document.createElement('style');style.id='capture-disable-motion';style.textContent='*,*::before,*::after{transition:none!important;animation:none!important;scroll-behavior:auto!important;caret-color:transparent!important}';document.head.appendChild(style);return true})()`)
    const version = await client.send('Browser.getVersion')
    await captureScreens({
      evaluate,
      screenshot: async bounds => {
        const result = await client.send('Page.captureScreenshot', { format: 'png', clip: { ...bounds, scale: 1 }, captureBeyondViewport: true, fromSurface: true })
        return Buffer.from(result.data, 'base64')
      }
    }, { browser: version.product, node: process.versions.node, engine: 'Isolated headless Chrome / CDP' }, blockedNetwork)
    await client.send('Browser.close').catch(() => {})
  } finally {
    clearTimeout(timer)
    client?.close()
    child.kill()
  }
}

async function connectCDP(url) {
  const socket = new WebSocket(url)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  let sequence = 0
  const requests = new Map()
  const listeners = new Map()
  socket.addEventListener('message', event => {
    const response = JSON.parse(event.data)
    if (response.id) {
      const pending = requests.get(response.id)
      if (!pending) return
      requests.delete(response.id)
      if (response.error) pending.reject(new Error(response.error.message))
      else pending.resolve(response.result || {})
    } else for (const listener of listeners.get(response.method) || []) Promise.resolve(listener(response.params)).catch(() => {})
  })
  socket.addEventListener('close', () => {
    for (const pending of requests.values()) pending.reject(new Error('The isolated browser closed'))
    requests.clear()
  })
  return {
    send(method, params = {}) {
      const requestId = ++sequence
      return new Promise((resolve, reject) => {
        requests.set(requestId, { resolve, reject })
        socket.send(JSON.stringify({ id: requestId, method, params }))
      })
    },
    on(method, listener) { const items = listeners.get(method) || []; items.push(listener); listeners.set(method, items) },
    close() { socket.close() }
  }
}

async function captureScreens(driver, runtime, blockedNetwork) {
  const previews = path.join(designRoot, 'previews')
  const imports = path.join(designRoot, 'figma-import')
  fs.mkdirSync(previews, { recursive: true })
  fs.mkdirSync(imports, { recursive: true })
  const screens = []
  for (const route of routes) {
    await driver.evaluate(`location.hash=${JSON.stringify(route)}; true`)
    await until(async () => driver.evaluate(`document.querySelector('.app')?.dataset.view===${JSON.stringify(route)}`), `Missing .app for ${route}`)
    await driver.evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`)
    const bounds = await driver.evaluate(`(()=>{const r=document.querySelector('.app').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`)
    assert.equal(bounds.width, 1440, `${route} must keep the 1440px design width`)
    assert.equal(bounds.height, 900, `${route} must keep the 900px design height`)
    const png = await driver.screenshot({ x: Math.round(bounds.x), y: Math.round(bounds.y), width: 1440, height: 900 })
    fs.writeFileSync(path.join(previews, `${route}.png`), png)
    const exported = await driver.evaluate(`(${exportNativeSVG.toString()})()`)
    assert(exported.stats.textNodes > 10, `${route} should contain editable text`)
    assert(!/<foreignObject\b/i.test(exported.svg), 'SVG may not contain foreignObject')
    fs.writeFileSync(path.join(imports, `${route}.svg`), exported.svg, 'utf8')
    screens.push({ route, screenshot: `previews/${route}.png`, svg: `figma-import/${route}.svg`, ...exported.stats })
    console.log(`${route}: ${exported.stats.textNodes} text layers, ${exported.stats.shapeNodes} shapes, ${exported.stats.vectorIcons} SVG icons`)
  }
  const states = await captureStates(driver, previews, imports)
  await driver.evaluate(`document.querySelector('#capture-disable-motion')?.remove(); true`)
  const interaction = await driver.evaluate(`(${verifyInteractions.toString()})()`)
  const motion = await captureMotion(driver, previews)
  const evidence = {
    date: '2026-10-30', width: 1440, height: 900, screens, states, interaction, motion,
    sourceSha256: Object.fromEntries(['index.html', 'style.css', 'prototype.js', 'motion-spec.json'].map(file => [file, require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(designRoot, file))).digest('hex')])),
    networkHostsBlocked: [...blockedNetwork],
    note: 'Design prototype uses simulated hosts and outputs. SVG is editable text, vector shapes and icons; no whole-UI raster or foreignObject. Native desktop/real SSH are outside this design check.',
    svgEffects: 'Native SVG preserves measured layout, editable text, fills, borders, clipping and vector icons. CSS shadows and backdrop blur are simplified; PNG is the visual reference.',
    runtime,
    screenshotMode: 'Hidden/isolated browser; no system clipboard or real credentials accessed.'
  }
  fs.writeFileSync(path.join(designRoot, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n', 'utf8')
  await driver.evaluate(`(()=>{const p=window.prismPrototype;p.state.server='web-01';p.state.ai=true;p.state.disconnected=false;p.state.targets=new Set(['web-01','web-02','db-01']);p.state.transfer='idle';p.state.progress=42;p.state.provider='Ollama';p.setReduce(false);p.navigate('terminal');return true})()`)
}

async function captureStates(driver, previews, imports) {
  const states = []
  fs.mkdirSync(path.join(previews, 'states'), { recursive: true })
  fs.mkdirSync(path.join(imports, 'states'), { recursive: true })
  const navigate = async route => {
    await driver.evaluate(`window.prismPrototype.navigate(${JSON.stringify(route)}); true`)
    await until(async () => driver.evaluate(`document.querySelector('.app')?.dataset.view===${JSON.stringify(route)}`), `Missing state route ${route}`)
    await driver.evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`)
  }
  const snapshot = async name => {
    const bounds = await driver.evaluate(`(()=>{const r=document.querySelector('.app').getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),width:1440,height:900}})()`)
    fs.writeFileSync(path.join(previews, 'states', `${name}.png`), await driver.screenshot(bounds))
    const exported = await driver.evaluate(`(${exportNativeSVG.toString()})()`)
    assert(exported.stats.textNodes > 10 && !/<foreignObject\b/i.test(exported.svg), `State ${name} must retain native editable layers`)
    fs.writeFileSync(path.join(imports, 'states', `${name}.svg`), exported.svg, 'utf8')
    states.push({ state: name, screenshot: `previews/states/${name}.png`, svg: `figma-import/states/${name}.svg`, ...exported.stats })
    console.log(`${name}: ${exported.stats.textNodes} text layers, ${exported.stats.shapeNodes} shapes`)
  }
  await navigate('workspace')
  await driver.evaluate(`document.querySelector('[data-action="toggle-empty"]').click(); true`)
  await snapshot('workspace-empty')
  await driver.evaluate(`document.querySelector('[data-action="toggle-empty"]').click(); true`)
  await navigate('terminal')
  await driver.evaluate(`document.querySelector('[data-action="approval"]').click(); true`)
  await until(async () => driver.evaluate(`Boolean(document.querySelector('.modal-backdrop.open'))`), 'Approval state did not open')
  await snapshot('terminal-approval')
  await driver.evaluate(`window.prismPrototype.closeModal(); true`)
  await until(async () => driver.evaluate(`!document.querySelector('.modal-backdrop')`), 'Approval state did not close')
  await driver.evaluate(`document.querySelector('[data-action="disconnect"]').click(); true`)
  await snapshot('terminal-disconnected')
  await driver.evaluate(`document.querySelector('[data-action="disconnect"]').click(); window.prismPrototype.state.targets.add('web-01'); true`)
  await navigate('connections')
  await driver.evaluate(`window.prismPrototype.openModal('fingerprint-changed'); true`)
  await until(async () => driver.evaluate(`Boolean(document.querySelector('.modal-backdrop.open'))`), 'Key-change state did not open')
  await snapshot('connections-key-change')
  await driver.evaluate(`window.prismPrototype.closeModal(); true`)
  await until(async () => driver.evaluate(`!document.querySelector('.modal-backdrop')`), 'Key-change state did not close')
  await navigate('files')
  await driver.evaluate(`document.querySelector('[data-action="start-transfer"]').click(); true`)
  await until(async () => driver.evaluate(`window.prismPrototype.state.transfer==='committing'`), 'Commit state unavailable')
  await snapshot('files-committing')
  await until(async () => driver.evaluate(`window.prismPrototype.state.transfer==='done'`), 'Commit capture did not finish')
  await driver.evaluate(`(()=>{const p=window.prismPrototype;p.state.transfer='idle';p.state.progress=42;p.state.transferTarget='web-01';p.state.targets=new Set(['web-01','web-02','db-01']);p.render();return true})()`)
  return states
}

async function until(predicate, message, timeout = 10000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise(resolve => setTimeout(resolve, 40))
  }
  throw new Error(message)
}

async function verifyInteractions() {
  const outcome = { routes: [], checks: [], reducedMotion: null, scope: 'Isolated simulated-data HTML prototype; no native desktop, SSH or model-provider calls.' }
  const prototype = window.prismPrototype
  const expect = (condition, message) => { if (!condition) throw new Error(message) }
  const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  const waitFor = async (condition, message, timeout = 6000) => {
    const limit = performance.now() + timeout
    while (performance.now() < limit) {
      if (condition()) return
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    throw new Error(message)
  }
  const navigate = async route => {
    prototype.navigate(route)
    await waitFor(() => document.querySelector('.app')?.dataset.view === route, `Missing ${route} route`)
    await frame()
  }
  const click = selector => {
    const element = document.querySelector(selector)
    expect(element && !element.disabled, `Missing/enabled control ${selector}`)
    element.focus()
    element.click()
    return element
  }
  for (const route of ['workspace', 'connections', 'terminal', 'files', 'settings', 'motion']) {
    await navigate(route)
    const app = document.querySelector('.app')
    expect(app && app.getBoundingClientRect().width === 1440 && app.getBoundingClientRect().height === 900, `Invalid artboard ${route}`)
    outcome.routes.push(route)
  }
  prototype.setReduce(false)
  await navigate('terminal')
  expect(prototype.state.ai, 'Assistant starts open')
  click('[data-action="toggle-ai"]')
  expect(document.querySelector('.terminal-layout').classList.contains('ai-hidden'), 'Assistant close updates layout')
  expect(document.querySelector('[data-action="toggle-ai"]').getAttribute('aria-expanded') === 'false', 'Assistant collapsed aria state')
  expect(document.querySelector('.assistant').inert && document.querySelector('.assistant').getAttribute('aria-hidden') === 'true', 'Collapsed assistant is inert and aria-hidden')
  click('[data-action="toggle-ai"]')
  expect(!document.querySelector('.terminal-layout').classList.contains('ai-hidden'), 'Assistant can reopen')
  expect(!document.querySelector('.assistant').inert, 'Open assistant restores interaction')
  outcome.checks.push({ name: 'assistant-toggle', passed: true, assertion: 'Opens and closes; layout, aria-expanded, aria-hidden and inert agree.' })

  const before = prototype.state.targets.size
  click('[data-action="targetpicker"]')
  const target = document.querySelector('input[data-target="web-02"]')
  expect(target?.checked, 'web-02 starts selected')
  target.click()
  expect(prototype.state.targets.size === before - 1 && !prototype.state.targets.has('web-02'), 'Target deselection changes count')
  expect(![...document.querySelectorAll('.target-chips')].some(node => node.textContent.includes('web-02')), 'Deselected target disappears from chips')
  target.click()
  expect(prototype.state.targets.size === before && prototype.state.targets.has('web-02'), 'Target can be selected again')
  expect([...document.querySelectorAll('.target-chips')].some(node => node.textContent.includes('web-02')), 'Selected target returns to chips')
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  expect(document.querySelector('[data-action="targetpicker"]').getAttribute('aria-expanded') === 'false', 'Escape resets target-picker aria state')
  outcome.checks.push({ name: 'target-selection', passed: true, assertion: 'web-02 checkbox changes target set, count and visible chips immediately.' })

  const approvalTrigger = click('[data-action="approval"]')
  await waitFor(() => document.querySelector('.modal-backdrop.open'), 'Approval dialog must open')
  expect(document.activeElement === document.querySelector('.modal-actions [data-action="close-modal"]'), 'Approval defaults focus to cancel')
  const focusable = [...document.querySelectorAll('.modal-backdrop button:not([disabled]),.modal-backdrop input,.modal-backdrop select,.modal-backdrop textarea,.modal-backdrop a[href]')]
  focusable.at(-1).focus()
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
  expect(document.activeElement === focusable[0], 'Modal traps forward Tab')
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await waitFor(() => !document.querySelector('.modal-backdrop'), 'Escape must close approval')
  expect(document.activeElement === approvalTrigger, 'Closing restores trigger focus')
  outcome.checks.push({ name: 'approval-keyboard', passed: true, assertion: 'Cancel receives default focus, Tab remains in dialog, Escape closes and restores focus.' })

  await navigate('files')
  const lastFailure = document.querySelector('#transfer-list .transfer-row:last-child').getBoundingClientRect()
  const filesBody = document.querySelector('.files-body').getBoundingClientRect()
  expect(lastFailure.bottom <= filesBody.bottom + 1, 'Last failed transfer is visible inside file panel')
  outcome.checks.push({ name: 'files-failure-visible', passed: true, assertion: 'Last failed transfer bottom is inside the visible file panel.', rowBottom: lastFailure.bottom, panelBottom: filesBody.bottom })
  click('[data-action="start-transfer"]')
  expect(prototype.state.transfer === 'running' && prototype.state.progress === 0, 'Transfer starts at zero')
  click('[data-action="cancel-transfer"]')
  expect(prototype.state.transfer === 'cancelled', 'Running transfer can cancel')
  click('[data-action="start-transfer"]')
  const progressElement = document.querySelector('.progress-fill')
  expect(getComputedStyle(progressElement).transitionProperty === 'transform', 'Progress animates transform')
  await waitFor(() => prototype.state.progress > 0, 'Transfer needs its first progress sample')
  expect(document.querySelector('.progress-fill') === progressElement && progressElement.isConnected, 'Progress element survives a progress sample')
  await waitFor(() => prototype.state.transfer === 'committing', 'Transfer must enter commit phase')
  expect(prototype.state.progress === 99.9, 'Committing stays below 100 percent')
  expect(document.querySelector('[data-action="cancel-transfer"]')?.disabled, 'Commit phase disables cancellation')
  await waitFor(() => prototype.state.transfer === 'done', 'Transfer must finish after commit')
  expect(prototype.state.progress === 100, 'Only complete transfer displays 100 percent')
  outcome.checks.push({ name: 'transfer-states', passed: true, assertion: 'Running can cancel; progress keeps the same DOM node and uses transform interpolation; 99.9% commit disables cancellation before done/100%.' })

  await navigate('settings')
  click('[data-action="provider-picker"]')
  await waitFor(() => document.querySelector('.modal-backdrop.open'), 'Provider picker opens')
  click('[data-action="select-provider"][data-provider="OpenAI 兼容服务"]')
  await waitFor(() => prototype.state.provider === 'OpenAI 兼容服务' && !document.querySelector('.modal-backdrop'), 'Selected provider is applied')
  expect(document.querySelector('.provider-slab h3').textContent === 'OpenAI 兼容服务', 'Provider name updates visibly')
  outcome.checks.push({ name: 'provider-selection', passed: true, assertion: 'Provider dialog changes the selected service and displayed configuration without any network call.' })
  prototype.state.provider = 'Ollama'

  await navigate('terminal')
  click('[data-action="host-tab"][data-host="web-02"]')
  await frame()
  expect(document.querySelector('.terminal-output').textContent.includes('deploy@web-02') && !document.querySelector('.terminal-output').textContent.includes('deploy@web-01'), 'web-02 terminal uses the correct host prompt')
  expect(document.querySelector('.host-heading').textContent === 'web-02', 'Terminal header follows host')
  await navigate('files')
  click('[data-action="upload"]')
  await waitFor(() => document.querySelector('.modal-backdrop.open'), 'Upload confirmation opens')
  expect(document.querySelector('.modal .identity-block').textContent.includes('web-02'), 'Upload confirmation identifies web-02')
  click('[data-action="confirm-upload"]')
  await waitFor(() => prototype.state.transfer === 'running', 'Confirmed upload starts')
  expect(prototype.state.transferTarget === 'web-02', 'Upload is bound to the confirmed host')
  click('[data-action="select-host"][data-host="web-01"]')
  await navigate('files')
  const historyPaths = [...document.querySelectorAll('#transfer-list .target-path')].map(node => node.textContent)
  expect(historyPaths[0].includes('web-02') && historyPaths[1].includes('web-01') && historyPaths[2].includes('web-02'), 'Switching current host does not relabel historical task targets')
  await waitFor(() => prototype.state.transfer === 'done', 'Host-bound upload completes')
  outcome.checks.push({ name: 'host-and-task-binding', passed: true, assertion: 'web-02 updates terminal prompt/header; upload confirms web-02; changing current host keeps upload and history targets fixed.', historyPaths })

  await navigate('terminal')
  click('[data-action="disconnect"]')
  expect(prototype.state.disconnected && !prototype.state.targets.has('web-01'), 'Disconnect removes unavailable host from selected targets')
  click('[data-action="targetpicker"]')
  expect(document.querySelector('input[data-target="web-01"]')?.disabled, 'Disconnected host cannot be selected')
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  click('[data-action="disconnect"]')
  expect(!prototype.state.disconnected, 'Disconnect demo can reset')
  prototype.state.targets.add('web-01')
  outcome.checks.push({ name: 'disconnect-target', passed: true, assertion: 'Lost host is removed from targets and disabled in picker; the demonstration can be reset.' })

  await navigate('motion')
  const reduce = document.querySelector('#reduce-motion')
  expect(reduce, 'Review toolbar has a reduced-motion checkbox')
  reduce.click()
  expect(prototype.state.reduced && document.documentElement.dataset.reduce === 'true', 'Reduced-motion checkbox updates state and CSS hook')
  click('[data-action="play-motion"]')
  await waitFor(() => document.querySelector('#motion-drawer').classList.contains('open'), 'Reduced-motion demo opens drawer')
  const drawer = getComputedStyle(document.querySelector('#motion-drawer'))
  expect(drawer.transform === 'none', 'Reduced-motion drawer has no translation or scale')
  const spatialKeyframes = document.getAnimations().flatMap(animation => animation.effect?.getKeyframes?.() || []).filter(keyframe => ['transform', 'translate', 'scale', 'rotate', 'filter'].some(key => keyframe[key] && keyframe[key] !== 'none'))
  expect(spatialKeyframes.length === 0, 'Reduced-motion active animations contain no spatial/filter keyframes')
  await waitFor(() => document.querySelector('.app').dataset.motion === 'done', 'Reduced-motion sequence completes')
  outcome.reducedMotion = {
    systemPreference: matchMedia('(prefers-reduced-motion: reduce)').matches,
    hasDocumentControl: true, drawerTransform: drawer.transform,
    transitionProperty: drawer.transitionProperty, activeSpatialKeyframes: spatialKeyframes.length,
    completed: true
  }
  outcome.checks.push({ name: 'reduced-motion', passed: true, assertion: 'Manual control works, drawer has transform:none, active animation keyframes have no spatial properties, state sequence completes.' })
  prototype.setReduce(false)
  await navigate('motion')
  expect(!document.querySelector('#capture-disable-motion'), 'Motion verification must not use the static screenshot override')
  return outcome
}

async function captureMotion(driver, previews) {
  const directory = path.join(previews, 'motion-frames')
  fs.mkdirSync(directory, { recursive: true })
  await driver.evaluate(`(()=>{const p=window.prismPrototype;p.setReduce(false);p.navigate('motion');return true})()`)
  await until(async () => driver.evaluate(`document.querySelector('.app')?.dataset.view==='motion'`), 'Motion route unavailable')
  await driver.evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`)
  const bounds = await driver.evaluate(`(()=>{const r=document.querySelector('.motion-stage').getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)}})()`)
  await driver.evaluate(`window.prismPrototype.playMotion(); window.__motionCaptureStart=performance.now(); true`)
  const frames = []
  for (const [index, offset] of [0, 450, 1050, 1850, 2800, 3550].entries()) {
    await driver.evaluate(`new Promise(resolve=>setTimeout(resolve,Math.max(0,${offset}-(performance.now()-window.__motionCaptureStart))))`)
    const file = `frame-${String(index + 1).padStart(2, '0')}.png`
    const state = await driver.evaluate(`(()=>({ elapsedMs:Math.round(performance.now()-window.__motionCaptureStart),phase:document.querySelector('#motion-state').textContent.trim(),drawerOpen:document.querySelector('#motion-drawer').classList.contains('open'),drawerTransform:getComputedStyle(document.querySelector('#motion-drawer')).transform,confirmationVisible:document.querySelector('#motion-confirm').classList.contains('open'),status:document.querySelector('.app').dataset.motion,reduced:window.prismPrototype.state.reduced }))()`)
    fs.writeFileSync(path.join(directory, file), await driver.screenshot(bounds))
    frames.push({ file: `previews/motion-frames/${file}`, ...state })
  }
  assert.equal(frames.at(-1).status, 'done', 'Motion sample must finish')
  const durations = frames.map((frame, index) => index < frames.length - 1 ? (frames[index + 1].elapsedMs - frame.elapsedMs) / 1000 : 0.9)
  const concat = frames.map((frame, index) => `file '${path.basename(frame.file)}'\nduration ${Math.max(0.05, durations[index]).toFixed(3)}`).join('\n') + `\nfile '${path.basename(frames.at(-1).file)}'\n`
  fs.writeFileSync(path.join(directory, 'frames.txt'), concat, 'utf8')
  const { spawnSync } = require('node:child_process')
  const result = spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(directory, 'frames.txt'), '-filter_complex', '[0:v]split[a][b];[a]palettegen[p];[b][p]paletteuse', path.join(previews, 'motion-keyframes.gif')], { windowsHide: true, encoding: 'utf8', timeout: 30000 })
  assert.equal(result.status, 0, result.stderr || result.error?.message || 'ffmpeg keyframe GIF failed')
  console.log(`motion: ${frames.length} keyframes, ${bounds.width}x${bounds.height}; interactive checks passed`)
  return { frames, crop: { width: bounds.width, height: bounds.height }, gif: 'previews/motion-keyframes.gif', note: 'Six timed keyframes from the working simulated-data motion prototype; GIF is a keyframe review, not a real SSH recording.' }
}

function exportNativeSVG() {
  const app = document.querySelector('.app')
  const base = app.getBoundingClientRect()
  const width = Math.round(base.width)
  const height = Math.round(base.height)
  const stats = { textNodes: 0, shapeNodes: 0, vectorIcons: 0, rasterAssets: 0, clips: 0, gradients: 0, domElements: 0 }
  const definitions = []
  let sequence = 0
  const id = prefix => `${prefix}-${++sequence}`
  const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character]))
  const number = value => Number(value.toFixed(3))
  const colorCanvas = document.createElement('canvas')
  colorCanvas.width = 1; colorCanvas.height = 1
  const colorContext = colorCanvas.getContext('2d', { willReadFrequently: true })
  const colorCache = new Map()
  const color = value => {
    if (!value || value === 'none' || String(value).startsWith('url(')) return { rgb: value || 'none', alpha: 1 }
    if (colorCache.has(value)) return colorCache.get(value)
    colorContext.clearRect(0, 0, 1, 1)
    colorContext.fillStyle = value
    colorContext.fillRect(0, 0, 1, 1)
    const bytes = colorContext.getImageData(0, 0, 1, 1).data
    const result = { rgb: `rgb(${bytes[0]},${bytes[1]},${bytes[2]})`, alpha: number(bytes[3] / 255) }
    colorCache.set(value, result)
    return result
  }
  const paint = (attribute, value) => {
    const normalized = color(value)
    return ` ${attribute}="${escape(normalized.rgb)}"${normalized.alpha < 1 ? ` ${attribute}-opacity="${normalized.alpha}"` : ''}`
  }
  const transparent = color => !color || color === 'transparent' || /rgba\([^)]*,\s*0\s*\)/.test(color)
  const splitTopLevel = value => {
    const values = []
    let depth = 0, start = 0
    for (let index = 0; index < value.length; index++) {
      if (value[index] === '(') depth++
      if (value[index] === ')') depth--
      if (value[index] === ',' && depth === 0) { values.push(value.slice(start, index).trim()); start = index + 1 }
    }
    values.push(value.slice(start).trim())
    return values
  }
  const roundedPath = (x, y, w, h, style) => {
    const radius = key => Math.min(w / 2, h / 2, parseFloat(style[key]) || 0)
    const tl = radius('borderTopLeftRadius'), tr = radius('borderTopRightRadius')
    const br = radius('borderBottomRightRadius'), bl = radius('borderBottomLeftRadius')
    return `M${number(x + tl)} ${number(y)}H${number(x + w - tr)}Q${number(x + w)} ${number(y)} ${number(x + w)} ${number(y + tr)}V${number(y + h - br)}Q${number(x + w)} ${number(y + h)} ${number(x + w - br)} ${number(y + h)}H${number(x + bl)}Q${number(x)} ${number(y + h)} ${number(x)} ${number(y + h - bl)}V${number(y + tl)}Q${number(x)} ${number(y)} ${number(x + tl)} ${number(y)}Z`
  }
  const shape = (r, style, fill, stroke, strokeWidth = 0) => {
    if (r.width <= 0 || r.height <= 0) return ''
    stats.shapeNodes++
    return `<path d="${roundedPath(r.x - base.x, r.y - base.y, r.width, r.height, style)}"${paint('fill', fill || 'none')}${stroke ? `${paint('stroke', stroke)} stroke-width="${number(strokeWidth)}"` : ''}/>`
  }
  const gradient = background => {
    if (!background || background === 'none') return null
    const layers = splitTopLevel(background)
    const first = layers.find(layer => /^(?:linear|radial)-gradient\(/.test(layer))
    if (!first) return null
    const radial = first.startsWith('radial')
    const content = first.slice(first.indexOf('(') + 1, -1)
    const pieces = splitTopLevel(content)
    let angle = 180
    if (pieces[0].includes('deg')) angle = parseFloat(pieces.shift())
    else if (/^to /.test(pieces[0])) {
      const direction = pieces.shift()
      angle = /right/.test(direction) ? (/bottom/.test(direction) ? 135 : /top/.test(direction) ? 45 : 90) : /left/.test(direction) ? (/bottom/.test(direction) ? 225 : /top/.test(direction) ? 315 : 270) : /top/.test(direction) ? 0 : 180
    } else if (radial && !/^(?:rgb|#|color|transparent)/.test(pieces[0])) pieces.shift()
    const stops = pieces.map((piece, index) => {
      const match = piece.match(/^(.*?)(?:\s+(-?[\d.]+)%)(?:\s+[-\d.]+%)?$/)
      return { color: match ? match[1] : piece, offset: match ? Math.max(0, Math.min(100, Number(match[2]))) : pieces.length < 2 ? 0 : index / (pieces.length - 1) * 100 }
    })
    const gradientId = id('gradient')
    if (radial) {
      definitions.push(`<radialGradient id="${gradientId}">${stops.map(stop => `<stop offset="${stop.offset}%"${paint('stop-color', stop.color).replace('stop-color-opacity', 'stop-opacity')}/>`).join('')}</radialGradient>`)
    } else {
      const radians = angle * Math.PI / 180
      const dx = Math.sin(radians) * 0.5, dy = -Math.cos(radians) * 0.5
      definitions.push(`<linearGradient id="${gradientId}" x1="${0.5 - dx}" y1="${0.5 - dy}" x2="${0.5 + dx}" y2="${0.5 + dy}">${stops.map(stop => `<stop offset="${stop.offset}%"${paint('stop-color', stop.color).replace('stop-color-opacity', 'stop-opacity')}/>`).join('')}</linearGradient>`)
    }
    stats.gradients++
    return `url(#${gradientId})`
  }
  const readText = node => {
    const parent = node.parentElement
    if (!parent) return ''
    const style = getComputedStyle(parent)
    if (style.visibility === 'hidden' || Number(style.fontSize) === 0) return ''
    const content = node.textContent || ''
    if (!content.trim()) return ''
    const range = document.createRange()
    const lines = []
    let line = null
    let offset = 0
    for (const character of content) {
      range.setStart(node, offset)
      offset += character.length
      range.setEnd(node, offset)
      const rect = range.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) continue
      if (!line || Math.abs(line.top - rect.top) > 1.2 || Math.abs(line.right - rect.left) > 3) {
        line = { text: character, x: rect.x - base.x, top: rect.y, right: rect.right, height: rect.height }
        lines.push(line)
      } else { line.text += character; line.right = rect.right }
    }
    range.detach()
    return lines.map(line => {
      if (!line.text.trim()) return ''
      stats.textNodes++
      const size = parseFloat(style.fontSize)
      return `<text x="${number(line.x)}" y="${number(line.top - base.y + line.height * 0.81)}"${paint('fill', style.color)} font-family="${escape(style.fontFamily)}" font-size="${number(size)}" font-weight="${escape(style.fontWeight)}" font-style="${escape(style.fontStyle)}"${style.letterSpacing !== 'normal' ? ` letter-spacing="${escape(style.letterSpacing)}"` : ''} xml:space="preserve">${escape(line.text)}</text>`
    }).join('')
  }
  const nativeInputText = (element, style, rect) => {
    if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)) return ''
    const value = element.tagName === 'SELECT' ? element.selectedOptions[0]?.textContent : element.value || element.placeholder
    if (!value || ['checkbox', 'radio', 'range', 'color'].includes(element.type)) return ''
    const size = parseFloat(style.fontSize)
    const x = rect.x - base.x + (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.borderLeftWidth) || 0)
    const y = rect.y - base.y + rect.height / 2 + size * 0.34
    stats.textNodes++
    return `<text x="${number(x)}" y="${number(y)}"${paint('fill', style.color)} font-family="${escape(style.fontFamily)}" font-size="${number(size)}" font-weight="${escape(style.fontWeight)}">${escape(value)}</text>`
  }
  const pseudoShape = (element, parentStyle, rect, pseudo) => {
    const style = getComputedStyle(element, pseudo)
    if (style.content === 'none' || style.content === 'normal' || style.display === 'none' || transparent(style.backgroundColor)) return ''
    const px = value => value === 'auto' ? null : parseFloat(value)
    const left = px(style.left), right = px(style.right), top = px(style.top), bottom = px(style.bottom)
    const width = px(style.width) ?? (left !== null && right !== null ? rect.width - left - right : 0)
    const height = px(style.height) ?? (top !== null && bottom !== null ? rect.height - top - bottom : 0)
    if (!width || !height) return ''
    let x = rect.x + (parseFloat(parentStyle.paddingLeft) || 0) + (parseFloat(parentStyle.borderLeftWidth) || 0)
    let y = rect.y + (parseFloat(parentStyle.paddingTop) || 0) + (parseFloat(parentStyle.borderTopWidth) || 0)
    if (style.position === 'absolute') {
      x = rect.x + (left ?? rect.width - (right ?? 0) - width)
      y = rect.y + (top ?? rect.height - (bottom ?? 0) - height)
    } else if (parentStyle.alignItems === 'center') y = rect.y + (rect.height - height) / 2
    if (style.transform !== 'none') {
      const matrix = new DOMMatrix(style.transform)
      x += matrix.e; y += matrix.f
    }
    return shape({ x, y, width, height }, style, style.backgroundColor)
  }
  // Symbol references remain vectors when the prototype uses a shared icon sprite.
  for (const symbol of document.querySelectorAll('svg symbol')) definitions.push(symbol.outerHTML)
  const walk = element => {
    if (!(element instanceof Element)) return element.nodeType === Node.TEXT_NODE ? readText(element) : ''
    if (['SCRIPT', 'STYLE', 'LINK', 'NOSCRIPT', 'TEMPLATE'].includes(element.tagName) || element.hasAttribute('data-export-ignore')) return ''
    const style = getComputedStyle(element)
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return ''
    const rect = element.getBoundingClientRect()
    if (!rect.width || !rect.height) return ''
    stats.domElements++
    if (element instanceof SVGSVGElement) {
      stats.vectorIcons++
      const clone = element.cloneNode(true)
      clone.setAttribute('x', number(rect.x - base.x))
      clone.setAttribute('y', number(rect.y - base.y))
      clone.setAttribute('width', number(rect.width))
      clone.setAttribute('height', number(rect.height))
      clone.setAttribute('color', color(style.color).rgb)
      clone.style.color = color(style.color).rgb
      clone.style.width = `${rect.width}px`
      clone.style.height = `${rect.height}px`
      clone.style.position = 'static'
      const applySVGStyle = (target, computed) => {
        for (const key of ['fill', 'stroke', 'strokeWidth', 'strokeLinecap', 'strokeLinejoin', 'opacity']) {
          if (!computed[key]) continue
          if (key === 'fill' || key === 'stroke') {
            const normalized = color(computed[key])
            target.style[key] = normalized.rgb
            if (normalized.alpha < 1) target.style[`${key}Opacity`] = normalized.alpha
          } else target.style[key] = computed[key]
        }
      }
      applySVGStyle(clone, style)
      const sourceChildren = element.querySelectorAll('*')
      const cloneChildren = clone.querySelectorAll('*')
      for (let index = 0; index < sourceChildren.length; index++) {
        const childStyle = getComputedStyle(sourceChildren[index])
        applySVGStyle(cloneChildren[index], childStyle)
      }
      return clone.outerHTML
    }
    let inside = ''
    if (!transparent(style.backgroundColor)) inside += shape(rect, style, style.backgroundColor)
    const fill = gradient(style.backgroundImage)
    if (fill) inside += shape(rect, style, fill)
    const sides = ['Top', 'Right', 'Bottom', 'Left']
    const borders = sides.map(side => ({ width: parseFloat(style[`border${side}Width`]) || 0, color: style[`border${side}Color`] }))
    if (borders[0].width && borders.every(border => border.width === borders[0].width && border.color === borders[0].color)) {
      inside += shape(rect, style, 'none', borders[0].color, borders[0].width)
    } else {
      for (let index = 0; index < borders.length; index++) {
        const border = borders[index]
        if (!border.width || transparent(border.color)) continue
        const x = rect.x - base.x, y = rect.y - base.y, w = rect.width, h = rect.height
        const edges = [[x, y, w, border.width], [x + w - border.width, y, border.width, h], [x, y + h - border.width, w, border.width], [x, y, border.width, h]]
        const edge = edges[index]
        stats.shapeNodes++
        inside += `<rect x="${number(edge[0])}" y="${number(edge[1])}" width="${number(edge[2])}" height="${number(edge[3])}"${paint('fill', border.color)}/>`
      }
    }
    inside += pseudoShape(element, style, rect, '::before')
    if (element instanceof HTMLImageElement && element.complete && element.naturalWidth) {
      const canvas = document.createElement('canvas')
      canvas.width = element.naturalWidth; canvas.height = element.naturalHeight
      canvas.getContext('2d').drawImage(element, 0, 0)
      inside += `<image x="${number(rect.x - base.x)}" y="${number(rect.y - base.y)}" width="${number(rect.width)}" height="${number(rect.height)}" href="${canvas.toDataURL('image/png')}"/>`
      stats.rasterAssets++
    }
    inside += nativeInputText(element, style, rect)
    for (const child of element.childNodes) inside += walk(child)
    inside += pseudoShape(element, style, rect, '::after')
    let clip = ''
    if (element === app || /hidden|clip|auto|scroll/.test(`${style.overflowX} ${style.overflowY}`)) {
      const clipId = id('clip')
      definitions.push(`<clipPath id="${clipId}"><path d="${roundedPath(rect.x - base.x, rect.y - base.y, rect.width, rect.height, style)}"/></clipPath>`)
      clip = ` clip-path="url(#${clipId})"`
      stats.clips++
    }
    const name = element.getAttribute('aria-label') || element.getAttribute('data-export-name') || element.className || element.tagName.toLowerCase()
    return `<g data-name="${escape(String(name))}"${Number(style.opacity) < 1 ? ` opacity="${escape(style.opacity)}"` : ''}${clip}>${inside}</g>`
  }
  const body = walk(app)
  return {
    svg: `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><title>Prism editable UI design — ${escape(location.hash.slice(1) || 'workspace')}</title><desc>Native vector shapes and editable text, exported from an isolated simulated-data design prototype. No foreignObject or whole-interface screenshot.</desc><defs>${definitions.join('')}</defs>${body}</svg>\n`,
    stats
  }
}
