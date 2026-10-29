import test from 'node:test'
import assert from 'node:assert/strict'
import { ChatHistoryStore } from './chat-history'
import { createAssistantMessage, createUserMessage } from './messages/message'

function fixture() {
  const values: Record<string, string> = {}
  const storage = new Proxy(values, { get(target, key) {
    if (key === 'getItem') return (name: string) => target[name] ?? null
    if (key === 'setItem') return (name: string, value: string) => { target[name] = value }
    if (key === 'removeItem') return (name: string) => { delete target[name] }
    return target[String(key)]
  } }) as unknown as Storage
  return { values, store: new ChatHistoryStore(storage) }
}

test('history restores complete user text, tool results and host identity without provider reasoning', () => {
  const { store, values } = fixture()
  const user = createUserMessage('user', '完整需求'.repeat(2000))
  user.info.targets = [{ id: 'old-runtime', name: 'Server A', host: 'a.invalid' }]
  const assistant = createAssistantMessage('answer', 'user')
  assistant.parts = [
    { type: 'text', text: 'result', kind: 'summary' },
    { type: 'reasoning', text: 'private', metadata: { encrypted_content: 'opaque' } },
    { type: 'tool', tool: 'read_file', callID: 'call', metadata: { encrypted_content: 'opaque' }, state: { status: 'completed', input: { path: '/x' }, output: 'contents', raw: 'opaque', metadata: { reasoning: 'private' } } }
  ]
  store.save('saved-config', [user, assistant], {})
  const loaded = store.load('saved-config', {})
  assert.equal(loaded[0].parts[0].type === 'text' && loaded[0].parts[0].text, user.parts[0].type === 'text' && user.parts[0].text)
  assert.deepEqual(loaded[0].info.targets, user.info.targets)
  assert.equal(loaded[1].parts.length, 2)
  assert.doesNotMatch(JSON.stringify(values), /opaque|private|encrypted_content/)
  assert.deepEqual(store.load('another-config', {}), [])
})

test('retention limits disk history at user boundaries and never mutates the live conversation', () => {
  const { store } = fixture()
  const messages = [createUserMessage('u1', 'first'), createAssistantMessage('a1', 'u1'), createUserMessage('u2', 'second'), createAssistantMessage('a2', 'u2')]
  store.save('host', messages, { maxHistoryMessages: 3 })
  assert.deepEqual(store.load('host', {}).map(message => message.info.id), ['u2', 'a2'])
  assert.equal(messages.length, 4)
  store.applySettings({ maxHistoryMessages: 1 })
  assert.deepEqual(store.load('host', {}), [])
})

test('disabling history removes all saved hosts and prevents subsequent writes', () => {
  const { store, values } = fixture()
  for (const id of ['a', 'b']) store.save(id, [createUserMessage(id, 'request')], {})
  values['other-setting'] = 'keep'
  store.applySettings({ enableChatHistory: false })
  store.save('a', [createUserMessage('new', 'request')], { enableChatHistory: false })
  assert.deepEqual(values, { 'other-setting': 'keep' })
})

test('corrupt history is ignored and interrupted tool work is restored as aborted', () => {
  const { store, values } = fixture()
  values['prism.chat-history.v1:broken'] = '{'
  assert.deepEqual(store.load('broken', {}), [])
  const assistant = createAssistantMessage('answer', 'user')
  assistant.parts = [{ type: 'tool', callID: 'call', tool: 'inspect_server', state: { status: 'running' } }]
  store.save('host', [createUserMessage('user', 'inspect'), assistant], {})
  const part = store.load('host', {})[1].parts[0]
  assert.equal(part.type === 'tool' && part.state.status, 'aborted')
  assert.equal(assistant.parts[0].type === 'tool' && assistant.parts[0].state.status, 'running')
})
