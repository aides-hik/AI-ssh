# PostgreSQL 迁移与已有数据库接入

服务端现在只运行 `packages/database/prisma/migrations` 中的版本迁移。启动不再自动退回 `db push`，不自动重置、删除数据或认领已有数据库。

## 全新空数据库

执行根目录 `pnpm db:migrate:deploy`。它先应用 `0_baseline`（本次修改前的 PostgreSQL schema），再应用 `20261029000000_auth_sessions`（新增登录会话表）。`AUTO_MIGRATE=true` 启动时执行相同迁移。

## 原来通过 db push 或手工 SQL 建表的数据库

必须先由部署者完成一次接入。不要直接运行 baseline SQL，也不要跳过核对直接标记已应用。

1. 备份数据库并验证恢复流程，在数据库副本中先演练。暂停旧服务写入，避免核对期间结构变化。
2. 检查现有 `_prisma_migrations`。如果已经有其他迁移历史，先核对它与当前仓库历史的关系，不要覆盖或删除历史。
3. 将实际库结构与 `packages/database/prisma/migrations/0_baseline/migration.sql` 逐项比较：表、列、类型、默认值、可空性、唯一约束、索引、外键与枚举。baseline 包含账号、SSH、命令日志、订阅/订单及 managed_ai_usage；不包含 auth_sessions。可在一次性空 PostgreSQL 中应用 baseline，再用 Prisma migrate diff 与数据库副本比较。此过程需要部署者自己的连接配置。
4. 如果存在缺失表或列，先审阅并执行必要的增量补齐；如果存在额外业务表/列，不要为了匹配 baseline 删除它们。确认差异原因、数据兼容性和所有 baseline 结构均已存在后，再标记 baseline 已应用。
5. 在 `packages/database` 目录执行：

   ```text
   pnpm exec prisma migrate resolve --applied 0_baseline --schema prisma/schema-postgresql.prisma
   pnpm db:migrate:deploy
   ```

   `resolve` 仅写迁移记录，不创建表；只有核对通过才能使用。随后 deploy 只新增 auth_sessions 及其索引/外键，不修改既有业务数据。如果该表已经由其他操作创建，先核对其结构再决定是否标记该增量已应用；不要盲目重复执行。

6. 检查迁移状态、启动服务、确认 `/health` HTTP 200 且 database/redis 均为 healthy，执行登录→刷新→登出→旧令牌被拒绝的验收。

`packages/database/migrations/` 中旧的 `add-sync-fields.sql` 与 `20260412_add_managed_ai_usage.sql` 保留为历史参考，不属于 Prisma 执行目录。managed_ai_usage 已包含在 baseline；旧同步 SQL 涉及当前 PostgreSQL schema 不存在的聊天/文件表，禁止整份补跑。已有的额外同步结构由部署者核对并保留。

## 登录会话兼容性

本次发布后，旧的无 type/sessionId JWT 不再接受，用户需要重新登录。新 access 与 refresh JWT 只能用于各自接口；每次鉴权和刷新都检查持久会话、到期时间和账号激活状态，并采用数据库中的最新用户信息。登出撤销当前设备会话，旧 access 与 refresh JWT 随即失效，其他设备会话不受影响。

会话最长 30 天，刷新不会延长会话寿命；不采用每次轮换 refresh token，客户端可以继续使用登录时的 refresh token 到登出或到期。只保存会话标识与有效期，不把令牌明文存入数据库。数据库不可用时拒绝鉴权，不降级成只验签。

不要在日志、提交或本文档中写入连接 URL、密码、JWT 或密钥。桌面端默认本地功能不需要部署该服务。
