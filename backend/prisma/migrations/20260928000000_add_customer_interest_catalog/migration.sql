-- CreateEnum
CREATE TYPE "CustomerInterestType" AS ENUM ('CATEGORY', 'BRAND');

-- CreateTable
CREATE TABLE "CustomerInterestOption" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" "CustomerInterestType" NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerInterestOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerInterest" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "interestOptionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerInterest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerInterestOption_id_companyId_key" ON "CustomerInterestOption"("id", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerInterestOption_companyId_type_normalizedName_key" ON "CustomerInterestOption"("companyId", "type", "normalizedName");

-- CreateIndex
CREATE INDEX "CustomerInterestOption_companyId_type_active_idx" ON "CustomerInterestOption"("companyId", "type", "active");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerInterest_id_companyId_key" ON "CustomerInterest"("id", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerInterest_companyId_customerId_interestOptionId_key" ON "CustomerInterest"("companyId", "customerId", "interestOptionId");

-- CreateIndex
CREATE INDEX "CustomerInterest_companyId_interestOptionId_idx" ON "CustomerInterest"("companyId", "interestOptionId");

-- AddForeignKey
ALTER TABLE "CustomerInterestOption" ADD CONSTRAINT "CustomerInterestOption_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerInterest" ADD CONSTRAINT "CustomerInterest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerInterest" ADD CONSTRAINT "CustomerInterest_customerId_companyId_fkey" FOREIGN KEY ("customerId", "companyId") REFERENCES "Customer"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerInterest" ADD CONSTRAINT "CustomerInterest_interestOptionId_companyId_fkey" FOREIGN KEY ("interestOptionId", "companyId") REFERENCES "CustomerInterestOption"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
