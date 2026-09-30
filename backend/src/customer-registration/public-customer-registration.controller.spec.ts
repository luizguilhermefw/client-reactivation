import { INestApplication, ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule, minutes } from '@nestjs/throttler';
import request from 'supertest';
import { PublicCustomerRegistrationController } from './public-customer-registration.controller';
import { PublicCustomerRegistrationService } from './public-customer-registration.service';

describe('PublicCustomerRegistrationController HTTP', () => {
  const publicId = 'A'.repeat(43);
  const serviceMock = { getBootstrap: jest.fn(), submit: jest.fn() };
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot([
          { name: 'default', ttl: minutes(10), limit: 5 },
        ]),
      ],
      controllers: [PublicCustomerRegistrationController],
      providers: [
        { provide: PublicCustomerRegistrationService, useValue: serviceMock },
      ],
    }).compile();

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
    serviceMock.getBootstrap.mockResolvedValue({
      company: { displayName: 'Outlet Cascavel' },
      interests: { categories: [], brands: [] },
    });
    serviceMock.submit.mockResolvedValue({
      success: true,
      message: 'Cadastro realizado com sucesso.',
    });
  });

  afterAll(async () => app.close());

  it('uses only the public throttler guard and works without a JWT', async () => {
    expect(
      Reflect.getMetadata(
        GUARDS_METADATA,
        PublicCustomerRegistrationController,
      ),
    ).toEqual([ThrottlerGuard]);

    await request(app.getHttpServer())
      .get(`/public/customer-registration/${publicId}`)
      .expect(200)
      .expect({
        company: { displayName: 'Outlet Cascavel' },
        interests: { categories: [], brands: [] },
      });

    expect(serviceMock.getBootstrap).toHaveBeenCalledWith(publicId);
  });

  it('does not pass query-controlled companyId to the service', async () => {
    await request(app.getHttpServer())
      .get(
        `/public/customer-registration/${publicId}?companyId=attacker-company`,
      )
      .expect(200);

    expect(serviceMock.getBootstrap).toHaveBeenCalledWith(publicId);
  });

  it('submits without JWT and returns only the minimal public response', async () => {
    const payload = {
      name: 'Maria',
      phone: '45999999999',
      cpf: '52998224725',
      contactConsent: true,
      interestOptionIds: [],
    };

    await request(app.getHttpServer())
      .post(`/public/customer-registration/${publicId}`)
      .send(payload)
      .expect(201)
      .expect({
        success: true,
        message: 'Cadastro realizado com sucesso.',
      });

    expect(serviceMock.submit).toHaveBeenCalledWith(
      publicId,
      expect.objectContaining(payload),
    );
  });

  it('rejects client-controlled companyId before calling the service', async () => {
    await request(app.getHttpServer())
      .post(`/public/customer-registration/${publicId}`)
      .send({
        name: 'Maria',
        phone: '45999999999',
        cpf: '52998224725',
        contactConsent: true,
        interestOptionIds: [],
        companyId: 'attacker-company',
      })
      .expect(400);

    expect(serviceMock.submit).not.toHaveBeenCalled();
  });

  it('ignores query companyId and never passes it to the domain', async () => {
    await request(app.getHttpServer())
      .post(
        `/public/customer-registration/${publicId}?companyId=attacker-company`,
      )
      .send({
        name: 'Maria',
        phone: '45999999999',
        cpf: '52998224725',
        contactConsent: true,
        interestOptionIds: [],
      })
      .expect(201);

    expect(serviceMock.submit).toHaveBeenCalledWith(publicId, {
      name: 'Maria',
      phone: '45999999999',
      cpf: '52998224725',
      contactConsent: true,
      interestOptionIds: [],
    });
  });
});
