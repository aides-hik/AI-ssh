import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const currentDir = dirname(fileURLToPath(import.meta.url))
const chatViewPath = join(currentDir, 'AIChatOpenCodeStyle.vue')

async function loadSendHandler(overrides: Record<string, any> = {}) {
  const source = await readFile(chatViewPath, 'utf8')
  const script = source.slice(source.indexOf('>') + 1, source.indexOf('</script>'))
  const parsed = ts.createSourceFile('chat.ts', script, ts.ScriptTarget.Latest, true)
  const declaration = parsed.statements.find(statement =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === 'handleSendMessage'
  )
  assert(declaration, 'The actual component submit handler must exist')
  const javascript = ts.transpileModule(declaration.getText(parsed), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText
  const state = {
    props: { currentProvider: { id: 'openai' }, currentModel: { id: 'test-model' }, connectionId: 'test-ssh' },
    inputMessage: { value: '  保留这段草稿  ' },
    isGenerating: { value: false },
    error: { value: null as Error | null },
    statuses: [] as string[],
    requests: [] as string[],
    inputRef: { value: { focus() {} } },
    nextTick: (callback: () => void) => callback(),
    resizeInputHeight() {},
    normalizeUserErrorMessage: (message: string) => message,
    console: { error() {} },
    ...overrides
  }
  const dependencies = {
    ...state,
    setStatus: (_stage: string, message: string) => state.statuses.push(message),
    sendMessageWithTools: overrides.sendMessageWithTools || (async (content: string) => { state.requests.push(content) })
  }
  const run = new Function(...Object.keys(dependencies), javascript + '\nreturn handleSendMessage')(
    ...Object.values(dependencies)
  ) as () => Promise<void>
  return { state, run }
}

test('sending without a model keeps the draft and shows an actionable error', async () => {
  const { state, run } = await loadSendHandler({
    props: { currentProvider: null, currentModel: null, connectionId: 'test-ssh' }
  })
  await run()
  assert.equal(state.inputMessage.value, '  保留这段草稿  ')
  assert.match(state.error.value?.message || '', /选择.*模型/)
  assert.equal(state.requests.length, 0)
})

test('model HTTP errors explain authentication, quota and service failures without displaying response bodies', async () => {
  const source = await readFile(chatViewPath, 'utf8')
  const script = source.slice(source.indexOf('>') + 1, source.indexOf('</script>'))
  const parsed = ts.createSourceFile('chat.ts', script, ts.ScriptTarget.Latest, true)
  const declaration = parsed.statements.find(statement =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === 'normalizeUserErrorMessage'
  )
  assert(declaration)
  const javascript = ts.transpileModule(declaration.getText(parsed), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText
  const normalize = new Function(javascript + '\nreturn normalizeUserErrorMessage')() as (error: string) => string
  for (const status of [401, 403]) {
    const message = normalize(`HTTP ${status}: forbidden - private response body`)
    assert.match(message, /API Key.*权限/)
    assert.match(message, new RegExp(`HTTP ${status}`))
    assert.doesNotMatch(message, /private response body/)
  }
  assert.match(normalize('HTTP 429: limit'), /检查配额/)
  assert.match(normalize('HTTP 503: unavailable'), /HTTP 503.*模型是否可用/)
})

test('sending without an SSH connection keeps the draft and shows an actionable error', async () => {
  const { state, run } = await loadSendHandler({
    props: { currentProvider: { id: 'openai' }, currentModel: { id: 'test-model' }, connectionId: '' }
  })
  await run()
  assert.equal(state.inputMessage.value, '  保留这段草稿  ')
  assert.match(state.error.value?.message || '', /建立 SSH 连接/)
  assert.equal(state.requests.length, 0)
})

test('an unexpected send failure is displayed and restores the submitted draft', async () => {
  const failure = new Error('local fixture failed')
  const { state, run } = await loadSendHandler({
    sendMessageWithTools: async () => { throw failure }
  })
  await run()
  assert.equal(state.error.value, failure)
  assert.equal(state.inputMessage.value, '保留这段草稿')
  assert.equal(state.statuses.at(-1), failure.message)
})

test('a failed request preserves a new draft typed while waiting', async () => {
  const { state, run } = await loadSendHandler()
  const { run: fail } = await loadSendHandler({
    inputMessage: state.inputMessage,
    sendMessageWithTools: async () => {
      state.inputMessage.value = '用户新写的草稿'
      throw new Error('local fixture failed')
    }
  })
  await fail()
  assert.equal(state.inputMessage.value, '用户新写的草稿')
  state.inputMessage.value = '正常发送'
  await run()
  assert.deepEqual(state.requests, ['正常发送'])
  assert.equal(state.inputMessage.value, '')
})

test('chat input stays editable while generation is in progress', async () => {
  const source = await readFile(chatViewPath, 'utf8')

  assert.doesNotMatch(source, /:disabled="isGenerating"/)
  assert.match(source, /if \(!inputMessage\.value\.trim\(\) \|\| isGenerating\.value\) return/)
})

test('chat stop button shows stopping state and aborted tools render as cancelled', async () => {
  const source = await readFile(chatViewPath, 'utf8')

  assert.match(source, /const isStopping = ref\(false\)/)
  assert.match(source, /aborted: 'Cancelled'/)
  assert.match(source, /oc-send-button oc-stop-button is-stopping/)
  assert.match(source, /:disabled="isStopping"/)
  assert.match(source, />Stopping\.\.\.</)
})

test('session status panel is collapsed by default', async () => {
  const source = await readFile(chatViewPath, 'utf8')

  assert.match(source, /const sessionStatusExpanded = ref\(false\)/)
})

test('assistant display is built from ordered timeline blocks', async () => {
  const source = await readFile(chatViewPath, 'utf8')

  assert.match(source, /blocks:\s*getOrderedBlocks\(msg\)/)
  assert.match(source, /v-for="block in msg\.blocks"/)
  assert.doesNotMatch(source, /!isThinkingContent\(msg\.content\)/)
  assert.doesNotMatch(source, /getResponseText\(msg\)/)
})

test('stream handler writes explicit analysis inquiry and summary semantics', async () => {
  const source = await readFile(chatViewPath, 'utf8')

  assert.match(source, /appendAssistantTextBlock\(currentMsg, event\.delta\)/)
  assert.match(source, /event\.toolName === 'ask_followup_question'/)
  assert.match(
    source,
    /displayKind:\s*event\.toolName === 'ask_followup_question' \? 'inquiry' : 'tool'/
  )
  assert.match(source, /markLastAssistantTextBlockAsSummary\(currentMsg\)/)
})

test('inquiry and summary use response shell while tools stay in timeline', async () => {
  const source = await readFile(chatViewPath, 'utf8')

  assert.match(source, /v-if="block\.type === 'analysis'"/)
  assert.match(source, /v-else-if="block\.type === 'tool' && block\.toolPart"/)
  assert.match(
    source,
    /v-else-if="\(block\.type === 'inquiry' \|\| block\.type === 'summary'\) && block\.text"/
  )
  assert.match(source, /block\.type === 'inquiry' \? '询问' : '总结'/)
  assert.match(source, /copyResponse\(block\.text\)/)
})

test('active SSH chat system prompt forbids interactive shell commands', async () => {
  const source = await readFile(chatViewPath, 'utf8')

  assert.match(source, /SSH command execution rules:/)
  assert.match(source, /All SSH commands must be non-interactive and one-shot\./)
  assert.match(
    source,
    /Never run interactive programs like vim, nano, less, more, top, htop, watch, mysql, psql, or ssh\./
  )
  assert.match(
    source,
    /Never run commands that wait indefinitely for input or stream forever, such as tail -f, journalctl -f, docker logs -f, or read\./
  )
  assert.match(
    source,
    /Use non-interactive flags whenever available \(for example: --no-pager, -n, --yes, --batch, --non-interactive\)\./
  )
  assert.match(
    source,
    /If a task cannot be completed safely in non-interactive mode, ask the user before proceeding instead of executing the command\./
  )
})

test('active SSH chat system prompt explains how to update env docs without force_replace errors', async () => {
  const source = await readFile(chatViewPath, 'utf8')

  assert.match(
    source,
    /When updating the server environment document, default to old_string\/new_string exact replacements\./
  )
  assert.match(
    source,
    /Do not replace the entire document with content unless the user clearly asked for a full rewrite\./
  )
  assert.match(
    source,
    /Only use force_replace=true after the user explicitly confirms a full-document overwrite\./
  )
  assert.match(
    source,
    /canonical environment document is env\.md in the authenticated remote user's \$HOME/
  )
  assert.match(source, /shared by every computer that connects as that same remote user/)
})

test('active SSH chat system prompt requires complete and readable software inventory updates', async () => {
  const source = await readFile(chatViewPath, 'utf8')

  assert.match(source, /Software documentation workflow:/)
  assert.match(source, /read the full env\.md.*inspect the live server.*update only that section.*read env\.md again/)
  assert.match(source, /exact version and build options/)
  assert.match(source, /package manager, and verified install\/update\/remove commands/)
  assert.match(source, /installation, configuration, include, module, certificate, web root, data, cache, temporary, PID, and log paths/)
  assert.match(source, /Adapt inspection to the target type instead of using a product-specific checklist/)
  assert.match(source, /for databases inspect client\/server versions/)
  assert.match(source, /for containers inspect runtime/)
  assert.match(source, /for language runtimes inspect executable/)
  assert.match(source, /for web applications inspect deployment root/)
  assert.match(source, /Collect only fields applicable to the target/)
  assert.match(source, /do not stop after a version check/)
  assert.doesNotMatch(source, /For Nginx specifically/)
  assert.match(source, /record it as 未确认 and briefly state why/)
  assert.match(source, /Do not paste raw command output into env\.md/)
  assert.match(source, /基本信息 table/)
  assert.match(source, /路径与文件 table/)
  assert.match(source, /网络与实例 table/)
  assert.match(source, /常用命令 fenced shell block/)
  assert.match(source, /target software section exists exactly once/)
})

test('assistant turns with tool activity stay expanded while tools are running', async () => {
  const source = await readFile(chatViewPath, 'utf8')

  assert.match(source, /const hasRunningTool = msg\.blocks\.some\(/)
  assert.match(source, /block\.type === 'tool' && block\.toolPart\?\.state\.status === 'running'/)
  assert.match(source, /if \(hasRunningTool\) \{\s*return false\s*\}/)
})
