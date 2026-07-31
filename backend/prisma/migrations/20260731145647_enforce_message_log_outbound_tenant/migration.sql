-- DropForeignKey
ALTER TABLE "MessageLog" DROP CONSTRAINT "MessageLog_outboundMessageId_fkey";

-- CreateIndex
CREATE UNIQUE INDEX "MessageLog_outboundMessageId_companyId_key" ON "MessageLog"("outboundMessageId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "OutboundMessage_id_companyId_key" ON "OutboundMessage"("id", "companyId");

-- AddForeignKey
ALTER TABLE "MessageLog" ADD CONSTRAINT "MessageLog_outboundMessageId_companyId_fkey" FOREIGN KEY ("outboundMessageId", "companyId") REFERENCES "OutboundMessage"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
