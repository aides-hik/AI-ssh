import test from 'node:test'
import assert from 'node:assert/strict'
import { marked } from 'marked'
import { createMarkdownRenderCache } from './markdown-render-cache'

test('draft edits and other blocks streaming reuse stable Markdown without changing its HTML', () => {
  let parses = 0
  const render = createMarkdownRenderCache(text => {
    parses++
    return marked.parse(text, { async: false })
  })
  const history = '## 中文记录\n\n| 命令 | 结果 |\n| --- | --- |\n| `ls` | 正常 |'
  const expected = marked.parse(history, { async: false })
  for (let index = 0; index < 200; index++) {
    assert.equal(render(history, 'history'), expected)
    render(`正在输出 ${index}`, 'current-response')
  }
  assert.equal(parses, 201)
})

test('a streamed block keeps its latest prefix without evicting stable history', () => {
  const counts = new Map<string, number>()
  const render = createMarkdownRenderCache(
    text => {
      counts.set(text, (counts.get(text) || 0) + 1)
      return text
    },
    { maxEntries: 2 }
  )
  render('stable', 'history')
  for (let index = 0; index < 200; index++) render(`prefix ${index}`, 'stream')
  render('stable', 'history')
  assert.equal(counts.get('stable'), 1)
  render('new block', 'third')
  render('prefix 199', 'stream')
  assert.equal(counts.get('prefix 199'), 2)
})

test('many visible historical blocks remain cached while the current block streams', () => {
  let parses = 0
  const render = createMarkdownRenderCache(text => {
    parses++
    return text
  })
  for (let frame = 0; frame < 100; frame++) {
    for (let block = 0; block < 200; block++) render(`History ${block}`, `block-${block}`)
    render(`Current ${frame}`, 'current')
  }
  assert.equal(parses, 300)
})

test('total retained text and HTML are bounded, and oversized output is not retained', () => {
  let parses = 0
  const render = createMarkdownRenderCache(
    text => {
      parses++
      return `<p>${text}</p>`
    },
    { maxCharacters: 30 }
  )
  render('first', 'a')
  render('second', 'b')
  render('first', 'a')
  assert.equal(parses, 3)
  render('x'.repeat(40), 'large')
  render('x'.repeat(40), 'large')
  assert.equal(parses, 5)
  render('first', 'a')
  assert.equal(parses, 5)
})

test('cleared text invalidates previous content and a thrown parser does not cache stale output', () => {
  let parses = 0
  const render = createMarkdownRenderCache(text => {
    parses++
    if (text === 'bad') throw new Error('bad parse')
    return text.toUpperCase()
  })
  assert.equal(render('old', 'a'), 'OLD')
  assert.equal(render('', 'a'), '')
  assert.equal(render('old', 'a'), 'OLD')
  assert.throws(() => render('bad', 'a'))
  assert.equal(render('old', 'a'), 'OLD')
  assert.equal(parses, 4)
})
