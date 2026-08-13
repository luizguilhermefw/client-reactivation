-- CreateEnum
CREATE TYPE "MessagingProvider" AS ENUM ('EVOLUTION');

-- CreateEnum
CREATE TYPE "MessagingChannelStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "MessagingChannel" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "provider" "MessagingProvider" NOT NULL,
    "instanceName" TEXT NOT NULL,
    "status" "MessagingChannelStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessagingChannel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MessagingChannel_provider_instanceName_key" ON "MessagingChannel"("provider", "instanceName");

-- CreateIndex
CREATE INDEX "MessagingChannel_companyId_provider_status_idx" ON "MessagingChannel"("companyId", "provider", "status");

-- AddForeignKey
ALTER TABLE "MessagingChannel" ADD CONSTRAINT "MessagingChannel_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
