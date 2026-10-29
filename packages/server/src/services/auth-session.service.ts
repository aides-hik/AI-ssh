import type { User } from '@ai-ssh/database/postgres'
import Database from '../config/database.js'

export type SessionUser = Pick<User, 'id' | 'uuid' | 'username' | 'email' | 'role' | 'isActive'>
export type AuthTokenClaims = {
  type: 'access' | 'refresh'
  userId: string
  sessionId: string
}

const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000

export function isAuthToken(value: unknown, type: AuthTokenClaims['type']): value is AuthTokenClaims {
  if (!value || typeof value !== 'object') return false
  const claims = value as Partial<AuthTokenClaims>
  return claims.type === type && typeof claims.userId === 'string' && claims.userId.length > 0 &&
    typeof claims.sessionId === 'string' && claims.sessionId.length > 0
}

export function accessClaims(user: SessionUser, sessionId: string) {
  return { type: 'access' as const, sessionId, userId: user.id, uuid: user.uuid,
    username: user.username, email: user.email, role: user.role }
}

export class AuthSessionService {
  async create(userId: string) {
    return Database.getInstance().authSession.create({
      data: { userId, expiresAt: new Date(Date.now() + SESSION_LIFETIME_MS) },
      select: { id: true, expiresAt: true }
    })
  }

  async getActiveUser(sessionId: string, userId: string): Promise<SessionUser | null> {
    const session = await Database.getInstance().authSession.findFirst({
      where: { id: sessionId, userId, revokedAt: null, expiresAt: { gt: new Date() }, user: { isActive: true } },
      select: { user: { select: { id: true, uuid: true, username: true, email: true, role: true, isActive: true } } }
    })
    return session?.user || null
  }

  async revoke(sessionId: string, userId: string): Promise<void> {
    await Database.getInstance().authSession.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() }
    })
  }
}

export const authSessionService = new AuthSessionService()
