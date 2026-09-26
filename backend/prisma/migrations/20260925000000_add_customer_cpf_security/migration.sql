-- AlterTable
ALTER TABLE "Customer"
ADD COLUMN "cpfEncrypted" TEXT,
ADD COLUMN "cpfEncryptionIv" TEXT,
ADD COLUMN "cpfEncryptionAuthTag" TEXT,
ADD COLUMN "cpfEncryptionKeyVersion" TEXT,
ADD COLUMN "cpfLookupHash" CHAR(64),
ADD COLUMN "cpfLookupKeyVersion" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Customer_companyId_cpfLookupHash_key"
ON "Customer"("companyId", "cpfLookupHash");
