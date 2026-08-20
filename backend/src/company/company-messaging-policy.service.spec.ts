import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MessagingPolicyAction, UnknownContactPolicy } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  UNKNOWN_CONTACT_DECLARATION_TEXT,
  UNKNOWN_CONTACT_DECLARATION_VERSION,
  OPT_OUT_INSTRUCTIONS_DECLARATION_TEXT,
  OPT_OUT_INSTRUCTIONS_DECLARATION_VERSION,
  OPT_OUT_INSTRUCTIONS_ENABLED_AUDIT_TEXT,
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
      includeOptOutInstructions: true,
    });

    await expect(service.getPolicy(companyId)).resolves.toEqual({
      unknownContactPolicy: UnknownContactPolicy.BLOCK_UNKNOWN,
      includeOptOutInstructions: true,
      declaration: {
        required: true,
        version: UNKNOWN_CONTACT_DECLARATION_VERSION,
        text: UNKNOWN_CONTACT_DECLARATION_TEXT,
      },
      optOutInstructionsDeclaration: {
        required: true,
        version: OPT_OUT_INSTRUCTIONS_DECLARATION_VERSION,
        text: OPT_OUT_INSTRUCTIONS_DECLARATION_TEXT,
      },
    });
  });

  it('requires explicit responsibility acknowledgement when disabling instructions', async () => {
    await expect(
      service.updateOptOutInstructions(companyId, userId, false),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('disables instructions and appends a tenant-scoped audit record', async () => {
    transactionMock.company.findUnique.mockResolvedValue({
      id: companyId,
      includeOptOutInstructions: true,
    });

    await expect(
      service.updateOptOutInstructions(companyId, userId, false, true),
    ).resolves.toEqual({ includeOptOutInstructions: false });

    expect(transactionMock.company.findUnique).toHaveBeenCalledWith({
      where: { id: companyId },
      select: { id: true, includeOptOutInstructions: true },
    });
    expect(transactionMock.user.findFirst).toHaveBeenCalledWith({
      where: { id: userId, companyId },
      select: { id: true, companyId: true },
    });
    expect(
      transactionMock.messagingPolicyAcceptance.create,
    ).toHaveBeenCalledWith({
      data: {
        companyId,
        acceptedByUserId: userId,
        action: MessagingPolicyAction.DISABLED_OPT_OUT_INSTRUCTIONS,
        responsibilityAcknowledged: true,
        declarationVersion: OPT_OUT_INSTRUCTIONS_DECLARATION_VERSION,
        declarationTextSnapshot: OPT_OUT_INSTRUCTIONS_DECLARATION_TEXT,
      },
    });
    expect(transactionMock.company.updateMany).toHaveBeenCalledWith({
      where: { id: companyId, includeOptOutInstructions: true },
      data: { includeOptOutInstructions: false },
    });
  });

  it('reactivates instructions without acknowledgement and audits the action', async () => {
    transactionMock.company.findUnique.mockResolvedValue({
      id: companyId,
      includeOptOutInstructions: false,
    });

    await expect(
      service.updateOptOutInstructions(companyId, userId, true),
    ).resolves.toEqual({ includeOptOutInstructions: true });

    expect(
      transactionMock.messagingPolicyAcceptance.create,
    ).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId,
        acceptedByUserId: userId,
        action: MessagingPolicyAction.ENABLED_OPT_OUT_INSTRUCTIONS,
        responsibilityAcknowledged: false,
        declarationTextSnapshot: OPT_OUT_INSTRUCTIONS_ENABLED_AUDIT_TEXT,
      }),
    });
  });

  it('does not append audit history when the setting is unchanged', async () => {
    transactionMock.company.findUnique.mockResolvedValue({
      id: companyId,
      includeOptOutInstructions: true,
    });

    await expect(
      service.updateOptOutInstructions(companyId, userId, true),
    ).resolves.toEqual({ includeOptOutInstructions: true });

    expect(
      transactionMock.messagingPolicyAcceptance.create,
    ).not.toHaveBeenCalled();
    expect(transactionMock.company.updateMany).not.toHaveBeenCalled();
  });

  it('does not allow a user from Company A to change Company B instructions', async () => {
    transactionMock.company.findUnique.mockResolvedValue({
      id: 'company-b',
      includeOptOutInstructions: true,
    });
    transactionMock.user.findFirst.mockResolvedValue(null);

    await expect(
      service.updateOptOutInstructions('company-b', 'user-a', false, true),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(transactionMock.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-a', companyId: 'company-b' },
      }),
    );
    expect(
      transactionMock.messagingPolicyAcceptance.create,
    ).not.toHaveBeenCalled();
    expect(transactionMock.company.updateMany).not.toHaveBeenCalled();
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
