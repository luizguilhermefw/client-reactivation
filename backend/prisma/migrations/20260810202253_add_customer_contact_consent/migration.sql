-- CreateEnum
CREATE TYPE "CustomerContactConsentStatus" AS ENUM ('UNKNOWN', 'GRANTED', 'OPTED_OUT');

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "consentGrantedAt" TIMESTAMP(3),
ADD COLUMN     "contactConsentStatus" "CustomerContactConsentStatus" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "optedOutAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Customer_companyId_isActiveForAutomation_contactConsentStat_idx" ON "Customer"("companyId", "isActiveForAutomation", "contactConsentStatus");
