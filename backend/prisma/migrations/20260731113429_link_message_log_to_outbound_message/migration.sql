-- DropForeignKey
ALTER TABLE "MessageLog" DROP CONSTRAINT "MessageLog_automationId_companyId_fkey";

-- DropForeignKey
ALTER TABLE "MessageLog" DROP CONSTRAINT "MessageLog_customerId_companyId_fkey";

-- AlterTable
ALTER TABLE "MessageLog" ADD COLUMN     "outboundMessageId" TEXT,
ALTER COLUMN "customerId" DROP NOT NULL,
ALTER COLUMN "automationId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "MessageLog_outboundMessageId_key" ON "MessageLog"("outboundMessageId");

-- AddForeignKey
ALTER TABLE "MessageLog" ADD CONSTRAINT "MessageLog_customerId_companyId_fkey" FOREIGN KEY ("customerId", "companyId") REFERENCES "Customer"("id", "companyId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageLog" ADD CONSTRAINT "MessageLog_automationId_companyId_fkey" FOREIGN KEY ("automationId", "companyId") REFERENCES "Automation"("id", "companyId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageLog" ADD CONSTRAINT "MessageLog_outboundMessageId_fkey" FOREIGN KEY ("outboundMessageId") REFERENCES "OutboundMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
