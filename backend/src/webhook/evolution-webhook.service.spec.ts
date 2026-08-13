import { BadRequestException, Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  EVOLUTION_INSTANCE_TENANT_RESOLVER,
  EvolutionInstanceTenantResolver,
} from './evolution-instance-tenant-resolver.interface';
import { EvolutionWebhookService } from './evolution-webhook.service';
import { InboundOptOutService } from './inbound-opt-out.service';

describe('EvolutionWebhookService', () => {
  let service: EvolutionWebhookService;
  const tenantResolverMock: jest.Mocked<EvolutionInstanceTenantResolver> = {
    resolveCompanyId: jest.fn(),
  };
  const inboundOptOutServiceMock = {
    process: jest.fn(),
  };
  const validPayload = {
    event: 'messages.upsert',
    instance: 'tenant-instance',
    data: {
      key: {
        id: 'provider-message-1',
        remoteJid: '5545999999999@s.whatsapp.net',
        fromMe: false,
      },
      message: {
        conversation: 'Mensagem inbound',
      },
      messageTimestamp: Date.parse('2026-08-10T15:00:00.000Z') / 1000,
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EvolutionWebhookService,
        {
          provide: EVOLUTION_INSTANCE_TENANT_RESOLVER,
          useValue: tenantResolverMock,
        },
        {
          provide: InboundOptOutService,
          useValue: inboundOptOutServiceMock,
        },
      ],
    }).compile();

    service = module.get(EvolutionWebhookService);
    tenantResolverMock.resolveCompanyId.mockResolvedValue('company-1');
    inboundOptOutServiceMock.process.mockResolvedValue('not-opt-out-command');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('normalizes and accepts a valid inbound message', async () => {
    const result = await service.handle(validPayload);

    expect(result).toEqual({
      status: 'accepted',
      companyId: 'company-1',
      message: {
        provider: 'EVOLUTION',
        instanceName: 'tenant-instance',
        providerMessageId: 'provider-message-1',
        phone: '5545999999999',
        text: 'Mensagem inbound',
        fromMe: false,
        receivedAt: new Date('2026-08-10T15:00:00.000Z'),
      },
    });
  });

  it('forwards a valid PARAR message to InboundOptOutService', async () => {
    await service.handle({
      ...validPayload,
      data: {
        ...validPayload.data,
        message: { conversation: 'PARAR' },
      },
    });

    expect(inboundOptOutServiceMock.process).toHaveBeenCalledWith(
      'company-1',
      expect.objectContaining({
        phone: '5545999999999',
        text: 'PARAR',
        fromMe: false,
      }),
    );
  });

  it('forwards a normal message without converting it into an error', async () => {
    await expect(service.handle(validPayload)).resolves.toEqual(
      expect.objectContaining({ status: 'accepted' }),
    );
    expect(inboundOptOutServiceMock.process).toHaveBeenCalledWith(
      'company-1',
      expect.objectContaining({ text: 'Mensagem inbound' }),
    );
  });

  it('ignores fromMe before tenant resolution', async () => {
    const result = await service.handle({
      ...validPayload,
      data: {
        ...validPayload.data,
        key: { ...validPayload.data.key, fromMe: true },
      },
    });

    expect(result).toEqual({ status: 'ignored', reason: 'from-me' });
    expect(tenantResolverMock.resolveCompanyId).not.toHaveBeenCalled();
    expect(inboundOptOutServiceMock.process).not.toHaveBeenCalled();
  });

  it('ignores unsupported events', async () => {
    const result = await service.handle({
      event: 'connection.update',
      instance: 'tenant-instance',
      data: {},
    });

    expect(result).toEqual({
      status: 'ignored',
      reason: 'unsupported-event',
    });
    expect(tenantResolverMock.resolveCompanyId).not.toHaveBeenCalled();
    expect(inboundOptOutServiceMock.process).not.toHaveBeenCalled();
  });

  it('ignores an unknown instance without changing data', async () => {
    tenantResolverMock.resolveCompanyId.mockResolvedValue(null);

    const result = await service.handle(validPayload);

    expect(result).toEqual({
      status: 'ignored',
      reason: 'unknown-instance',
    });
    expect(inboundOptOutServiceMock.process).not.toHaveBeenCalled();
  });

  it('does not use a companyId supplied by the webhook payload', async () => {
    const result = await service.handle({
      ...validPayload,
      companyId: 'attacker-company',
    });

    expect(tenantResolverMock.resolveCompanyId).toHaveBeenCalledWith(
      'tenant-instance',
    );
    expect(result).toEqual(
      expect.objectContaining({
        status: 'accepted',
        companyId: 'company-1',
      }),
    );
  });

  it('does not log message text, phone or arbitrary payload fields', async () => {
    const loggerSpy = jest.spyOn(Logger.prototype, 'log');

    await service.handle({
      ...validPayload,
      secretField: 'sensitive-payload-value',
    });

    const logs = JSON.stringify(loggerSpy.mock.calls);
    expect(logs).not.toContain('Mensagem inbound');
    expect(logs).not.toContain('5545999999999');
    expect(logs).not.toContain('sensitive-payload-value');
  });

  it('ignores a message without a valid phone', async () => {
    const result = await service.handle({
      ...validPayload,
      data: {
        ...validPayload.data,
        key: { ...validPayload.data.key, remoteJid: '@s.whatsapp.net' },
      },
    });

    expect(result).toEqual({
      status: 'ignored',
      reason: 'invalid-message',
    });
    expect(tenantResolverMock.resolveCompanyId).not.toHaveBeenCalled();
    expect(inboundOptOutServiceMock.process).not.toHaveBeenCalled();
  });

  it('preserves providerMessageId and extracts extended text defensively', async () => {
    const result = await service.handle({
      ...validPayload,
      data: {
        ...validPayload.data,
        message: {
          extendedTextMessage: {
            text: 'Texto estendido',
          },
        },
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        message: expect.objectContaining({
          providerMessageId: 'provider-message-1',
          text: 'Texto estendido',
        }),
      }),
    );
  });

  it('accepts missing optional text and timestamp as null', async () => {
    const result = await service.handle({
      event: 'MESSAGES_UPSERT',
      instance: 'tenant-instance',
      data: {
        key: {
          remoteJid: '5545999999999@s.whatsapp.net',
          fromMe: false,
        },
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        message: expect.objectContaining({
          providerMessageId: null,
          text: null,
          receivedAt: null,
        }),
      }),
    );
  });

  it.each([null, [], {}, { event: 'messages.upsert' }])(
    'rejects structurally invalid payload %p',
    async (payload) => {
      await expect(service.handle(payload)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    },
  );
});
