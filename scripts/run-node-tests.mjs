import { readdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const requestedRoot = process.argv[2]
if (!requestedRoot) throw new Error('Usage: node scripts/run-node-tests.mjs <workspace path>')

const testRoot = resolve(repositoryRoot, requestedRoot)
const relativeRoot = relative(repositoryRoot, testRoot)
if (relativeRoot.startsWith('..') || isAbsolute(relativeRoot)) {
  throw new Error('The test workspace must be inside this repository')
}

const ignoredDirectories = new Set([
  'node_modules', 'dist', 'dist-electron', 'dist-bundle', 'release', 'coverage', 'generated'
])

async function collectTests(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory() && !ignoredDirectories.has(entry.name)) {
      files.push(...await collectTests(path))
    } else if (entry.isFile() && /\.test\.(?:ts|mts|js|mjs)$/.test(entry.name)) {
      files.push(path)
    }
  }
  return files
}

const tests = (await collectTests(testRoot)).sort()
if (tests.length === 0) throw new Error(`No tests found in ${requestedRoot}`)

const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...tests], {
  cwd: repositoryRoot,
  stdio: 'inherit'
})
if (result.error) throw result.error
process.exitCode = result.status ?? 1
