-- CreateEnum
CREATE TYPE "MessagingPolicyAction" AS ENUM ('DISABLED_OPT_OUT_INSTRUCTIONS', 'ENABLED_OPT_OUT_INSTRUCTIONS');

-- AlterTable
ALTER TABLE "Company"
ADD COLUMN "includeOptOutInstructions" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "MessagingPolicyAcceptance"
ALTER COLUMN "policy" DROP NOT NULL,
ADD COLUMN "action" "MessagingPolicyAction",
ADD COLUMN "responsibilityAcknowledged" BOOLEAN NOT NULL DEFAULT false;

-- Preserve one and only one audit event discriminator per record.
ALTER TABLE "MessagingPolicyAcceptance"
ADD CONSTRAINT "MessagingPolicyAcceptance_policy_or_action_check"
CHECK (
  ("policy" IS NOT NULL AND "action" IS NULL)
  OR
  ("policy" IS NULL AND "action" IS NOT NULL)
);

-- CreateIndex
CREATE INDEX "MessagingPolicyAcceptance_companyId_action_acceptedAt_idx"
ON "MessagingPolicyAcceptance"("companyId", "action", "acceptedAt");
