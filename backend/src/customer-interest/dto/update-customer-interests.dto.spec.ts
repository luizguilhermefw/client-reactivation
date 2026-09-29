import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';
import { UpdateCustomerInterestsDto } from './update-customer-interests.dto';

describe('UpdateCustomerInterestsDto', () => {
  const firstId = '8156cf3a-4baa-4680-843f-f901297940f2';
  const secondId = '3f785c9c-f130-4dc0-8a9e-150ab54d821f';
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  const transform = (value: Record<string, unknown>) =>
    pipe.transform(value, {
      type: 'body',
      metatype: UpdateCustomerInterestsDto,
      data: '',
    } as ArgumentMetadata) as Promise<UpdateCustomerInterestsDto>;

  it('accepts a valid UUID array and an empty replacement', async () => {
    await expect(
      transform({ interestOptionIds: [firstId, secondId] }),
    ).resolves.toEqual({ interestOptionIds: [firstId, secondId] });
    await expect(transform({ interestOptionIds: [] })).resolves.toEqual({
      interestOptionIds: [],
    });
  });

  it.each([
    {},
    { interestOptionIds: 'not-an-array' },
    { interestOptionIds: ['invalid'] },
    { interestOptionIds: [firstId, firstId] },
    {
      interestOptionIds: Array.from(
        { length: 101 },
        (_, index) =>
          `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`,
      ),
    },
    { interestOptionIds: [], companyId: 'attacker-company' },
  ])('rejects invalid payload %j', async (payload) => {
    await expect(transform(payload)).rejects.toBeDefined();
  });
});
