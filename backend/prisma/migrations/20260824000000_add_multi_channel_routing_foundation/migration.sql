-- AlterTable
ALTER TABLE "Automation"
ADD COLUMN "messagingChannelId" TEXT;

-- AlterTable
ALTER TABLE "OutboundMessage"
ADD COLUMN "messagingChannelId" TEXT;

-- Existing rows are pinned only when their tenant has exactly one active
-- EVOLUTION routing channel. Ambiguous and unavailable routing remains NULL.
WITH "SingleActiveEvolutionChannel" AS (
    SELECT "companyId", MIN("id") AS "messagingChannelId"
    FROM "MessagingChannel"
    WHERE "provider" = 'EVOLUTION'
      AND "status" = 'ACTIVE'
    GROUP BY "companyId"
    HAVING COUNT(*) = 1
)
UPDATE "Automation" AS "automation"
SET "messagingChannelId" = "singleChannel"."messagingChannelId"
FROM "SingleActiveEvolutionChannel" AS "singleChannel"
WHERE "automation"."companyId" = "singleChannel"."companyId"
  AND "automation"."messagingChannelId" IS NULL;

WITH "SingleActiveEvolutionChannel" AS (
    SELECT "companyId", MIN("id") AS "messagingChannelId"
    FROM "MessagingChannel"
    WHERE "provider" = 'EVOLUTION'
      AND "status" = 'ACTIVE'
    GROUP BY "companyId"
    HAVING COUNT(*) = 1
)
UPDATE "OutboundMessage" AS "outboundMessage"
SET "messagingChannelId" = "singleChannel"."messagingChannelId"
FROM "SingleActiveEvolutionChannel" AS "singleChannel"
WHERE "outboundMessage"."companyId" = "singleChannel"."companyId"
  AND "outboundMessage"."messagingChannelId" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "MessagingChannel_id_companyId_key"
ON "MessagingChannel"("id", "companyId");

-- CreateIndex
CREATE INDEX "Automation_companyId_messagingChannelId_idx"
ON "Automation"("companyId", "messagingChannelId");

-- CreateIndex
CREATE INDEX "OutboundMessage_companyId_messagingChannelId_idx"
ON "OutboundMessage"("companyId", "messagingChannelId");

-- AddForeignKey
ALTER TABLE "Automation"
ADD CONSTRAINT "Automation_messagingChannelId_companyId_fkey"
FOREIGN KEY ("messagingChannelId", "companyId")
REFERENCES "MessagingChannel"("id", "companyId")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundMessage"
ADD CONSTRAINT "OutboundMessage_messagingChannelId_companyId_fkey"
FOREIGN KEY ("messagingChannelId", "companyId")
REFERENCES "MessagingChannel"("id", "companyId")
ON DELETE RESTRICT ON UPDATE CASCADE;
