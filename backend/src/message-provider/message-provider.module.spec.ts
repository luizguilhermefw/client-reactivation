import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { MessageProviderModule } from './message-provider.module';
import { MESSAGE_PROVIDER } from './message-provider.token';
import { MessageProviderRouter } from './message-provider-router';
import { EvolutionMessageProvider } from './evolution/evolution-message.provider';
import { MetaCloudMessageProvider } from './meta-cloud/meta-cloud-message.provider';
import { EnvMetaCloudConfigResolver } from './meta-cloud/env-meta-cloud-config.resolver';
import { META_CLOUD_CONFIG_RESOLVER } from './meta-cloud/meta-cloud-config-resolver.token';

describe('MessageProviderModule', () => {
  it('wires the router and both adapters with no Meta env, database connection or HTTP', async () => {
    const originalEnv = process.env;
    process.env = { ...originalEnv };
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('META_WHATSAPP_')) delete process.env[key];
    }
    const prisma = { messagingChannel: { findFirst: jest.fn() } };
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('Unexpected HTTP'));
    try {
      const moduleRef = await Test.createTestingModule({
        imports: [MessageProviderModule],
      })
        .overrideProvider(PrismaService)
        .useValue(prisma)
        .compile();
      try {
        await moduleRef.init();
        expect(moduleRef.get(MESSAGE_PROVIDER)).toBe(
          moduleRef.get(MessageProviderRouter),
        );
        expect(moduleRef.get(EvolutionMessageProvider)).toBeDefined();
        expect(moduleRef.get(MetaCloudMessageProvider)).toBeDefined();
        expect(moduleRef.get(META_CLOUD_CONFIG_RESOLVER)).toBe(
          moduleRef.get(EnvMetaCloudConfigResolver),
        );
        expect(prisma.messagingChannel.findFirst).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        await moduleRef.close();
      }
    } finally {
      process.env = originalEnv;
      fetchMock.mockRestore();
    }
  });
});
