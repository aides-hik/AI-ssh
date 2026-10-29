import { FastifyRequest, FastifyReply } from 'fastify'
import { logger } from './safe-logger.js'
import { accessClaims, authSessionService, isAuthToken } from '../services/auth-session.service.js'

// 扩展 Fastify 类型
declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>
  }
}

// JWT 认证中间件
export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify()
    if (!isAuthToken(request.user, 'access')) throw new Error('Invalid access token purpose')
  } catch {
    logger.warn('Access token verification failed')
    return reply.status(401).send({
      success: false,
      message: '认证失败，请重新登录',
      code: 'AUTHENTICATION_FAILED'
    })
  }
  try {
    const claims = request.user as { sessionId: string; userId: string }
    const user = await authSessionService.getActiveUser(claims.sessionId, claims.userId)
    if (!user) {
      return reply.status(401).send({ success: false, message: '登录已失效，请重新登录', code: 'AUTHENTICATION_FAILED' })
    }
    // Use current account claims, so disabled accounts and role changes take effect immediately.
    request.user = accessClaims(user, claims.sessionId)
  } catch {
    return reply.status(503).send({ success: false, message: '暂时无法验证登录状态', code: 'AUTHENTICATION_UNAVAILABLE' })
  }
}

// 角色检查中间件工厂
export function requireRole(roles: string | string[]) {
  const allowedRoles = Array.isArray(roles) ? roles : [roles]

  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user

    if (!user) {
      return reply.status(401).send({
        success: false,
        message: '认证失败',
        code: 'NOT_AUTHENTICATED'
      })
    }

    if (!allowedRoles.includes((user as any).role)) {
      return reply.status(403).send({
        success: false,
        message: '权限不足',
        code: 'INSUFFICIENT_PERMISSIONS'
      })
    }
  }
}

// 可选认证中间件（不强制要求登录）
export async function optionalAuth(request: FastifyRequest, _reply: FastifyReply) {
  try {
    await request.jwtVerify()
    if (!isAuthToken(request.user, 'access')) throw new Error('Invalid access token purpose')
    const user = await authSessionService.getActiveUser(request.user.sessionId, request.user.userId)
    if (!user) throw new Error('Inactive authentication session')
    request.user = accessClaims(user, request.user.sessionId)
  } catch {
    request.user = undefined
  }
}

