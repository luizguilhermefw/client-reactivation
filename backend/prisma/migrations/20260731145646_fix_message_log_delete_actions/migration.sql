-- DropForeignKey
ALTER TABLE "MessageLog" DROP CONSTRAINT "MessageLog_automationId_companyId_fkey";

-- DropForeignKey
ALTER TABLE "MessageLog" DROP CONSTRAINT "MessageLog_customerId_companyId_fkey";

-- AddForeignKey
ALTER TABLE "MessageLog" ADD CONSTRAINT "MessageLog_customerId_companyId_fkey" FOREIGN KEY ("customerId", "companyId") REFERENCES "Customer"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageLog" ADD CONSTRAINT "MessageLog_automationId_companyId_fkey" FOREIGN KEY ("automationId", "companyId") REFERENCES "Automation"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
