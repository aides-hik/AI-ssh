import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it('baseline and additive session migration reproduce the only PostgreSQL schema without altering old tables', async () => {
  const databaseDir = fileURLToPath(new URL('../../../database/', import.meta.url))
  const migrationsDir = join(databaseDir, 'prisma/migrations')
  const baseline = await readFile(join(migrationsDir, '0_baseline/migration.sql'), 'utf8')
  const sessions = await readFile(join(migrationsDir, '20261029000000_auth_sessions/migration.sql'), 'utf8')
  expect(baseline).not.toContain('auth_sessions')
  expect(sessions).toContain('CREATE TABLE "auth_sessions"')
  expect(sessions).not.toMatch(/\b(?:DROP|DELETE|TRUNCATE|UPDATE)\b(?! CASCADE)/i)
  expect(sessions.match(/ALTER TABLE "([^"]+)"/g)).toEqual(['ALTER TABLE "auth_sessions"'])

  const taskDir = await mkdtemp(join(tmpdir(), 'prism-migration-check-'))
  try {
    // This config deliberately never loads deployment .env files and diff reads schema files only.
    const configPath = join(taskDir, 'prisma.config.ts')
    await writeFile(configPath, `export default ${JSON.stringify({
      schema: join(databaseDir, 'prisma/schema-postgresql.prisma'),
      datasource: { url: 'postgresql://offline:offline@127.0.0.1:1/offline' }
    })}\n`)
    const require = createRequire(import.meta.url)
    const cli = require.resolve('prisma/build/index.js', { paths: [databaseDir] })
    const generated = execFileSync(process.execPath, [cli, 'migrate', 'diff', '--from-empty',
      '--to-schema', join(databaseDir, 'prisma/schema-postgresql.prisma'), '--script', '--config', configPath],
    { encoding: 'utf8', cwd: databaseDir, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const statements = (sql: string) => sql.replace(/^--[^\n]*$/gm, '').split(';')
      .map(statement => statement.replace(/\s+/g, ' ').trim()).filter(Boolean).sort()
    expect(statements(generated).length).toBeGreaterThan(0)
    expect(statements(baseline + sessions)).toEqual(statements(generated))
  } finally {
    await rm(taskDir, { recursive: true, force: true })
  }
}, 30000)
