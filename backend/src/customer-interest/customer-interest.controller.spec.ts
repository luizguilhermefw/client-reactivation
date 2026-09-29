import {
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { CustomerInterestType, UserRole } from '@prisma/client';
import request from 'supertest';
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

  it('applies the three required guards at controller scope', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, CustomerInterestController),
    ).toEqual([JwtAuthGuard, CompanyActiveGuard, ExactRolesGuard]);
  });

  it('creates using companyId exclusively from JWT', async () => {
    await request(app.getHttpServer())
      .post('/customer-interests/options')
      .send({ type: CustomerInterestType.BRAND, name: 'Apple' })
      .expect(201);

    expect(serviceMock.create).toHaveBeenCalledWith(
      authenticatedUser.companyId,
      CustomerInterestType.BRAND,
      'Apple',
    );
  });

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

  it('updates name and status using the JWT tenant', async () => {
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
  });

  it.each([UserRole.OPERATOR, UserRole.VIEWER])(
    'blocks %s from every administrative catalog endpoint',
    async (role) => {
      authenticatedUser.role = role;

      await request(app.getHttpServer())
        .post('/customer-interests/options')
        .send({ type: CustomerInterestType.BRAND, name: 'Apple' })
        .expect(403);
      await request(app.getHttpServer())
        .get('/customer-interests/options')
        .expect(403);
      await request(app.getHttpServer())
        .put(`/customer-interests/options/${optionId}`)
        .send({ name: 'Apple' })
        .expect(403);
      await request(app.getHttpServer())
        .patch(`/customer-interests/options/${optionId}/status`)
        .send({ active: false })
        .expect(403);
    },
  );
});
