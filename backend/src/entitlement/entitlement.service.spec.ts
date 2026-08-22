import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  CompanyEntitlement,
  EntitlementFeature,
  EntitlementSource,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EntitlementService } from './entitlement.service';

describe('EntitlementService', () => {
  const now = new Date('2026-08-22T12:00:00.000Z');
  const prismaMock = {
    company: { findUnique: jest.fn() },
    companyEntitlement: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  };
  const persisted = (
    overrides: Partial<CompanyEntitlement> = {},
  ): CompanyEntitlement => ({
    id: 'entitlement-1',
    companyId: 'company-1',
    feature: EntitlementFeature.WHATSAPP_CHANNELS,
    limit: 2,
    source: EntitlementSource.MANUAL,
    externalReference: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });

  let service: EntitlementService;

  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.company.findUnique.mockResolvedValue({ id: 'company-1' });
    prismaMock.companyEntitlement.findUnique.mockResolvedValue(null);
    prismaMock.companyEntitlement.upsert.mockResolvedValue(persisted());
    service = new EntitlementService(prismaMock as unknown as PrismaService);
  });

  it('retorna zero quando o entitlement não existe', async () => {
    await expect(
      service.getLimit('company-1', EntitlementFeature.WHATSAPP_CHANNELS),
    ).resolves.toBe(0);

    expect(prismaMock.companyEntitlement.findUnique).toHaveBeenCalledWith({
      where: {
        companyId_feature: {
          companyId: 'company-1',
          feature: EntitlementFeature.WHATSAPP_CHANNELS,
        },
      },
      select: { limit: true },
    });
  });

  it('cria entitlement MANUAL por chave tenant-aware', async () => {
    await service.setManualLimit(
      'company-1',
      EntitlementFeature.WHATSAPP_CHANNELS,
      2,
    );

    expect(prismaMock.companyEntitlement.upsert).toHaveBeenCalledWith({
      where: {
        companyId_feature: {
          companyId: 'company-1',
          feature: EntitlementFeature.WHATSAPP_CHANNELS,
        },
      },
      create: {
        companyId: 'company-1',
        feature: EntitlementFeature.WHATSAPP_CHANNELS,
        limit: 2,
        source: EntitlementSource.MANUAL,
        externalReference: null,
      },
      update: {
        limit: 2,
        source: EntitlementSource.MANUAL,
        externalReference: null,
      },
    });
  });

  it('atualiza o mesmo entitlement via upsert sem criar chave duplicada', async () => {
    await service.setManualLimit(
      'company-1',
      EntitlementFeature.WHATSAPP_CHANNELS,
      2,
    );
    await service.setManualLimit(
      'company-1',
      EntitlementFeature.WHATSAPP_CHANNELS,
      3,
    );

    expect(prismaMock.companyEntitlement.upsert).toHaveBeenCalledTimes(2);
    expect(
      prismaMock.companyEntitlement.upsert.mock.calls.map(
        ([call]) => call.where,
      ),
    ).toEqual([
      {
        companyId_feature: {
          companyId: 'company-1',
          feature: EntitlementFeature.WHATSAPP_CHANNELS,
        },
      },
      {
        companyId_feature: {
          companyId: 'company-1',
          feature: EntitlementFeature.WHATSAPP_CHANNELS,
        },
      },
    ]);
    expect(prismaMock.companyEntitlement.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ limit: 3 }),
      }),
    );
  });

  it.each([-1, -10, 1.5, Number.NaN])(
    'rejeita limite inválido %s antes do Prisma',
    async (limit) => {
      await expect(
        service.setManualLimit(
          'company-1',
          EntitlementFeature.WHATSAPP_CHANNELS,
          limit,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prismaMock.company.findUnique).not.toHaveBeenCalled();
      expect(prismaMock.companyEntitlement.upsert).not.toHaveBeenCalled();
    },
  );

  it('retorna NotFound quando a Company não existe', async () => {
    prismaMock.company.findUnique.mockResolvedValue(null);

    await expect(
      service.setManualLimit(
        'missing-company',
        EntitlementFeature.WHATSAPP_CHANNELS,
        1,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(prismaMock.companyEntitlement.upsert).not.toHaveBeenCalled();
  });

  it('Company A nunca lê o entitlement da Company B', async () => {
    prismaMock.companyEntitlement.findUnique.mockImplementation(
      async ({ where }) =>
        where.companyId_feature.companyId === 'company-b' ? { limit: 9 } : null,
    );

    await expect(
      service.getLimit('company-a', EntitlementFeature.WHATSAPP_CHANNELS),
    ).resolves.toBe(0);
  });

  it('aceita source BILLING apenas pela API interna do serviço', async () => {
    prismaMock.companyEntitlement.upsert.mockResolvedValue(
      persisted({
        source: EntitlementSource.BILLING,
        externalReference: 'billing-subscription-reference',
      }),
    );

    await service.setLimit({
      companyId: 'company-1',
      feature: EntitlementFeature.WHATSAPP_CHANNELS,
      limit: 4,
      source: EntitlementSource.BILLING,
      externalReference: 'billing-subscription-reference',
    });

    expect(prismaMock.companyEntitlement.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          source: EntitlementSource.BILLING,
          externalReference: 'billing-subscription-reference',
        }),
        update: expect.objectContaining({
          source: EntitlementSource.BILLING,
          externalReference: 'billing-subscription-reference',
        }),
      }),
    );
  });
});
