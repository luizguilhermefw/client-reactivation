import {
  BadRequestException,
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { UnknownContactPolicy, UserRole } from '@prisma/client';
import request from 'supertest';
import { CompanyActiveGuard } from '../auth/guards/company-active.guard';
import { ExactRolesGuard } from '../auth/guards/exact-roles.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { RequestWithUser } from '../auth/types/request-with-user';
import {
  UNKNOWN_CONTACT_DECLARATION_TEXT,
  UNKNOWN_CONTACT_DECLARATION_VERSION,
  OPT_OUT_INSTRUCTIONS_DECLARATION_TEXT,
  OPT_OUT_INSTRUCTIONS_DECLARATION_VERSION,
} from './company-messaging-policy.declaration';
import { CompanyMessagingPolicyService } from './company-messaging-policy.service';
import { CompanyController } from './company.controller';
import { CompanyService } from './company.service';

jest.mock(
  'prisma/prisma.service',
  () => ({ PrismaService: class PrismaService {} }),
  { virtual: true },
);

describe('CompanyController messaging policy HTTP', () => {
  const authenticatedUser: RequestWithUser['user'] = {
    userId: 'user-from-jwt',
    name: 'Owner',
    email: 'owner@example.test',
    companyId: 'company-from-jwt',
    role: UserRole.OWNER,
  };
  const policyServiceMock = {
    getPolicy: jest.fn(),
    updateUnknownContactPolicy: jest.fn(),
    updateOptOutInstructions: jest.fn(),
  };
  let app: INestApplication;

  beforeAll(async () => {
    const authenticatedGuard = {
      canActivate: (context: ExecutionContext) => {
        context.switchToHttp().getRequest<RequestWithUser>().user =
          authenticatedUser;
        return true;
      },
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [CompanyController],
      providers: [
        { provide: CompanyService, useValue: {} },
        ExactRolesGuard,
        {
          provide: CompanyMessagingPolicyService,
          useValue: policyServiceMock,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(authenticatedGuard)
      .overrideGuard(CompanyActiveGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    authenticatedUser.role = UserRole.OWNER;
    policyServiceMock.getPolicy.mockResolvedValue({
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
    policyServiceMock.updateUnknownContactPolicy.mockImplementation(
      (
        _companyId: string,
        _userId: string,
        policy: UnknownContactPolicy,
        declarationAccepted?: boolean,
      ) => {
        if (
          policy === UnknownContactPolicy.ALLOW_UNKNOWN_WITH_DECLARATION &&
          declarationAccepted !== true
        ) {
          throw new BadRequestException('Declaration acceptance is required');
        }

        return Promise.resolve({ unknownContactPolicy: policy });
      },
    );
    policyServiceMock.updateOptOutInstructions.mockImplementation(
      (
        _companyId: string,
        _userId: string,
        includeOptOutInstructions: boolean,
        responsibilityAcknowledged?: boolean,
      ) => {
        if (!includeOptOutInstructions && responsibilityAcknowledged !== true) {
          throw new BadRequestException(
            'Responsibility acknowledgement is required',
          );
        }

        return Promise.resolve({ includeOptOutInstructions });
      },
    );
  });

  afterAll(async () => {
    await app.close();
  });

  const patchPolicy = (body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .patch('/company/messaging-policy/unknown-contacts')
      .send(body);
  const patchOptOutInstructions = (body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .patch('/company/messaging-policy/opt-out-instructions')
      .send(body);

  it('returns the current policy and backend declaration', async () => {
    const response = await request(app.getHttpServer())
      .get('/company/messaging-policy')
      .expect(200);

    expect(policyServiceMock.getPolicy).toHaveBeenCalledWith(
      authenticatedUser.companyId,
    );
    expect(response.body).toEqual({
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

  it('allows OWNER to disable instructions using tenant identity from JWT', async () => {
    await patchOptOutInstructions({
      includeOptOutInstructions: false,
      responsibilityAcknowledged: true,
    })
      .expect(200)
      .expect({ includeOptOutInstructions: false });

    expect(policyServiceMock.updateOptOutInstructions).toHaveBeenCalledWith(
      authenticatedUser.companyId,
      authenticatedUser.userId,
      false,
      true,
    );
  });

  it('allows MANAGER to reactivate instructions without acknowledgement', async () => {
    authenticatedUser.role = UserRole.MANAGER;

    await patchOptOutInstructions({ includeOptOutInstructions: true })
      .expect(200)
      .expect({ includeOptOutInstructions: true });
  });

  it.each([UserRole.OPERATOR, UserRole.VIEWER])(
    'blocks %s from changing opt-out instructions',
    async (role) => {
      authenticatedUser.role = role;

      await patchOptOutInstructions({ includeOptOutInstructions: true }).expect(
        403,
      );

      expect(policyServiceMock.updateOptOutInstructions).not.toHaveBeenCalled();
    },
  );

  it('rejects disabling instructions without explicit acknowledgement', async () => {
    await patchOptOutInstructions({
      includeOptOutInstructions: false,
    }).expect(400);
  });

  it.each([
    ['companyId', 'other-company'],
    ['userId', 'other-user'],
    ['role', UserRole.OWNER],
  ])('rejects client-controlled opt-out field %s', async (field, value) => {
    await patchOptOutInstructions({
      includeOptOutInstructions: false,
      responsibilityAcknowledged: true,
      [field]: value,
    }).expect(400);

    expect(policyServiceMock.updateOptOutInstructions).not.toHaveBeenCalled();
  });

  it('allows OWNER and uses companyId and userId exclusively from JWT', async () => {
    await patchPolicy({
      policy: UnknownContactPolicy.ALLOW_UNKNOWN_WITH_DECLARATION,
      declarationAccepted: true,
    })
      .expect(200)
      .expect({
        unknownContactPolicy:
          UnknownContactPolicy.ALLOW_UNKNOWN_WITH_DECLARATION,
      });

    expect(policyServiceMock.updateUnknownContactPolicy).toHaveBeenCalledWith(
      authenticatedUser.companyId,
      authenticatedUser.userId,
      UnknownContactPolicy.ALLOW_UNKNOWN_WITH_DECLARATION,
      true,
    );
  });

  it('allows MANAGER to alter the policy', async () => {
    authenticatedUser.role = UserRole.MANAGER;

    await patchPolicy({ policy: UnknownContactPolicy.BLOCK_UNKNOWN })
      .expect(200)
      .expect({ unknownContactPolicy: UnknownContactPolicy.BLOCK_UNKNOWN });

    expect(policyServiceMock.updateUnknownContactPolicy).toHaveBeenCalledWith(
      authenticatedUser.companyId,
      authenticatedUser.userId,
      UnknownContactPolicy.BLOCK_UNKNOWN,
      undefined,
    );
  });

  it.each([UserRole.OPERATOR, UserRole.VIEWER])(
    'returns 403 for %s',
    async (role) => {
      authenticatedUser.role = role;

      await patchPolicy({
        policy: UnknownContactPolicy.BLOCK_UNKNOWN,
      }).expect(403);

      expect(
        policyServiceMock.updateUnknownContactPolicy,
      ).not.toHaveBeenCalled();
    },
  );

  it.each([UserRole.PLATFORM_ADMIN, UserRole.SUPPORT])(
    'does not implicitly allow %s',
    async (role) => {
      authenticatedUser.role = role;

      await patchPolicy({
        policy: UnknownContactPolicy.BLOCK_UNKNOWN,
      }).expect(403);

      expect(
        policyServiceMock.updateUnknownContactPolicy,
      ).not.toHaveBeenCalled();
    },
  );

  it('keeps GET available to an authenticated active-company user', async () => {
    authenticatedUser.role = UserRole.VIEWER;

    await request(app.getHttpServer())
      .get('/company/messaging-policy')
      .expect(200);

    expect(policyServiceMock.getPolicy).toHaveBeenCalledWith(
      authenticatedUser.companyId,
    );
  });

  it('allows BLOCK_UNKNOWN without a declaration', async () => {
    await patchPolicy({ policy: UnknownContactPolicy.BLOCK_UNKNOWN })
      .expect(200)
      .expect({ unknownContactPolicy: UnknownContactPolicy.BLOCK_UNKNOWN });

    expect(policyServiceMock.updateUnknownContactPolicy).toHaveBeenCalledWith(
      authenticatedUser.companyId,
      authenticatedUser.userId,
      UnknownContactPolicy.BLOCK_UNKNOWN,
      undefined,
    );
  });

  it('rejects ALLOW without declarationAccepted=true', async () => {
    await patchPolicy({
      policy: UnknownContactPolicy.ALLOW_UNKNOWN_WITH_DECLARATION,
    }).expect(400);
  });

  it.each([
    ['companyId', 'other-company'],
    ['userId', 'other-user'],
    ['acceptedAt', '2026-08-11T15:00:00.000Z'],
    ['declarationVersion', 'client-version'],
    ['declarationTextSnapshot', 'client declaration'],
    ['role', UserRole.OWNER],
  ])('rejects client-controlled field %s', async (field, value) => {
    await patchPolicy({
      policy: UnknownContactPolicy.BLOCK_UNKNOWN,
      [field]: value,
    }).expect(400);

    expect(policyServiceMock.updateUnknownContactPolicy).not.toHaveBeenCalled();
  });

  it('rejects invalid policy and declarationAccepted types', async () => {
    await patchPolicy({
      policy: 'ALLOW_UNKNOWN',
      declarationAccepted: true,
    }).expect(400);
    await patchPolicy({
      policy: UnknownContactPolicy.ALLOW_UNKNOWN_WITH_DECLARATION,
      declarationAccepted: 'true',
    }).expect(400);
  });

  it('returns only the current policy after an update', async () => {
    const response = await patchPolicy({
      policy: UnknownContactPolicy.BLOCK_UNKNOWN,
    }).expect(200);

    expect(Object.keys(response.body)).toEqual(['unknownContactPolicy']);
    expect(response.body).not.toHaveProperty('acceptances');
    expect(response.body).not.toHaveProperty('companyId');
    expect(response.body).not.toHaveProperty('userId');
  });
});
