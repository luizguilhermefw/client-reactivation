-- CreateEnum
CREATE TYPE "CampaignAudienceType" AS ENUM ('ALL_ELIGIBLE', 'CUSTOMER_IDS', 'SEGMENTED');

-- AlterTable
ALTER TABLE "Automation" ADD COLUMN     "campaignAudienceType" "CampaignAudienceType" NOT NULL DEFAULT 'ALL_ELIGIBLE',
ADD COLUMN     "segmentCity" TEXT,
ADD COLUMN     "segmentGender" "CustomerGender",
ADD COLUMN     "segmentLastPurchaseAfter" TIMESTAMP(3),
ADD COLUMN     "segmentLastPurchaseBefore" TIMESTAMP(3),
ADD COLUMN     "segmentMaxAge" INTEGER,
ADD COLUMN     "segmentMinAge" INTEGER,
ADD COLUMN     "segmentState" TEXT;
