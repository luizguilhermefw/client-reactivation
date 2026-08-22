-- CreateEnum
CREATE TYPE "EntitlementFeature" AS ENUM ('WHATSAPP_CHANNELS');

-- CreateEnum
CREATE TYPE "EntitlementSource" AS ENUM ('MANUAL', 'BILLING');

-- CreateTable
CREATE TABLE "CompanyEntitlement" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "feature" "EntitlementFeature" NOT NULL,
    "limit" INTEGER NOT NULL,
    "source" "EntitlementSource" NOT NULL,
    "externalReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyEntitlement_limit_non_negative_check" CHECK ("limit" >= 0),
    CONSTRAINT "CompanyEntitlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompanyEntitlement_companyId_feature_key"
ON "CompanyEntitlement"("companyId", "feature");

-- AddForeignKey
ALTER TABLE "CompanyEntitlement"
ADD CONSTRAINT "CompanyEntitlement_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "Company"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
