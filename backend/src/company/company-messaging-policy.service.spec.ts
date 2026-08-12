import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { UnknownContactPolicy } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  UNKNOWN_CONTACT_DECLARATION_TEXT,
  UNKNOWN_CONTACT_DECLARATION_VERSION,
} from './company-messaging-policy.declaration';
import { CompanyMessagingPolicyService } from './company-messaging-policy.service';

describe('CompanyMessagingPolicyService', () => {
  let service: CompanyMessagingPolicyService;
  const companyId = 'company-1';
  const userId = 'user-1';
  const transactionMock = {
    company: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    user: {
      findFirst: jest.fn(),
    },
    messagingPolicyAcceptance: {
      create: jest.fn(),
    },
  };
  const prismaMock = {
    company: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    user: {
      findFirst: jest.fn(),
    },
    messagingPolicyAcceptance: {
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompanyMessagingPolicyService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get(CompanyMessagingPolicyService);
    prismaMock.company.findUnique.mockResolvedValue({ id: companyId });
    prismaMock.company.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.user.findFirst.mockResolvedValue({ id: userId });
    transactionMock.company.findUnique.mockResolvedValue({ id: companyId });
    transactionMock.company.updateMany.mockResolvedValue({ count: 1 });
    transactionMock.user.findFirst.mockResolvedValue({
      id: userId,
      companyId,
    });
    transactionMock.messagingPolicyAcceptance.create.mockResolvedValue({
      id: 'acceptance-1',
      acceptedAt: new Date('2026-08-11T15:00:00.000Z'),
    });
    prismaMock.$transaction.mockImplementation(
      (callback: (transaction: typeof transactionMock) => Promise<unknown>) =>
        callback(transactionMock),
    );
  });

  it('returns BLOCK_UNKNOWN as the safe default policy', async () => {
    prismaMock.company.findUnique.mockResolvedValue({
      unknownContactPolicy: UnknownContactPolicy.BLOCK_UNKNOWN,
    });

    await expect(service.getPolicy(companyId)).resolves.toEqual({
      unknownContactPolicy: UnknownContactPolicy.BLOCK_UNKNOWN,
      declaration: {
        required: true,
        version: UNKNOWN_CONTACT_DECLARATION_VERSION,
        text: UNKNOWN_CONTACT_DECLARATION_TEXT,
      },
    });
  });

  it('creates an immutable acceptance and enables ALLOW in one transaction', async () => {
    const result = await service.allowUnknownWithDeclaration(
      companyId,
      userId,
      true,
    );

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(
      transactionMock.messagingPolicyAcceptance.create,
    ).toHaveBeenCalledWith({
      data: {
        companyId,
        acceptedByUserId: userId,
        policy: UnknownContactPolicy.ALLOW_UNKNOWN_WITH_DECLARATION,
        declarationVersion: UNKNOWN_CONTACT_DECLARATION_VERSION,
        declarationTextSnapshot: UNKNOWN_CONTACT_DECLARATION_TEXT,
      },
    });
    expect(transactionMock.company.updateMany).toHaveBeenCalledWith({
      where: { id: companyId },
      data: {
        unknownContactPolicy:
          UnknownContactPolicy.ALLOW_UNKNOWN_WITH_DECLARATION,
      },
    });
    expect(result).toEqual({
      unknownContactPolicy: UnknownContactPolicy.ALLOW_UNKNOWN_WITH_DECLARATION,
    });
  });

  it('relies on the database default to generate acceptedAt', async () => {
    await service.allowUnknownWithDeclaration(companyId, userId, true);

    const acceptanceData =
      transactionMock.messagingPolicyAcceptance.create.mock.calls[0][0].data;
    expect(acceptanceData).not.toHaveProperty('acceptedAt');
  });

  it('rejects ALLOW without explicit declaration acceptance', async () => {
    await expect(
      service.allowUnknownWithDeclaration(companyId, userId, false),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('validates that the accepting user belongs to the same Company', async () => {
    transactionMock.user.findFirst.mockResolvedValue(null);

    await expect(
      service.allowUnknownWithDeclaration('company-2', userId, true),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(transactionMock.user.findFirst).toHaveBeenCalledWith({
      where: {
        id: userId,
        companyId: 'company-2',
      },
      select: {
        id: true,
        companyId: true,
      },
    });
    expect(
      transactionMock.messagingPolicyAcceptance.create,
    ).not.toHaveBeenCalled();
    expect(transactionMock.company.updateMany).not.toHaveBeenCalled();
  });

  it('does not allow Company A user to alter Company B', async () => {
    transactionMock.user.findFirst.mockResolvedValue(null);

    await expect(
      service.updateUnknownContactPolicy(
        'company-b',
        'user-a',
        UnknownContactPolicy.ALLOW_UNKNOWN_WITH_DECLARATION,
        true,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(transactionMock.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-a', companyId: 'company-b' },
      }),
    );
    expect(transactionMock.company.updateMany).not.toHaveBeenCalled();
  });

  it('blocks UNKNOWN without deleting or updating acceptance history', async () => {
    const result = await service.blockUnknown(companyId, userId);

    expect(prismaMock.company.updateMany).toHaveBeenCalledWith({
      where: { id: companyId },
      data: {
        unknownContactPolicy: UnknownContactPolicy.BLOCK_UNKNOWN,
      },
    });
    expect(prismaMock.messagingPolicyAcceptance.create).not.toHaveBeenCalled();
    expect(prismaMock.messagingPolicyAcceptance.update).not.toHaveBeenCalled();
    expect(prismaMock.messagingPolicyAcceptance.delete).not.toHaveBeenCalled();
    expect(result).toEqual({
      unknownContactPolicy: UnknownContactPolicy.BLOCK_UNKNOWN,
    });
  });

  it('requires a new acceptance after ALLOW -> BLOCK -> ALLOW', async () => {
    await service.allowUnknownWithDeclaration(companyId, userId, true);
    await service.blockUnknown(companyId, userId);
    await service.allowUnknownWithDeclaration(companyId, userId, true);

    expect(
      transactionMock.messagingPolicyAcceptance.create,
    ).toHaveBeenCalledTimes(2);
    expect(prismaMock.company.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          unknownContactPolicy: UnknownContactPolicy.BLOCK_UNKNOWN,
        },
      }),
    );
  });

  it('does not update policy when acceptance persistence fails', async () => {
    transactionMock.messagingPolicyAcceptance.create.mockRejectedValue(
      new Error('database unavailable'),
    );

    await expect(
      service.allowUnknownWithDeclaration(companyId, userId, true),
    ).rejects.toThrow('database unavailable');

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(transactionMock.company.updateMany).not.toHaveBeenCalled();
  });
});
