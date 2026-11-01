import test from 'node:test'
import assert from 'node:assert/strict'
import { ChatHistoryStore } from './chat-history'
import { createAssistantMessage, createUserMessage } from './messages/message'

function fixture(faults: { read?: boolean; write?: boolean; remove?: boolean; enumerate?: boolean } = {}) {
  const values: Record<string, string> = {}
  const storage = new Proxy(values, {
    get(target, key) {
      if (key === 'getItem') return (name: string) => { if (faults.read) throw new Error('Storage access blocked'); return target[name] ?? null }
      if (key === 'setItem') return (name: string, value: string) => { if (faults.write) throw new DOMException('Storage full', 'QuotaExceededError'); target[name] = value }
      if (key === 'removeItem') return (name: string) => { if (faults.remove) throw new Error('Storage removal blocked'); delete target[name] }
      return target[String(key)]
    },
    ownKeys(target) { if (faults.enumerate) throw new Error('Storage enumeration blocked'); return Reflect.ownKeys(target) }
  }) as unknown as Storage
  return { values, storage, store: new ChatHistoryStore(storage) }
}

test('history restores complete user text, tool results and host identity without provider reasoning', () => {
  const { store, values } = fixture()
  const user = createUserMessage('user', '完整需求'.repeat(2000))
  user.info.targets = [{ id: 'old-runtime', name: 'Server A', host: 'a.invalid' }]
  const assistant = createAssistantMessage('answer', 'user')
  assistant.parts = [
    { type: 'text', text: 'result', kind: 'summary' },
    { type: 'reasoning', text: 'private', metadata: { encrypted_content: 'opaque' } },
    { type: 'tool', tool: 'read_file', callID: 'call', metadata: { encrypted_content: 'opaque' }, state: { status: 'completed', input: { path: '/x' }, output: 'contents', raw: 'opaque', metadata: { targetId: 'old-runtime', targetName: 'Server A', reasoning: 'private', thought_signature: 'opaque' } } }
  ]
  store.save('saved-config', [user, assistant], {})
  const loaded = store.load('saved-config', {})
  assert.equal(loaded[0].parts[0].type === 'text' && loaded[0].parts[0].text, user.parts[0].type === 'text' && user.parts[0].text)
  assert.deepEqual(loaded[0].info.targets, user.info.targets)
  assert.equal(loaded[1].parts.length, 2)
  const tool = loaded[1].parts[1]
  assert.equal(tool.type, 'tool')
  assert.deepEqual(tool.type === 'tool' && tool.state.metadata, { targetId: 'old-runtime', targetName: 'Server A' })
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

test('new conversations have independent histories and the active selection survives reopening', () => {
  const { store, storage } = fixture()
  const first = store.create('host', {})
  assert.ok(first)
  assert.equal(first.title, '')
  assert.equal(first.messageCount, 0)
  assert.equal(store.save('host', [createUserMessage('one', 'Inspect CPU')], {}, first.id), true)
  const second = store.create('host', {})
  assert.ok(second)
  assert.notEqual(first.id, second.id)
  assert.deepEqual(store.load('host', {}), [])
  assert.deepEqual(store.list('host', {}).map(item => item.id), [second.id, first.id])
  assert.deepEqual(store.load('host', {}, first.id).map(item => item.info.id), ['one'])
  assert.equal(store.save('host', [createUserMessage('two', 'Inspect memory')], {}, second.id), true)
  const secondUpdatedAt = store.getActive('host', {})?.updatedAt
  assert.equal(store.select('host', first.id, {}), true)
  assert.equal(store.list('host', {}).find(item => item.id === second.id)?.updatedAt, secondUpdatedAt)
  const reopened = new ChatHistoryStore(storage)
  assert.equal(reopened.getActive('host', {})?.id, first.id)
  assert.deepEqual(reopened.load('host', {}).map(item => item.info.id), ['one'])
  assert.equal(reopened.list('host', {}).length, 2)
})

test('explicit background saves cannot overwrite the selected conversation or resurrect a deleted ID', () => {
  const { store } = fixture()
  const first = store.create('host', {})
  const second = store.create('host', {})
  assert.ok(first && second)
  assert.equal(store.save('host', [createUserMessage('late-one', 'First conversation result')], {}, first.id), true)
  assert.equal(store.getActive('host', {})?.id, second.id)
  assert.deepEqual(store.load('host', {}), [])
  assert.equal(store.delete('host', first.id, {}), true)
  assert.equal(store.save('host', [createUserMessage('late-two', 'Must not revive')], {}, first.id), false)
  assert.deepEqual(store.list('host', {}).map(item => item.id), [second.id])
  assert.equal(store.select('host', first.id, {}), false)
  assert.deepEqual(store.load('host', {}, first.id), [])
})

test('scope identities isolate conversations and reject IDs belonging to another host', () => {
  const { store } = fixture()
  const first = store.create('saved-host-a', {})
  assert.ok(first)
  store.save('saved-host-a', [createUserMessage('a', 'Server A request')], {}, first.id)
  assert.deepEqual(store.list('saved-host-b', {}), [])
  assert.equal(store.getActive('saved-host-b', {}), null)
  assert.equal(store.select('saved-host-b', first.id, {}), false)
  assert.equal(store.save('saved-host-b', [createUserMessage('b', 'Wrong scope')], {}, first.id), false)
  assert.deepEqual(store.load('saved-host-a', {}, first.id).map(item => item.info.id), ['a'])
})

test('legacy scope histories migrate to the first conversation without losing user text or tool observations', () => {
  const { store, values } = fixture()
  const user = createUserMessage('user', '完整需求'.repeat(3000))
  const answer = createAssistantMessage('answer', 'user')
  answer.parts = [{ type: 'tool', tool: 'inspect_server', callID: 'call', state: {
    status: 'completed', input: { targetId: 'runtime', checks: ['cpu'] }, output: 'Observed CPU state',
    metadata: { targetId: 'runtime', targetName: 'Server A' }
  } }]
  values['prism.chat-history.v1:host'] = JSON.stringify([user, answer])
  const migrated = store.getActive('host', {})
  assert.ok(migrated)
  assert.equal(store.list('host', {}).length, 1)
  assert.equal(migrated.messageCount, 2)
  const messages = store.load('host', {}, migrated.id)
  assert.equal(messages[0].parts[0].type === 'text' && messages[0].parts[0].text, '完整需求'.repeat(3000))
  assert.equal(messages[1].parts[0].type === 'tool' && messages[1].parts[0].state.output, 'Observed CPU state')
  assert.equal(values['prism.chat-history.v1:host'], undefined)
  assert.ok(values['prism.chat-history.v2:host'])
  assert.equal(store.getActive('host', {})?.id, migrated.id)
  const fresh = store.create('host', {})
  assert.ok(fresh)
  assert.equal(store.list('host', {}).length, 2)
  assert.equal(store.load('host', {}, migrated.id).length, 2)
})

test('failed migration keeps the original storage record readable and never deletes it', () => {
  const faults = { write: true }
  const { store, values } = fixture(faults)
  const original = JSON.stringify([createUserMessage('old', 'Original request')])
  values['prism.chat-history.v1:host'] = original
  assert.deepEqual(store.load('host', {}).map(item => item.info.id), ['old'])
  assert.equal(store.getActive('host', {})?.id, 'legacy')
  assert.equal(store.create('host', {}), null)
  assert.equal(values['prism.chat-history.v1:host'], original)
  assert.equal(values['prism.chat-history.v2:host'], undefined)
  faults.write = false
  assert.equal(store.getActive('host', {})?.id, 'legacy')
  assert.equal(values['prism.chat-history.v1:host'], undefined)
})

test('first user titles remain stable when later requests and retention remove the original message', () => {
  const { store } = fixture()
  const conversation = store.create('host', {})
  assert.ok(conversation)
  const messages = [
    createUserMessage('u1', '  Original title\n stays  concise  '), createAssistantMessage('a1', 'u1'),
    createUserMessage('u2', 'Later request'), createAssistantMessage('a2', 'u2')
  ]
  assert.equal(store.save('host', messages, { maxHistoryMessages: 3 }, conversation.id), true)
  assert.equal(store.getActive('host', {})?.title, 'Original title stays concise')
  assert.deepEqual(store.load('host', {}, conversation.id).map(item => item.info.id), ['u2', 'a2'])
  store.save('host', [createUserMessage('u3', 'Another request')], {}, conversation.id)
  assert.equal(store.getActive('host', {})?.title, 'Original title stays concise')
  const named = store.create('host', {}, 'Saved investigation')
  assert.ok(named)
  store.save('host', [createUserMessage('u4', 'Do not rename')], {}, named.id)
  assert.equal(store.getActive('host', {})?.title, 'Saved investigation')
})

test('message limits apply to each conversation without changing active selection or live messages', () => {
  const { store } = fixture()
  const conversations = [store.create('host', {}), store.create('host', {})]
  const messages = [createUserMessage('u1', 'First'), createAssistantMessage('a1', 'u1'), createUserMessage('u2', 'Second'), createAssistantMessage('a2', 'u2')]
  for (const conversation of conversations) {
    assert.ok(conversation)
    store.save('host', messages, {}, conversation.id)
  }
  const active = store.getActive('host', {})?.id
  assert.equal(store.applySettings({ maxHistoryMessages: 3 }), true)
  assert.equal(store.getActive('host', {})?.id, active)
  assert.ok(store.list('host', {}).every(item => item.messageCount === 2))
  for (const conversation of conversations) {
    assert.ok(conversation)
    assert.deepEqual(store.load('host', {}, conversation.id).map(item => item.info.id), ['u2', 'a2'])
  }
  assert.equal(messages.length, 4)
})

test('deleting active history selects the newest remaining conversation and deleting the last leaves no active record', () => {
  const { store } = fixture()
  const first = store.create('host', {})
  const second = store.create('host', {})
  const third = store.create('host', {})
  assert.ok(first && second && third)
  assert.equal(store.delete('host', third.id, {}), true)
  assert.equal(store.getActive('host', {})?.id, second.id)
  assert.equal(store.delete('host', first.id, {}), true)
  assert.equal(store.getActive('host', {})?.id, second.id)
  assert.equal(store.delete('host', second.id, {}), true)
  assert.equal(store.getActive('host', {}), null)
  assert.deepEqual(store.list('host', {}), [])
  assert.deepEqual(store.load('host', {}), [])
  assert.equal(store.delete('host', second.id, {}), false)
})

test('disabled history clears both formats across scopes and cannot be recreated by any write API', () => {
  const { store, values } = fixture()
  const conversation = store.create('host', {})
  assert.ok(conversation)
  store.save('host', [createUserMessage('new', 'Current format')], {}, conversation.id)
  values['prism.chat-history.v1:old-host'] = JSON.stringify([createUserMessage('old', 'Legacy format')])
  values['other-setting'] = 'keep'
  assert.equal(store.applySettings({ enableChatHistory: false }), true)
  assert.equal(store.create('host', { enableChatHistory: false }), null)
  assert.equal(store.select('host', conversation.id, { enableChatHistory: false }), false)
  assert.equal(store.save('host', [createUserMessage('late', 'Must not return')], { enableChatHistory: false }, conversation.id), false)
  assert.deepEqual(store.list('host', { enableChatHistory: false }), [])
  assert.deepEqual(values, { 'other-setting': 'keep' })
})

test('storage quota failures preserve all previous conversations and selections', () => {
  const faults = { write: false }
  const { store, values } = fixture(faults)
  const first = store.create('host', {})
  const second = store.create('host', {})
  assert.ok(first && second)
  store.save('host', [createUserMessage('saved', 'Keep this')], {}, second.id)
  const before = JSON.stringify(values)
  faults.write = true
  assert.equal(store.save('host', [createUserMessage('new', 'Cannot save')], {}, second.id), false)
  assert.equal(store.create('host', {}), null)
  assert.equal(store.select('host', first.id, {}), false)
  assert.equal(store.delete('host', second.id, {}), false)
  assert.equal(store.applySettings({ maxHistoryMessages: 1 }), false)
  assert.equal(JSON.stringify(values), before)
  assert.equal(store.getActive('host', {})?.id, second.id)
  assert.deepEqual(store.load('host', {}).map(item => item.info.id), ['saved'])
})

test('blocked storage reads or enumeration fail safely without overwriting existing records', () => {
  const faults = { read: false, enumerate: false }
  const { store, values } = fixture(faults)
  const conversation = store.create('host', {})
  assert.ok(conversation)
  const before = JSON.stringify(values)
  faults.read = true
  assert.deepEqual(store.list('host', {}), [])
  assert.deepEqual(store.load('host', {}), [])
  assert.equal(store.getActive('host', {}), null)
  assert.equal(store.create('host', {}), null)
  assert.equal(store.save('host', [createUserMessage('new', 'Cannot read index')], {}), false)
  assert.equal(JSON.stringify(values), before)
  faults.enumerate = true
  assert.equal(store.applySettings({ enableChatHistory: false }), false)
})

test('scope clearing preserves other hosts and prevents a leftover legacy record from returning', () => {
  const { store, values } = fixture()
  const first = store.create('a', {})
  const second = store.create('b', {})
  assert.ok(first && second)
  values['prism.chat-history.v1:a'] = JSON.stringify([createUserMessage('old', 'Old duplicate')])
  assert.equal(store.clear('a'), true)
  assert.deepEqual(store.list('a', {}), [])
  assert.equal(values['prism.chat-history.v1:a'], undefined)
  assert.equal(store.getActive('b', {})?.id, second.id)
  assert.equal(store.clear(''), false)
})

test('damaged conversation indexes recover valid entries without duplicating IDs or restoring private state', () => {
  const { store, values } = fixture()
  values['prism.chat-history.v2:host'] = JSON.stringify({ version: 2, activeId: 'missing', conversations: [
    { id: 'valid', title: 'Retained', createdAt: 1, updatedAt: 2, messages: [createUserMessage('user', 'Keep text')] },
    { id: 'valid', title: 'Duplicate', createdAt: 1, updatedAt: 3, messages: [] },
    { id: 'bad', messages: null }, null
  ] })
  assert.deepEqual(store.list('host', {}).map(item => item.id), ['valid'])
  assert.equal(store.getActive('host', {})?.id, 'valid')
  assert.deepEqual(store.load('host', {}).map(item => item.info.id), ['user'])
})

test('a migrated legacy record cannot return after deleting its v2 conversation even if legacy cleanup is blocked', () => {
  const faults = { remove: true }
  const { store, values } = fixture(faults)
  values['prism.chat-history.v1:host'] = JSON.stringify([createUserMessage('old', 'Original history')])
  const conversation = store.getActive('host', {})
  assert.ok(conversation)
  assert.ok(values['prism.chat-history.v1:host'])
  assert.equal(store.delete('host', conversation.id, {}), true)
  assert.deepEqual(store.list('host', {}), [])
  assert.equal(store.getActive('host', {}), null)
  assert.equal(store.applySettings({ enableChatHistory: false }), false)
  faults.remove = false
  assert.equal(store.applySettings({ enableChatHistory: false }), true)
  assert.deepEqual(values, {})
})

test('existence distinguishes present or deleted conversations from unavailable storage', () => {
  const faults = { read: false }
  const { store } = fixture(faults)
  const conversation = store.create('host', {})
  assert.ok(conversation)
  assert.equal(store.has('host', conversation.id, {}), true)
  assert.equal(store.has('other-host', conversation.id, {}), false)
  assert.equal(store.has('host', 'unknown', {}), false)
  faults.read = true
  assert.equal(store.has('host', conversation.id, {}), null)
  assert.equal(store.has('host', 'unknown', {}), null)
  faults.read = false
  assert.equal(store.delete('host', conversation.id, {}), true)
  assert.equal(store.has('host', conversation.id, {}), false)
  const replacement = store.create('host', {})
  assert.ok(replacement)
  assert.equal(store.has('host', replacement.id, {}), true)
  store.applySettings({ enableChatHistory: false })
  assert.equal(store.has('host', replacement.id, { enableChatHistory: false }), null)
  assert.equal(store.has('host', replacement.id, {}), false)
})
