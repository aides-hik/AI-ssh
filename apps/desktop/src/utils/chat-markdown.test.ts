import test from 'node:test'
import assert from 'node:assert/strict'
import { marked } from 'marked'
import { renderChatMarkdown } from './chat-markdown'

test('code fences cannot turn literal code, language names or control labels into HTML', () => {
  const html = renderChatMarkdown(
    '```<svg/onload=alert(1)>\n</code><img src=x onerror=alert(2)>\n```',
    'Copy" onclick="alert(3)',
    '<img src=x>'
  )

  assert.doesNotMatch(html, /<svg|<img|<button[^>]*"\s+onclick=/)
  assert.doesNotMatch(html, /class="language-/)
  assert.match(html, /&lt;svg\/onload=alert\(1\)&gt;/)
  assert.match(html, /&lt;\/code&gt;&lt;img src=x onerror=alert\(2\)&gt;/)
  assert.match(html, /aria-label="Copy&quot; onclick=&quot;alert\(3\)"/)
  assert.match(renderChatMarkdown('```\nx\n```', 'Copy', '<code>'), /&lt;code&gt;/)
})

test('copyable code retains indentation, entities and trailing blank lines', () => {
  const markdown = '```bash\n  printf "a & b < c"\n\tsecond line\n\n```'
  const expected = marked.parse(markdown, { async: false }) as string
  const actual = renderChatMarkdown(markdown, '复制代码', '代码')
  const content = (html: string) => html.match(/<code\b[^>]*>([\s\S]*?)<\/code>/)?.[1]

  // The toolbar must not change any literal text the existing parser put in code.
  assert.equal(content(actual), content(expected))
  assert.match(actual, /class="language-bash"/)
})

test('headings, tables, inline code and links keep their existing Markdown rendering', () => {
  const text = '## 检查结果\n\n- **服务正常**\n- `uptime`\n\n| 项目 | 状态 |\n| --- | --- |\n| CPU | 正常 |\n\n[查看文档](https://example.com)'
  assert.equal(renderChatMarkdown(text, '复制代码', '代码'), marked.parse(text, { async: false }))
  // A custom renderer must not mutate marked's shared parser configuration.
  assert.equal(marked.parse('```js\nx\n```', { async: false }), '<pre><code class="language-js">x\n</code></pre>\n')
})
