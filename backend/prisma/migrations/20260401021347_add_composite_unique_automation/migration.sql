/*
  Warnings:

  - A unique constraint covering the columns `[id,companyId]` on the table `Automation` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Automation_id_companyId_key" ON "Automation"("id", "companyId");
