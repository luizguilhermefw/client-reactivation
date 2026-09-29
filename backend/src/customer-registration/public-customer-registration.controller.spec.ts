import { INestApplication } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PublicCustomerRegistrationController } from './public-customer-registration.controller';
import { PublicCustomerRegistrationService } from './public-customer-registration.service';

describe('PublicCustomerRegistrationController HTTP', () => {
  const serviceMock = { getBootstrap: jest.fn() };
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [PublicCustomerRegistrationController],
      providers: [
        { provide: PublicCustomerRegistrationService, useValue: serviceMock },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    serviceMock.getBootstrap.mockResolvedValue({
      company: { displayName: 'Outlet Cascavel' },
      interests: { categories: [], brands: [] },
    });
  });

  afterAll(async () => app.close());

  it('has no authentication guards and works without a JWT', async () => {
    expect(
      Reflect.getMetadata(
        GUARDS_METADATA,
        PublicCustomerRegistrationController,
      ),
    ).toBeUndefined();

    await request(app.getHttpServer())
      .get('/public/customer-registration/opaque-public-id')
      .expect(200)
      .expect({
        company: { displayName: 'Outlet Cascavel' },
        interests: { categories: [], brands: [] },
      });

    expect(serviceMock.getBootstrap).toHaveBeenCalledWith('opaque-public-id');
  });

  it('does not pass query-controlled companyId to the service', async () => {
    await request(app.getHttpServer())
      .get(
        '/public/customer-registration/opaque-public-id?companyId=attacker-company',
      )
      .expect(200);

    expect(serviceMock.getBootstrap).toHaveBeenCalledWith('opaque-public-id');
  });
});
