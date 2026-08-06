-- CreateEnum
CREATE TYPE "OutboundMessageType" AS ENUM ('TEXT', 'IMAGE');

-- AlterTable
ALTER TABLE "OutboundMessage"
ADD COLUMN "type" "OutboundMessageType" NOT NULL DEFAULT 'TEXT';
