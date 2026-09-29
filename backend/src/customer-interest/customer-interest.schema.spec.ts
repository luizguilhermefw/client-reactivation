import { Prisma } from '@prisma/client';

describe('CustomerInterest tenant-safe Prisma model', () => {
  it('enforces tenant-scoped normalized option uniqueness', () => {
    const model = Prisma.dmmf.datamodel.models.find(
      ({ name }) => name === 'CustomerInterestOption',
    );
    expect(model?.uniqueFields).toContainEqual([
      'companyId',
      'type',
      'normalizedName',
    ]);
  });

  it('enforces unique association and composite tenant relations', () => {
    const model = Prisma.dmmf.datamodel.models.find(
      ({ name }) => name === 'CustomerInterest',
    );
    expect(model?.uniqueFields).toContainEqual([
      'companyId',
      'customerId',
      'interestOptionId',
    ]);
    expect(model?.fields.find(({ name }) => name === 'customer')).toMatchObject(
      {
        relationFromFields: ['customerId', 'companyId'],
        relationToFields: ['id', 'companyId'],
      },
    );
    expect(
      model?.fields.find(({ name }) => name === 'interestOption'),
    ).toMatchObject({
      relationFromFields: ['interestOptionId', 'companyId'],
      relationToFields: ['id', 'companyId'],
    });
  });
});
