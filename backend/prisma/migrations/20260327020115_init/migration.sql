/*
  Warnings:

  - A unique constraint covering the columns `[cnpj]` on the table `Company` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `cnpj` to the `Company` table without a default value. This is not possible if the table is not empty.
  - Added the required column `displayName` to the `Company` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `status` on the `MessageLog` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "LogStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "cnpj" TEXT NOT NULL,
ADD COLUMN     "displayName" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "MessageLog" DROP COLUMN "status",
ADD COLUMN     "status" "LogStatus" NOT NULL;

-- CreateIndex
CREATE INDEX "Automation_companyId_idx" ON "Automation"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Company_cnpj_key" ON "Company"("cnpj");

-- CreateIndex
CREATE INDEX "Company_name_idx" ON "Company"("name");

-- CreateIndex
CREATE INDEX "Customer_companyId_idx" ON "Customer"("companyId");

-- CreateIndex
CREATE INDEX "Customer_phone_idx" ON "Customer"("phone");

-- CreateIndex
CREATE INDEX "MessageLog_customerId_idx" ON "MessageLog"("customerId");

-- CreateIndex
CREATE INDEX "MessageLog_automationId_idx" ON "MessageLog"("automationId");
