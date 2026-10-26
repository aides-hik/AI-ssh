import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Script } from 'node:vm'

const siteRoot = path.resolve(process.argv[2] || fileURLToPath(new URL('../site/', import.meta.url)))
const failures = []
const documents = new Map()
let references = 0

function check(condition, message) {
  if (!condition) failures.push(message)
}

function attributes(source) {
  const result = new Map()
  const pattern = /([^\s=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g
  for (const match of source.matchAll(pattern)) {
    result.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '')
  }
  return result
}

async function collect(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name)
    check(!entry.isSymbolicLink(), `站点不能包含符号链接：${target}`)
    if (entry.isDirectory()) files.push(...await collect(target))
    else if (entry.isFile()) files.push(target)
  }
  return files
}

async function checkReference(value, source, ids) {
  if (!value) {
    check(false, `${path.basename(source)} 包含空链接或资源地址`)
    return
  }
  if (/^(?:https:|mailto:|tel:|data:image\/)/i.test(value)) return
  check(!/^(?:[a-z][a-z\d+.-]*:|\/)/i.test(value), `必须使用相对路径或 HTTPS：${value}`)
  if (/^(?:[a-z][a-z\d+.-]*:|\/)/i.test(value)) return

  let url
  try {
    const relative = path.relative(siteRoot, source).split(path.sep).join('/')
    url = new URL(value.replaceAll('&amp;', '&'), `https://example.test/AI-ssh/${relative}`)
  } catch {
    check(false, `无法解析 ${path.basename(source)} 中的链接：${value}`)
    return
  }
  check(url.pathname.startsWith('/AI-ssh/'), `链接越出 Pages 项目路径：${value}`)
  if (!url.pathname.startsWith('/AI-ssh/')) return

  let destination
  try {
    destination = path.resolve(siteRoot, decodeURIComponent(url.pathname.slice('/AI-ssh/'.length)))
    const relative = path.relative(siteRoot, destination)
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('path escape')
    if ((await stat(destination)).isDirectory()) destination = path.join(destination, 'index.html')
    check((await stat(destination)).isFile(), `资源不是普通文件：${value}`)
    references += 1
  } catch {
    check(false, `${path.basename(source)} 缺少本地资源：${value}`)
    return
  }

  if (url.hash && documents.has(destination)) {
    try {
      const targetIds = destination === source ? ids : documents.get(destination).ids
      check(targetIds.has(decodeURIComponent(url.hash.slice(1))), `缺少锚点：${value}`)
    } catch {
      check(false, `无法解析锚点：${value}`)
    }
  }
}

try {
  const files = await collect(siteRoot)
  for (const file of files.filter(file => file.endsWith('.html'))) {
    const source = (await readFile(file, 'utf8')).replace(/<!--[\s\S]*?-->/g, '')
    const tags = [...source.matchAll(/<([a-z][\w-]*)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gi)]
      .map(match => ({ name: match[1].toLowerCase(), attrs: attributes(match[2]) }))
    const ids = new Set()
    for (const { attrs } of tags) {
      if (!attrs.has('id')) continue
      const id = attrs.get('id')
      check(Boolean(id) && !ids.has(id), `重复或空的 HTML id：${id}`)
      ids.add(id)
    }
    documents.set(file, { source, tags, ids })
  }

  const home = documents.get(path.join(siteRoot, 'index.html'))
  check(Boolean(home), '必须提供 site/index.html')
  if (home) {
    const { source, tags } = home
    check(/<html\b[^>]*\blang=["']zh(?:-CN)?["']/i.test(source), '必须声明中文页面语言')
    check(/<title>[^<]+<\/title>/i.test(source), '必须提供页面标题')
    check(tags.some(({ name, attrs }) => name === 'meta' && attrs.get('name') === 'description' && attrs.get('content')), '必须提供页面简介')
    check(tags.some(({ name, attrs }) => name === 'meta' && attrs.get('name') === 'viewport'), '必须提供移动端 viewport')
    check(tags.filter(({ name }) => name === 'h1').length === 1, '页面应有且只有一个 h1')
    check(tags.some(({ name }) => name === 'main'), '必须提供 main 内容区域')
    check(tags.some(({ name, attrs }) => name === 'script' && attrs.get('src') === './main.js' && attrs.has('defer')), 'main.js 必须使用相对路径并 defer 加载')
    check(tags.some(({ name, attrs }) => name === 'link' && attrs.get('href') === './styles.css'), '必须使用相对路径加载 styles.css')
    const downloads = tags.filter(({ name, attrs }) => name === 'a' && /^https:\/\/github\.com\/aides-hik\/AI-ssh\/releases\/latest(?:[#/?]|$)/.test(attrs.get('href') ?? ''))
    check(downloads.length > 0, '必须提供无需 JavaScript 的最新 Release 下载链接')
    const content = source.replace(/<(?:script|style)\b[\s\S]*?<\/(?:script|style)>/gi, '').replace(/<[^>]+>/g, ' ')
    for (const term of [/棱镜/, /Prism/, /SSH/, /SFTP/, /AI/, /Docker|Compose/, /Windows/, /macOS/, /Linux/, /下载/, /常见问题|FAQ/, /模拟数据/, /私钥/, /SSH\s*Agent/i, /应用层加密/]) {
      check(term.test(content), `缺少必要的可直接阅读的产品内容：${term}`)
    }
    check(/外部模型/.test(content) && /终端输出会发送/.test(content), '必须说明外部模型会收到参与分析的终端输出')
    check(tags.filter(({ name }) => name === 'summary').length >= 5, 'FAQ 应使用原生 details/summary')
    const platformDownloads = tags.filter(({ attrs }) => attrs.has('data-download'))
    check(platformDownloads.length === 5, '必须提供 Windows、两种 macOS 架构、AppImage 和 DEB 下载选择')
    for (const { name, attrs } of platformDownloads) {
      check(name === 'a' && /^https:\/\/github\.com\/aides-hik\/AI-ssh\/releases\/(?:latest$|download\/[^\s"<>]+$)/.test(attrs.get('href') ?? ''), '各平台下载必须指向本仓库的正式发布入口或安装包')
    }
    for (const { attrs } of tags.filter(({ attrs }) => attrs.has('data-demo-tab'))) {
      check(tags.some(tag => tag.attrs.get('id') === attrs.get('aria-controls') && tag.attrs.get('data-demo-panel') === attrs.get('data-demo-tab')), '演示场景按钮必须指向对应内容面板')
    }
  }

  for (const [file, { tags, ids }] of documents) {
    for (const { name, attrs } of tags) {
      if (name === 'img') check(attrs.has('alt'), '每张图片必须声明 alt（装饰图片可为空）')
      if (name === 'button') check(attrs.has('type'), '交互按钮必须声明 type')
      if (attrs.has('data-demo-panel') || attrs.has('data-nav-menu')) {
        check(!attrs.has('hidden'), '主要导航和演示面板在无 JavaScript 时必须可读')
      }
      for (const attribute of ['src', 'href', 'poster']) {
        if (attrs.has(attribute)) await checkReference(attrs.get(attribute), file, ids)
      }
      if (attrs.get('target') === '_blank') {
        check(/(?:^|\s)noopener(?:\s|$)/.test(attrs.get('rel') ?? ''), '新窗口链接必须声明 rel="noopener"')
      }
      for (const attribute of ['aria-controls', 'aria-labelledby', 'aria-describedby']) {
        for (const id of (attrs.get(attribute) ?? '').split(/\s+/).filter(Boolean)) {
          check(ids.has(id), `${attribute} 引用不存在的 id：${id}`)
        }
      }
    }
  }

  for (const file of files) {
    if (file.endsWith('.css')) {
      const css = (await readFile(file, 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '')
      if (path.basename(file) === 'styles.css') {
        check(/prefers-reduced-motion\s*:\s*reduce/.test(css), '样式必须尊重减少动态效果偏好')
        check(/\[hidden\][^{]*\{[^}]*display\s*:\s*none\s*!important/s.test(css), '样式必须保留 HTML hidden 属性的隐藏效果')
      }
      for (const match of css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi)) {
        await checkReference(match[1] ?? match[2] ?? match[3], file, new Set())
      }
    }
    if (file.endsWith('.js')) {
      try {
        const javascript = await readFile(file, 'utf8')
        new Script(javascript, { filename: file })
        if (path.basename(file) === 'main.js') {
          check(!/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/.test(javascript), '官网交互不能依赖浏览器网络 API')
        }
      } catch (error) {
        check(false, `JavaScript 语法错误：${error.message}`)
      }
    }
  }
  if (failures.length) {
    console.error(failures.map(message => `✗ ${message}`).join('\n'))
    process.exitCode = 1
  } else {
    console.log(`官网静态检查通过：${documents.size} 个 HTML，${files.length} 个文件，${references} 处本地引用；兼容 /AI-ssh/ 项目路径。`)
  }
} catch (error) {
  console.error(`官网静态检查失败：${error.message}`)
  process.exitCode = 1
}
