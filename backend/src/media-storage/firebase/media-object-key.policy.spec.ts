import {
  InvalidMediaObjectKeyError,
  MediaObjectKeyPolicy,
} from './media-object-key.policy';

describe('MediaObjectKeyPolicy', () => {
  const policy = new MediaObjectKeyPolicy();

  it('aceita chave relativa estruturalmente válida', () => {
    expect(() =>
      policy.assertValid('companies/company-1/assets/image.jpg'),
    ).not.toThrow();
  });

  it.each([
    '',
    '/companies/company-1/image.jpg',
    'companies\\company-1\\image.jpg',
    'companies/company-1/../image.jpg',
    'companies/company-1/./image.jpg',
    'companies//image.jpg',
    'companies/company-1/image.jpg?download=1',
    'companies/company-1/image.jpg#fragment',
    'https://storage.example.com/image.jpg',
    '//storage.example.com/image.jpg',
    'companies/company-1/image\u0000.jpg',
  ])('rejeita chave estruturalmente inválida', (objectKey) => {
    expect(() => policy.assertValid(objectKey)).toThrow(
      InvalidMediaObjectKeyError,
    );
  });

  it('aceita upload com prefixo do tenant', () => {
    expect(() =>
      policy.assertOwnedByTenant(
        'companies/company-1/assets/image.jpg',
        'company-1',
      ),
    ).not.toThrow();
  });

  it('rejeita prefixo de outro tenant', () => {
    expect(() =>
      policy.assertOwnedByTenant(
        'companies/company-2/assets/image.jpg',
        'company-1',
      ),
    ).toThrow(InvalidMediaObjectKeyError);
  });

  it('não inclui a chave recebida no erro', () => {
    const objectKey = 'https://private.example.com/secret.jpg';

    try {
      policy.assertValid(objectKey);
      throw new Error('Expected object key validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidMediaObjectKeyError);
      expect((error as Error).message).toBe('Media object key is invalid');
      expect((error as Error).message).not.toContain(objectKey);
    }
  });
});
