import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ThrottlerModule, minutes } from '@nestjs/throttler';
import request from 'supertest';
import { PublicCustomerRegistrationController } from './public-customer-registration.controller';
import { PublicCustomerRegistrationService } from './public-customer-registration.service';

describe('PublicCustomerRegistrationController throttling', () => {
  const publicId = 'A'.repeat(43);
  const payload = {
    name: 'Maria',
    phone: '45999999999',
    cpf: '52998224725',
    contactConsent: true,
    interestOptionIds: [],
  };

  async function createApp(trustLoopbackProxy = false) {
    const serviceMock = {
      getBootstrap: jest.fn().mockResolvedValue({
        company: { displayName: 'Empresa' },
        interests: { categories: [], brands: [] },
      }),
      submit: jest.fn().mockResolvedValue({
        success: true,
        message: 'Cadastro realizado com sucesso.',
      }),
    };
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
    const app = moduleRef.createNestApplication<NestExpressApplication>();
    if (trustLoopbackProxy) {
      app.set('trust proxy', 'loopback');
    }
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    return { app, serviceMock };
  }

  it('allows 30 GET requests in 60 seconds and returns 429 for the next one', async () => {
    const { app, serviceMock } = await createApp();
    try {
      for (let requestNumber = 0; requestNumber < 30; requestNumber += 1) {
        await request(app.getHttpServer())
          .get(`/public/customer-registration/${publicId}`)
          .expect(200);
      }

      await request(app.getHttpServer())
        .get(`/public/customer-registration/${publicId}`)
        .expect(429);
      expect(serviceMock.getBootstrap).toHaveBeenCalledTimes(30);
    } finally {
      await app.close();
    }
  });

  it('allows 5 POST requests in 10 minutes and returns 429 for the next one', async () => {
    const { app, serviceMock } = await createApp();
    try {
      for (let requestNumber = 0; requestNumber < 5; requestNumber += 1) {
        await request(app.getHttpServer())
          .post(`/public/customer-registration/${publicId}`)
          .send(payload)
          .expect(201);
      }

      await request(app.getHttpServer())
        .post(`/public/customer-registration/${publicId}`)
        .send(payload)
        .expect(429);
      expect(serviceMock.submit).toHaveBeenCalledTimes(5);
    } finally {
      await app.close();
    }
  });

  it('keeps counters isolated by request.ip behind an explicitly trusted loopback proxy', async () => {
    const { app, serviceMock } = await createApp(true);
    try {
      for (let requestNumber = 0; requestNumber < 5; requestNumber += 1) {
        await request(app.getHttpServer())
          .post(`/public/customer-registration/${publicId}`)
          .set('X-Forwarded-For', '203.0.113.10')
          .send(payload)
          .expect(201);
      }

      await request(app.getHttpServer())
        .post(`/public/customer-registration/${publicId}`)
        .set('X-Forwarded-For', '203.0.113.10')
        .send(payload)
        .expect(429);

      await request(app.getHttpServer())
        .post(`/public/customer-registration/${publicId}`)
        .set('X-Forwarded-For', '203.0.113.11')
        .send(payload)
        .expect(201);

      expect(serviceMock.submit).toHaveBeenCalledTimes(6);
    } finally {
      await app.close();
    }
  });
});
