-- CreateTable
CREATE TABLE "CampaignInterestFilter" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "interestOptionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignInterestFilter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CampaignInterestFilter_companyId_automationId_interestOptionId_key" ON "CampaignInterestFilter"("companyId", "automationId", "interestOptionId");

-- CreateIndex
CREATE INDEX "CampaignInterestFilter_companyId_automationId_idx" ON "CampaignInterestFilter"("companyId", "automationId");

-- CreateIndex
CREATE INDEX "CampaignInterestFilter_companyId_interestOptionId_idx" ON "CampaignInterestFilter"("companyId", "interestOptionId");

-- AddForeignKey
ALTER TABLE "CampaignInterestFilter" ADD CONSTRAINT "CampaignInterestFilter_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignInterestFilter" ADD CONSTRAINT "CampaignInterestFilter_automationId_companyId_fkey" FOREIGN KEY ("automationId", "companyId") REFERENCES "Automation"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignInterestFilter" ADD CONSTRAINT "CampaignInterestFilter_interestOptionId_companyId_fkey" FOREIGN KEY ("interestOptionId", "companyId") REFERENCES "CustomerInterestOption"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
