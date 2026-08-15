import {
  ExecutionContext,
  HttpStatus,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import request from 'supertest';
import { CompanyActiveGuard } from '../auth/guards/company-active.guard';
import { ExactRolesGuard } from '../auth/guards/exact-roles.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { RequestWithUser } from '../auth/types/request-with-user';
import { EvolutionWebhookProvisioningController } from './evolution-webhook-provisioning.controller';
import {
  EVOLUTION_MESSAGES_UPSERT_EVENT,
  EvolutionWebhookProvisioningService,
} from './evolution-webhook-provisioning.service';

describe('EvolutionWebhookProvisioningController HTTP', () => {
  const authenticatedUser: RequestWithUser['user'] = {
    userId: 'platform-admin-1',
    name: 'Platform Admin',
    email: 'platform-admin@example.test',
    companyId: 'company-from-jwt',
    role: UserRole.PLATFORM_ADMIN,
  };
  const provisioningServiceMock = {
    ensureConfigured: jest.fn(),
  };
  let app: INestApplication;
  let authenticated = true;

  beforeAll(async () => {
    const jwtGuard = {
      canActivate: (context: ExecutionContext) => {
        if (!authenticated) {
          throw new UnauthorizedException();
        }
        context.switchToHttp().getRequest<RequestWithUser>().user =
          authenticatedUser;
        return true;
      },
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [EvolutionWebhookProvisioningController],
      providers: [
        ExactRolesGuard,
        {
          provide: EvolutionWebhookProvisioningService,
          useValue: provisioningServiceMock,
        },
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
    authenticated = true;
    authenticatedUser.role = UserRole.PLATFORM_ADMIN;
    provisioningServiceMock.ensureConfigured.mockResolvedValue({
      instanceName: 'instance-1',
      configured: true,
      changed: false,
      url: 'https://backend.example.test/webhooks/evolution/messages',
      events: [EVOLUTION_MESSAGES_UPSERT_EVENT],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const ensureWebhook = (body: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .post('/company/evolution/webhook/ensure')
      .send(body);

  it('exige JWT', async () => {
    authenticated = false;
    await ensureWebhook().expect(HttpStatus.UNAUTHORIZED);
    expect(provisioningServiceMock.ensureConfigured).not.toHaveBeenCalled();
  });

  it('permite somente PLATFORM_ADMIN e usa companyId exclusivamente do JWT', async () => {
    const response = await ensureWebhook().expect(HttpStatus.OK);

    expect(provisioningServiceMock.ensureConfigured).toHaveBeenCalledWith(
      authenticatedUser.companyId,
    );
    expect(response.body).toEqual({
      instanceName: 'instance-1',
      configured: true,
      changed: false,
      url: 'https://backend.example.test/webhooks/evolution/messages',
      events: [EVOLUTION_MESSAGES_UPSERT_EVENT],
    });
  });

  it.each([
    UserRole.OWNER,
    UserRole.MANAGER,
    UserRole.OPERATOR,
    UserRole.VIEWER,
    UserRole.SUPPORT,
  ])('retorna 403 para role %s', async (role) => {
    authenticatedUser.role = role;
    await ensureWebhook().expect(HttpStatus.FORBIDDEN);
    expect(provisioningServiceMock.ensureConfigured).not.toHaveBeenCalled();
  });

  it.each([
    ['apiKey', 'client-api-key'],
    ['secret', 'client-secret'],
    ['instanceName', 'client-instance'],
    ['url', 'https://client.example.test/webhook'],
    ['companyId', 'other-company'],
  ])('rejeita campo controlado pelo cliente: %s', async (field, value) => {
    await ensureWebhook({ [field]: value }).expect(HttpStatus.BAD_REQUEST);
    expect(provisioningServiceMock.ensureConfigured).not.toHaveBeenCalled();
  });

  it('não retorna headers, API key ou webhook secret', async () => {
    const response = await ensureWebhook().expect(HttpStatus.OK);
    expect(response.body).not.toHaveProperty('headers');
    expect(response.body).not.toHaveProperty('apiKey');
    expect(JSON.stringify(response.body)).not.toMatch(/secret|private-api-key/i);
  });
});
