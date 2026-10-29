-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN', 'PREMIUM');

-- CreateEnum
CREATE TYPE "SSHAuthType" AS ENUM ('PASSWORD', 'PRIVATE_KEY', 'SSH_AGENT');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('CONNECTED', 'DISCONNECTED', 'CONNECTING', 'ERROR');

-- CreateEnum
CREATE TYPE "SubscriptionPlanType" AS ENUM ('MONTHLY', 'YEARLY', 'LIFETIME');

-- CreateEnum
CREATE TYPE "SubscriptionPlanCode" AS ENUM ('BASE_MONTHLY', 'BASE_YEARLY', 'BASE_LIFETIME', 'AI_MONTHLY', 'FULL_MONTHLY', 'FULL_YEARLY', 'FULL_LIFETIME');

-- CreateEnum
CREATE TYPE "PaymentOrderStatus" AS ENUM ('PENDING', 'PAID', 'ACTIVATED', 'EXPIRED', 'CLOSED', 'FAILED');

-- CreateEnum
CREATE TYPE "SafetyLevel" AS ENUM ('SAFE', 'CAUTION', 'DANGEROUS');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "uuid" TEXT NOT NULL,
    "email" TEXT,
    "username" TEXT,
    "password" TEXT,
    "avatar" TEXT,
    "wechatOpenId" TEXT,
    "wechatUnionId" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_settings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ssh_connections" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 22,
    "username" TEXT NOT NULL,
    "authType" "SSHAuthType" NOT NULL,
    "password" TEXT,
    "privateKey" TEXT,
    "publicKey" TEXT,
    "passphrase" TEXT,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "lastUsed" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "meta" JSONB,
    "userId" TEXT NOT NULL,

    CONSTRAINT "ssh_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "command_logs" (
    "id" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "output" TEXT,
    "exitCode" INTEGER,
    "duration" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "safetyLevel" "SafetyLevel" NOT NULL DEFAULT 'SAFE',
    "metadata" JSONB,
    "userId" TEXT NOT NULL,
    "sshConnectionId" TEXT,

    CONSTRAINT "command_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_subscriptions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "trialExpiresAt" TIMESTAMP(3),
    "basePlanType" "SubscriptionPlanType",
    "baseExpiresAt" TIMESTAMP(3),
    "aiPlanType" "SubscriptionPlanType",
    "aiExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_orders" (
    "id" TEXT NOT NULL,
    "bizId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planCode" "SubscriptionPlanCode" NOT NULL,
    "paymentProductId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "PaymentOrderStatus" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "rawPlatformPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "managed_ai_usage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "limitCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "managed_ai_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_uuid_key" ON "users"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_wechatOpenId_key" ON "users"("wechatOpenId");

-- CreateIndex
CREATE UNIQUE INDEX "users_wechatUnionId_key" ON "users"("wechatUnionId");

-- CreateIndex
CREATE UNIQUE INDEX "user_settings_userId_key" ON "user_settings"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_subscriptions_userId_key" ON "user_subscriptions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_orders_bizId_key" ON "payment_orders"("bizId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_orders_sessionId_key" ON "payment_orders"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "managed_ai_usage_userId_featureKey_periodKey_key" ON "managed_ai_usage"("userId", "featureKey", "periodKey");

-- AddForeignKey
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ssh_connections" ADD CONSTRAINT "ssh_connections_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "command_logs" ADD CONSTRAINT "command_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "command_logs" ADD CONSTRAINT "command_logs_sshConnectionId_fkey" FOREIGN KEY ("sshConnectionId") REFERENCES "ssh_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_subscriptions" ADD CONSTRAINT "user_subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "managed_ai_usage" ADD CONSTRAINT "managed_ai_usage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
