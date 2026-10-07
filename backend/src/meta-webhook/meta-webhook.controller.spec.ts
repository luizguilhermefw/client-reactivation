import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { MetaWebhookController } from './meta-webhook.controller';
import { MetaWebhookSignatureGuard } from './meta-webhook-signature.guard';
import { MetaWebhookService } from './meta-webhook.service';

describe('Meta webhook HTTP/raw body', () => {
  let app: INestApplication;
  const handle = jest.fn();
  const originalSecret = process.env.META_WHATSAPP_APP_SECRET;
  const originalToken = process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  const secret = 'fictional-test-secret';
  const sign = (body: string) =>
    `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  beforeEach(async () => {
    process.env.META_WHATSAPP_APP_SECRET = secret;
    process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'fictional-verify-token';
    handle.mockReset().mockResolvedValue(undefined);
    const module = await Test.createTestingModule({
      controllers: [MetaWebhookController],
      providers: [
        MetaWebhookSignatureGuard,
        { provide: MetaWebhookService, useValue: { handle } },
      ],
    }).compile();
    app = module.createNestApplication({ rawBody: true });
    await app.init();
  });
  afterEach(async () => {
    await app.close();
    if (originalSecret === undefined)
      delete process.env.META_WHATSAPP_APP_SECRET;
    else process.env.META_WHATSAPP_APP_SECRET = originalSecret;
    if (originalToken === undefined)
      delete process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN;
    else process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN = originalToken;
  });
  it('returns the verification challenge', async () => {
    const result = await request(app.getHttpServer())
      .get('/webhooks/meta')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'fictional-verify-token',
        'hub.challenge': '12345',
      })
      .expect(200);
    expect(result.text).toBe('12345');
  });
  it.each([
    {},
    {
      'hub.mode': 'subscribe',
      'hub.verify_token': 'wrong',
      'hub.challenge': '12345',
    },
  ])('rejects invalid verification', async (query) => {
    await request(app.getHttpServer())
      .get('/webhooks/meta')
      .query(query)
      .expect(403);
  });
  it('validates the exact received bytes, not reserialized JSON', async () => {
    const body = '{ "entry" : [] }';
    await request(app.getHttpServer())
      .post('/webhooks/meta')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', sign(body))
      .send(body)
      .expect(200);
    expect(handle).toHaveBeenCalledWith({ entry: [] });
  });
  it('rejects a changed body and a signature over reserialized JSON', async () => {
    const result = await request(app.getHttpServer())
      .post('/webhooks/meta')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', sign('{"entry":[]}'))
      .send('{ "entry" : [] }')
      .expect(401);
    expect(handle).not.toHaveBeenCalled();
    expect(JSON.stringify(result.body)).not.toContain(secret);
  });
  it('rejects missing secret, signature and rawBody without fallback', async () => {
    delete process.env.META_WHATSAPP_APP_SECRET;
    await request(app.getHttpServer())
      .post('/webhooks/meta')
      .send({})
      .expect(401);
    process.env.META_WHATSAPP_APP_SECRET = secret;
    await request(app.getHttpServer())
      .post('/webhooks/meta')
      .send({})
      .expect(401);
    await app.close();
    const module = await Test.createTestingModule({
      controllers: [MetaWebhookController],
      providers: [
        MetaWebhookSignatureGuard,
        { provide: MetaWebhookService, useValue: { handle } },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    await request(app.getHttpServer())
      .post('/webhooks/meta')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', sign('{}'))
      .send('{}')
      .expect(401);
    expect(handle).not.toHaveBeenCalled();
  });
});
