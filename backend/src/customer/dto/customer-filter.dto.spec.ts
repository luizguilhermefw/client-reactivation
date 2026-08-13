import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';
import { CustomerFilterDto } from './customer-filter.dto';

describe('CustomerFilterDto', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  const metadata: ArgumentMetadata = {
    type: 'query',
    metatype: CustomerFilterDto,
    data: '',
  };

  const transform = (value: Record<string, unknown>) =>
    pipe.transform(value, metadata) as Promise<CustomerFilterDto>;

  it('uses pagination defaults and normalizes lowercase state', async () => {
    await expect(transform({ state: ' pr ' })).resolves.toEqual(
      expect.objectContaining({ state: 'PR', page: 1, pageSize: 20 }),
    );
  });

  it.each([
    [{ gender: 'INVALID' }, 'invalid gender'],
    [{ state: 'PARANA' }, 'invalid state'],
    [{ state: 'ZZ' }, 'unknown state code'],
    [{ minAge: '-1' }, 'negative minAge'],
    [{ maxAge: '121' }, 'maxAge over 120'],
    [{ minAge: '36', maxAge: '35' }, 'inverted age range'],
    [{ lastPurchaseBefore: 'not-a-date' }, 'invalid before date'],
    [{ lastPurchaseAfter: '2026-99-99' }, 'invalid after date'],
    [{ page: '0' }, 'invalid page'],
    [{ pageSize: '101' }, 'pageSize over 100'],
    [{ isActiveForAutomation: 'yes' }, 'invalid boolean'],
    [{ companyId: 'attacker-company' }, 'extra companyId'],
  ])('rejects %s (%s)', async (query) => {
    await expect(transform(query)).rejects.toBeDefined();
  });

  it('accepts and transforms valid filters', async () => {
    await expect(
      transform({
        gender: 'FEMALE',
        minAge: '18',
        maxAge: '35',
        isActiveForAutomation: 'false',
        page: '2',
        pageSize: '50',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        gender: 'FEMALE',
        minAge: 18,
        maxAge: 35,
        isActiveForAutomation: false,
        page: 2,
        pageSize: 50,
      }),
    );
  });
});
