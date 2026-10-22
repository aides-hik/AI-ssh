// Run with the packaged executable in ELECTRON_RUN_AS_NODE mode on a CI runner.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')

// A package inside the checkout must not silently resolve missing files from the
// development node_modules higher in the directory tree.
function restrictDependencies(appRoot) {
  const originalResolve = Module._resolveFilename
  Module._resolveFilename = function (request, parent, ...options) {
    const resolved = originalResolve.call(this, request, parent, ...options)
    if (!Module.isBuiltin(resolved)) {
      const relative = path.relative(appRoot, fs.realpathSync(resolved))
      assert.ok(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), `Dependency escaped packaged app: ${resolved}`)
    }
    return resolved
  }
  return () => { Module._resolveFilename = originalResolve }
}

async function verify() {
  const appRoot = fs.realpathSync(process.argv[2])
  const outputFile = process.argv[3]
  const requireFromApp = Module.createRequire(path.join(appRoot, 'package.json'))
  restrictDependencies(appRoot)
  assert.equal(process.platform, 'win32')
  assert.equal(process.arch, 'x64')
  const Database = requireFromApp('better-sqlite3')
  const sqlite = new Database(':memory:')
  try {
    sqlite.exec('CREATE TABLE ci_probe (value TEXT NOT NULL)')
    sqlite.prepare('INSERT INTO ci_probe VALUES (?)').run('packaged-sqlite-ok')
    assert.equal(sqlite.prepare('SELECT value FROM ci_probe').get().value, 'packaged-sqlite-ok')
  } finally {
    sqlite.close()
  }

  assert.equal(typeof requireFromApp('ssh2').Client, 'function')
  const { StorageManager } = requireFromApp('@ai-ssh/database')
  const storage = new StorageManager({ mode: 'local', localOptions: { connectionString: 'file::memory:' } })
  try {
    await storage.connect()
    assert.equal((await storage.getStatus()).local.connected, true)
    assert.ok(Array.isArray(await storage.findMany('SSHConnection')))
  } finally {
    await storage.disconnect()
  }

  const databaseEntry = requireFromApp.resolve('@ai-ssh/database')
  for (const client of ['client', 'client-sqlite']) {
    const generated = path.join(path.dirname(databaseEntry), 'generated', client, 'client.js')
    assert.equal(typeof requireFromApp(generated).PrismaClient, 'function')
  }
  assert.ok(process.versions.electron, 'The packaged Electron executable must run the probe')
  fs.writeFileSync(outputFile, JSON.stringify({ success: true, sqlite: true, storage: true, prismaClients: true, ssh2: true, electron: process.versions.electron, node: process.versions.node, platform: process.platform, arch: process.arch }, null, 2))
}

module.exports = { restrictDependencies }
if (require.main === module) {
  verify().catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}
