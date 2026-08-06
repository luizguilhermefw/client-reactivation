import {
  BadRequestException,
  ConflictException,
  ExecutionContext,
  INestApplication,
  InternalServerErrorException,
  PayloadTooLargeException,
  ValidationPipe,
} from '@nestjs/common';
import { GUARDS_METADATA, MODULE_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { MediaAsset, MediaAssetStatus, UserRole } from '@prisma/client';
import request from 'supertest';
import { CompanyActiveGuard } from '../auth/guards/company-active.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { RequestWithUser } from '../auth/types/request-with-user';
import { UploadMediaAssetDto } from './dto/upload-media-asset.dto';
import {
  MAX_MEDIA_ASSET_UPLOAD_BYTES,
  MAX_MEDIA_ASSET_CLIENT_PARTS,
  MEDIA_ASSET_UPLOAD_OPTIONS,
  MediaAssetController,
} from './media-asset.controller';
import { MediaAssetService } from './media-asset.service';
import { MediaStorageModule } from './media-storage.module';

describe('MediaAssetController', () => {
  const now = new Date('2026-08-06T12:00:00.000Z');
  const serviceMock = {
    create: jest.fn(),
  };
  const request = {
    user: {
      userId: 'user-1',
      name: 'Owner',
      email: 'owner@example.test',
      companyId: 'company-authenticated',
      role: UserRole.OWNER,
    },
  } as RequestWithUser;
  const persistedAsset: MediaAsset = {
    id: 'asset-1',
    companyId: 'company-authenticated',
    storageProvider: 'FIREBASE',
    bucket: 'private-bucket',
    objectKey: 'companies/company-authenticated/media/asset-1/campaign.jpg',
    originalName: 'campaign.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 4,
    checksumSha256: 'a'.repeat(64),
    status: MediaAssetStatus.READY,
    expiresAt: new Date('2026-08-07T12:00:00.000Z'),
    storageDeletedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  let controller: MediaAssetController;

  const file = (mimeType = 'image/jpeg', content = Buffer.from('file')) => ({
    originalname: mimeType === 'image/png' ? 'campaign.png' : 'campaign.jpg',
    mimetype: mimeType,
    size: content.length,
    buffer: content,
  });

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(now);
    jest.clearAllMocks();
    serviceMock.create.mockResolvedValue(persistedAsset);
    controller = new MediaAssetController(
      serviceMock as unknown as MediaAssetService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it.each([
    ['JPEG', 'image/jpeg'],
    ['PNG', 'image/png'],
  ])('envia upload %s com o companyId autenticado', async (_name, mimeType) => {
    const uploadedFile = file(mimeType);

    await controller.create(request, uploadedFile, {});

    expect(serviceMock.create).toHaveBeenCalledWith({
      companyId: 'company-authenticated',
      originalName: uploadedFile.originalname,
      mimeType,
      sizeBytes: uploadedFile.size,
      content: uploadedFile.buffer,
      expiresAt: undefined,
    });
  });

  it('ValidationPipe rejeita companyId e campos inesperados', async () => {
    const validationPipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });
    const metadata = {
      type: 'body' as const,
      metatype: UploadMediaAssetDto,
      data: undefined,
    };

    await expect(
      validationPipe.transform(
        { expiresAt: '2026-08-07T12:00:00.000Z' },
        metadata,
      ),
    ).resolves.toBeInstanceOf(UploadMediaAssetDto);
    await expect(
      validationPipe.transform({ companyId: 'company-attacker' }, metadata),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      validationPipe.transform({ unexpected: 'value' }, metadata),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(serviceMock.create).not.toHaveBeenCalled();
  });

  it('expõe opções Multer explícitas e fail-closed', () => {
    expect(MEDIA_ASSET_UPLOAD_OPTIONS.storage).toBeDefined();
    expect(MEDIA_ASSET_UPLOAD_OPTIONS.limits).toEqual({
      fileSize: MAX_MEDIA_ASSET_UPLOAD_BYTES,
      files: 1,
      fields: 1,
      parts: MAX_MEDIA_ASSET_CLIENT_PARTS + 1,
    });
    expect(MEDIA_ASSET_UPLOAD_OPTIONS.fileFilter).toEqual(expect.any(Function));
  });

  it('rejeita arquivo ausente', async () => {
    await expect(controller.create(request, undefined, {})).rejects.toThrow(
      new BadRequestException('Image file is required'),
    );
    expect(serviceMock.create).not.toHaveBeenCalled();
  });

  it('rejeita arquivo vazio', async () => {
    await expect(
      controller.create(request, file('image/jpeg', Buffer.alloc(0)), {}),
    ).rejects.toThrow(
      new BadRequestException('Image file is empty or invalid'),
    );
    expect(serviceMock.create).not.toHaveBeenCalled();
  });

  it('rejeita arquivo maior que 5 MiB', async () => {
    const oversizedFile = file('image/jpeg', Buffer.alloc(5 * 1024 * 1024 + 1));

    await expect(controller.create(request, oversizedFile, {})).rejects.toThrow(
      new PayloadTooLargeException('Image exceeds 5 MiB limit'),
    );
    expect(serviceMock.create).not.toHaveBeenCalled();
  });

  it('rejeita MIME diferente de JPEG ou PNG', async () => {
    await expect(
      controller.create(request, file('image/gif'), {}),
    ).rejects.toThrow(
      new BadRequestException('Only JPEG and PNG images are allowed'),
    );
    expect(serviceMock.create).not.toHaveBeenCalled();
  });

  it('converte expiresAt ISO-8601 futuro para Date', async () => {
    await controller.create(request, file(), {
      expiresAt: '2026-08-07T12:00:00.000Z',
    });

    expect(serviceMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        expiresAt: new Date('2026-08-07T12:00:00.000Z'),
      }),
    );
  });

  it('rejeita expiresAt inválido', async () => {
    await expect(
      controller.create(request, file(), { expiresAt: 'not-a-date' }),
    ).rejects.toThrow(
      new BadRequestException('expiresAt must be a valid ISO-8601 date'),
    );
    expect(serviceMock.create).not.toHaveBeenCalled();
  });

  it('rejeita expiresAt no passado', async () => {
    await expect(
      controller.create(request, file(), {
        expiresAt: '2026-08-06T11:59:59.000Z',
      }),
    ).rejects.toThrow(
      new BadRequestException('expiresAt must be in the future'),
    );
    expect(serviceMock.create).not.toHaveBeenCalled();
  });

  it('retorna somente os campos públicos do asset', async () => {
    const response = await controller.create(request, file(), {});

    expect(response).toEqual({
      id: 'asset-1',
      originalName: 'campaign.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 4,
      status: MediaAssetStatus.READY,
      checksumSha256: 'a'.repeat(64),
      expiresAt: new Date('2026-08-07T12:00:00.000Z'),
      createdAt: now,
      updatedAt: now,
    });
    expect(response).not.toHaveProperty('bucket');
    expect(response).not.toHaveProperty('objectKey');
    expect(response).not.toHaveProperty('storageProvider');
    expect(response).not.toHaveProperty('storageDeletedAt');
    expect(response).not.toHaveProperty('url');
    expect(response).not.toHaveProperty('token');
  });

  it.each([
    new ConflictException('Media asset upload is already in progress'),
    new InternalServerErrorException('Media asset upload failed'),
  ])('propaga erro seguro do service', async (safeError) => {
    serviceMock.create.mockRejectedValue(safeError);

    await expect(controller.create(request, file(), {})).rejects.toBe(
      safeError,
    );
  });

  it('exige JWT e empresa ativa no controller', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      MediaAssetController,
    ) as unknown[];

    expect(guards).toEqual([JwtAuthGuard, CompanyActiveGuard]);
  });

  it('está registrado com o service no módulo sem inicializar Firebase', () => {
    const controllers = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      MediaStorageModule,
    ) as unknown[];
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      MediaStorageModule,
    ) as unknown[];

    expect(controllers).toContain(MediaAssetController);
    expect(providers).toContain(MediaAssetService);
  });
});

describe('MediaAssetController HTTP', () => {
  const now = new Date('2026-08-06T12:00:00.000Z');
  const authenticatedUser: RequestWithUser['user'] = {
    userId: 'user-http',
    name: 'HTTP Owner',
    email: 'http-owner@example.test',
    companyId: 'company-from-jwt',
    role: UserRole.OWNER,
  };
  const persistedAsset: MediaAsset = {
    id: 'asset-http',
    companyId: authenticatedUser.companyId,
    storageProvider: 'FIREBASE',
    bucket: 'private-bucket',
    objectKey: 'companies/company-from-jwt/media/asset-http/upload.jpg',
    originalName: 'upload.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 4,
    checksumSha256: 'b'.repeat(64),
    status: MediaAssetStatus.READY,
    expiresAt: null,
    storageDeletedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const serviceMock = {
    create: jest.fn(),
  };

  let app: INestApplication;

  beforeAll(async () => {
    const authenticatedGuard = {
      canActivate: (context: ExecutionContext) => {
        const httpRequest = context
          .switchToHttp()
          .getRequest<RequestWithUser>();
        httpRequest.user = authenticatedUser;
        return true;
      },
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [MediaAssetController],
      providers: [
        {
          provide: MediaAssetService,
          useValue: serviceMock,
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
    serviceMock.create.mockResolvedValue(persistedAsset);
  });

  afterAll(async () => {
    await app.close();
  });

  it('aceita JPEG com 201 e companyId do usuário autenticado', async () => {
    const content = Buffer.from('jpeg');

    await request(app.getHttpServer())
      .post('/media-assets')
      .attach('file', content, {
        filename: 'upload.jpg',
        contentType: 'image/jpeg',
      })
      .expect(201);

    expect(serviceMock.create).toHaveBeenCalledTimes(1);
    expect(serviceMock.create).toHaveBeenCalledWith({
      companyId: 'company-from-jwt',
      originalName: 'upload.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: content.length,
      content,
      expiresAt: undefined,
    });
  });

  it('aceita PNG com 201', async () => {
    await request(app.getHttpServer())
      .post('/media-assets')
      .attach('file', Buffer.from('png'), {
        filename: 'upload.png',
        contentType: 'image/png',
      })
      .expect(201);

    expect(serviceMock.create).toHaveBeenCalledTimes(1);
    expect(serviceMock.create).toHaveBeenCalledWith(
      expect.objectContaining({ mimeType: 'image/png' }),
    );
  });

  it('rejeita ausência de arquivo com 400', async () => {
    await request(app.getHttpServer()).post('/media-assets').expect(400);

    expect(serviceMock.create).not.toHaveBeenCalled();
  });

  it('rejeita arquivo acima de 5 MiB com 413', async () => {
    await request(app.getHttpServer())
      .post('/media-assets')
      .attach('file', Buffer.alloc(MAX_MEDIA_ASSET_UPLOAD_BYTES + 1), {
        filename: 'oversized.jpg',
        contentType: 'image/jpeg',
      })
      .expect(413);

    expect(serviceMock.create).not.toHaveBeenCalled();
  });

  it('rejeita MIME inválido pelo fileFilter com 400', async () => {
    await request(app.getHttpServer())
      .post('/media-assets')
      .attach('file', Buffer.from('gif'), {
        filename: 'upload.gif',
        contentType: 'image/gif',
      })
      .expect(400);

    expect(serviceMock.create).not.toHaveBeenCalled();
  });

  it('rejeita mais de um arquivo no campo file com 400', async () => {
    await request(app.getHttpServer())
      .post('/media-assets')
      .attach('file', Buffer.from('first'), {
        filename: 'first.jpg',
        contentType: 'image/jpeg',
      })
      .attach('file', Buffer.from('second'), {
        filename: 'second.jpg',
        contentType: 'image/jpeg',
      })
      .expect(400);

    expect(serviceMock.create).not.toHaveBeenCalled();
  });

  it.each(['companyId', 'unexpected'])(
    'rejeita campo multipart não permitido %s com 400',
    async (fieldName) => {
      await request(app.getHttpServer())
        .post('/media-assets')
        .field(fieldName, 'client-controlled-value')
        .attach('file', Buffer.from('jpeg'), {
          filename: 'upload.jpg',
          contentType: 'image/jpeg',
        })
        .expect(400);

      expect(serviceMock.create).not.toHaveBeenCalled();
    },
  );

  it('converte expiresAt válido e envia Date ao service', async () => {
    await request(app.getHttpServer())
      .post('/media-assets')
      .field('expiresAt', '2099-08-07T12:00:00.000Z')
      .attach('file', Buffer.from('jpeg'), {
        filename: 'upload.jpg',
        contentType: 'image/jpeg',
      })
      .expect(201);

    expect(serviceMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        expiresAt: new Date('2099-08-07T12:00:00.000Z'),
      }),
    );
  });

  it.each(['not-a-date', '2000-01-01T00:00:00.000Z'])(
    'rejeita expiresAt inválido ou passado: %s',
    async (expiresAt) => {
      await request(app.getHttpServer())
        .post('/media-assets')
        .field('expiresAt', expiresAt)
        .attach('file', Buffer.from('jpeg'), {
          filename: 'upload.jpg',
          contentType: 'image/jpeg',
        })
        .expect(400);

      expect(serviceMock.create).not.toHaveBeenCalled();
    },
  );

  it('não expõe detalhes físicos do storage na resposta HTTP', async () => {
    const response = await request(app.getHttpServer())
      .post('/media-assets')
      .attach('file', Buffer.from('jpeg'), {
        filename: 'upload.jpg',
        contentType: 'image/jpeg',
      })
      .expect(201);

    expect(response.body).not.toHaveProperty('bucket');
    expect(response.body).not.toHaveProperty('objectKey');
    expect(response.body).not.toHaveProperty('storageProvider');
    expect(response.body).not.toHaveProperty('url');
    expect(response.body).not.toHaveProperty('token');
  });
});
