-- CreateEnum
CREATE TYPE "UnknownContactPolicy" AS ENUM ('BLOCK_UNKNOWN', 'ALLOW_UNKNOWN_WITH_DECLARATION');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN "unknownContactPolicy" "UnknownContactPolicy" NOT NULL DEFAULT 'BLOCK_UNKNOWN';

-- CreateTable
CREATE TABLE "MessagingPolicyAcceptance" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "acceptedByUserId" TEXT NOT NULL,
    "policy" "UnknownContactPolicy" NOT NULL,
    "declarationVersion" TEXT NOT NULL,
    "declarationTextSnapshot" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessagingPolicyAcceptance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_id_companyId_key" ON "User"("id", "companyId");

-- CreateIndex
CREATE INDEX "MessagingPolicyAcceptance_companyId_acceptedAt_idx" ON "MessagingPolicyAcceptance"("companyId", "acceptedAt");

-- CreateIndex
CREATE INDEX "MessagingPolicyAcceptance_acceptedAt_idx" ON "MessagingPolicyAcceptance"("acceptedAt");

-- AddForeignKey
ALTER TABLE "MessagingPolicyAcceptance" ADD CONSTRAINT "MessagingPolicyAcceptance_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessagingPolicyAcceptance" ADD CONSTRAINT "MessagingPolicyAcceptance_acceptedByUserId_companyId_fkey" FOREIGN KEY ("acceptedByUserId", "companyId") REFERENCES "User"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
