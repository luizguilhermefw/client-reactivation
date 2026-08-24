-- CreateEnum
CREATE TYPE "MessagingChannelConnectionStatus" AS ENUM (
    'UNKNOWN',
    'PROVISIONING',
    'WAITING_QR',
    'CONNECTED',
    'DISCONNECTED',
    'ERROR'
);

-- AlterTable
ALTER TABLE "MessagingChannel"
ADD COLUMN "connectionStatus" "MessagingChannelConnectionStatus",
ADD COLUMN "provisioningKey" TEXT,
ADD COLUMN "lastConnectionCheckAt" TIMESTAMP(3),
ADD COLUMN "connectedPhone" TEXT;

-- Routing status does not prove the technical state of a WhatsApp connection.
-- Every pre-existing channel starts UNKNOWN until Evolution is consulted.
UPDATE "MessagingChannel"
SET "connectionStatus" = 'UNKNOWN'::"MessagingChannelConnectionStatus";

ALTER TABLE "MessagingChannel"
ALTER COLUMN "connectionStatus" SET NOT NULL,
ALTER COLUMN "connectionStatus" SET DEFAULT 'PROVISIONING';

-- CreateIndex
CREATE UNIQUE INDEX "MessagingChannel_companyId_provisioningKey_key"
ON "MessagingChannel"("companyId", "provisioningKey");
