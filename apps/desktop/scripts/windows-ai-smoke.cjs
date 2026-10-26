/** Windows Electron integration check against a loopback-only model fixture. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const desktopRoot = path.resolve(__dirname, '..')
const repositoryRoot = path.resolve(desktopRoot, '../..')

async function launch() {
  assert.equal(process.platform, 'win32', 'This check is intended for Windows')
  const outputDir = path.join(repositoryRoot, 'tmp', 'windows-validation', `ai-${Date.now()}`)
  fs.mkdirSync(outputDir, { recursive: true })
  const result = await require('esbuild').build({
    stdin: {
      contents: browserProbe,
      resolveDir: desktopRoot,
      sourcefile: 'windows-ai-probe.ts',
      loader: 'ts'
    },
    bundle: true,
    platform: 'browser',
    format: 'iife',
    globalName: 'WindowsAiProbe',
    write: false
  })
  fs.writeFileSync(path.join(outputDir, 'probe.js'), result.outputFiles[0].text)
  const env = { ...process.env, WINDOWS_AI_SMOKE_DIR: outputDir }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  const child = spawn(require('electron'), [__filename], {
    cwd: desktopRoot, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
  })
  const stdout = fs.createWriteStream(path.join(outputDir, 'stdout.log'))
  const stderr = fs.createWriteStream(path.join(outputDir, 'stderr.log'))
  child.stdout.pipe(stdout)
  child.stderr.pipe(stderr)
  const timer = setTimeout(() => child.kill(), 70000)
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', resolve)
  })
  clearTimeout(timer)
  const resultPath = path.join(outputDir, 'result.json')
  assert.equal(code, 0, `Windows AI smoke failed; see ${outputDir}`)
  const report = JSON.parse(fs.readFileSync(resultPath, 'utf8'))
  assert.equal(report.success, true)
  console.log(JSON.stringify({ ...report, resultPath }, null, 2))
}

const browserProbe = String.raw`
import { LLMSession } from './src/services/llm.ts'
import { testProviderConnection } from './src/services/ai-test.service.ts'
import type { AIModel, AIProvider } from './src/types/ai-providers'
import { z } from 'zod'
const check = (condition, message) => { if (!condition) throw new Error(message) }
export async function run(endpoint) {
  const provider: AIProvider = {
    id: 'openai', name: 'Local validation', description: 'Loopback model fixture',
    icon: '', website: '', endpoint, apiKey: 'windows-validation-local',
    enabled: true, isDefault: false, models: []
  }
  const model = (id: string): AIModel => ({
    id, name: id, providerId: provider.id, contextWindow: 8192,
    capabilities: { text: true, image: false, functionCall: true, vision: false }
  })
  const tool = {
    id: 'probe',
    init: async () => ({
      description: 'Harmless validation tool',
      parameters: z.object({ message: z.string(), note: z.string().optional() }),
      execute: async () => ({ title: 'probe', metadata: {}, output: 'ok' })
    })
  }
  const connection = await testProviderConnection(provider, 'windows-fixture')
  check(connection.success, 'Model connection test failed')
  const chunks = []
  for await (const chunk of new LLMSession(provider, model('windows-fixture'), [tool], 'fixture').stream([
    { role: 'user', content: 'Windows 中文流式测试' }
  ])) chunks.push(chunk)
  check(chunks.filter(item => item.type === 'text').map(item => item.content).join('') === '你好，Windows ✅', 'UTF-8 streaming was corrupted')
  const call = chunks.find(item => item.type === 'tool-call')
  check(call?.toolCallId === 'call_windows' && call.toolName === 'probe' && call.toolInput?.message === '中文参数', 'Fragmented tool call was corrupted')
  check(chunks.some(item => item.type === 'done'), 'Stream did not complete')

  let rejected = false
  try {
    for await (const _chunk of new LLMSession(provider, model('unauthorized'), [], 'fixture').stream([])) {}
  } catch (error) { rejected = /HTTP 401/.test(String(error)) }
  check(rejected, 'HTTP authentication failure was not surfaced')

  const controller = new AbortController()
  let abortObserved = false
  let receivedBeforeAbort = false
  try {
    const session = new LLMSession(provider, model('cancel'), [], 'fixture', undefined, undefined, controller.signal)
    for await (const chunk of session.stream([])) {
      if (chunk.type === 'text') {
        receivedBeforeAbort = true
        controller.abort()
      }
    }
  } catch (error) { abortObserved = error?.name === 'AbortError' }
  check(receivedBeforeAbort && abortObserved, 'Streaming cancellation failed')
  return { connectionTest: true, utf8Streaming: true, fragmentedToolCall: true, authenticationError: true, cancellation: true }
}`

async function runElectron() {
  const { app, BrowserWindow, globalShortcut, session } = require('electron')
  const http = require('node:http')
  const outputDir = process.env.WINDOWS_AI_SMOKE_DIR
  assert.ok(outputDir, 'Use the Node launcher to isolate test data')
  process.env.NODE_ENV = 'production'
  process.env.ELECTRON_FORCE_PROD_RENDERER = '1'
  app.setPath('userData', path.join(outputDir, 'profile'))
  app.setPath('sessionData', path.join(outputDir, 'profile'))
  BrowserWindow.prototype.show = function () {}
  BrowserWindow.prototype.showInactive = function () {}
  BrowserWindow.prototype.focus = function () {}
  globalShortcut.register = () => false
  const unexpectedHosts = new Set()
  let schemaValidated = false
  let requests = 0
  const server = http.createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*')
    response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return }
    try {
      assert.equal(request.method, 'POST')
      assert.equal(request.url, '/v1/chat/completions')
      assert.equal(request.headers.authorization, 'Bearer windows-validation-local')
      let raw = ''
      for await (const part of request) raw += part
      const body = JSON.parse(raw)
      requests++
      if (body.model === 'unauthorized') {
        response.writeHead(401, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ error: { message: 'fixture unauthorized' } }))
        return
      }
      if (!body.stream) {
        response.setHeader('Content-Type', 'application/json')
        response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }))
        return
      }
      response.setHeader('Content-Type', 'text/event-stream')
      const event = choice => `data: ${JSON.stringify({ choices: [choice] })}\n\n`
      if (body.model === 'cancel') {
        response.write(event({ delta: { content: 'start' }, finish_reason: null }))
        return
      }
      const parameters = body.tools?.[0]?.function?.parameters
      assert.equal(parameters?.type, 'object')
      assert.deepEqual(parameters?.required, ['message'])
      assert.equal(parameters?.properties?.message?.type, 'string')
      schemaValidated = true
      const events = [
        event({ delta: { content: '你好，Windows ✅' }, finish_reason: null }),
        event({ delta: { tool_calls: [{ index: 0, id: 'call_windows', type: 'function', function: { name: 'probe', arguments: '{"message":"' } }] }, finish_reason: null }),
        event({ delta: { tool_calls: [{ index: 0, function: { arguments: '中文参数"}' } }] }, finish_reason: null }),
        event({ delta: {}, finish_reason: 'tool_calls' }),
        'data: [DONE]\n\n'
      ]
      // Split within a multibyte Chinese character, and across SSE records.
      const bytes = Buffer.from(events.join(''))
      const split = bytes.indexOf(Buffer.from('你')) + 1
      response.write(bytes.subarray(0, split))
      await new Promise(resolve => setTimeout(resolve, 20))
      response.write(bytes.subarray(split, split + 32))
      await new Promise(resolve => setTimeout(resolve, 20))
      response.end(bytes.subarray(split + 32))
    } catch (error) {
      response.statusCode = 500
      response.end(String(error))
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const endpoint = `http://127.0.0.1:${server.address().port}/v1`
  let complete = false
  const finish = (success, details) => {
    if (complete) return
    complete = true
    fs.writeFileSync(path.join(outputDir, 'result.json'), JSON.stringify({
      success, platform: process.platform, arch: process.arch,
      electron: process.versions.electron, requests, schemaValidated,
      unexpectedHosts: [...unexpectedHosts], ...details
    }, null, 2))
    server.closeAllConnections()
    server.close()
    app.exit(success ? 0 : 1)
  }
  setTimeout(() => finish(false, { error: 'Timed out' }), 60000)
  app.on('ready', () => {
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      const url = new URL(details.url)
      const network = ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)
      const unexpected = network && url.origin !== endpoint.replace('/v1', '')
      if (unexpected) unexpectedHosts.add(url.hostname)
      callback({ cancel: unexpected })
    })
  })
  let tested = false
  app.on('web-contents-created', (_, contents) => {
    contents.on('did-finish-load', async () => {
      if (tested || !contents.getURL().startsWith('file:')) return
      tested = true
      try {
        const script = fs.readFileSync(path.join(outputDir, 'probe.js'), 'utf8')
        const details = await contents.executeJavaScript(script + `\nWindowsAiProbe.run(${JSON.stringify(endpoint)})`)
        assert.equal(schemaValidated, true)
        assert.equal(unexpectedHosts.size, 0)
        assert.equal(requests, 4)
        finish(true, details)
      } catch (error) { finish(false, { error: String(error) }) }
    })
  })
  require(path.join(desktopRoot, 'dist-electron', 'main', 'index.js'))
}

if (process.versions.electron) {
  runElectron().catch(error => { console.error(error); require('electron').app.exit(1) })
} else {
  launch().catch(error => { console.error(error); process.exitCode = 1 })
}
