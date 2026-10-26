import assert from 'node:assert/strict'
import test from 'node:test'
import { connectedWorkspaceSessions, pickConnectedWorkspaceTab } from './workspace-sessions'

test('dock considers runtime connections, not saved or disconnected definitions', () => {
  assert.deepEqual(
    connectedWorkspaceSessions([
      { id: 'saved', name: 'Saved', isConnected: false },
      { id: 'live', name: 'Production', host: 'server.local', isConnected: true },
      { id: 'event', status: 'connected', config: { name: 'Preview', host: 'preview.local' } },
      { id: 'closed', status: 'disconnected' }
    ]),
    [
      { id: 'live', name: 'Production', host: 'server.local' },
      { id: 'event', name: 'Preview', host: 'preview.local' }
    ]
  )
})

test('navigation keeps the selected live session and ignores a disconnected tab', () => {
  const tabs = [
    { id: 'terminal-old', name: 'Old', icon: '', path: '/terminal?connectionId=old' },
    {
      id: 'terminal-live',
      name: 'Live',
      icon: '',
      path: '/terminal?connectionId=live&nodeId=definition'
    },
    { id: 'file-manager-other', name: 'Other', icon: '', path: '/file-manager?connectionId=other' }
  ]
  const connections = [
    { id: 'live', name: 'Live', host: '' },
    { id: 'other', name: 'Other', host: '' }
  ]
  assert.equal(
    pickConnectedWorkspaceTab(tabs, connections, 'terminal-live', '')?.id,
    'terminal-live'
  )
  assert.equal(
    pickConnectedWorkspaceTab(tabs, connections, 'terminal-old', 'terminal-live')?.id,
    'terminal-live'
  )
  assert.equal(pickConnectedWorkspaceTab(tabs, [], 'terminal-live', 'terminal-live'), undefined)
})

test('a running connection can reopen terminal and files without an existing tab', () => {
  const tab = pickConnectedWorkspaceTab(
    [],
    [{ id: 'live/1', name: 'Demo & tools', host: '' }],
    '',
    ''
  )
  assert.ok(tab)
  const query = new URLSearchParams(tab.path.split('?')[1])
  assert.equal(query.get('connectionId'), 'live/1')
  assert.equal(query.get('name'), 'Demo & tools')
})
