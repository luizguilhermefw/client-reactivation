/*
  Warnings:

  - A unique constraint covering the columns `[companyId,systemKey]` on the table `Automation` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `updatedAt` to the `Automation` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Automation" ADD COLUMN     "isSystem" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "systemKey" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ALTER COLUMN "isActive" SET DEFAULT false;

-- CreateIndex
CREATE INDEX "Automation_companyId_isSystem_idx" ON "Automation"("companyId", "isSystem");

-- CreateIndex
CREATE UNIQUE INDEX "Automation_companyId_systemKey_key" ON "Automation"("companyId", "systemKey");
