-- CreateEnum
CREATE TYPE "CustomerGender" AS ENUM ('FEMALE', 'MALE', 'OTHER', 'UNSPECIFIED');

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "city" TEXT,
ADD COLUMN     "gender" "CustomerGender" NOT NULL DEFAULT 'UNSPECIFIED',
ADD COLUMN     "state" TEXT;

-- CreateIndex
CREATE INDEX "Customer_companyId_gender_idx" ON "Customer"("companyId", "gender");

-- CreateIndex
CREATE INDEX "Customer_companyId_state_idx" ON "Customer"("companyId", "state");

-- CreateIndex
CREATE INDEX "Customer_companyId_city_idx" ON "Customer"("companyId", "city");

-- CreateIndex
CREATE INDEX "Customer_companyId_lastPurchaseDate_idx" ON "Customer"("companyId", "lastPurchaseDate");
