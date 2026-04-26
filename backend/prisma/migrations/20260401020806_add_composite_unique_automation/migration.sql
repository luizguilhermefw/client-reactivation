/*
  Warnings:

  - A unique constraint covering the columns `[companyId,name]` on the table `Automation` will be added. If there are existing duplicate values, this will fail.
  - Made the column `cooldownHours` on table `Automation` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "AutomationType" AS ENUM ('REACTIVATION', 'BIRTHDAY', 'CAMPAIGN', 'MAINTENANCE');

-- AlterTable
ALTER TABLE "Automation" ADD COLUMN     "type" "AutomationType" NOT NULL DEFAULT 'REACTIVATION',
ALTER COLUMN "cooldownHours" SET NOT NULL,
ALTER COLUMN "cooldownHours" SET DEFAULT 24;

-- CreateIndex
CREATE UNIQUE INDEX "Automation_companyId_name_key" ON "Automation"("companyId", "name");

-- CreateIndex
CREATE INDEX "MessageLog_sentAt_idx" ON "MessageLog"("sentAt");
