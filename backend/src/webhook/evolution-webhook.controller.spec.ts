import { BadRequestException, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { EvolutionWebhookController } from './evolution-webhook.controller';
import { EvolutionWebhookSecretGuard } from './evolution-webhook-secret.guard';
import { EvolutionWebhookService } from './evolution-webhook.service';

describe('EvolutionWebhookController', () => {
  const originalWebhookSecret = process.env.EVOLUTION_WEBHOOK_SECRET;
  const configuredSecret = 'test-webhook-secret';
  const serviceMock = {
    handle: jest.fn(),
  };
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [EvolutionWebhookController],
      providers: [
        EvolutionWebhookSecretGuard,
        { provide: EvolutionWebhookService, useValue: serviceMock },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.EVOLUTION_WEBHOOK_SECRET = configuredSecret;
    serviceMock.handle.mockResolvedValue({ status: 'accepted' });
  });

  afterAll(async () => {
    if (originalWebhookSecret === undefined) {
      delete process.env.EVOLUTION_WEBHOOK_SECRET;
    } else {
      process.env.EVOLUTION_WEBHOOK_SECRET = originalWebhookSecret;
    }

    await app.close();
  });

  const postWebhook = (payload: unknown, secret?: string) => {
    const operation = request(app.getHttpServer())
      .post('/webhooks/evolution/messages')
      .send(payload);

    return secret === undefined
      ? operation
      : operation.set('x-aylaflow-webhook-secret', secret);
  };

  it('accepts an authenticated webhook with the dedicated secret', async () => {
    const payload = {
      event: 'messages.upsert',
      instance: 'tenant-instance',
      data: {},
    };

    await postWebhook(payload, configuredSecret)
      .expect(200)
      .expect({ status: 'accepted' });

    expect(serviceMock.handle).toHaveBeenCalledWith(payload);
  });

  it('returns 401 when the secret header is absent', async () => {
    await postWebhook({}).expect(401);

    expect(serviceMock.handle).not.toHaveBeenCalled();
  });

  it('returns 401 when the secret is invalid', async () => {
    await postWebhook({}, 'incorrect-secret').expect(401);

    expect(serviceMock.handle).not.toHaveBeenCalled();
  });

  it('fails closed when EVOLUTION_WEBHOOK_SECRET is not configured', async () => {
    delete process.env.EVOLUTION_WEBHOOK_SECRET;

    await postWebhook({}, configuredSecret).expect(401);

    expect(serviceMock.handle).not.toHaveBeenCalled();
  });

  it('returns 400 for an obviously invalid payload', async () => {
    serviceMock.handle.mockRejectedValue(
      new BadRequestException('Invalid Evolution webhook payload'),
    );

    await postWebhook({}, configuredSecret).expect(400);
  });
});
