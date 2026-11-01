export interface SSHDragNode {
  id: string
  type: 'folder' | 'connection'
}

/** OS drag data is visible outside the app; include only an internal reference. */
export function serializeSSHDragNode(node: SSHDragNode): string {
  return JSON.stringify({ id: node.id, type: node.type })
}

export function parseSSHDragNode(value: string): SSHDragNode | null {
  if (!value || value.length > 1024) return null
  try {
    const node: unknown = JSON.parse(value)
    if (!node || typeof node !== 'object' || Array.isArray(node)) return null
    const candidate = node as Record<string, unknown>
    if (typeof candidate.id !== 'string' || !candidate.id.trim() || candidate.id.length > 256) return null
    if (candidate.type !== 'folder' && candidate.type !== 'connection') return null
    return { id: candidate.id, type: candidate.type }
  } catch {
    return null
  }
}
