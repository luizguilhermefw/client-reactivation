import { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import request from 'supertest';
import { CompanyActiveGuard } from '../../auth/guards/company-active.guard';
import { ExactRolesGuard } from '../../auth/guards/exact-roles.guard';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { RequestWithUser } from '../../auth/types/request-with-user';
import { CustomerImportController } from './customer-import.controller';
import { CustomerImportService } from './customer-import.service';
import { CustomerImportTemplateService } from './customer-import-template.service';

describe('CustomerImportController HTTP', () => {
  const companyId = 'company-from-jwt';
  let role = UserRole.OWNER;
  let app: INestApplication;
  const importServiceMock = {
    preview: jest.fn(),
    execute: jest.fn(),
  };
  const templateServiceMock = { create: jest.fn() };

  beforeAll(async () => {
    const jwtGuard = {
      canActivate(context: ExecutionContext) {
        const request = context.switchToHttp().getRequest<RequestWithUser>();
        request.user = {
          userId: 'user-1',
          companyId,
          name: 'User',
          email: 'user@example.test',
          role,
        };
        return true;
      },
    };
    const module = await Test.createTestingModule({
      controllers: [CustomerImportController],
      providers: [
        ExactRolesGuard,
        { provide: CustomerImportService, useValue: importServiceMock },
        {
          provide: CustomerImportTemplateService,
          useValue: templateServiceMock,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(jwtGuard)
      .overrideGuard(CompanyActiveGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = module.createNestApplication();
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    role = UserRole.OWNER;
    importServiceMock.preview.mockResolvedValue({ summary: {} });
    importServiceMock.execute.mockResolvedValue({ summary: {} });
    templateServiceMock.create.mockResolvedValue(Buffer.from('template'));
  });

  afterAll(async () => app.close());

  const attachCsv = (operation: request.Test) =>
    operation.attach('file', Buffer.from('nome,telefone\nAna,45999999999'), {
      filename: 'customers.csv',
      contentType: 'text/csv',
    });

  it('allows OWNER to preview using companyId only from JWT', async () => {
    await attachCsv(
      request(app.getHttpServer()).post('/customer/import/preview'),
    ).expect(200);

    expect(importServiceMock.preview).toHaveBeenCalledWith(
      companyId,
      expect.objectContaining({ originalname: 'customers.csv' }),
    );
  });

  it('allows MANAGER to execute', async () => {
    role = UserRole.MANAGER;
    await attachCsv(
      request(app.getHttpServer()).post('/customer/import/execute'),
    ).expect(201);
    expect(importServiceMock.execute).toHaveBeenCalledWith(
      companyId,
      expect.any(Object),
    );
  });

  it.each(['text/plain', 'application/vnd.ms-excel'])(
    'accepts .csv upload with MIME %s',
    async (contentType) => {
      await request(app.getHttpServer())
        .post('/customer/import/preview')
        .attach('file', Buffer.from('nome,telefone\nAna,45999999999'), {
          filename: 'customers.csv',
          contentType,
        })
        .expect(200);
    },
  );

  it.each([
    ['customers.txt', 'text/plain'],
    ['customers.xls', 'application/vnd.ms-excel'],
  ])('rejects upload %s with MIME %s', async (filename, contentType) => {
    await request(app.getHttpServer())
      .post('/customer/import/preview')
      .attach('file', Buffer.from('nome,telefone\nAna,45999999999'), {
        filename,
        contentType,
      })
      .expect(400);
  });

  it('allows OPERATOR to download the template', async () => {
    role = UserRole.OPERATOR;
    const response = await request(app.getHttpServer())
      .get('/customer/import/template')
      .expect(200);
    expect(response.headers['content-disposition']).toContain(
      'aylaflow-customer-import.xlsx',
    );
  });

  it.each(['preview', 'execute', 'template'])(
    'returns 403 to VIEWER on %s',
    async (endpoint) => {
      role = UserRole.VIEWER;
      const operation = request(app.getHttpServer())[
        endpoint === 'template' ? 'get' : 'post'
      ](`/customer/import/${endpoint}`);
      await (endpoint === 'template' ? operation : attachCsv(operation)).expect(
        403,
      );
    },
  );

  it.each([UserRole.PLATFORM_ADMIN, UserRole.SUPPORT])(
    'does not grant import access implicitly to %s',
    async (blockedRole) => {
      role = blockedRole;
      await attachCsv(
        request(app.getHttpServer()).post('/customer/import/preview'),
      ).expect(403);
    },
  );
});
