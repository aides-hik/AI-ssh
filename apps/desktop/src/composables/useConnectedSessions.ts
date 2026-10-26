import { onMounted, onUnmounted, ref } from 'vue'
import {
  connectedWorkspaceSessions,
  type ConnectedWorkspaceSession
} from '@/utils/workspace-sessions'

/** Keep the dock in sync with live SSH state, including remote disconnects. */
export function useConnectedSessions() {
  const connections = ref<ConnectedWorkspaceSession[]>([])
  let unsubscribe: (() => void) | undefined
  let disposed = false

  onMounted(async () => {
    const api = window.electronAPI
    if (!api?.ssh?.getConnections) return
    let initializing = true
    const pendingStatuses = new Map<string, ConnectedWorkspaceSession | null>()
    unsubscribe = api.onConnectionStatusChange?.((value: unknown) => {
      if (!value || typeof value !== 'object') return
      const status = value as Record<string, unknown>
      if (typeof status.id !== 'string') return
      const session = connectedWorkspaceSessions([status])[0] ?? null
      const existing = connections.value.find(connection => connection.id === status.id)
      if (session && existing) {
        const config =
          status.config && typeof status.config === 'object'
            ? (status.config as Record<string, unknown>)
            : undefined
        if (!status.name && !config?.name) session.name = existing.name
        if (!session.host) session.host = existing.host
      }
      // A disconnect can arrive while the initial IPC snapshot is still pending.
      if (initializing) pendingStatuses.set(status.id, session)
      connections.value = connections.value.filter(connection => connection.id !== status.id)
      if (session) connections.value.push(session)
    })
    try {
      const initial = await api.ssh.getConnections()
      if (disposed) return
      const live = new Map(connectedWorkspaceSessions(initial).map(item => [item.id, item]))
      for (const [id, session] of pendingStatuses) {
        if (session) live.set(id, session)
        else live.delete(id)
      }
      connections.value = [...live.values()]
    } catch {
      // Status events continue to work if the initial runtime snapshot fails.
    } finally {
      initializing = false
      pendingStatuses.clear()
    }
  })

  onUnmounted(() => {
    disposed = true
    unsubscribe?.()
  })

  return { connections }
}
