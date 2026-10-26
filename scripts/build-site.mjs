import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repository = 'aides-hik/AI-ssh'
const source = fileURLToPath(new URL('../site/', import.meta.url))
const output = fileURLToPath(new URL('../tmp/prism-site/', import.meta.url))
const latest = `https://github.com/${repository}/releases/latest`
const assetPatterns = {
  windows: /^Prism-.+-setup-x64\.exe$/i,
  'mac-arm64': /^prism-.+-macos-arm64\.dmg$/i,
  'mac-x64': /^prism-.+-macos-x64\.dmg$/i,
  'linux-appimage': /^prism-.+-linux-x86_64\.AppImage$/i,
  'linux-deb': /^prism-.+-linux-amd64\.deb$/i,
}

// Build in an ignored directory. Never rewrite the source download fallbacks.
await mkdir(output, { recursive: true })
await cp(source, output, { recursive: true })
let release
let resolved = 0
try {
  if (process.argv[2]) {
    release = JSON.parse(await readFile(path.resolve(process.argv[2]), 'utf8'))
  } else {
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'Prism-Website' }
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
    const response = await fetch(`https://api.github.com/repos/${repository}/releases/latest`, {
      headers,
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) throw new Error(`Release API returned HTTP ${response.status}`)
    release = await response.json()
  }
  if (!release || release.draft || release.prerelease || !Array.isArray(release.assets)) {
    throw new Error('No published stable release with assets')
  }

  const htmlPath = path.join(output, 'index.html')
  let html = await readFile(htmlPath, 'utf8')
  html = html.replace(/<a\b[^>]*\bdata-download="([^"]+)"[^>]*>/g, (tag, platform) => {
    const pattern = assetPatterns[platform]
    if (!pattern) return tag
    const asset = release.assets.find((item) => {
      if (typeof item.name !== 'string' || !pattern.test(item.name)) return false
      try {
        const url = new URL(item.browser_download_url)
        return url.origin === 'https://github.com' &&
          url.pathname.startsWith(`/${repository}/releases/download/`) &&
          !url.username && !url.password && !url.search && !url.hash
      } catch { return false }
    })
    if (!asset) return tag
    const escaped = asset.browser_download_url.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
    resolved += 1
    return tag.replace(/\bhref="[^"]*"/, `href="${escaped}"`)
  })
  if (resolved === Object.keys(assetPatterns).length) {
    const version = String(release.tag_name || '').replace(/[<>&"']/g, '').slice(0, 64)
    html = html.replace(/(<span\b[^>]*\bdata-download-notice[^>]*>)[\s\S]*?(<\/span>)/, (_match, start, end) => `${start}当前正式版 ${version} · 安装包由 GitHub Releases 提供。${end}`)
  }
  await writeFile(htmlPath, html)
  console.log(`Matched ${resolved}/${Object.keys(assetPatterns).length} platform downloads from the latest stable release.`)
} catch (error) {
  console.warn(`Release metadata unavailable: ${error.message}. Keeping permanent download links: ${latest}`)
}

console.log(`Static website prepared at ${path.relative(process.cwd(), output)}. Source links remain unchanged.`)
