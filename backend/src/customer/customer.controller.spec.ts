import {
  ExecutionContext,
  INestApplication,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { CustomerContactConsentStatus, UserRole } from '@prisma/client';
import request from 'supertest';
import { CompanyActiveGuard } from '../auth/guards/company-active.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { RequestWithUser } from '../auth/types/request-with-user';
import { CustomerConsentService } from './customer-consent.service';
import { CustomerController } from './customer.controller';
import { CustomerService } from './customer.service';

describe('CustomerController contact consent HTTP', () => {
  const authenticatedUser: RequestWithUser['user'] = {
    userId: 'user-1',
    name: 'Owner',
    email: 'owner@example.test',
    companyId: 'company-from-jwt',
    role: UserRole.OWNER,
  };
  const customerId = 'customer-1';
  const consentGrantedAt = '2026-08-01T12:00:00.000Z';
  const optedOutAt = '2026-08-10T15:00:00.000Z';
  const customerConsentServiceMock = {
    updateConsent: jest.fn(),
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
      controllers: [CustomerController],
      providers: [
        { provide: CustomerService, useValue: {} },
        {
          provide: CustomerConsentService,
          useValue: customerConsentServiceMock,
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
    customerConsentServiceMock.updateConsent.mockResolvedValue({
      id: customerId,
      contactConsentStatus: CustomerContactConsentStatus.OPTED_OUT,
      consentGrantedAt,
      optedOutAt,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const updateConsent = (body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .patch(`/customer/${customerId}/contact-consent`)
      .send(body);

  it('uses the existing authentication and active-company guards', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      CustomerController,
    ) as unknown[];

    expect(guards).toEqual([JwtAuthGuard, CompanyActiveGuard]);
  });

  it('updates consent through the authenticated PATCH using companyId from JWT', async () => {
    const response = await updateConsent({ status: 'OPTED_OUT' }).expect(200);

    expect(customerConsentServiceMock.updateConsent).toHaveBeenCalledWith(
      authenticatedUser.companyId,
      customerId,
      CustomerContactConsentStatus.OPTED_OUT,
    );
    expect(response.body).toEqual({
      id: customerId,
      contactConsentStatus: CustomerContactConsentStatus.OPTED_OUT,
      consentGrantedAt,
      optedOutAt,
    });
  });

  it('rejects companyId in the request body', async () => {
    await updateConsent({
      status: 'GRANTED',
      companyId: 'attacker-company',
    }).expect(400);

    expect(customerConsentServiceMock.updateConsent).not.toHaveBeenCalled();
  });

  it.each(['UNKNOWN', 'INVALID'])('rejects status %s', async (status) => {
    await updateConsent({ status }).expect(400);

    expect(customerConsentServiceMock.updateConsent).not.toHaveBeenCalled();
  });

  it('rejects additional fields', async () => {
    await updateConsent({ status: 'GRANTED', consentGrantedAt }).expect(400);

    expect(customerConsentServiceMock.updateConsent).not.toHaveBeenCalled();
  });

  it('returns 404 without exposing a cross-tenant customer', async () => {
    customerConsentServiceMock.updateConsent.mockRejectedValue(
      new NotFoundException('Customer not found'),
    );

    await updateConsent({ status: 'OPTED_OUT' }).expect(404);
  });

  it('returns only the safe consent response fields', async () => {
    const response = await updateConsent({ status: 'OPTED_OUT' }).expect(200);

    expect(Object.keys(response.body).sort()).toEqual(
      ['id', 'contactConsentStatus', 'consentGrantedAt', 'optedOutAt'].sort(),
    );
    expect(response.body).not.toHaveProperty('companyId');
    expect(response.body).not.toHaveProperty('name');
    expect(response.body).not.toHaveProperty('phone');
  });
});
