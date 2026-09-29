import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomerRegistrationLinkService } from './customer-registration-link.service';
import { CustomerRegistrationPublicIdGenerator } from './customer-registration-public-id.generator';

describe('CustomerRegistrationLinkService', () => {
  const companyId = 'company-1';
  const createdAt = new Date('2026-09-29T12:00:00.000Z');
  const updatedAt = new Date('2026-09-29T12:00:00.000Z');
  const link = {
    publicId: 'public-id-1',
    active: true,
    createdAt,
    updatedAt,
  };
  const publicSelect = {
    publicId: true,
    active: true,
    createdAt: true,
    updatedAt: true,
  };
  const prismaMock = {
    customerRegistrationLink: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const generatorMock = { generate: jest.fn() };
  let service: CustomerRegistrationLinkService;

  const p2002 = (target: string[] | string) =>
    new Prisma.PrismaClientKnownRequestError('sensitive database detail', {
      code: 'P2002',
      clientVersion: '5.22.0',
      meta: { target },
    });

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CustomerRegistrationLinkService(
      prismaMock as unknown as PrismaService,
      generatorMock as unknown as CustomerRegistrationPublicIdGenerator,
    );
    generatorMock.generate.mockReturnValue('public-id-1');
    prismaMock.customerRegistrationLink.findUnique.mockResolvedValue(null);
    prismaMock.customerRegistrationLink.create.mockResolvedValue(link);
    prismaMock.customerRegistrationLink.update.mockResolvedValue(link);
    prismaMock.customerRegistrationLink.updateMany.mockResolvedValue({
      count: 1,
    });
  });

  it('gets only the public administrative projection in its tenant', async () => {
    prismaMock.customerRegistrationLink.findUnique.mockResolvedValue(link);

    await expect(service.get(companyId)).resolves.toEqual({
      ...link,
      publicPath: '/register/public-id-1',
    });
    expect(prismaMock.customerRegistrationLink.findUnique).toHaveBeenCalledWith(
      {
        where: { companyId },
        select: publicSelect,
      },
    );
  });

  it('returns 404 when the authenticated Company has no link', async () => {
    await expect(service.get(companyId)).rejects.toThrow(
      new NotFoundException('Link de cadastro não encontrado'),
    );
  });

  it('creates a link using only companyId and a generated opaque publicId', async () => {
    await expect(service.create(companyId)).resolves.toEqual({
      ...link,
      publicPath: '/register/public-id-1',
    });

    expect(prismaMock.customerRegistrationLink.findUnique).toHaveBeenCalledWith(
      { where: { companyId }, select: { id: true } },
    );
    expect(prismaMock.customerRegistrationLink.create).toHaveBeenCalledWith({
      data: { companyId, publicId: 'public-id-1' },
      select: publicSelect,
    });
  });

  it('rejects an existing Company link before generating another one', async () => {
    prismaMock.customerRegistrationLink.findUnique.mockResolvedValue({
      id: 'link-1',
    });

    await expect(service.create(companyId)).rejects.toThrow(
      new ConflictException('A empresa já possui um link de cadastro.'),
    );
    expect(generatorMock.generate).not.toHaveBeenCalled();
    expect(prismaMock.customerRegistrationLink.create).not.toHaveBeenCalled();
  });

  it('converts only the Company unique race into a safe conflict', async () => {
    prismaMock.customerRegistrationLink.create.mockRejectedValueOnce(
      p2002(['companyId']),
    );

    await expect(service.create(companyId)).rejects.toThrow(
      new ConflictException('A empresa já possui um link de cadastro.'),
    );
  });

  it('retries only publicId collisions during create', async () => {
    generatorMock.generate
      .mockReturnValueOnce('colliding-public-id')
      .mockReturnValueOnce('public-id-1');
    prismaMock.customerRegistrationLink.create
      .mockRejectedValueOnce(p2002(['publicId']))
      .mockResolvedValueOnce(link);

    await expect(service.create(companyId)).resolves.toMatchObject({
      publicId: 'public-id-1',
    });
    expect(prismaMock.customerRegistrationLink.create).toHaveBeenCalledTimes(2);
  });

  it('fails safely after the bounded publicId collision attempts', async () => {
    prismaMock.customerRegistrationLink.create.mockRejectedValue(
      p2002('CustomerRegistrationLink_publicId_key'),
    );

    await expect(service.create(companyId)).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(prismaMock.customerRegistrationLink.create).toHaveBeenCalledTimes(3);
  });

  it('propagates an unrelated P2002 without converting it', async () => {
    const unrelated = p2002(['unrelatedField']);
    prismaMock.customerRegistrationLink.create.mockRejectedValueOnce(unrelated);

    await expect(service.create(companyId)).rejects.toBe(unrelated);
    expect(prismaMock.customerRegistrationLink.create).toHaveBeenCalledTimes(1);
  });

  it('rotates the tenant link and returns the new public path', async () => {
    prismaMock.customerRegistrationLink.findUnique.mockResolvedValue({
      id: 'link-1',
    });
    generatorMock.generate.mockReturnValue('rotated-public-id');
    prismaMock.customerRegistrationLink.update.mockResolvedValue({
      ...link,
      publicId: 'rotated-public-id',
    });

    await expect(service.rotate(companyId)).resolves.toMatchObject({
      publicId: 'rotated-public-id',
      publicPath: '/register/rotated-public-id',
    });
    expect(prismaMock.customerRegistrationLink.update).toHaveBeenCalledWith({
      where: { companyId },
      data: { publicId: 'rotated-public-id' },
      select: publicSelect,
    });
  });

  it('returns 404 instead of creating during rotate when no link exists', async () => {
    await expect(service.rotate(companyId)).rejects.toThrow(NotFoundException);
    expect(prismaMock.customerRegistrationLink.update).not.toHaveBeenCalled();
  });

  it('retries a publicId collision during rotate and nothing else', async () => {
    prismaMock.customerRegistrationLink.findUnique.mockResolvedValue({
      id: 'link-1',
    });
    const unrelated = p2002(['companyId']);
    prismaMock.customerRegistrationLink.update
      .mockRejectedValueOnce(p2002(['publicId']))
      .mockResolvedValueOnce(link);

    await service.rotate(companyId);
    expect(prismaMock.customerRegistrationLink.update).toHaveBeenCalledTimes(2);

    prismaMock.customerRegistrationLink.update.mockReset();
    prismaMock.customerRegistrationLink.update.mockRejectedValueOnce(unrelated);
    await expect(service.rotate(companyId)).rejects.toBe(unrelated);
    expect(prismaMock.customerRegistrationLink.update).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])(
    'updates status to %s only inside the JWT tenant',
    async (active) => {
      prismaMock.customerRegistrationLink.findUnique.mockResolvedValue({
        ...link,
        active,
      });

      await service.updateStatus(companyId, active);

      expect(
        prismaMock.customerRegistrationLink.updateMany,
      ).toHaveBeenCalledWith({
        where: { companyId },
        data: { active },
      });
    },
  );

  it('returns 404 when status update cannot find the tenant link', async () => {
    prismaMock.customerRegistrationLink.updateMany.mockResolvedValue({
      count: 0,
    });

    await expect(service.updateStatus(companyId, false)).rejects.toThrow(
      NotFoundException,
    );
    expect(
      prismaMock.customerRegistrationLink.findUnique,
    ).not.toHaveBeenCalled();
  });
});
