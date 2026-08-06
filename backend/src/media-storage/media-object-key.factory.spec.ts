import { MediaObjectKeyPolicy } from './firebase/media-object-key.policy';
import {
  MAX_MEDIA_OBJECT_FILE_NAME_LENGTH,
  MediaObjectKeyFactory,
} from './media-object-key.factory';

describe('MediaObjectKeyFactory', () => {
  const policy = new MediaObjectKeyPolicy();
  const factory = new MediaObjectKeyFactory(policy);

  it('gera chave multi-tenant com asset id e nome seguro', () => {
    expect(factory.create('company-1', 'asset-1', 'campanha.jpg')).toBe(
      'companies/company-1/media/asset-1/campanha.jpg',
    );
  });

  it('remove caminhos locais, query, fragmento e caracteres inseguros', () => {
    expect(
      factory.create(
        'company-1',
        'asset-1',
        'C:\\private\\..\\Campanha verão!!.JPG?token=secret#fragment',
      ),
    ).toBe('companies/company-1/media/asset-1/Campanha-verao.jpg');
  });

  it('remove segmentos de caminho Unix sem usar o nome como identificador', () => {
    const objectKey = factory.create(
      'company-1',
      'asset-unique',
      '../../image.png',
    );

    expect(objectKey).toBe('companies/company-1/media/asset-unique/image.png');
    expect(objectKey).not.toContain('..');
  });

  it('limita o nome preservando extensão segura', () => {
    const objectKey = factory.create(
      'company-1',
      'asset-1',
      `${'a'.repeat(300)}.jpeg`,
    );
    const safeFileName = objectKey.split('/').at(-1) ?? '';

    expect(safeFileName).toHaveLength(MAX_MEDIA_OBJECT_FILE_NAME_LENGTH);
    expect(safeFileName.endsWith('.jpeg')).toBe(true);
  });

  it('usa fallback seguro para nome sem conteúdo aproveitável', () => {
    expect(factory.create('company-1', 'asset-1', '..')).toBe(
      'companies/company-1/media/asset-1/file',
    );
  });

  it('sempre produz chave aceita pela política existente', () => {
    const objectKey = factory.create(
      'company-1',
      'asset-1',
      'imagem\u0000 final.png',
    );

    expect(() =>
      policy.assertOwnedByTenant(objectKey, 'company-1'),
    ).not.toThrow();
  });
});
