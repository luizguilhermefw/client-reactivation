/*
  Warnings:

  - Added the required column `companyId` to the `MessageLog` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "OutboundMessageStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OutboundMessageSource" AS ENUM ('AUTOMATION', 'CAMPAIGN', 'MANUAL');

-- DropForeignKey
ALTER TABLE "MessageLog" DROP CONSTRAINT "MessageLog_automationId_fkey";

-- DropForeignKey
ALTER TABLE "MessageLog" DROP CONSTRAINT "MessageLog_customerId_fkey";

-- DropIndex
DROP INDEX "MessageLog_customerId_automationId_idx";

-- DropIndex
DROP INDEX "MessageLog_scheduledDate_idx";

-- DropIndex
DROP INDEX "MessageLog_status_idx";

-- DropIndex
DROP INDEX "MessageLog_status_scheduledDate_idx";

-- AlterTable
ALTER TABLE "MessageLog" ADD COLUMN     "companyId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "OutboundMessage" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerId" TEXT,
    "automationId" TEXT,
    "source" "OutboundMessageSource" NOT NULL,
    "status" "OutboundMessageStatus" NOT NULL DEFAULT 'PENDING',
    "recipientPhone" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "payload" JSONB,
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processingAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "provider" TEXT,
    "providerMessageId" TEXT,
    "lastError" TEXT,
    "lastErrorCode" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutboundMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OutboundMessage_status_availableAt_priority_idx" ON "OutboundMessage"("status", "availableAt", "priority");

-- CreateIndex
CREATE INDEX "OutboundMessage_status_lockedAt_idx" ON "OutboundMessage"("status", "lockedAt");

-- CreateIndex
CREATE INDEX "OutboundMessage_companyId_status_idx" ON "OutboundMessage"("companyId", "status");

-- CreateIndex
CREATE INDEX "OutboundMessage_companyId_customerId_idx" ON "OutboundMessage"("companyId", "customerId");

-- CreateIndex
CREATE INDEX "OutboundMessage_companyId_automationId_idx" ON "OutboundMessage"("companyId", "automationId");

-- CreateIndex
CREATE UNIQUE INDEX "OutboundMessage_companyId_idempotencyKey_key" ON "OutboundMessage"("companyId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "MessageLog_companyId_idx" ON "MessageLog"("companyId");

-- CreateIndex
CREATE INDEX "MessageLog_companyId_status_idx" ON "MessageLog"("companyId", "status");

-- CreateIndex
CREATE INDEX "MessageLog_companyId_scheduledDate_idx" ON "MessageLog"("companyId", "scheduledDate");

-- CreateIndex
CREATE INDEX "MessageLog_companyId_status_scheduledDate_idx" ON "MessageLog"("companyId", "status", "scheduledDate");

-- CreateIndex
CREATE INDEX "MessageLog_companyId_customerId_automationId_idx" ON "MessageLog"("companyId", "customerId", "automationId");

-- AddForeignKey
ALTER TABLE "MessageLog" ADD CONSTRAINT "MessageLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageLog" ADD CONSTRAINT "MessageLog_customerId_companyId_fkey" FOREIGN KEY ("customerId", "companyId") REFERENCES "Customer"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageLog" ADD CONSTRAINT "MessageLog_automationId_companyId_fkey" FOREIGN KEY ("automationId", "companyId") REFERENCES "Automation"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
