/** Verify the Node-API SQLite binaries shipped with better-sqlite3 13. */
const fs = require('node:fs')
const path = require('node:path')
const { assertNativeArch } = require('./native-arch')

const desktopDir = path.resolve(__dirname, '..')
const betterSqliteDir = path.dirname(
  require.resolve('better-sqlite3/package.json', { paths: [desktopDir] })
)
const targetArch = process.env.TARGET_ARCH || process.arch
const targetPlatform = process.platform === 'linux' && !process.report.getReport().header.glibcVersionRuntime
  ? 'linuxmusl'
  : process.platform
const bindingPath = path.join(betterSqliteDir, 'prebuilds', `${targetPlatform}-${targetArch}.node`)

try {
  if (!fs.existsSync(bindingPath)) {
    throw new Error(`Missing SQLite Node-API binary: ${bindingPath}. Reinstall dependencies for a supported platform.`)
  }

  assertNativeArch(bindingPath, targetArch)

  // Cross-architecture CI can inspect the target binary but cannot load it.
  if (targetArch === process.arch) {
    const Database = require(path.join(betterSqliteDir, 'lib', 'index.js'))
    const database = new Database(':memory:', { nativeBinding: bindingPath })
    try {
      const result = database.prepare('SELECT 1 AS ready').get()
      if (result.ready !== 1) throw new Error('SQLite startup query failed')
    } finally {
      database.close()
    }
  }
  console.log(`SQLite Node-API binary is ready (${targetPlatform}-${targetArch})`)
} catch (error) {
  console.error('Failed to prepare better-sqlite3:', error.message)
  process.exitCode = 1
}
