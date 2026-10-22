import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const targets = [
  { key: 'windows', platform: 'Windows', os: 'windows-latest', build_script: 'build:win', target_arch: 'x64', artifacts: 'apps/desktop/release/*/AI-SSH-Assistant-*-setup-*.exe' },
  { key: 'macos', platform: 'macOS x64', os: 'macos-latest', build_script: 'build:mac:x64', target_arch: 'x64', artifacts: 'apps/desktop/release/*/ai-ssh-assistant-*-macos-x64.dmg\napps/desktop/release/*/ai-ssh-assistant-*-macos-x64.zip' },
  { key: 'macos', platform: 'macOS arm64', os: 'macos-latest', build_script: 'build:mac:arm64', target_arch: 'arm64', artifacts: 'apps/desktop/release/*/ai-ssh-assistant-*-macos-arm64.dmg\napps/desktop/release/*/ai-ssh-assistant-*-macos-arm64.zip' },
  { key: 'linux', platform: 'Linux', os: 'ubuntu-latest', build_script: 'build:linux', target_arch: 'x64', artifacts: 'apps/desktop/release/*/ai-ssh-assistant-*-linux-*.AppImage\napps/desktop/release/*/ai-ssh-assistant-*-linux-*.deb' }
]

export function createBuildMatrix(platforms = 'windows') {
  const selected = new Set(platforms.split(',').map(value => value.trim()))
  for (const platform of selected) {
    if (!targets.some(target => target.key === platform)) throw new Error(`Unknown build platform: ${platform}`)
  }
  return { include: targets.filter(target => selected.has(target.key)) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const matrix = createBuildMatrix(process.env.BUILD_PLATFORMS || 'windows')
  if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required')
  appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify(matrix)}\n`)
}
