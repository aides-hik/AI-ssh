import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { parseSSHDragNode, serializeSSHDragNode } from '../../utils/ssh-tree-drag'
import { findNode } from '../../utils/tree-utils'

async function loadDragHandlers(node: Record<string, unknown>) {
  const source = await readFile(new URL('./SSHTreeNode.vue', import.meta.url), 'utf8')
  const script = source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)?.[1]
  assert(script)
  const parsed = ts.createSourceFile('component.ts', script, ts.ScriptTarget.Latest, true)
  const names = new Set(['handleDragStart', 'handleDragEnd', 'handleDrop'])
  const statements = parsed.statements.filter(statement => ts.isVariableStatement(statement) &&
    statement.declarationList.declarations.some(declaration => names.has(declaration.name.getText(parsed))))
  assert.equal(statements.length, 3)
  const javascript = ts.transpileModule(statements.map(statement => statement.getText(parsed)).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText
  const events: unknown[][] = []
  const handlers = new Function('props', 'isDragging', 'isDragOver', 'emit', 'serializeSSHDragNode', 'parseSSHDragNode',
    javascript + '\nreturn {handleDragStart, handleDragEnd, handleDrop}')(
    { node }, { value: false }, { value: false }, (...args: unknown[]) => events.push(args), serializeSSHDragNode, parseSSHDragNode
  )
  return { ...handlers, events }
}

test('actual connection and nested folder drags expose only identity to the OS and internal drag event', async () => {
  const connection = { id: 'connection-id', type: 'connection', name: 'host', host: 'private-host',
    password: 'fixture-password', privateKey: 'fixture-private-key', passphrase: 'fixture-passphrase' }
  for (const node of [connection, { id: 'folder-id', type: 'folder', name: 'group', children: [connection] }]) {
    const handlers = await loadDragHandlers(node)
    const data = new Map<string, string>([['text/plain', 'fixture-password'], ['text/html', 'fixture-private-key']])
    handlers.handleDragStart({ dataTransfer: { clearData: () => data.clear(), setData: (key: string, value: string) => data.set(key, value) } })
    assert.equal(data.size, 1)
    assert.deepEqual(JSON.parse(data.get('application/json')!), { id: node.id, type: node.type })
    assert.deepEqual(handlers.events, [['drag-node', { id: node.id, type: node.type }]])
    for (const secret of ['fixture-password', 'fixture-private-key', 'fixture-passphrase', 'private-host']) {
      assert.equal(JSON.stringify([...data.values(), handlers.events]).includes(secret), false)
    }
    handlers.handleDragEnd()
    assert.deepEqual(handlers.events.at(-1), ['drag-end'], 'Cancelled and completed drags both clear parent drag identity')
  }
})

test('actual folder drop accepts identity and strips unrelated fields, while invalid external drags are ignored', async () => {
  const folder = { id: 'destination', type: 'folder' }
  const handlers = await loadDragHandlers(folder)
  handlers.handleDrop({ dataTransfer: { getData: () => JSON.stringify({ id: 'source', type: 'connection', password: 'discard-me' }) } })
  assert.deepEqual(handlers.events, [['drop-node', { dragNode: { id: 'source', type: 'connection' }, dropNode: folder }]])
  for (const value of ['', 'bad json', 'null', '[]', '{}', '{"id":"x","type":"other"}', 'x'.repeat(2048)]) {
    handlers.handleDrop({ dataTransfer: { getData: () => value } })
  }
  assert.equal(handlers.events.length, 1)
})

test('actual sidebar moves only an internally dragged node and rejects self or descendant destinations', async () => {
  const source = await readFile(new URL('../layout/AppSidebar.vue', import.meta.url), 'utf8')
  const script = source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)?.[1]
  assert(script)
  const parsed = ts.createSourceFile('sidebar.ts', script, ts.ScriptTarget.Latest, true)
  const declarations = parsed.statements.filter(statement => ts.isVariableStatement(statement) &&
    statement.declarationList.declarations.some(item => ['handleDropNode', 'handleDragEnd'].includes(item.name.getText(parsed))))
  assert.equal(declarations.length, 2)
  const javascript = ts.transpileModule(declarations.map(item => item.getText(parsed)).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText
  const connection = { id: 'connection', type: 'connection' }
  const child = { id: 'child', type: 'folder' }
  const group = { id: 'group', type: 'folder', children: [child] }
  const destination = { id: 'destination', type: 'folder' }
  const dragged = { value: null as null | { id: string; type: string } }
  const moves: unknown[] = []
  const { drop, end } = new Function('findNode', 'sshTreeData', 'dragNode', 'sshService', 'loadSSHTree', javascript + '\nreturn {drop: handleDropNode, end: handleDragEnd};')(
    findNode, { value: [connection, group, destination] }, dragged,
    { moveNode: async (value: unknown) => moves.push(value) }, async () => {}
  )
  await drop({ dragNode: connection, dropNode: destination })
  assert.equal(moves.length, 0, 'External payload without an internal drag must be ignored')
  dragged.value = { id: 'connection', type: 'connection' }
  await drop({ dragNode: { id: 'connection', type: 'folder' }, dropNode: destination })
  assert.equal(moves.length, 0)
  await drop({ dragNode: connection, dropNode: destination })
  assert.deepEqual(moves, [{ nodeId: 'connection', nodeType: 'connection', targetFolderId: 'destination', order: 0 }])
  for (const target of [group, child]) {
    dragged.value = { id: 'group', type: 'folder' }
    await drop({ dragNode: group, dropNode: target })
  }
  assert.equal(moves.length, 1)
  dragged.value = { id: 'connection', type: 'connection' }
  end()
  await drop({ dragNode: connection, dropNode: destination })
  assert.equal(moves.length, 1, 'An external drop cannot reuse an identity left by an earlier cancelled drag')
})
