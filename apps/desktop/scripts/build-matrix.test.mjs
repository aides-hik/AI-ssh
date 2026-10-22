import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBuildMatrix } from '../../../scripts/build-matrix.mjs'

test('manual builds default to Windows and do not schedule other operating systems', () => {
  const matrix = createBuildMatrix()
  assert.deepEqual(matrix.include.map(target => target.os), ['windows-latest'])
  assert.equal(matrix.include[0].build_script, 'build:win')
})

test('selected platforms expand only to their requested architectures', () => {
  const matrix = createBuildMatrix('windows,macos')
  assert.deepEqual(matrix.include.map(target => target.platform), ['Windows', 'macOS x64', 'macOS arm64'])
  assert.deepEqual(createBuildMatrix('linux').include.map(target => target.target_arch), ['x64'])
})

test('unknown platforms fail before scheduling a build', () => {
  assert.throws(() => createBuildMatrix('windows,unknown'), /Unknown build platform/)
  assert.throws(() => createBuildMatrix(''), /Unknown build platform/)
})

test('the Actions command emits a Windows-only matrix into GITHUB_OUTPUT', t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'aissh-build-matrix-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const outputFile = path.join(directory, 'github-output')
  const script = fileURLToPath(new URL('../../../scripts/build-matrix.mjs', import.meta.url))
  const result = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: { ...process.env, BUILD_PLATFORMS: 'windows', GITHUB_OUTPUT: outputFile }
  })
  assert.equal(result.status, 0, result.stderr)
  const output = readFileSync(outputFile, 'utf8').trim()
  assert.ok(output.startsWith('matrix='))
  const matrix = JSON.parse(output.slice('matrix='.length))
  assert.equal(matrix.include.length, 1)
  assert.equal(matrix.include[0].os, 'windows-latest')
  assert.equal(matrix.include[0].target_arch, 'x64')
  assert.match(matrix.include[0].artifacts, /setup-.*\.exe$/)
})
