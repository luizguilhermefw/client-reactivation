import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';
import { CustomerGender } from '@prisma/client';
import { CreateCustomerDto } from './create-customer.dto';
import { UpdateCustomerDto } from './update-customer.dto';

describe('Customer profile DTOs', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  const transform = <T extends object>(
    value: Record<string, unknown>,
    metatype: new () => T,
  ) =>
    pipe.transform(value, {
      type: 'body',
      metatype,
      data: '',
    } as ArgumentMetadata) as Promise<T>;

  it('accepts enum gender and normalizes lowercase state on create', async () => {
    await expect(
      transform(
        {
          name: 'Maria',
          phone: '45999999999',
          gender: CustomerGender.FEMALE,
          city: 'Foz do Iguaçu',
          state: ' pr ',
        },
        CreateCustomerDto,
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        gender: CustomerGender.FEMALE,
        state: 'PR',
      }),
    );
  });

  it.each(['INVALID', 'female', ''])(
    'rejects invalid gender %j',
    async (gender) => {
      await expect(
        transform(
          { name: 'Maria', phone: '45999999999', gender },
          CreateCustomerDto,
        ),
      ).rejects.toBeDefined();
    },
  );

  it.each(['ZZ', 'XX', 'PARANA', 'P', '1A'])(
    'rejects invalid state %j',
    async (state) => {
      await expect(
        transform(
          { name: 'Maria', phone: '45999999999', state },
          CreateCustomerDto,
        ),
      ).rejects.toBeDefined();
    },
  );

  it('allows null to clear city and state on update', async () => {
    await expect(
      transform({ city: null, state: null }, UpdateCustomerDto),
    ).resolves.toEqual(expect.objectContaining({ city: null, state: null }));
  });

  it.each([
    'companyId',
    'contactConsentStatus',
    'consentGrantedAt',
    'optedOutAt',
    'isActiveForAutomation',
    'createdAt',
  ])('rejects protected field %s', async (field) => {
    await expect(
      transform(
        { name: 'Maria', phone: '45999999999', [field]: 'forbidden' },
        CreateCustomerDto,
      ),
    ).rejects.toBeDefined();
  });
});
