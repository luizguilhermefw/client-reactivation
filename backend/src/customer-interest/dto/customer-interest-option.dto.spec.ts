import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';
import { CustomerInterestType } from '@prisma/client';
import { CreateCustomerInterestOptionDto } from './create-customer-interest-option.dto';
import { CustomerInterestOptionFilterDto } from './customer-interest-option-filter.dto';
import { UpdateCustomerInterestOptionDto } from './update-customer-interest-option.dto';
import { UpdateCustomerInterestOptionStatusDto } from './update-customer-interest-option-status.dto';

describe('Customer interest option DTOs', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  const transform = <T extends object>(
    value: Record<string, unknown>,
    metatype: new () => T,
    type: 'body' | 'query' = 'body',
  ) =>
    pipe.transform(value, {
      type,
      metatype,
      data: '',
    } as ArgumentMetadata) as Promise<T>;

  it.each([CustomerInterestType.CATEGORY, CustomerInterestType.BRAND])(
    'accepts valid %s creation',
    async (type) => {
      await expect(
        transform({ type, name: 'Apple' }, CreateCustomerInterestOptionDto),
      ).resolves.toEqual({ type, name: 'Apple' });
    },
  );

  it('rejects invalid type, empty name and administrative fields', async () => {
    await expect(
      transform(
        { type: 'INVALID', name: 'Apple' },
        CreateCustomerInterestOptionDto,
      ),
    ).rejects.toBeDefined();
    await expect(
      transform(
        { type: CustomerInterestType.BRAND, name: '' },
        CreateCustomerInterestOptionDto,
      ),
    ).rejects.toBeDefined();
    await expect(
      transform(
        {
          type: CustomerInterestType.BRAND,
          name: 'Apple',
          companyId: 'attacker-company',
        },
        CreateCustomerInterestOptionDto,
      ),
    ).rejects.toBeDefined();
  });

  it('validates update, status and transformed list filters', async () => {
    await expect(
      transform({ name: 'Apple' }, UpdateCustomerInterestOptionDto),
    ).resolves.toEqual({ name: 'Apple' });
    await expect(
      transform({ active: false }, UpdateCustomerInterestOptionStatusDto),
    ).resolves.toEqual({ active: false });
    await expect(
      transform(
        { type: CustomerInterestType.BRAND, active: 'false' },
        CustomerInterestOptionFilterDto,
        'query',
      ),
    ).resolves.toEqual({ type: CustomerInterestType.BRAND, active: false });
  });
});
