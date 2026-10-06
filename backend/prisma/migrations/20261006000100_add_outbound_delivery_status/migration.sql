CREATE TYPE "OutboundDeliveryStatus" AS ENUM ('SENT', 'DELIVERED', 'READ', 'FAILED');

ALTER TABLE "OutboundMessage"
ADD COLUMN "deliveryStatus" "OutboundDeliveryStatus",
ADD COLUMN "deliveredAt" TIMESTAMP(3),
ADD COLUMN "readAt" TIMESTAMP(3);
