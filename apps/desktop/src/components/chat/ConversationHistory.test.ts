import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

interface Summary { id: string; title: string; createdAt: number; updatedAt: number; messageCount: number }
const summaries: Summary[] = [
  { id: 'cpu', title: 'CPU 巡检', createdAt: 1, updatedAt: 3, messageCount: 4 },
  { id: 'docker', title: 'Docker deployment', createdAt: 1, updatedAt: 2, messageCount: 6 },
  { id: 'new', title: '', createdAt: 1, updatedAt: 1, messageCount: 0 }
]

async function historyPanel() {
  const source = await readFile(new URL('./ConversationHistory.vue', import.meta.url), 'utf8')
  const script = source.slice(source.indexOf('>') + 1, source.indexOf('</script>'))
  const parsed = ts.createSourceFile('history.ts', script, ts.ScriptTarget.Latest, true)
  const names = ['conversationTitle', 'filterConversations', 'canChange', 'selectConversation', 'requestDelete', 'cancelDelete', 'confirmDelete', 'onKeydown', 'focusSearch']
  const functions = names.map(name => {
    const declaration = parsed.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === name)
    assert.ok(declaration)
    return declaration.getText(parsed)
  })
  const javascript = ts.transpileModule(functions.join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText
  const props = { conversations: summaries.map(item => ({ ...item })), activeId: 'cpu', busy: false, loading: false, enabled: true, error: '' }
  const pendingDelete = { value: '' }
  const events: Array<[string, string?]> = []
  let searchFocused = 0
  let cancelFocused = 0
  const bindings = {
    props, pendingDelete, copy: { value: { newConversation: '新对话' } },
    emit: (event: string, id?: string) => events.push([event, id]),
    nextTick: async (callback?: () => void) => { callback?.() },
    searchInput: { value: { focus: () => { searchFocused++ } } },
    panel: { value: { querySelector: () => ({ focus: () => { cancelFocused++ } }) } }
  }
  const methods = new Function(...Object.keys(bindings), `${javascript}\nreturn { ${names.join(', ')} }`)(...Object.values(bindings)) as {
    filterConversations: (items: Summary[], query: string) => Summary[]
    conversationTitle: (item: Summary) => string
    selectConversation: (id: string) => void
    requestDelete: (id: string) => void
    cancelDelete: () => void
    confirmDelete: (id: string) => void
    onKeydown: (event: Partial<KeyboardEvent>) => void
    focusSearch: () => Promise<void>
  }
  return { source, props, pendingDelete, events, methods, focusCounts: () => ({ searchFocused, cancelFocused }) }
}

test('conversation search matches titles without case or surrounding whitespace and labels empty drafts', async () => {
  const { methods } = await historyPanel()
  assert.deepEqual(methods.filterConversations(summaries, '  docker  ').map(item => item.id), ['docker'])
  assert.deepEqual(methods.filterConversations(summaries, '巡检').map(item => item.id), ['cpu'])
  assert.deepEqual(methods.filterConversations(summaries, '新对话').map(item => item.id), ['new'])
  assert.deepEqual(methods.filterConversations(summaries, 'missing'), [])
  assert.equal(methods.filterConversations(summaries, '   ').length, 3)
  assert.equal(methods.conversationTitle(summaries[2]), '新对话')
})

test('deletion requires confirmation for the exact existing conversation and cannot emit twice', async () => {
  const panel = await historyPanel()
  panel.methods.confirmDelete('cpu')
  assert.deepEqual(panel.events, [])
  panel.methods.requestDelete('cpu')
  assert.equal(panel.pendingDelete.value, 'cpu')
  assert.equal(panel.focusCounts().cancelFocused, 1)
  panel.methods.confirmDelete('docker')
  assert.deepEqual(panel.events, [])
  panel.methods.confirmDelete('cpu')
  panel.methods.confirmDelete('cpu')
  assert.deepEqual(panel.events, [['delete', 'cpu']])
  assert.equal(panel.pendingDelete.value, '')
  panel.methods.requestDelete('missing')
  panel.methods.confirmDelete('missing')
  assert.equal(panel.events.length, 1)
})

test('cancelling deletion and selecting a conversation clear the old confirmation', async () => {
  const panel = await historyPanel()
  panel.methods.requestDelete('cpu')
  panel.methods.cancelDelete()
  panel.methods.confirmDelete('cpu')
  assert.deepEqual(panel.events, [])
  panel.methods.requestDelete('cpu')
  panel.methods.selectConversation('docker')
  panel.methods.confirmDelete('cpu')
  assert.deepEqual(panel.events, [['select', 'docker']])
  panel.methods.selectConversation('missing')
  assert.equal(panel.events.length, 1)
})

test('busy, loading and disabled history guard mutations even for direct handler calls', async () => {
  for (const state of [{ busy: true }, { loading: true }, { enabled: false }]) {
    const panel = await historyPanel()
    panel.methods.requestDelete('cpu')
    Object.assign(panel.props, state)
    panel.methods.selectConversation('docker')
    panel.methods.requestDelete('docker')
    panel.methods.confirmDelete('cpu')
    assert.deepEqual(panel.events, [])
    assert.deepEqual(panel.methods.filterConversations(panel.props.conversations, 'CPU').map(item => item.id), ['cpu'])
  }
})

test('a conversation removed by a concurrent refresh cannot be confirmed from stale UI', async () => {
  const panel = await historyPanel()
  panel.methods.requestDelete('cpu')
  panel.props.conversations = panel.props.conversations.filter(item => item.id !== 'cpu')
  panel.methods.confirmDelete('cpu')
  assert.deepEqual(panel.events, [])
})

test('search receives initial focus and Escape closes without interfering with IME composition', async () => {
  const panel = await historyPanel()
  await panel.methods.focusSearch()
  assert.equal(panel.focusCounts().searchFocused, 1)
  let prevented = 0
  let stopped = 0
  const key = { key: 'Escape', preventDefault: () => { prevented++ }, stopPropagation: () => { stopped++ } }
  panel.methods.onKeydown({ ...key, isComposing: true })
  panel.methods.onKeydown({ ...key, keyCode: 229 })
  assert.deepEqual(panel.events, [])
  panel.methods.onKeydown(key)
  assert.deepEqual(panel.events, [['close', undefined]])
  assert.equal(prevented, 1)
  assert.equal(stopped, 1)
})
