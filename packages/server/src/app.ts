import Fastify, { FastifyInstance, type FastifyError } from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import rateLimit from '@fastify/rate-limit'

import { config } from './config/app.config.js'
import { logger } from './utils/safe-logger.js'
import { authenticate } from './utils/auth.js'
import Database from './config/database.js'
import RedisManager from './config/redis.js'
import { i18nMiddleware } from './config/i18n.js'

// 路由导入
import { authRoutes } from './routes/auth.routes.js'
import { officialAiRoutes } from './routes/official-ai.routes.js'

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      transport: config.isDev
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'HH:MM:ss Z',
              ignore: 'pid,hostname'
            }
          }
        : undefined
    }
  })

  // 注册 CORS
  await app.register(cors, {
    origin: config.corsOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']
  })

  // 注册 JWT
  await app.register(jwt, {
    secret: config.jwtSecret,
    sign: {
      algorithm: 'HS256',
      expiresIn: config.jwtExpiresIn
    }
  })

  // 注册限流
  await app.register(rateLimit, {
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindow * 1000,
    redis: RedisManager.getInstance(),
    nameSpace: 'ai-ssh-rate-limit:'
  })

  // 注册 i18n 中间件
  app.addHook('onRequest', i18nMiddleware)

  // 注册请求日志中间件（为每个请求创建 request.log）
  // safe-logger 的 loggerMiddleware 会在 onRequest/onResponse/onError 中记录请求相关日志
  const { loggerMiddleware } = await import('./utils/safe-logger.js')
  // loggerMiddleware is an object exposing a `register` function.
  // Avvio expects a plugin function or promise, so wrap it in an async plugin function.
  await app.register(async function loggerPlugin(server: any, _opts: any) {
    await loggerMiddleware.register(server)
  })

  // Swagger 文档（仅在开发环境启用）
  if (config.enableDocs && config.isDev) {
    await app.register(swagger, {
      openapi: {
        openapi: '3.0.0',
        info: {
          title: 'AI SSH Assistant API',
          description: 'AI-powered SSH remote server management assistant API',
          version: '1.0.0'
        },
        servers: [
          {
            url: `http://${config.host}:${config.port}`,
            description: 'Development server'
          }
        ],
        components: {
          securitySchemes: {
            bearerAuth: {
              type: 'http',
              scheme: 'bearer',
              bearerFormat: 'JWT'
            }
          }
        }
      }
    })

    await app.register(swaggerUi, {
      routePrefix: '/docs',
      uiConfig: {
        docExpansion: 'list',
        deepLinking: false,
        defaultModelsExpandDepth: 1,
        defaultModelExpandDepth: 1
      },
      staticCSP: true,
      transformStaticCSP: header => header
    })
  }

  // 健康检查
  app.get(
    '/health',
    {
      schema: {
        description: 'Health check endpoint',
        tags: ['基础设施'],
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              timestamp: { type: 'string' },
              uptime: { type: 'number' },
              version: { type: 'string' },
              services: {
                type: 'object',
                properties: {
                  database: { type: 'string' },
                  redis: { type: 'string' }
                }
              }
            }
          },
          503: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              timestamp: { type: 'string' },
              error: { type: 'string' }
            }
          }
        }
      }
    },
    async (_request, reply) => {
      try {
        // 检查数据库连接
        await Database.getInstance().$queryRaw`SELECT 1`
        const dbStatus = 'healthy'

        // 检查 Redis 连接
        const redisStatus = (await RedisManager.healthCheck()) ? 'healthy' : 'unhealthy'

        return {
          status: 'healthy',
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
          version: process.env.APP_VERSION || process.env.npm_package_version || '1.0.0',
          services: {
            database: dbStatus,
            redis: redisStatus
          }
        }
      } catch (error) {
        logger.error('Health check failed:', String(error))
        reply.status(503)
        return {
          status: 'unhealthy',
          timestamp: new Date().toISOString(),
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      }
    }
  )

  // 注册认证装饰器
  app.decorate('authenticate', authenticate)

  // 404 处理
  app.setNotFoundHandler(
    typeof app.rateLimit === 'function'
      ? {
          preHandler: app.rateLimit()
        }
      : {},
    async (request, reply) => {
      reply.status(404).send({
        success: false,
        message: 'Route not found',
        path: request.url,
        method: request.method,
        timestamp: new Date().toISOString()
      })
    }
  )

  // 全局错误处理
  app.setErrorHandler<FastifyError>(async (error, request, reply) => {
    const statusCode = error.statusCode || 500

    logger.error(
      {
        error: error.message,
        stack: error.stack,
        url: request.url,
        method: request.method,
        statusCode
      },
      'Request error:'
    )

    // 验证错误
    if (error.validation) {
      return reply.status(400).send({
        success: false,
        message: 'Validation error',
        errors: error.validation.map(err => ({
          field: err.instancePath?.replace('/', '') || err.schemaPath,
          message: err.message,
          value: (err as any).data
        }))
      })
    }

    // JWT 错误
    if (
      error.code === 'FST_JWT_BAD_REQUEST' ||
      error.code === 'FST_JWT_NO_AUTHORIZATION_IN_HEADER'
    ) {
      return reply.status(401).send({
        success: false,
        message: 'Authentication required',
        code: error.code
      })
    }

    // 限流错误
    if (error.code === 'FST_TOO_MANY_REQUESTS') {
      return reply.status(429).send({
        success: false,
        message: 'Too many requests',
        retryAfter: (error as any).retryAfter
      })
    }

    // 开发环境返回详细错误信息
    if (config.isDev) {
      return reply.status(statusCode).send({
        success: false,
        message: error.message,
        stack: error.stack,
        code: error.code
      })
    }

    // 生产环境返回通用错误信息
    return reply.status(statusCode).send({
      success: false,
      message: statusCode === 500 ? 'Internal server error' : error.message,
      code: error.code
    })
  })

  // Fastify 5 captures the error handler when a plugin is registered.
  // Register routes after the shared handler so validation responses stay consistent.
  await app.register(authRoutes, { prefix: '/api/v1/auth' })
  await app.register(officialAiRoutes, { prefix: '/api/v1/ai/official' })

  // 优雅关闭钩子
  app.addHook('onClose', async () => {
    // 应用关闭
  })

  return app
}
