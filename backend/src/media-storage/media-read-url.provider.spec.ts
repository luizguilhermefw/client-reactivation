import type { FactoryProvider, Provider } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import {
  EnvMediaReadUrlConfig,
  MEDIA_READ_URL_CONFIG,
  MediaReadUrlConfig,
  MediaReadUrlConfigurationError,
} from './media-read-url.config';
import { MediaStorageModule } from './media-storage.module';

describe('MEDIA_READ_URL_CONFIG provider', () => {
  const originalValue = process.env.MEDIA_READ_URL_TTL_SECONDS;

  const getFactoryProvider = (): FactoryProvider<MediaReadUrlConfig> => {
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      MediaStorageModule,
    ) as Provider[];
    const provider = providers.find(
      (candidate): candidate is FactoryProvider<MediaReadUrlConfig> =>
        typeof candidate === 'object' &&
        candidate !== null &&
        'provide' in candidate &&
        candidate.provide === MEDIA_READ_URL_CONFIG &&
        'useFactory' in candidate,
    );

    if (!provider) {
      throw new Error('MEDIA_READ_URL_CONFIG factory provider was not found');
    }

    return provider;
  };

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env.MEDIA_READ_URL_TTL_SECONDS;
    } else {
      process.env.MEDIA_READ_URL_TTL_SECONDS = originalValue;
    }
  });

  it('resolve o token por useFactory sem registrar Function ou a classe', async () => {
    delete process.env.MEDIA_READ_URL_TTL_SECONDS;
    const factoryProvider = getFactoryProvider();
    const moduleRef = await Test.createTestingModule({
      providers: [factoryProvider],
    }).compile();

    expect(factoryProvider.inject).toBeUndefined();
    expect(
      moduleRef.get<MediaReadUrlConfig>(MEDIA_READ_URL_CONFIG).getTtlSeconds(),
    ).toBe(900);

    const moduleProviders = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      MediaStorageModule,
    ) as Provider[];
    expect(moduleProviders).not.toContain(EnvMediaReadUrlConfig);

    await moduleRef.close();
  });

  it('falha claramente ao resolver configuração inválida', async () => {
    process.env.MEDIA_READ_URL_TTL_SECONDS = '';

    await expect(
      Test.createTestingModule({
        providers: [getFactoryProvider()],
      }).compile(),
    ).rejects.toThrow(MediaReadUrlConfigurationError);
  });
});
