import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('CampaignInterestFilter migration', () => {
  const migrationSql = readFileSync(
    join(
      process.cwd(),
      'prisma',
      'migrations',
      '20260930000000_add_campaign_interest_segmentation',
      'migration.sql',
    ),
    'utf8',
  );

  it('removes filters with Automation and restricts CustomerInterestOption deletion', () => {
    expect(migrationSql).toContain(
      'CONSTRAINT "CampaignInterestFilter_automationId_companyId_fkey" FOREIGN KEY ("automationId", "companyId") REFERENCES "Automation"("id", "companyId") ON DELETE CASCADE',
    );
    expect(migrationSql).toContain(
      'CONSTRAINT "CampaignInterestFilter_interestOptionId_companyId_fkey" FOREIGN KEY ("interestOptionId", "companyId") REFERENCES "CustomerInterestOption"("id", "companyId") ON DELETE RESTRICT',
    );
  });
});
