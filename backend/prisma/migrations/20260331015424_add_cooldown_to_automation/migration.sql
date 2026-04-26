-- DropIndex
DROP INDEX "MessageLog_automationId_idx";

-- DropIndex
DROP INDEX "MessageLog_customerId_idx";

-- AlterTable
ALTER TABLE "Automation" ADD COLUMN     "cooldownHours" INTEGER;

-- AlterTable
ALTER TABLE "MessageLog" ADD COLUMN     "sentAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "MessageLog_customerId_automationId_idx" ON "MessageLog"("customerId", "automationId");
