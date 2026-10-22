import { defineConfig } from 'prisma/config'

// SQLite storage is managed by better-sqlite3; Prisma provides matching model types.
export default defineConfig({
  schema: 'prisma/schema-sqlite.prisma',
  datasource: { url: 'file:./local.db' }
})
