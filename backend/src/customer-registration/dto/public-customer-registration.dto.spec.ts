import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';
import { CustomerGender } from '@prisma/client';
import { PublicCustomerRegistrationDto } from './public-customer-registration.dto';

describe('PublicCustomerRegistrationDto', () => {
  const firstId = '8156cf3a-4baa-4680-843f-f901297940f2';
  const secondId = '3f785c9c-f130-4dc0-8a9e-150ab54d821f';
  const valid = {
    name: 'Maria da Silva',
    preferredName: 'Maria',
    phone: '45999999999',
    cpf: '52998224725',
    birthDate: '1990-05-10',
    gender: CustomerGender.FEMALE,
    city: 'Cascavel',
    state: ' pr ',
    contactConsent: true,
    interestOptionIds: [firstId, secondId],
  };
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  const transform = (value: Record<string, unknown>) =>
    pipe.transform(value, {
      type: 'body',
      metatype: PublicCustomerRegistrationDto,
      data: '',
    } as ArgumentMetadata) as Promise<PublicCustomerRegistrationDto>;

  it('accepts and normalizes the supported public fields', async () => {
    await expect(transform(valid)).resolves.toEqual({
      ...valid,
      state: 'PR',
    });
  });

  it('accepts an empty interest selection and false consent', async () => {
    await expect(
      transform({
        name: valid.name,
        phone: valid.phone,
        cpf: valid.cpf,
        contactConsent: false,
        interestOptionIds: [],
      }),
    ).resolves.toMatchObject({
      contactConsent: false,
      interestOptionIds: [],
    });
  });

  it.each([
    ['missing CPF', { ...valid, cpf: undefined }],
    ['missing consent', { ...valid, contactConsent: undefined }],
    ['missing interests', { ...valid, interestOptionIds: undefined }],
    ['invalid UUID', { ...valid, interestOptionIds: ['invalid'] }],
    ['duplicate UUID', { ...valid, interestOptionIds: [firstId, firstId] }],
    ['invalid state', { ...valid, state: 'ZZ' }],
    ['invalid consent', { ...valid, contactConsent: 'true' }],
    ['administrative field', { ...valid, companyId: 'attacker-company' }],
    ['controlled field', { ...valid, lastPurchaseDate: '2026-01-01' }],
  ])('rejects %s', async (_scenario, payload) => {
    await expect(transform(payload)).rejects.toBeDefined();
  });

  it('rejects more than 100 unique options', async () => {
    const interestOptionIds = Array.from(
      { length: 101 },
      (_, index) =>
        `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`,
    );
    await expect(
      transform({ ...valid, interestOptionIds }),
    ).rejects.toBeDefined();
  });
});
