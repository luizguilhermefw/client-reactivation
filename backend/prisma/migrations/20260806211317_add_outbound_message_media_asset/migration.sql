-- AlterTable
ALTER TABLE "OutboundMessage" ADD COLUMN     "mediaAssetId" TEXT;

-- CreateIndex
CREATE INDEX "OutboundMessage_companyId_mediaAssetId_idx" ON "OutboundMessage"("companyId", "mediaAssetId");

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_mediaAssetId_companyId_fkey" FOREIGN KEY ("mediaAssetId", "companyId") REFERENCES "MediaAsset"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
