import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import * as vue from 'vue'
import * as renderer from 'vue/server-renderer'
import { parse, compileScript } from 'vue/compiler-sfc'
import ts from 'typescript'
import * as display from './update-download-progress'

async function loadComponent(): Promise<vue.Component> {
  const filename = 'UpdateDownloadProgress.vue'
  const source = await readFile(new URL(`./${filename}`, import.meta.url), 'utf8')
  const { descriptor, errors } = parse(source, { filename })
  assert.deepEqual(errors, [])
  const script = compileScript(descriptor, { id: 'update-download-progress-test', inlineTemplate: true,
    templateOptions: { ssr: true } })
  const javascript = ts.transpileModule(script.content, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS
  } }).outputText
  const module = { exports: {} as { default?: vue.Component } }
  const dependencies: Record<string, unknown> = {
    vue, 'vue/server-renderer': renderer, './update-download-progress': display
  }
  new Function('require', 'module', 'exports', javascript)((id: string) => {
    assert(Object.hasOwn(dependencies, id), `Unexpected component dependency: ${id}`)
    return dependencies[id]
  }, module, module.exports)
  assert(module.exports.default)
  return module.exports.default
}

const component = loadComponent()
async function render(state: display.UpdateDownloadState) {
  return renderer.renderToString(vue.createSSRApp(await component, { state }))
}

test('download sizes and rates use readable byte units without invalid numbers', () => {
  assert.equal(display.formatUpdateBytes(0), '0 B')
  assert.equal(display.formatUpdateBytes(512), '512 B')
  assert.equal(display.formatUpdateBytes(1024), '1 KB')
  assert.equal(display.formatUpdateBytes(1536), '1.5 KB')
  assert.equal(display.formatUpdateBytes(2.5 * 1024 ** 2), '2.5 MB')
  assert.equal(display.formatUpdateBytes(1024 ** 3), '1 GB')
  for (const invalid of [NaN, Infinity, -1]) assert.equal(display.formatUpdateBytes(invalid), '0 B')
})

test('rendered percentage uses actual downloaded bytes before the legacy progress field', async () => {
  const html = await render({ status: 'downloading', downloadedBytes: 256 * 1024, totalBytes: 1024 ** 2,
    bytesPerSecond: 128 * 1024, progress: 90 })
  assert.match(html, /role="progressbar"/)
  assert.match(html, /aria-valuenow="25"/)
  assert.match(html, /25%/)
  assert.match(html, /256 KB \/ 1 MB/)
  assert.match(html, /128 KB\/s/)
  assert.match(html, /width:25%/)
  assert(!html.includes('90%'))
})

test('unknown total renders an indeterminate meter, received bytes and connection feedback', async () => {
  const html = await render({ status: 'downloading', downloadedBytes: 2048, totalBytes: 0, bytesPerSecond: 0 })
  assert.match(html, /role="progressbar"/)
  assert(!html.includes('aria-valuenow='))
  assert.match(html, /总大小未知/)
  assert.match(html, /已下载 2 KB/)
  assert.match(html, /0 B\/s · 等待数据/)
  assert(!html.includes('0%'))
  const connecting = await render({ status: 'downloading', bytesPerSecond: 0 })
  assert.match(connecting, /0 B\/s · 正在连接下载源/)
})

test('partial legacy data still renders percentage and invalid metrics never leak into the UI', async () => {
  const fallback = await render({ status: 'downloading', progress: 42.5 })
  assert.match(fallback, /aria-valuenow="42.5"/)
  assert.match(fallback, /42.5%/)
  assert.match(fallback, /正在获取下载大小/)
  for (const value of [NaN, Infinity, -5]) {
    const html = await render({ status: 'downloading', downloadedBytes: value, totalBytes: value,
      progress: value, bytesPerSecond: value })
    assert(!html.includes('aria-valuenow='))
    assert(!html.includes('NaN'))
    assert(!html.includes('Infinity'))
    assert(!html.includes('-5'))
  }
})

test('explicit unknown byte totals never reuse a stale legacy percentage', async () => {
  for (const totalBytes of [undefined, 0, NaN, Infinity, -1]) {
    const html = await render({ status: 'downloading', downloadedBytes: 2048,
      totalBytes, progress: 85, bytesPerSecond: 512 })
    assert(!html.includes('aria-valuenow='))
    assert.match(html, /总大小未知/)
    assert.match(html, /已下载 2 KB/)
    assert(!html.includes('85%'))
  }
})

test('out of range percentages clamp to the meter and zero byte transfers can show real zero', async () => {
  const overflow = await render({ status: 'downloading', downloadedBytes: 200, totalBytes: 100 })
  assert.match(overflow, /aria-valuenow="99"/)
  assert(!overflow.includes('width:200%'))
  const empty = await render({ status: 'downloading', downloadedBytes: 0, totalBytes: 1024 })
  assert.match(empty, /aria-valuenow="0"/)
  assert.match(empty, /0 B \/ 1 KB/)
})

test('received packages remain at 99 percent during verification without suggesting a stalled transfer', async () => {
  for (const speed of [0, 128 * 1024]) {
    const html = await render({ status: 'downloading', downloadedBytes: 1024 ** 2, totalBytes: 1024 ** 2,
      bytesPerSecond: speed, progress: 99 })
    assert.match(html, /正在校验安装包/)
    assert.match(html, /aria-valuenow="99"/)
    assert.match(html, /99%/)
    assert.match(html, /1 MB \/ 1 MB/)
    assert(!html.includes('100%'))
    assert(!html.includes('等待数据'))
    assert(!html.includes('KB/s'))
    assert(!html.includes('B/s'))
  }
})

test('download completion always displays 100 percent and discards the previous transfer speed', async () => {
  const html = await render({ status: 'downloaded', downloadedBytes: 1024, totalBytes: 2048,
    progress: 50, bytesPerSecond: 512 })
  assert.match(html, /下载完成/)
  assert.match(html, /aria-valuenow="100"/)
  assert.match(html, /100%/)
  assert.match(html, /2 KB/)
  assert(!html.includes('512 B/s'))
  assert(!html.includes('50%'))
})

test('idle, cancelled, checking and error states render no stale transfer details', async () => {
  for (const status of ['idle', 'cancelled', 'checking', 'error', 'installing']) {
    const html = await render({ status, downloadedBytes: 1024, totalBytes: 2048, bytesPerSecond: 512, progress: 50 })
    assert(!html.includes('role="progressbar"'))
    assert(!html.includes('50%'))
    assert(!html.includes('KB'))
    assert(!html.includes('/s'))
  }
})
