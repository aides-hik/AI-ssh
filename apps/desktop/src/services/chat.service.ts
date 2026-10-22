export interface ChatSession {
  id: string
  title: string
  config?: Record<string, any>
}

export function normalizeSessionContextWindow(value: unknown): number {
  if (value === '' || value === null || value === undefined) return 50
  const count = Number(value)
  return Number.isFinite(count) ? Math.min(50, Math.max(1, Math.floor(count))) : 50
}

class ChatService {
  private getStorageKey(sessionId: string) {
    return `chat-session-config-${sessionId}`
  }

  async getSession(sessionId: string): Promise<ChatSession | null> {
    const rawConfig = localStorage.getItem(this.getStorageKey(sessionId))
    const config = rawConfig ? JSON.parse(rawConfig) : {}

    return {
      id: sessionId,
      title: config.title || '',
      config
    }
  }

  async updateSession(sessionId: string, updateData: Partial<ChatSession>): Promise<void> {
    const currentSession = await this.getSession(sessionId)
    const nextConfig = {
      ...(currentSession?.config || {}),
      ...(updateData.config || {})
    }

    if (updateData.title !== undefined) {
      nextConfig.title = updateData.title
    }

    if (nextConfig.contextWindow !== undefined) {
      nextConfig.contextWindow = normalizeSessionContextWindow(nextConfig.contextWindow)
    }

    localStorage.setItem(this.getStorageKey(sessionId), JSON.stringify(nextConfig))
  }
}

export const chatService = new ChatService()
