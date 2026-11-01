import test from 'node:test'
import assert from 'node:assert/strict'
import { ToolCallProtocolError, ToolCallTextGuard } from './tool-call-protocol'

function guarded(chunks: string[]): string {
  const guard = new ToolCallTextGuard()
  return chunks.map(chunk => guard.push(chunk)).join('') + guard.finish()
}

test('tool protocol errors explain the failure and an actionable next step', () => {
  const error = new ToolCallProtocolError()
  assert.equal(error.name, 'ToolCallProtocolError')
  assert.match(error.message, /普通文本/)
  assert.match(error.message, /本轮工具未执行/)
  assert.match(error.message, /支持工具调用/)
  assert.match(error.message, /切换模型服务/)
})

test('ordinary prose, comparisons, HTML and unrelated angle syntax retain every character', () => {
  const text = '检查 CPU ✅\n1 < 2，3 > 2；<div>hello</div>，x << 3；DSML 只是名字，<|other|>。'
  assert.equal(guarded([text]), text)
  assert.equal(guarded([...text]), text)
  for (let split = 0; split <= text.length; split++) {
    assert.equal(guarded([text.slice(0, split), text.slice(split)]), text)
  }
})

for (const marker of ['<｜DSML｜', '<|DSML|', '</｜DSML｜', '</|DSML|', '<｜DSML|', '</|DSML｜', '<｜DSML ', '</|DSML\t']) {
  test(`rejects ${JSON.stringify(marker)} at every character partition without leaking its prefix`, () => {
    const source = `准备检查。\n${marker}invoke name="inspect_server">`
    for (let split = 0; split <= source.length; split++) {
      const guard = new ToolCallTextGuard()
      let shown = ''
      assert.throws(() => {
        shown += guard.push(source.slice(0, split))
        shown += guard.push(source.slice(split))
        shown += guard.finish()
      }, ToolCallProtocolError)
      assert.doesNotMatch(shown, /<\/?[|｜]/)
    }
    assert.throws(() => guarded([...source]), ToolCallProtocolError)
  })
}

test('UTF-8 bytes arriving separately cannot leak a Unicode DSML marker', () => {
  const decoder = new TextDecoder()
  const guard = new ToolCallTextGuard()
  let shown = ''
  const bytes = new TextEncoder().encode('正在检查✅\n<｜DSML｜invoke name="inspect_server">')
  assert.throws(() => {
    for (const byte of bytes) shown += guard.push(decoder.decode(Uint8Array.of(byte), { stream: true }))
    shown += guard.push(decoder.decode())
    shown += guard.finish()
  }, ToolCallProtocolError)
  assert.equal(shown, '正在检查✅\n')
})

test('truncated DSML names fail at end of stream while ordinary unfinished angle syntax is preserved', () => {
  for (const fragment of ['<|D', '<|DS', '<｜DSM', '<｜DSML', '</|DSML']) {
    assert.throws(() => guarded([...fragment]), ToolCallProtocolError)
  }
  for (const fragment of ['<', '</', '<|', '<｜', '<|different']) {
    assert.equal(guarded([...fragment]), fragment)
  }
  assert.throws(() => guarded(['<｜DSML｜invoke name="inspect_server">']), ToolCallProtocolError)
})

test('Markdown fenced and inline code examples remain text with arbitrarily split delimiters', () => {
  const text = [
    '协议示例：`<｜DSML｜invoke>`，双反引号 ``<|DSML|invoke> `quoted` ``。',
    '```xml',
    '<｜DSML｜tool_calls>',
    '<｜DSML｜invoke name="inspect_server">',
    '</｜DSML｜invoke>',
    '</｜DSML｜tool_calls>',
    '```',
    '   ~~~~xml',
    '<|DSML|tool_calls>',
    '   ~~~~',
    '展示结束。'
  ].join('\n')
  assert.equal(guarded([text]), text)
  assert.equal(guarded([...text]), text)
  for (let split = 0; split <= text.length; split++) {
    assert.equal(guarded([text.slice(0, split), text.slice(split)]), text)
  }
})

test('closing a code span or fence restores raw marker detection', () => {
  for (const text of [
    '`example`<|DSML|invoke>',
    '``example ` still code``<｜DSML｜invoke>',
    '```xml\n<|DSML|example>\n```\n<|DSML|invoke>',
    '~~~xml\n<|DSML|example>\n~~~~ \t\r\n</|DSML|invoke>'
  ]) {
    assert.throws(() => guarded([...text]), ToolCallProtocolError)
  }
})

test('a fence-like line with trailing text does not terminate an example', () => {
  const text = '```xml\n``` still inside code\n<｜DSML｜invoke>\n```\nfinished'
  assert.equal(guarded([...text]), text)
})

test('escaped backticks do not turn raw protocol text into a code example', () => {
  assert.throws(() => guarded([...('\\' + '`<|DSML|invoke>')]), ToolCallProtocolError)
  const text = '\\\\' + '`<|DSML|example>`'
  assert.equal(guarded([...text]), text)
})

test('an unmatched inline delimiter cannot hide raw calls in a later paragraph', () => {
  for (const paragraphBreak of ['\n\n', '\n \t \n', '\r\n\r\n', '\r\n \t \r\n']) {
    const text = `unclosed \`inline${paragraphBreak}<|DSML|invoke name="inspect_server">`
    assert.throws(() => guarded([text]), ToolCallProtocolError)
    assert.throws(() => guarded([...text]), ToolCallProtocolError)
  }
  const multilineSpan = '`inline\n<|DSML|example>`'
  assert.equal(guarded([...multilineSpan]), multilineSpan)
  const fence = '```xml\n\n<|DSML|example>\n```'
  assert.equal(guarded([...fence]), fence)
})

test('long responses stream continuously and long malformed raw calls fail at the marker', () => {
  const guard = new ToolCallTextGuard()
  const chunk = '正常回答 1 < 2。'.repeat(100)
  for (let index = 0; index < 1000; index++) assert.equal(guard.push(chunk), chunk)
  assert.equal(guard.finish(), '')
  assert.throws(() => guarded(['<|DSML', ' '.repeat(100000)]), ToolCallProtocolError)
  assert.throws(() => guarded(['<|DSML|', 'x'.repeat(100000)]), ToolCallProtocolError)
})

test('a rejected guard stays rejected if a caller tries to continue the stream', () => {
  const guard = new ToolCallTextGuard()
  assert.throws(() => guard.push('<|DSML|invoke>'), ToolCallProtocolError)
  assert.throws(() => guard.push('remaining content'), ToolCallProtocolError)
  assert.throws(() => guard.finish(), ToolCallProtocolError)
})
