import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const verifier = fileURLToPath(new URL('./ci-verify-windows-package.mjs', import.meta.url))
const { restrictDependencies } = createRequire(import.meta.url)('./ci-check-packaged-runtime.cjs')

function packageFixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'aissh-packaged-modules-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const appRoot = path.join(root, 'app')
  mkdirSync(path.join(appRoot, 'node_modules'), { recursive: true })
  writeFileSync(path.join(appRoot, 'package.json'), '{}')
  return { root, appRoot, requireFromApp: createRequire(path.join(appRoot, 'package.json')) }
}

function loadWithRestriction(appRoot, requireFromApp, name) {
  const restore = restrictDependencies(appRoot)
  try {
    return requireFromApp(name)
  } finally {
    restore()
  }
}

test('installer verification refuses to run on a normal local machine', () => {
  const result = spawnSync(process.execPath, [verifier], { encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: 'false' } })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Package installation verification is CI-only/)
})

test('installer verification refuses a persistent self-hosted Windows runner', () => {
  const result = spawnSync(process.execPath, [verifier], {
    encoding: 'utf8',
    env: { ...process.env, GITHUB_ACTIONS: 'true', RUNNER_OS: 'Windows', RUNNER_ENVIRONMENT: 'self-hosted' }
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Use a disposable GitHub-hosted worker/)
})

test('packaged dependencies can load their own nested dependencies and Node builtins', t => {
  const { appRoot, requireFromApp } = packageFixture(t)
  const dependency = path.join(appRoot, 'node_modules', 'inside')
  mkdirSync(path.join(dependency, 'node_modules', 'nested'), { recursive: true })
  writeFileSync(path.join(dependency, 'index.js'), 'module.exports = [require("nested"), require("node:path").sep]')
  writeFileSync(path.join(dependency, 'node_modules', 'nested', 'index.js'), 'module.exports = "nested-ok"')
  assert.deepEqual(loadWithRestriction(appRoot, requireFromApp, 'inside'), ['nested-ok', path.sep])
})

test('a missing package cannot fall back to development node_modules above the package', t => {
  const { root, appRoot, requireFromApp } = packageFixture(t)
  const dependency = path.join(appRoot, 'node_modules', 'inside')
  const outside = path.join(root, 'node_modules', 'outside')
  mkdirSync(dependency, { recursive: true })
  mkdirSync(outside, { recursive: true })
  writeFileSync(path.join(dependency, 'index.js'), 'module.exports = require("outside")')
  writeFileSync(path.join(outside, 'index.js'), 'module.exports = "should-not-load"')
  assert.throws(() => loadWithRestriction(appRoot, requireFromApp, 'inside'), /Dependency escaped packaged app/)
})

test('a package symlink pointing outside the shipped app is rejected', t => {
  const { root, appRoot, requireFromApp } = packageFixture(t)
  const outside = path.join(root, 'outside')
  mkdirSync(outside)
  writeFileSync(path.join(outside, 'index.js'), 'module.exports = "should-not-load"')
  symlinkSync(outside, path.join(appRoot, 'node_modules', 'outside-link'), process.platform === 'win32' ? 'junction' : 'dir')
  assert.throws(() => loadWithRestriction(appRoot, requireFromApp, 'outside-link'), /Dependency escaped packaged app/)
})
