import test from 'node:test'
import assert from 'node:assert/strict'

import { generateUpdateManifest } from './generate-update-manifest.mjs'

test('generateUpdateManifest builds entries for the configured repository', () => {
  const manifest = generateUpdateManifest({
    version: '1.8.4',
    releaseDate: '2026-04-07T12:00:00.000Z',
    notes: 'Updater test release',
    githubOwner: 'local-maintainer',
    githubRepo: 'desktop-app',
    files: [
      {
        fileName: 'AI-SSH-Assistant-1.8.4-setup-x64.exe',
        size: 100,
        sha512: 'sha-win',
        platform: 'win32',
        arch: 'x64'
      },
      {
        fileName: 'ai-ssh-assistant-1.8.4-macos-arm64.dmg',
        size: 200,
        sha512: 'sha-mac',
        platform: 'darwin',
        arch: 'arm64'
      },
      {
        fileName: 'ai-ssh-assistant-1.8.4-linux-x64.AppImage',
        size: 300,
        sha512: 'sha-linux',
        platform: 'linux',
        arch: 'x64'
      }
    ]
  })

  assert.equal(manifest.version, '1.8.4')
  assert.equal(manifest.platforms['win32-x64'].sha512, 'sha-win')
  assert.equal(
    manifest.platforms['darwin-arm64'].fileName,
    'ai-ssh-assistant-1.8.4-macos-arm64.dmg'
  )
  assert.equal(manifest.platforms['linux-x64'].size, 300)
  assert.deepEqual(
    manifest.platforms['win32-x64'].sources.map(source => source.id),
    ['github']
  )
  assert.match(
    manifest.platforms['win32-x64'].sources[0].url,
    /github\.com\/local-maintainer\/desktop-app\/releases\/download\/v1\.8\.4\//
  )
})

test('generateUpdateManifest can publish artifacts to self-hosted storage', () => {
  const manifest = generateUpdateManifest({
    version: '1.8.4',
    releaseDate: '2026-04-07T12:00:00.000Z',
    downloadBaseUrl: 'https://updates.example.test/releases/v1.8.4/',
    files: [{ fileName: 'desktop app-x64.exe', size: 4, sha512: 'hash' }]
  })
  assert.deepEqual(manifest.platforms['win32-x64'].sources, [{
    id: 'self-hosted',
    url: 'https://updates.example.test/releases/v1.8.4/desktop%20app-x64.exe'
  }])
})

test('generateUpdateManifest requires an explicit download destination', () => {
  assert.throws(() => generateUpdateManifest({
    version: '1.8.4', releaseDate: '2026-04-07T12:00:00.000Z', files: []
  }), /download base URL or GitHub repository is required/)
})
