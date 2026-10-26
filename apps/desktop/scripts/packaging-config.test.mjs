import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopRoot = fileURLToPath(new URL('../', import.meta.url))
const desktopRequire = createRequire(new URL('../package.json', import.meta.url))
const builderRequire = createRequire(desktopRequire.resolve('electron-builder/package.json'))
// Initialize the public entry before its platform modules to avoid their CJS cycle.
builderRequire('app-builder-lib')
const { getConfig, validateConfiguration } = builderRequire('app-builder-lib/out/util/config/config')
const { LinuxPackager } = builderRequire('app-builder-lib/out/linuxPackager')
const { LinuxTargetHelper } = builderRequire('app-builder-lib/out/targets/LinuxTargetHelper')
const { validateCriticalPathString } = builderRequire('app-builder-lib/out/targets/appimage/appImageUtil')

async function configuration() {
  const config = await getConfig(desktopRoot, join(desktopRoot, 'electron-builder.yml'))
  const metadata = JSON.parse(await readFile(join(desktopRoot, 'package.json'), 'utf8'))
  return { config, metadata }
}

function linuxPackager(config, metadata) {
  // Construct only the real naming/configuration layer; no package build,
  // native tools, target downloads, signing or filesystem changes are invoked.
  return new LinuxPackager({
    config, metadata, devMetadata: metadata, projectDir: desktopRoot,
    appDir: desktopRoot, buildResourcesDir: join(desktopRoot, 'build')
  })
}

test('release packaging configuration passes the installed electron-builder schema', async () => {
  const { config } = await configuration()
  await validateConfiguration(config, { isEnabled: false })
  const invalid = structuredClone(config)
  invalid.linux.unsupportedPackagingOption = true
  await assert.rejects(validateConfiguration(invalid, { isEnabled: false }), /Invalid configuration object[\s\S]*configuration\.linux/)
})

test('Linux scoped workspace metadata produces a safe executable and matching desktop launcher', async () => {
  const { config, metadata } = await configuration()
  assert.match(metadata.name, /^@[^/]+\//, 'Keep the real scoped workspace name in this regression')
  const packager = linuxPackager(config, metadata)
  assert.equal(packager.executableName, 'prism')
  validateCriticalPathString(packager.executableName, 'executableName')
  validateCriticalPathString(packager.appInfo.productFilename, 'productFilename')
  const helper = new LinuxTargetHelper(packager)
  assert.equal(helper.getDesktopFileName(), packager.executableName)
  const desktopEntry = await helper.computeDesktopEntry(packager.platformSpecificBuildOptions)
  assert.match(desktopEntry, /^Exec=\/opt\/Prism\/prism %U$/m)
  assert.match(desktopEntry, /^Icon=prism$/m)
})

test('omitting the Linux executable override reproduces the AppImage rejection of a scoped npm name', async () => {
  const { config, metadata } = await configuration()
  delete config.linux.executableName
  const packager = linuxPackager(config, metadata)
  assert.match(packager.executableName, /^@/)
  assert.throws(() => validateCriticalPathString(packager.executableName, 'executableName'),
    /executableName contains characters that cannot be safely used in file paths/)
})
