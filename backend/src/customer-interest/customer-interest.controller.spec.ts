import {
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { CustomerInterestType, UserRole } from '@prisma/client';
import request from 'supertest';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { CompanyActiveGuard } from '../auth/guards/company-active.guard';
import { ExactRolesGuard } from '../auth/guards/exact-roles.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { RequestWithUser } from '../auth/types/request-with-user';
import { CustomerInterestOptionService } from './customer-interest-option.service';
import { CustomerInterestController } from './customer-interest.controller';

describe('CustomerInterestController HTTP', () => {
  const optionId = '8156cf3a-4baa-4680-843f-f901297940f2';
  const authenticatedUser: RequestWithUser['user'] = {
    userId: 'user-1',
    name: 'Owner',
    email: 'owner@example.test',
    companyId: 'company-from-jwt',
    role: UserRole.OWNER,
  };
  const serviceMock = {
    create: jest.fn(),
    list: jest.fn(),
    updateName: jest.fn(),
    updateStatus: jest.fn(),
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
      controllers: [CustomerInterestController],
      providers: [
        ExactRolesGuard,
        { provide: CustomerInterestOptionService, useValue: serviceMock },
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
    serviceMock.create.mockResolvedValue({ id: optionId });
    serviceMock.list.mockResolvedValue([]);
    serviceMock.updateName.mockResolvedValue({ id: optionId });
    serviceMock.updateStatus.mockResolvedValue({ id: optionId });
  });

  afterAll(async () => app.close());

  it('requires authentication and active company without role restriction for GET', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, CustomerInterestController),
    ).toEqual([JwtAuthGuard, CompanyActiveGuard]);
    expect(
      Reflect.getMetadata(ROLES_KEY, CustomerInterestController),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(
        GUARDS_METADATA,
        CustomerInterestController.prototype.list,
      ),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(ROLES_KEY, CustomerInterestController.prototype.list),
    ).toBeUndefined();
  });

  it.each(['create', 'updateName', 'updateStatus'] as const)(
    'restricts %s to exact administrative roles',
    (method) => {
      const handler = CustomerInterestController.prototype[method];
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([
        ExactRolesGuard,
      ]);
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([
        UserRole.OWNER,
        UserRole.MANAGER,
      ]);
    },
  );

  it.each(Object.values(UserRole))(
    'allows %s to read its own tenant catalog',
    async (role) => {
      authenticatedUser.role = role;
      const options = [
        {
          id: optionId,
          type: CustomerInterestType.CATEGORY,
          name: 'Categoria',
          active: false,
          createdAt: '2026-10-01T00:00:00.000Z',
          updatedAt: '2026-10-01T00:00:00.000Z',
        },
      ];
      serviceMock.list.mockResolvedValue(options);
      await request(app.getHttpServer())
        .get('/customer-interests/options')
        .set('companyId', 'attacker-company')
        .expect(200)
        .expect(options);
      expect(serviceMock.list).toHaveBeenCalledWith(
        authenticatedUser.companyId,
        {},
      );
    },
  );

  it.each([
    [CustomerInterestType.CATEGORY, true],
    [CustomerInterestType.BRAND, false],
  ])('preserves type %s and active %s filters', async (type, active) => {
    await request(app.getHttpServer())
      .get(`/customer-interests/options?type=${type}&active=${active}`)
      .expect(200);
    expect(serviceMock.list).toHaveBeenCalledWith(authenticatedUser.companyId, {
      type,
      active,
    });
  });

  it.each(['companyId', 'tenantId'])(
    'rejects client-controlled %s query',
    async (field) => {
      await request(app.getHttpServer())
        .get(`/customer-interests/options?${field}=attacker-company`)
        .expect(400);
      expect(serviceMock.list).not.toHaveBeenCalled();
    },
  );

  it.each([UserRole.OWNER, UserRole.MANAGER])(
    'allows %s to create using companyId exclusively from JWT',
    async (role) => {
      authenticatedUser.role = role;
      await request(app.getHttpServer())
        .post('/customer-interests/options')
        .send({ type: CustomerInterestType.BRAND, name: 'Apple' })
        .expect(201);

      expect(serviceMock.create).toHaveBeenCalledWith(
        authenticatedUser.companyId,
        CustomerInterestType.BRAND,
        'Apple',
      );
    },
  );

  it('rejects client-controlled companyId', async () => {
    await request(app.getHttpServer())
      .post('/customer-interests/options')
      .send({
        type: CustomerInterestType.BRAND,
        name: 'Apple',
        companyId: 'attacker-company',
      })
      .expect(400);
    expect(serviceMock.create).not.toHaveBeenCalled();
  });

  it('allows MANAGER to list normalized filters in its own tenant', async () => {
    authenticatedUser.role = UserRole.MANAGER;
    await request(app.getHttpServer())
      .get('/customer-interests/options?type=CATEGORY&active=false')
      .expect(200);

    expect(serviceMock.list).toHaveBeenCalledWith(authenticatedUser.companyId, {
      type: CustomerInterestType.CATEGORY,
      active: false,
    });
  });

  it.each([UserRole.OWNER, UserRole.MANAGER])(
    'allows %s to update name and status using the JWT tenant',
    async (role) => {
      authenticatedUser.role = role;
      await request(app.getHttpServer())
        .put(`/customer-interests/options/${optionId}`)
        .send({ name: 'New Balance' })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/customer-interests/options/${optionId}/status`)
        .send({ active: false })
        .expect(200);

      expect(serviceMock.updateName).toHaveBeenCalledWith(
        authenticatedUser.companyId,
        optionId,
        'New Balance',
      );
      expect(serviceMock.updateStatus).toHaveBeenCalledWith(
        authenticatedUser.companyId,
        optionId,
        false,
      );
    },
  );

  it('rejects client-controlled companyId in both update bodies', async () => {
    await request(app.getHttpServer())
      .put(`/customer-interests/options/${optionId}`)
      .send({ name: 'Apple', companyId: 'attacker-company' })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/customer-interests/options/${optionId}/status`)
      .send({ active: false, companyId: 'attacker-company' })
      .expect(400);
    expect(serviceMock.updateName).not.toHaveBeenCalled();
    expect(serviceMock.updateStatus).not.toHaveBeenCalled();
  });

  it.each([
    UserRole.OPERATOR,
    UserRole.VIEWER,
    UserRole.SUPPORT,
    UserRole.PLATFORM_ADMIN,
  ])('blocks %s from every administrative catalog endpoint', async (role) => {
    authenticatedUser.role = role;

    await request(app.getHttpServer())
      .post('/customer-interests/options')
      .send({ type: CustomerInterestType.BRAND, name: 'Apple' })
      .expect(403);
    await request(app.getHttpServer())
      .put(`/customer-interests/options/${optionId}`)
      .send({ name: 'Apple' })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/customer-interests/options/${optionId}/status`)
      .send({ active: false })
      .expect(403);
    expect(serviceMock.create).not.toHaveBeenCalled();
    expect(serviceMock.updateName).not.toHaveBeenCalled();
    expect(serviceMock.updateStatus).not.toHaveBeenCalled();
  });
});
