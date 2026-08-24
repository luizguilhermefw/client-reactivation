import {
  ExecutionContext,
  INestApplication,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MessagingChannelConnectionStatus, UserRole } from '@prisma/client';
import request from 'supertest';
import { CompanyActiveGuard } from '../auth/guards/company-active.guard';
import { ExactRolesGuard } from '../auth/guards/exact-roles.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { RequestWithUser } from '../auth/types/request-with-user';
import { MessagingChannelController } from './messaging-channel.controller';
import { MessagingChannelProvisioningService } from './messaging-channel-provisioning.service';
import { MessagingChannelRoutingService } from './messaging-channel-routing.service';

describe('MessagingChannelController HTTP', () => {
  const channelId = '4b4e5167-1519-45e4-8aa5-5fca76d0792b';
  const idempotencyKey = '11111111-1111-4111-8111-111111111111';
  const authenticatedUser: RequestWithUser['user'] = {
    userId: 'user-1',
    name: 'Owner',
    email: 'owner@example.test',
    companyId: 'company-from-jwt',
    role: UserRole.OWNER,
  };
  const serviceMock = {
    provision: jest.fn(),
    getQrCode: jest.fn(),
    getConnection: jest.fn(),
    list: jest.fn(),
  };
  const routingServiceMock = {
    updateRoutingStatus: jest.fn(),
  };
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
      controllers: [MessagingChannelController],
      providers: [
        ExactRolesGuard,
        { provide: MessagingChannelProvisioningService, useValue: serviceMock },
        {
          provide: MessagingChannelRoutingService,
          useValue: routingServiceMock,
        },
      ],
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
    authenticatedUser.companyId = 'company-from-jwt';
    authenticatedUser.role = UserRole.OWNER;
    serviceMock.provision.mockResolvedValue({
      channelId,
      connectionStatus: MessagingChannelConnectionStatus.WAITING_QR,
      qrCode: 'fictional-qr',
    });
    serviceMock.getQrCode.mockResolvedValue({
      channelId,
      connectionStatus: MessagingChannelConnectionStatus.WAITING_QR,
      qrCode: 'fictional-qr',
    });
    serviceMock.getConnection.mockResolvedValue({
      channelId,
      connectionStatus: MessagingChannelConnectionStatus.CONNECTED,
      connectedPhone: null,
      isActive: true,
    });
    serviceMock.list.mockResolvedValue({
      limit: 2,
      used: 1,
      available: 1,
      channels: [
        {
          id: channelId,
          connectionStatus: MessagingChannelConnectionStatus.CONNECTED,
          connectedPhone: null,
          isActive: true,
        },
      ],
    });
    routingServiceMock.updateRoutingStatus.mockResolvedValue({
      channelId,
      isActive: true,
      connectionStatus: MessagingChannelConnectionStatus.CONNECTED,
    });
  });

  afterAll(async () => app.close());

  const postProvision = (body: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .post('/company/messaging-channels/whatsapp')
      .set('Idempotency-Key', idempotencyKey)
      .send(body);

  it.each([UserRole.OWNER, UserRole.MANAGER])(
    '%s can provision using only companyId from JWT',
    async (role) => {
      authenticatedUser.role = role;

      await postProvision().expect(201);

      expect(serviceMock.provision).toHaveBeenCalledWith(
        'company-from-jwt',
        idempotencyKey,
      );
    },
  );

  it.each([UserRole.OPERATOR, UserRole.VIEWER])(
    '%s cannot provision',
    async (role) => {
      authenticatedUser.role = role;

      await postProvision().expect(403);
      expect(serviceMock.provision).not.toHaveBeenCalled();
    },
  );

  it('rejects companyId controlled by the body', async () => {
    await postProvision({ companyId: 'other-company' }).expect(400);
    expect(serviceMock.provision).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', undefined],
    ['invalid', 'abc'],
    ['too long', 'a'.repeat(65)],
  ])('rejects %s Idempotency-Key', async (_scenario, value) => {
    const call = request(app.getHttpServer())
      .post('/company/messaging-channels/whatsapp')
      .send({});
    if (value) call.set('Idempotency-Key', value);

    await call.expect(400);
    expect(serviceMock.provision).not.toHaveBeenCalled();
  });

  it('allows OWNER to request a new QR for a tenant-scoped channel', async () => {
    await request(app.getHttpServer())
      .post(`/company/messaging-channels/whatsapp/${channelId}/qr`)
      .expect(200);

    expect(serviceMock.getQrCode).toHaveBeenCalledWith(
      'company-from-jwt',
      channelId,
    );
  });

  it.each([UserRole.OPERATOR, UserRole.VIEWER])(
    '%s cannot request QR or poll a provisioning connection',
    async (role) => {
      authenticatedUser.role = role;

      await request(app.getHttpServer())
        .post(`/company/messaging-channels/whatsapp/${channelId}/qr`)
        .expect(403);
      await request(app.getHttpServer())
        .get(`/company/messaging-channels/whatsapp/${channelId}/connection`)
        .expect(403);
      expect(serviceMock.getQrCode).not.toHaveBeenCalled();
      expect(serviceMock.getConnection).not.toHaveBeenCalled();
    },
  );

  it('returns a safe 404 when a channel belongs to another tenant', async () => {
    serviceMock.getQrCode.mockRejectedValue(
      new NotFoundException('Channel not found'),
    );

    await request(app.getHttpServer())
      .post(`/company/messaging-channels/whatsapp/${channelId}/qr`)
      .expect(404);
  });

  it('polls connection through companyId from JWT', async () => {
    await request(app.getHttpServer())
      .get(`/company/messaging-channels/whatsapp/${channelId}/connection`)
      .expect(200);

    expect(serviceMock.getConnection).toHaveBeenCalledWith(
      'company-from-jwt',
      channelId,
    );
  });

  it('allows an authenticated VIEWER to list only safe fields', async () => {
    authenticatedUser.role = UserRole.VIEWER;

    const response = await request(app.getHttpServer())
      .get('/company/messaging-channels/whatsapp?companyId=other-company')
      .expect(200);

    expect(serviceMock.list).toHaveBeenCalledWith('company-from-jwt');
    expect(response.body).toEqual({
      limit: 2,
      used: 1,
      available: 1,
      channels: [
        {
          id: channelId,
          connectionStatus: 'CONNECTED',
          connectedPhone: null,
          isActive: true,
        },
      ],
    });
    expect(JSON.stringify(response.body)).not.toContain('instanceName');
    expect(JSON.stringify(response.body)).not.toContain('provisioningKey');
    expect(JSON.stringify(response.body)).not.toContain('companyId');
    expect(JSON.stringify(response.body)).not.toContain('apiKey');
  });

  it.each([UserRole.OWNER, UserRole.MANAGER])(
    '%s can activate a same-tenant routing channel',
    async (role) => {
      authenticatedUser.role = role;

      const response = await request(app.getHttpServer())
        .patch(`/company/messaging-channels/whatsapp/${channelId}/routing`)
        .send({ isActive: true })
        .expect(200);

      expect(routingServiceMock.updateRoutingStatus).toHaveBeenCalledWith(
        'company-from-jwt',
        channelId,
        true,
      );
      expect(response.body).toEqual({
        channelId,
        isActive: true,
        connectionStatus: 'CONNECTED',
      });
      expect(JSON.stringify(response.body)).not.toMatch(
        /instanceName|provisioningKey|apiKey|webhookSecret/i,
      );
    },
  );

  it.each([UserRole.OPERATOR, UserRole.VIEWER])(
    '%s cannot change channel routing',
    async (role) => {
      authenticatedUser.role = role;

      await request(app.getHttpServer())
        .patch(`/company/messaging-channels/whatsapp/${channelId}/routing`)
        .send({ isActive: true })
        .expect(403);
      expect(routingServiceMock.updateRoutingStatus).not.toHaveBeenCalled();
    },
  );

  it.each([
    [{ isActive: 'true' }],
    [{ isActive: 1 }],
    [{}],
    [{ isActive: true, companyId: 'other-company' }],
  ])('strictly validates the routing body: %j', async (body) => {
    await request(app.getHttpServer())
      .patch(`/company/messaging-channels/whatsapp/${channelId}/routing`)
      .send(body)
      .expect(400);
    expect(routingServiceMock.updateRoutingStatus).not.toHaveBeenCalled();
  });

  it('deactivates through companyId exclusively from JWT', async () => {
    routingServiceMock.updateRoutingStatus.mockResolvedValue({
      channelId,
      isActive: false,
      connectionStatus: MessagingChannelConnectionStatus.ERROR,
    });

    await request(app.getHttpServer())
      .patch(`/company/messaging-channels/whatsapp/${channelId}/routing`)
      .send({ isActive: false })
      .expect(200);

    expect(routingServiceMock.updateRoutingStatus).toHaveBeenCalledWith(
      'company-from-jwt',
      channelId,
      false,
    );
  });
});
