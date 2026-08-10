-- CAMPAIGN automations receive their content at dispatch time and do not use a
-- recurrence interval. Existing non-null values are preserved.
ALTER TABLE "Automation"
ALTER COLUMN "daysAfter" DROP NOT NULL,
ALTER COLUMN "message" DROP NOT NULL;

ALTER TABLE "Automation"
ADD CONSTRAINT "Automation_recurring_fields_required_check"
CHECK (
  "type" = 'CAMPAIGN'
  OR (
    "daysAfter" IS NOT NULL
    AND "message" IS NOT NULL
  )
);
