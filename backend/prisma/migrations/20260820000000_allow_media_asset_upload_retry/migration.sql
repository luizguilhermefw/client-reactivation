-- Add an active deduplication lock without changing the historical checksum.
ALTER TABLE "MediaAsset"
ADD COLUMN "deduplicationKey" CHAR(64);

-- Only uploads in progress and reusable, non-expired assets retain the lock.
UPDATE "MediaAsset"
SET "deduplicationKey" = "checksumSha256"
WHERE "status" = 'PENDING'
   OR (
     "status" = 'READY'
     AND ("expiresAt" IS NULL OR "expiresAt" > CURRENT_TIMESTAMP)
   );

DROP INDEX "MediaAsset_companyId_checksumSha256_key";

CREATE UNIQUE INDEX "MediaAsset_companyId_deduplicationKey_key"
ON "MediaAsset"("companyId", "deduplicationKey");

CREATE INDEX "MediaAsset_companyId_checksumSha256_idx"
ON "MediaAsset"("companyId", "checksumSha256");

ALTER TABLE "MediaAsset"
ADD CONSTRAINT "MediaAsset_terminal_status_without_deduplication_key_check"
CHECK (
  ("status" = 'PENDING' AND "deduplicationKey" IS NOT NULL)
  OR "status" = 'READY'
  OR (
    "status" IN ('FAILED', 'DELETE_PENDING', 'DELETED')
    AND "deduplicationKey" IS NULL
  )
);
