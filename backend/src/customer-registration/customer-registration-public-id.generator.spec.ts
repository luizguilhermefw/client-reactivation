import { CustomerRegistrationPublicIdGenerator } from './customer-registration-public-id.generator';

describe('CustomerRegistrationPublicIdGenerator', () => {
  it('generates unpredictable 256-bit URL-safe identifiers', () => {
    const generator = new CustomerRegistrationPublicIdGenerator();
    const first = generator.generate();
    const second = generator.generate();

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).not.toBe(first);
  });
});
