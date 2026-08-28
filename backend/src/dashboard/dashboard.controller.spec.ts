import {
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { AutomationType, UserRole } from '@prisma/client';
import request from 'supertest';
import { CompanyActiveGuard } from '../auth/guards/company-active.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { RequestWithUser } from '../auth/types/request-with-user';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

describe('DashboardController HTTP', () => {
  const authenticatedUser: RequestWithUser['user'] = {
    userId: 'user-1',
    name: 'Owner',
    email: 'owner@example.test',
    companyId: 'company-from-jwt',
    role: UserRole.OWNER,
  };
  const serviceMock = { getSummary: jest.fn() };
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
      controllers: [DashboardController],
      providers: [{ provide: DashboardService, useValue: serviceMock }],
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
    serviceMock.getSummary.mockResolvedValue({
      activeAutomations: 2,
      contacts: 10,
      messagesSent: 8,
      campaigns: 3,
      recentAutomations: [
        {
          id: 'automation-1',
          name: 'Reativação',
          type: AutomationType.REACTIVATION,
          isActive: true,
          createdAt: new Date('2026-08-28T12:00:00.000Z'),
        },
      ],
    });
  });

  afterAll(async () => app.close());

  it('uses JwtAuthGuard and CompanyActiveGuard', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      DashboardController,
    ) as unknown[];

    expect(guards).toEqual([JwtAuthGuard, CompanyActiveGuard]);
  });

  it('returns summary using companyId exclusively from JWT', async () => {
    const response = await request(app.getHttpServer())
      .get('/dashboard/summary')
      .expect(200);

    expect(serviceMock.getSummary).toHaveBeenCalledWith('company-from-jwt');
    expect(response.body).toEqual({
      activeAutomations: 2,
      contacts: 10,
      messagesSent: 8,
      campaigns: 3,
      recentAutomations: [
        {
          id: 'automation-1',
          name: 'Reativação',
          type: 'REACTIVATION',
          isActive: true,
          createdAt: '2026-08-28T12:00:00.000Z',
        },
      ],
    });
    expect(JSON.stringify(response.body)).not.toMatch(
      /phone|recipientPhone|content|"message"|provider|companyId/i,
    );
  });

  it('does not allow query, body or params to control companyId', async () => {
    await request(app.getHttpServer())
      .get('/dashboard/summary?companyId=other-company')
      .send({ companyId: 'body-company' })
      .expect(200);
    await request(app.getHttpServer())
      .get('/dashboard/summary/other-company')
      .expect(404);

    expect(serviceMock.getSummary).toHaveBeenCalledTimes(1);
    expect(serviceMock.getSummary).toHaveBeenCalledWith('company-from-jwt');
  });
});
