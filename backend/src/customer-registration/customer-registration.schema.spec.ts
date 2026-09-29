import { Prisma } from '@prisma/client';

describe('CustomerRegistrationLink Prisma model', () => {
  it('keeps publicId globally unique and one link per Company', () => {
    const model = Prisma.dmmf.datamodel.models.find(
      ({ name }) => name === 'CustomerRegistrationLink',
    );

    expect(model).toBeDefined();
    expect(model?.fields.find(({ name }) => name === 'publicId')).toMatchObject(
      {
        isUnique: true,
        type: 'String',
      },
    );
    expect(model?.uniqueFields).toContainEqual(['companyId']);
    expect(model?.fields.find(({ name }) => name === 'active')).toMatchObject({
      hasDefaultValue: true,
      default: true,
    });
    expect(model?.fields.find(({ name }) => name === 'company')).toMatchObject({
      relationFromFields: ['companyId'],
      relationOnDelete: 'Restrict',
    });
  });
});
