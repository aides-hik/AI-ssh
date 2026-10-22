import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from './generated/client/client.js'

export * from './generated/client/client.js'

/** Server-only entrypoint: keep the PostgreSQL driver out of desktop renderer imports. */
export function createPostgresClient(
  connectionString: string,
  options: { log?: Array<'query' | 'info' | 'warn' | 'error'> } = {}
): PrismaClient {
  if (!connectionString) {
    throw new Error('DATABASE_URL is required for PostgreSQL')
  }

  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString,
      // Prisma 7 uses pg pooling; retain a bounded connection timeout.
      connectionTimeoutMillis: 5000
    }),
    ...options
  })
}
