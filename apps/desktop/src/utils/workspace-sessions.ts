export interface WorkspaceTab {
  id: string
  name: string
  icon: string
  path: string
}

export interface ConnectedWorkspaceSession {
  id: string
  name: string
  host: string
}

/** Saved connection definitions are not running sessions. */
export function connectedWorkspaceSessions(value: unknown): ConnectedWorkspaceSession[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    if (typeof record.id !== 'string' || !record.id) return []
    if (record.isConnected !== true && record.status !== 'connected') return []
    const config =
      record.config && typeof record.config === 'object'
        ? (record.config as Record<string, unknown>)
        : {}
    return [
      {
        id: record.id,
        name: String(record.name || config.name || record.host || config.host || 'SSH'),
        host: String(record.host || config.host || '')
      }
    ]
  })
}

export function pickConnectedWorkspaceTab(
  tabs: WorkspaceTab[],
  connections: ConnectedWorkspaceSession[],
  activeTabId: string,
  previousSessionTabId: string
): WorkspaceTab | undefined {
  const ids = new Set(connections.map(connection => connection.id))
  const sessions = tabs.filter(tab => {
    if (!/^\/(terminal|file-manager)\?/.test(tab.path)) return false
    const id = new URLSearchParams(tab.path.split('?')[1]).get('connectionId')
    return Boolean(id && ids.has(id))
  })
  const tab =
    sessions.find(item => item.id === activeTabId) ??
    sessions.find(item => item.id === previousSessionTabId) ??
    sessions.at(-1)
  if (tab) return tab
  const connection = connections.at(-1)
  if (!connection) return undefined
  const query = new URLSearchParams({ connectionId: connection.id, name: connection.name })
  return {
    id: `terminal-${connection.id}`,
    name: connection.name,
    icon: 'bi bi-terminal',
    path: `/terminal?${query}`
  }
}
