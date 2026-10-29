import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { APP_VERSION } from '../../shared/src/constants/index.js'

it('keeps the public version and every workspace release version synchronized', async () => {
  for (const path of ['package.json', 'apps/desktop/package.json', 'packages/server/package.json',
    'packages/database/package.json', 'packages/shared/package.json']) {
    const manifest = JSON.parse(await readFile(new URL(`../../../${path}`, import.meta.url), 'utf8'))
    expect(APP_VERSION, path).toBe(manifest.version)
  }
})
