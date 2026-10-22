import { config as loadEnv } from 'dotenv'
import { resolve } from 'node:path'
import { defineConfig } from 'prisma/config'

// CLI commands share the server's configuration; generation needs no database connection.
loadEnv({ path: resolve(__dirname, '../server/.env'), quiet: true })

export default defineConfig({
  schema: 'prisma/schema-postgresql.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts'
  },
  datasource: { url: process.env.DATABASE_URL }
})
