import {
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import request from 'supertest';
import { CompanyActiveGuard } from '../auth/guards/company-active.guard';
import { ExactRolesGuard } from '../auth/guards/exact-roles.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { RequestWithUser } from '../auth/types/request-with-user';
import { CustomerRegistrationLinkController } from './customer-registration-link.controller';
import { CustomerRegistrationLinkService } from './customer-registration-link.service';
import { CustomerRegistrationQrCodeService } from './customer-registration-qr-code.service';

describe('CustomerRegistrationLinkController HTTP', () => {
  const authenticatedUser: RequestWithUser['user'] = {
    userId: 'user-1',
    name: 'Owner',
    email: 'owner@example.test',
    companyId: 'company-from-jwt',
    role: UserRole.OWNER,
  };
  const response = {
    publicId: 'opaque-public-id',
    active: true,
    publicPath: '/register/opaque-public-id',
    createdAt: new Date('2026-09-29T12:00:00.000Z'),
    updatedAt: new Date('2026-09-29T12:00:00.000Z'),
  };
  const serviceMock = {
    get: jest.fn(),
    create: jest.fn(),
    rotate: jest.fn(),
    updateStatus: jest.fn(),
  };
  const qrCodeServiceMock = {
    generate: jest.fn(),
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
      controllers: [CustomerRegistrationLinkController],
      providers: [
        ExactRolesGuard,
        { provide: CustomerRegistrationLinkService, useValue: serviceMock },
        {
          provide: CustomerRegistrationQrCodeService,
          useValue: qrCodeServiceMock,
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
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    authenticatedUser.role = UserRole.OWNER;
    serviceMock.get.mockResolvedValue(response);
    serviceMock.create.mockResolvedValue(response);
    serviceMock.rotate.mockResolvedValue({
      ...response,
      publicId: 'rotated-id',
      publicPath: '/register/rotated-id',
    });
    serviceMock.updateStatus.mockImplementation(
      (_companyId: string, active: boolean) =>
        Promise.resolve({ ...response, active }),
    );
    qrCodeServiceMock.generate.mockResolvedValue({
      publicUrl: 'https://public.example.test/register/opaque-public-id',
      qrCodeDataUrl: 'data:image/png;base64,generated',
    });
  });

  afterAll(async () => app.close());

  it('applies authentication, active-company and exact-role guards', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, CustomerRegistrationLinkController),
    ).toEqual([JwtAuthGuard, CompanyActiveGuard, ExactRolesGuard]);
  });

  it.each([UserRole.OWNER, UserRole.MANAGER])(
    'allows %s to create using companyId exclusively from JWT',
    async (role) => {
      authenticatedUser.role = role;

      await request(app.getHttpServer())
        .post('/customer-registration-link')
        .send({})
        .expect(201);

      expect(serviceMock.create).toHaveBeenCalledWith(
        authenticatedUser.companyId,
      );
    },
  );

  it.each([
    UserRole.OPERATOR,
    UserRole.VIEWER,
    UserRole.PLATFORM_ADMIN,
    UserRole.SUPPORT,
  ])('blocks %s from managing the link', async (role) => {
    authenticatedUser.role = role;

    await request(app.getHttpServer())
      .post('/customer-registration-link')
      .send({})
      .expect(403);
    await request(app.getHttpServer())
      .post('/customer-registration-link/rotate')
      .send({})
      .expect(403);
    await request(app.getHttpServer())
      .patch('/customer-registration-link/status')
      .send({ active: false })
      .expect(403);
    await request(app.getHttpServer())
      .get('/customer-registration-link/qr-code')
      .expect(403);
  });

  it('gets only the service response for the JWT tenant', async () => {
    const result = await request(app.getHttpServer())
      .get('/customer-registration-link')
      .expect(200);

    expect(serviceMock.get).toHaveBeenCalledWith(authenticatedUser.companyId);
    expect(result.body).not.toHaveProperty('companyId');
  });

  it.each([UserRole.OWNER, UserRole.MANAGER])(
    'allows %s to generate QR code using only the JWT tenant',
    async (role) => {
      authenticatedUser.role = role;

      const result = await request(app.getHttpServer())
        .get(
          '/customer-registration-link/qr-code?companyId=attacker-company&publicId=attacker-id',
        )
        .set('Host', 'evil.example')
        .set('X-Forwarded-Host', 'evil-forwarded.example')
        .set('Origin', 'https://evil-origin.example')
        .expect(200);

      expect(qrCodeServiceMock.generate).toHaveBeenCalledWith(
        authenticatedUser.companyId,
      );
      expect(result.body).toEqual({
        publicUrl: 'https://public.example.test/register/opaque-public-id',
        qrCodeDataUrl: 'data:image/png;base64,generated',
      });
      expect(result.text).not.toContain('evil');
    },
  );

  it('rotates only the JWT tenant link', async () => {
    await request(app.getHttpServer())
      .post('/customer-registration-link/rotate')
      .send({})
      .expect(201);

    expect(serviceMock.rotate).toHaveBeenCalledWith(
      authenticatedUser.companyId,
    );
  });

  it.each([true, false])('updates status to %s', async (active) => {
    await request(app.getHttpServer())
      .patch('/customer-registration-link/status')
      .send({ active })
      .expect(200);

    expect(serviceMock.updateStatus).toHaveBeenCalledWith(
      authenticatedUser.companyId,
      active,
    );
  });

  it('rejects missing, invalid and extra status fields', async () => {
    await request(app.getHttpServer())
      .patch('/customer-registration-link/status')
      .send({})
      .expect(400);
    await request(app.getHttpServer())
      .patch('/customer-registration-link/status')
      .send({ active: 'false' })
      .expect(400);
    await request(app.getHttpServer())
      .patch('/customer-registration-link/status')
      .send({ active: false, companyId: 'attacker-company' })
      .expect(400);

    expect(serviceMock.updateStatus).not.toHaveBeenCalled();
  });

  it('rejects client-controlled fields during create and rotate', async () => {
    await request(app.getHttpServer())
      .post('/customer-registration-link')
      .send({ companyId: 'attacker-company' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/customer-registration-link/rotate')
      .send({ publicId: 'attacker-public-id' })
      .expect(400);

    expect(serviceMock.create).not.toHaveBeenCalled();
    expect(serviceMock.rotate).not.toHaveBeenCalled();
  });
});

describe('CustomerRegistrationLinkController unauthenticated HTTP', () => {
  it('blocks QR code generation without a JWT', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CustomerRegistrationLinkController],
      providers: [
        ExactRolesGuard,
        { provide: CustomerRegistrationLinkService, useValue: {} },
        { provide: CustomerRegistrationQrCodeService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: () => {
          throw new UnauthorizedException();
        },
      })
      .overrideGuard(CompanyActiveGuard)
      .useValue({ canActivate: () => true })
      .compile();
    const unauthenticatedApp = moduleRef.createNestApplication();
    await unauthenticatedApp.init();

    await request(unauthenticatedApp.getHttpServer())
      .get('/customer-registration-link/qr-code')
      .expect(401);

    await unauthenticatedApp.close();
  });
});
