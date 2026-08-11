import { Test, TestingModule } from '@nestjs/testing';
import { MessagingChannelStatus, MessagingProvider } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfiguredEvolutionInstanceTenantResolver } from './configured-evolution-instance-tenant.resolver';

describe('ConfiguredEvolutionInstanceTenantResolver', () => {
  let resolver: ConfiguredEvolutionInstanceTenantResolver;
  const prismaMock = {
    messagingChannel: {
      findFirst: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConfiguredEvolutionInstanceTenantResolver,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    resolver = module.get(ConfiguredEvolutionInstanceTenantResolver);
    prismaMock.messagingChannel.findFirst.mockResolvedValue({
      companyId: 'company-1',
    });
  });

  it('resolves companyId from an active EVOLUTION channel', async () => {
    await expect(resolver.resolveCompanyId('tenant-instance')).resolves.toBe(
      'company-1',
    );
    expect(prismaMock.messagingChannel.findFirst).toHaveBeenCalledWith({
      where: {
        provider: MessagingProvider.EVOLUTION,
        instanceName: 'tenant-instance',
        status: MessagingChannelStatus.ACTIVE,
      },
      select: {
        companyId: true,
      },
    });
  });

  it('trims instanceName before the exact lookup', async () => {
    await resolver.resolveCompanyId('  tenant-instance  ');

    expect(prismaMock.messagingChannel.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          instanceName: 'tenant-instance',
        }),
      }),
    );
  });

  it('returns null for an unknown instance', async () => {
    prismaMock.messagingChannel.findFirst.mockResolvedValue(null);

    await expect(
      resolver.resolveCompanyId('unknown-instance'),
    ).resolves.toBeNull();
  });

  it('returns null for an INACTIVE channel because only ACTIVE is queried', async () => {
    prismaMock.messagingChannel.findFirst.mockResolvedValue(null);

    await expect(
      resolver.resolveCompanyId('inactive-instance'),
    ).resolves.toBeNull();
    expect(prismaMock.messagingChannel.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: MessagingChannelStatus.ACTIVE,
        }),
      }),
    );
  });

  it('does not match a channel from another provider', async () => {
    prismaMock.messagingChannel.findFirst.mockResolvedValue(null);

    await expect(
      resolver.resolveCompanyId('other-provider-instance'),
    ).resolves.toBeNull();
    expect(prismaMock.messagingChannel.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          provider: MessagingProvider.EVOLUTION,
        }),
      }),
    );
  });

  it('does not use an external companyId in tenant resolution', async () => {
    await resolver.resolveCompanyId('tenant-instance');

    const lookup = prismaMock.messagingChannel.findFirst.mock.calls[0][0];
    expect(lookup.where).not.toHaveProperty('companyId');
    expect(lookup.select).toEqual({ companyId: true });
  });

  it('does not scan Company or depend on EnvEvolutionConfigResolver', async () => {
    await resolver.resolveCompanyId('tenant-instance');

    expect(prismaMock).not.toHaveProperty('company');
    expect(resolver as unknown as Record<string, unknown>).not.toHaveProperty(
      'evolutionConfigResolver',
    );
    expect(prismaMock.messagingChannel.findFirst).toHaveBeenCalledTimes(1);
  });

  it('returns null without querying when instanceName is blank', async () => {
    await expect(resolver.resolveCompanyId('   ')).resolves.toBeNull();

    expect(prismaMock.messagingChannel.findFirst).not.toHaveBeenCalled();
  });
});
