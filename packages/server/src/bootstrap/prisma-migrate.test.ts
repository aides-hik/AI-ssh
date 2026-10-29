import { beforeEach, describe, expect, it, vi } from 'vitest'

const spawnMock = vi.fn()
const loggerInfo = vi.fn()
const loggerWarn = vi.fn()
const loggerError = vi.fn()
const existsSyncMock = vi.fn()
const readdirSyncMock = vi.fn()

vi.mock('node:child_process', () => ({
  spawn: spawnMock
}))

vi.mock('node:fs', () => ({
  existsSync: existsSyncMock,
  readdirSync: readdirSyncMock
}))

vi.mock('../utils/safe-logger.js', () => ({
  logger: {
    info: loggerInfo,
    warn: loggerWarn,
    error: loggerError
  }
}))

describe('autoMigrateIfEnabled', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    spawnMock.mockImplementation(() => ({
      on: (event: string, handler: (value?: any) => void) => {
        if (event === 'close') {
          handler(0)
        }
      }
    }))
  })

  it('refuses unversioned automatic schema pushes when migrations are missing', async () => {
    existsSyncMock.mockReturnValue(false)

    const { autoMigrateIfEnabled } = await import('./prisma-migrate.js')
    await expect(autoMigrateIfEnabled(true)).rejects.toThrow('refusing automatic db push')
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('uses prisma migrate deploy when migrations exist', async () => {
    existsSyncMock.mockImplementation(path => /migrations$|migration\.sql$/.test(String(path)))
    readdirSyncMock.mockReturnValue(['20260410_init'])

    const { autoMigrateIfEnabled } = await import('./prisma-migrate.js')
    await autoMigrateIfEnabled(true)

    expect(spawnMock).toHaveBeenCalledWith(
      process.execPath,
      [
        expect.stringMatching(/prisma[\\/]build[\\/]index\.js$/),
        'migrate',
        'deploy',
        '--schema',
        expect.stringMatching(/schema-postgresql\.prisma$/)
      ],
      expect.objectContaining({
        cwd: expect.stringMatching(/packages[\\/]database$/),
        shell: false
      })
    )
  })

  it('does not mistake the migration lock file for an executable migration', async () => {
    existsSyncMock.mockImplementation(path => String(path).endsWith('migrations'))
    readdirSyncMock.mockReturnValue(['migration_lock.toml'])
    const { autoMigrateIfEnabled } = await import('./prisma-migrate.js')
    await expect(autoMigrateIfEnabled(true)).rejects.toThrow('refusing automatic db push')
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('leaves schema unchanged when automatic migration is disabled', async () => {
    const { autoMigrateIfEnabled } = await import('./prisma-migrate.js')
    await autoMigrateIfEnabled(false)
    expect(spawnMock).not.toHaveBeenCalled()
  })
})
