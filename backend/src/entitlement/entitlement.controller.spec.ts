import {
  ExecutionContext,
  INestApplication,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import {
  EntitlementFeature,
  EntitlementSource,
  UserRole,
} from '@prisma/client';
import request from 'supertest';
import { CompanyActiveGuard } from '../auth/guards/company-active.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { RequestWithUser } from '../auth/types/request-with-user';
import { AdminEntitlementController } from './admin-entitlement.controller';
import { CompanyEntitlementController } from './company-entitlement.controller';
import { EntitlementService } from './entitlement.service';

describe('Entitlement controllers HTTP', () => {
  const authenticatedUser: RequestWithUser['user'] = {
    userId: 'platform-admin-1',
    name: 'Platform Admin',
    email: 'admin@example.test',
    companyId: 'platform-company-context',
    role: UserRole.PLATFORM_ADMIN,
  };
  const entitlementServiceMock = {
    getLimit: jest.fn(),
    setManualLimit: jest.fn(),
  };
  let app: INestApplication;

  beforeAll(async () => {
    const jwtGuard = {
      canActivate: (context: ExecutionContext) => {
        context.switchToHttp().getRequest<RequestWithUser>().user =
          authenticatedUser;
        return true;
      },
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminEntitlementController, CompanyEntitlementController],
      providers: [
        RolesGuard,
        { provide: EntitlementService, useValue: entitlementServiceMock },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(jwtGuard)
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
    authenticatedUser.role = UserRole.PLATFORM_ADMIN;
    authenticatedUser.companyId = 'platform-company-context';
    entitlementServiceMock.getLimit.mockResolvedValue(0);
    entitlementServiceMock.setManualLimit.mockResolvedValue({
      feature: EntitlementFeature.WHATSAPP_CHANNELS,
      limit: 2,
      source: EntitlementSource.MANUAL,
      externalReference: null,
      companyId: 'target-company',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const patchAdminLimit = (body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .patch('/admin/company/target-company/entitlements/whatsapp-channels')
      .send(body);

  it('PLATFORM_ADMIN define WHATSAPP_CHANNELS como MANUAL', async () => {
    await patchAdminLimit({ limit: 2 }).expect(200).expect({
      feature: EntitlementFeature.WHATSAPP_CHANNELS,
      limit: 2,
      source: EntitlementSource.MANUAL,
    });

    expect(entitlementServiceMock.setManualLimit).toHaveBeenCalledWith(
      'target-company',
      EntitlementFeature.WHATSAPP_CHANNELS,
      2,
    );
  });

  it('não concede acesso administrativo a roles de tenant', async () => {
    authenticatedUser.role = UserRole.OWNER;

    await patchAdminLimit({ limit: 2 }).expect(403);
    expect(entitlementServiceMock.setManualLimit).not.toHaveBeenCalled();
  });

  it.each([
    ['companyId', 'other-company'],
    ['feature', EntitlementFeature.WHATSAPP_CHANNELS],
    ['source', EntitlementSource.BILLING],
  ])(
    'rejeita campo administrativo controlado pelo cliente: %s',
    async (field, value) => {
      await patchAdminLimit({ limit: 2, [field]: value }).expect(400);
      expect(entitlementServiceMock.setManualLimit).not.toHaveBeenCalled();
    },
  );

  it.each([-1, 1.5, '2'])('rejeita limit inválido: %s', async (limit) => {
    await patchAdminLimit({ limit }).expect(400);
    expect(entitlementServiceMock.setManualLimit).not.toHaveBeenCalled();
  });

  it('retorna 404 quando a empresa não existe', async () => {
    entitlementServiceMock.setManualLimit.mockRejectedValue(
      new NotFoundException('Company not found'),
    );

    await patchAdminLimit({ limit: 1 }).expect(404);
  });

  it('GET usa exclusivamente companyId do JWT e retorna zero fail-closed', async () => {
    authenticatedUser.role = UserRole.VIEWER;
    authenticatedUser.companyId = 'company-from-jwt';

    await request(app.getHttpServer())
      .get('/company/entitlements?companyId=other-company')
      .expect(200)
      .expect({ whatsappChannels: { limit: 0 } });

    expect(entitlementServiceMock.getLimit).toHaveBeenCalledWith(
      'company-from-jwt',
      EntitlementFeature.WHATSAPP_CHANNELS,
    );
  });

  it('GET não expõe source, referência externa ou companyId', async () => {
    authenticatedUser.role = UserRole.OPERATOR;
    authenticatedUser.companyId = 'company-a';
    entitlementServiceMock.getLimit.mockResolvedValue(3);

    const response = await request(app.getHttpServer())
      .get('/company/entitlements')
      .expect(200);

    expect(response.body).toEqual({ whatsappChannels: { limit: 3 } });
    expect(response.body).not.toHaveProperty('source');
    expect(response.body).not.toHaveProperty('externalReference');
    expect(response.body).not.toHaveProperty('companyId');
  });

  it('mantém JwtAuthGuard e CompanyActiveGuard no endpoint da Company', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      CompanyEntitlementController.prototype.getEntitlements,
    );

    expect(guards).toEqual([JwtAuthGuard, CompanyActiveGuard]);
  });
});
