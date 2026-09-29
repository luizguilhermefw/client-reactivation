import {
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import request from 'supertest';
import { CompanyActiveGuard } from '../auth/guards/company-active.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { RequestWithUser } from '../auth/types/request-with-user';
import { CustomerInterestAssignmentController } from './customer-interest-assignment.controller';
import { CustomerInterestAssignmentService } from './customer-interest-assignment.service';

describe('CustomerInterestAssignmentController HTTP', () => {
  const customerId = '8156cf3a-4baa-4680-843f-f901297940f2';
  const optionId = '3f785c9c-f130-4dc0-8a9e-150ab54d821f';
  const authenticatedUser: RequestWithUser['user'] = {
    userId: 'user-1',
    name: 'Operator',
    email: 'operator@example.test',
    companyId: 'company-from-jwt',
    role: UserRole.OPERATOR,
  };
  const serviceMock = { get: jest.fn(), update: jest.fn() };
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
      controllers: [CustomerInterestAssignmentController],
      providers: [
        { provide: CustomerInterestAssignmentService, useValue: serviceMock },
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
    serviceMock.get.mockResolvedValue({ categories: [], brands: [] });
    serviceMock.update.mockResolvedValue({ categories: [], brands: [] });
  });

  afterAll(async () => app.close());

  it('uses the same authentication guards as regular Customer CRUD', () => {
    expect(
      Reflect.getMetadata(
        GUARDS_METADATA,
        CustomerInterestAssignmentController,
      ),
    ).toEqual([JwtAuthGuard, CompanyActiveGuard]);
  });

  it('gets assignments using customerId and companyId from JWT', async () => {
    await request(app.getHttpServer())
      .get(`/customer/${customerId}/interests`)
      .expect(200);

    expect(serviceMock.get).toHaveBeenCalledWith(
      authenticatedUser.companyId,
      customerId,
    );
  });

  it('fully replaces assignments using the JWT tenant', async () => {
    await request(app.getHttpServer())
      .put(`/customer/${customerId}/interests`)
      .send({ interestOptionIds: [optionId] })
      .expect(200);

    expect(serviceMock.update).toHaveBeenCalledWith(
      authenticatedUser.companyId,
      customerId,
      [optionId],
    );
  });

  it('rejects client-controlled companyId and malformed customer IDs', async () => {
    await request(app.getHttpServer())
      .put(`/customer/${customerId}/interests`)
      .send({ interestOptionIds: [], companyId: 'attacker-company' })
      .expect(400);
    await request(app.getHttpServer())
      .get('/customer/not-a-uuid/interests')
      .expect(400);

    expect(serviceMock.update).not.toHaveBeenCalled();
    expect(serviceMock.get).not.toHaveBeenCalled();
  });
});
