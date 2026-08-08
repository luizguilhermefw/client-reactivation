import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MediaAssetEnqueueError } from '../queue/media-asset-enqueue.error';
import { AutomationService } from './automation.service';
import {
  CampaignAudienceType,
  CampaignDispatchType,
  DispatchCampaignDto,
} from './dto/dispatch-campaign.dto';
import { EngineService } from './engine/engine.service';

describe('AutomationService campaign dispatch', () => {
  const engineServiceMock = {
    enqueueCampaign: jest.fn(),
  };
  const service = new AutomationService(
    {} as PrismaService,
    engineServiceMock as unknown as EngineService,
  );
  const companyId = 'company-from-jwt';
  const automationId = 'campaign-automation-1';

  const textInput = (): DispatchCampaignDto => ({
    type: CampaignDispatchType.TEXT,
    content: '  Promoção especial  ',
    audience: {
      type: CampaignAudienceType.ALL_ELIGIBLE,
    },
  });

  beforeEach(() => {
    jest.clearAllMocks();
    engineServiceMock.enqueueCampaign.mockResolvedValue({
      eligibleCustomers: 2,
      processed: 2,
    });
  });

  it('coordena TEXT para todos os elegíveis com companyId confiável', async () => {
    await expect(
      service.dispatchCampaign(automationId, textInput(), companyId),
    ).resolves.toEqual({
      automationId,
      type: CampaignDispatchType.TEXT,
      audienceType: CampaignAudienceType.ALL_ELIGIBLE,
      eligibleCustomers: 2,
      processed: 2,
    });

    expect(engineServiceMock.enqueueCampaign).toHaveBeenCalledWith(
      companyId,
      automationId,
      {
        customerIds: undefined,
        content: 'Promoção especial',
      },
    );
  });

  it('remove customerIds duplicados e normaliza espaços', async () => {
    await service.dispatchCampaign(
      automationId,
      {
        ...textInput(),
        audience: {
          type: CampaignAudienceType.CUSTOMER_IDS,
          customerIds: [' customer-1 ', 'customer-2', 'customer-1'],
        },
      },
      companyId,
    );

    expect(engineServiceMock.enqueueCampaign).toHaveBeenCalledWith(
      companyId,
      automationId,
      expect.objectContaining({
        customerIds: ['customer-1', 'customer-2'],
      }),
    );
  });

  it('coordena IMAGE somente com mediaAssetId e caption', async () => {
    const result = await service.dispatchCampaign(
      automationId,
      {
        type: CampaignDispatchType.IMAGE,
        mediaAssetId: '  media-asset-1  ',
        caption: 'Legenda opcional',
        audience: {
          type: CampaignAudienceType.ALL_ELIGIBLE,
        },
      },
      companyId,
    );

    expect(engineServiceMock.enqueueCampaign).toHaveBeenCalledWith(
      companyId,
      automationId,
      {
        customerIds: undefined,
        mediaAssetId: 'media-asset-1',
        caption: 'Legenda opcional',
      },
    );
    expect(JSON.stringify(result)).not.toMatch(
      /mediaAsset|mediaUrl|bucket|objectKey|storageProvider|token/i,
    );
  });

  it.each([
    ['MEDIA_ASSET_NOT_FOUND', NotFoundException, 'Media asset was not found'],
    ['MEDIA_ASSET_NOT_READY', ConflictException, 'Media asset is not ready'],
    ['MEDIA_ASSET_EXPIRED', ConflictException, 'Media asset has expired'],
  ] as const)(
    'traduz %s para erro HTTP seguro',
    async (code, exceptionType, message) => {
      engineServiceMock.enqueueCampaign.mockRejectedValue(
        new MediaAssetEnqueueError(code, 'internal-storage-detail'),
      );

      try {
        await service.dispatchCampaign(
          automationId,
          {
            type: CampaignDispatchType.IMAGE,
            mediaAssetId: 'media-asset-1',
            audience: { type: CampaignAudienceType.ALL_ELIGIBLE },
          },
          companyId,
        );
        throw new Error('Expected dispatchCampaign to reject');
      } catch (error) {
        expect(error).toBeInstanceOf(exceptionType);
        expect((error as Error).message).toBe(message);
        expect((error as Error).message).not.toContain(
          'internal-storage-detail',
        );
      }
    },
  );

  it('repassa erro seguro de campanha inexistente ou de outro tenant', async () => {
    const safeError = new NotFoundException('Campanha não encontrada');
    engineServiceMock.enqueueCampaign.mockRejectedValue(safeError);

    await expect(
      service.dispatchCampaign(automationId, textInput(), companyId),
    ).rejects.toBe(safeError);
  });

  it('mantém os mesmos argumentos em dispatch repetido para idempotência persistente', async () => {
    await service.dispatchCampaign(automationId, textInput(), companyId);
    await service.dispatchCampaign(automationId, textInput(), companyId);

    expect(engineServiceMock.enqueueCampaign).toHaveBeenCalledTimes(2);
    expect(engineServiceMock.enqueueCampaign.mock.calls[0]).toEqual(
      engineServiceMock.enqueueCampaign.mock.calls[1],
    );
  });
});
