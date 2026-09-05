import { NotFoundException } from '@nestjs/common';
import {
  CompanyStatus,
  EntitlementFeature,
  EntitlementSource,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminService } from './admin.service';

describe('AdminService', () => {
  const companyId = 'company-1';
  const approvedAt = new Date('2026-09-05T12:00:00.000Z');
  const transactionMock = {
    company: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    companyEntitlement: {
      upsert: jest.fn(),
    },
  };
  const prismaMock = {
    $transaction: jest.fn(),
  };

  let service: AdminService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(approvedAt);
    prismaMock.$transaction.mockImplementation(
      (callback: (transaction: typeof transactionMock) => Promise<unknown>) =>
        callback(transactionMock),
    );
    transactionMock.company.findUnique.mockResolvedValue({
      id: companyId,
      status: CompanyStatus.PENDING,
      approvedAt: null,
    });
    transactionMock.companyEntitlement.upsert.mockResolvedValue({
      id: 'entitlement-1',
    });
    transactionMock.company.update.mockResolvedValue({
      id: companyId,
      status: CompanyStatus.ACTIVE,
      approvedAt,
    });
    service = new AdminService(prismaMock as unknown as PrismaService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('mantém NotFound para empresa inexistente', async () => {
    transactionMock.company.findUnique.mockResolvedValue(null);

    await expect(service.activateCompany('missing-company')).rejects.toBeInstanceOf(
      NotFoundException,
    );

    expect(transactionMock.companyEntitlement.upsert).not.toHaveBeenCalled();
    expect(transactionMock.company.update).not.toHaveBeenCalled();
  });

  it('ativa empresa PENDING, preenche approvedAt e cria entitlement padrão', async () => {
    await expect(service.activateCompany(companyId)).resolves.toEqual({
      message: 'Empresa aprovada com sucesso.',
      company: {
        id: companyId,
        status: CompanyStatus.ACTIVE,
        approvedAt,
      },
    });

    expect(transactionMock.companyEntitlement.upsert).toHaveBeenCalledWith({
      where: {
        companyId_feature: {
          companyId,
          feature: EntitlementFeature.WHATSAPP_CHANNELS,
        },
      },
      create: {
        companyId,
        feature: EntitlementFeature.WHATSAPP_CHANNELS,
        limit: 1,
        source: EntitlementSource.MANUAL,
      },
      update: {},
    });
    expect(transactionMock.company.update).toHaveBeenCalledWith({
      where: { id: companyId },
      data: {
        status: CompanyStatus.ACTIVE,
        approvedAt,
      },
    });
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });

  it('preserva integralmente um entitlement existente', async () => {
    transactionMock.companyEntitlement.upsert.mockResolvedValue({
      id: 'existing-entitlement',
      companyId,
      feature: EntitlementFeature.WHATSAPP_CHANNELS,
      limit: 2,
      source: EntitlementSource.BILLING,
      externalReference: 'existing-reference',
    });

    await service.activateCompany(companyId);

    expect(transactionMock.companyEntitlement.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: {} }),
    );
  });

  it('permanece idempotente quando a aprovação é repetida', async () => {
    transactionMock.company.findUnique
      .mockResolvedValueOnce({
        id: companyId,
        status: CompanyStatus.PENDING,
        approvedAt: null,
      })
      .mockResolvedValueOnce({
        id: companyId,
        status: CompanyStatus.ACTIVE,
        approvedAt,
      });

    await service.activateCompany(companyId);
    await service.activateCompany(companyId);

    expect(transactionMock.companyEntitlement.upsert).toHaveBeenCalledTimes(2);
    expect(
      transactionMock.companyEntitlement.upsert.mock.calls.map(
        ([input]) => input.where,
      ),
    ).toEqual([
      {
        companyId_feature: {
          companyId,
          feature: EntitlementFeature.WHATSAPP_CHANNELS,
        },
      },
      {
        companyId_feature: {
          companyId,
          feature: EntitlementFeature.WHATSAPP_CHANNELS,
        },
      },
    ]);
    expect(transactionMock.company.update).toHaveBeenLastCalledWith({
      where: { id: companyId },
      data: {
        status: CompanyStatus.ACTIVE,
        approvedAt,
      },
    });
  });

  it('não aprova parcialmente quando a criação do entitlement falha', async () => {
    transactionMock.companyEntitlement.upsert.mockRejectedValue(
      new Error('database failure'),
    );

    await expect(service.activateCompany(companyId)).rejects.toThrow(
      'database failure',
    );

    expect(transactionMock.company.update).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });
});
