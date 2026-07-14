/*
  Warnings:

  - You are about to drop the column `isAdmin` on the `User` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('PLATFORM_ADMIN', 'SUPPORT', 'OWNER', 'MANAGER', 'OPERATOR');

-- DropIndex
DROP INDEX "MessageLog_sentAt_idx";

-- AlterTable
ALTER TABLE "MessageLog" ADD COLUMN     "errorMessage" TEXT;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "isAdmin",
ADD COLUMN     "role" "UserRole" NOT NULL DEFAULT 'OWNER';

-- CreateIndex
CREATE INDEX "MessageLog_status_idx" ON "MessageLog"("status");

-- CreateIndex
CREATE INDEX "MessageLog_scheduledDate_idx" ON "MessageLog"("scheduledDate");

-- CreateIndex
CREATE INDEX "MessageLog_status_scheduledDate_idx" ON "MessageLog"("status", "scheduledDate");
