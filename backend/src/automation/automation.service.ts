import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AutomationType,
  CampaignAudienceType,
  CustomerInterestType,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { MediaAssetEnqueueError } from '../queue/media-asset-enqueue.error';
import { CreateAutomationDto } from './dto/create-automation.dto';
import { UpdateAutomationDto } from './dto/update-automation.dto';
import {
  CampaignDispatchType,
  DispatchCampaignDto,
  DispatchCampaignResponse,
} from './dto/dispatch-campaign.dto';
import { EngineService } from './engine/engine.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import {
  assertCampaignAudienceConfiguration,
  EMPTY_CAMPAIGN_SEGMENTATION,
  normalizeCampaignCustomerIds,
  normalizeCampaignSegmentation,
  type CampaignSegmentationInput,
} from './campaign/campaign-segmentation';
import { PreviewCampaignAudienceDto } from './dto/preview-campaign-audience.dto';
import { MessagingChannelRoutingService } from '../messaging-channel/messaging-channel-routing.service';

@Injectable()
export class AutomationService {
  private readonly customAutomationLimit = 5;

  constructor(
    private readonly prisma: PrismaService,
    private readonly engineService: EngineService,
    private readonly messagingChannelRoutingService: MessagingChannelRoutingService,
  ) {}

  private automationTenantWhere(id: string, companyId: string) {
    return {
      id,
      companyId,
    };
  }

  async findAll(companyId: string) {
    const automations = await this.prisma.automation.findMany({
      where: {
        companyId,
      },
      include: this.campaignInterestFilterInclude(),
      orderBy: [
        {
          isSystem: 'desc',
        },
        {
          createdAt: 'desc',
        },
      ],
    });
    return automations.map((automation) =>
      this.toAutomationResponse(automation),
    );
  }

  async dispatchCampaign(
    id: string,
    data: DispatchCampaignDto,
    companyId: string,
  ): Promise<DispatchCampaignResponse> {
    const customerIds =
      data.audience.type === CampaignAudienceType.CUSTOMER_IDS
        ? normalizeCampaignCustomerIds(data.audience.customerIds)
        : undefined;

    try {
      const result = await this.engineService.enqueueCampaign(companyId, id, {
        audienceType: data.audience.type,
        customerIds,
        ...(data.type === CampaignDispatchType.TEXT
          ? { content: data.content!.trim() }
          : {
              mediaAssetId: data.mediaAssetId!.trim(),
              ...(data.caption === undefined ? {} : { caption: data.caption }),
            }),
      });

      return {
        automationId: id,
        type: data.type,
        audienceType: data.audience.type,
        eligibleCustomers: result.eligibleCustomers,
        processed: result.processed,
      };
    } catch (error) {
      if (!(error instanceof MediaAssetEnqueueError)) {
        throw error;
      }

      if (error.code === 'MEDIA_ASSET_NOT_FOUND') {
        throw new NotFoundException('Media asset was not found');
      }

      throw new ConflictException(
        error.code === 'MEDIA_ASSET_EXPIRED'
          ? 'Media asset has expired'
          : 'Media asset is not ready',
      );
    }
  }

  async previewCampaignAudience(
    id: string,
    companyId: string,
    data: PreviewCampaignAudienceDto = {},
  ) {
    const audienceType = data.audience?.type;
    const customerIds =
      audienceType === CampaignAudienceType.CUSTOMER_IDS
        ? normalizeCampaignCustomerIds(data.audience?.customerIds)
        : undefined;

    return this.engineService.previewCampaignAudience(companyId, id, {
      audienceType,
      customerIds,
    });
  }

  async create(data: CreateAutomationDto, companyId: string) {
    if (data.type === AutomationType.CAMPAIGN) {
      throw new BadRequestException(
        'Use o endpoint específico para criar campanhas.',
      );
    }

    const customAutomationCount = await this.prisma.automation.count({
      where: {
        companyId,
        isSystem: false,
        type: {
          not: AutomationType.CAMPAIGN,
        },
      },
    });

    if (customAutomationCount >= this.customAutomationLimit) {
      throw new ConflictException(
        `Limite de ${this.customAutomationLimit} automações personalizadas atingido.`,
      );
    }

    const messagingChannelId = await this.resolveConfiguredChannel(
      companyId,
      data.messagingChannelId,
    );

    try {
      return await this.prisma.automation.create({
        data: {
          name: data.name.trim(),
          type: data.type,
          daysAfter: data.daysAfter,
          message: data.message.trim(),
          cooldownHours: data.cooldownHours ?? 24,
          isActive: false,
          isSystem: false,
          systemKey: null,
          companyId,
          ...(messagingChannelId === undefined ? {} : { messagingChannelId }),
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Já existe uma automação com esse nome.');
      }

      throw error;
    }
  }

  async createCampaign(data: CreateCampaignDto, companyId: string) {
    const audienceType = data.audienceType ?? CampaignAudienceType.ALL_ELIGIBLE;
    if (audienceType === CampaignAudienceType.CUSTOMER_IDS) {
      throw new BadRequestException(
        'CUSTOMER_IDS audience is configured at dispatch time',
      );
    }
    const segmentation = normalizeCampaignSegmentation(data);
    const segmentCategoryIds = data.segmentCategoryIds ?? [];
    const segmentBrandIds = data.segmentBrandIds ?? [];
    assertCampaignAudienceConfiguration(audienceType, segmentation, {
      segmentCategoryIds,
      segmentBrandIds,
    });
    const messagingChannelId = await this.resolveConfiguredChannel(
      companyId,
      data.messagingChannelId,
    );

    try {
      const automation = await this.prisma.$transaction(async (prisma) => {
        await this.assertValidCampaignInterestOptions(
          prisma,
          companyId,
          segmentCategoryIds,
          segmentBrandIds,
        );
        const created = await prisma.automation.create({
          data: {
            name: data.name.trim(),
            type: AutomationType.CAMPAIGN,
            daysAfter: null,
            message: null,
            isActive: true,
            cooldownHours: 24,
            isSystem: false,
            systemKey: null,
            companyId,
            campaignAudienceType: audienceType,
            ...(messagingChannelId === undefined ? {} : { messagingChannelId }),
            ...segmentation,
          },
        });
        const interestOptionIds = [...segmentCategoryIds, ...segmentBrandIds];
        if (interestOptionIds.length > 0) {
          await prisma.campaignInterestFilter.createMany({
            data: interestOptionIds.map((interestOptionId) => ({
              companyId,
              automationId: created.id,
              interestOptionId,
            })),
          });
        }
        return prisma.automation.findUniqueOrThrow({
          where: { id: created.id },
          include: this.campaignInterestFilterInclude(),
        });
      });
      return this.toAutomationResponse(automation);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        !this.isCampaignInterestFilterUniqueViolation(error)
      ) {
        throw new ConflictException('Já existe uma campanha com esse nome.');
      }

      throw error;
    }
  }

  async update(id: string, data: UpdateAutomationDto, companyId: string) {
    const automation = await this.prisma.automation.findFirst({
      where: this.automationTenantWhere(id, companyId),
      include: this.campaignInterestFilterInclude(),
    });

    if (!automation) {
      throw new NotFoundException('Automação não encontrada.');
    }

    if (
      automation.type === AutomationType.CAMPAIGN &&
      (data.daysAfter !== undefined ||
        data.message !== undefined ||
        data.cooldownHours !== undefined)
    ) {
      throw new BadRequestException(
        'Campanhas não possuem regra recorrente ou conteúdo persistido.',
      );
    }

    const hasCampaignConfiguration =
      data.audienceType !== undefined || this.hasSegmentationInput(data);

    if (
      automation.type !== AutomationType.CAMPAIGN &&
      hasCampaignConfiguration
    ) {
      throw new BadRequestException(
        'Segment configuration is only available for campaigns.',
      );
    }

    const messagingChannelUpdate = await this.prepareChannelUpdate(
      companyId,
      data.messagingChannelId,
    );

    if (automation.type === AutomationType.CAMPAIGN) {
      return this.updateCampaign(
        id,
        companyId,
        automation,
        data,
        messagingChannelUpdate,
      );
    }

    /*
     * Automação padrão de aniversário:
     * - nome fixo
     * - tipo fixo
     * - regra de aniversário fixa
     * - permite editar mensagem e status
     */
    if (automation.isSystem && automation.systemKey === 'BIRTHDAY_DEFAULT') {
      return this.prisma.automation.update({
        where: {
          id,
        },
        data: {
          ...(data.message !== undefined && {
            message: data.message.trim(),
          }),
          ...(data.isActive !== undefined && {
            isActive: data.isActive,
          }),
          ...messagingChannelUpdate,
        },
      });
    }

    /*
     * Automação padrão de reativação:
     * - nome fixo
     * - tipo fixo
     * - permite editar mensagem, dias e status
     */
    if (
      automation.isSystem &&
      automation.systemKey === 'REACTIVATION_30_DAYS'
    ) {
      return this.prisma.automation.update({
        where: {
          id,
        },
        data: {
          ...(data.message !== undefined && {
            message: data.message.trim(),
          }),
          ...(data.daysAfter !== undefined && {
            daysAfter: data.daysAfter,
          }),
          ...(data.isActive !== undefined && {
            isActive: data.isActive,
          }),
          ...messagingChannelUpdate,
        },
      });
    }

    /*
     * Proteção para qualquer outra automação do sistema
     * que possa ser adicionada futuramente.
     */
    if (automation.isSystem) {
      throw new ForbiddenException(
        'Esta automação padrão não pode ser editada.',
      );
    }

    /*
     * Automação personalizada:
     * permite editar todos os campos configuráveis.
     */
    try {
      return await this.prisma.automation.update({
        where: {
          id,
        },
        data: {
          ...(data.name !== undefined && {
            name: data.name.trim(),
          }),
          ...(data.message !== undefined && {
            message: data.message.trim(),
          }),
          ...(data.daysAfter !== undefined && {
            daysAfter: data.daysAfter,
          }),
          ...(data.cooldownHours !== undefined && {
            cooldownHours: data.cooldownHours,
          }),
          ...(data.isActive !== undefined && {
            isActive: data.isActive,
          }),
          ...messagingChannelUpdate,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Já existe uma automação com esse nome.');
      }

      throw error;
    }
  }

  private async updateCampaign(
    id: string,
    companyId: string,
    automation: CampaignSegmentationInput & {
      campaignAudienceType?: CampaignAudienceType;
      campaignInterestFilters?: Array<{
        interestOptionId: string;
        interestOption: { type: CustomerInterestType };
      }>;
    },
    data: UpdateAutomationDto,
    messagingChannelUpdate: { messagingChannelId?: string | null },
  ) {
    const hasConfigurationChange =
      data.audienceType !== undefined || this.hasSegmentationInput(data);

    if (!hasConfigurationChange) {
      try {
        const updated = await this.prisma.automation.update({
          where: { id },
          data: {
            ...(data.name === undefined ? {} : { name: data.name.trim() }),
            ...(data.isActive === undefined ? {} : { isActive: data.isActive }),
            ...messagingChannelUpdate,
          },
          include: this.campaignInterestFilterInclude(),
        });
        return this.toAutomationResponse(updated);
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw new ConflictException('Já existe uma automação com esse nome.');
        }
        throw error;
      }
    }

    const audienceType =
      data.audienceType ??
      automation.campaignAudienceType ??
      CampaignAudienceType.ALL_ELIGIBLE;

    if (audienceType === CampaignAudienceType.CUSTOMER_IDS) {
      throw new BadRequestException(
        'CUSTOMER_IDS audience is configured at preview or dispatch time',
      );
    }

    if (
      audienceType !== CampaignAudienceType.SEGMENTED &&
      this.hasSegmentationInput(data)
    ) {
      throw new BadRequestException(
        'Segment filters are only allowed for SEGMENTED audience',
      );
    }

    const currentCategoryIds = this.getInterestIds(
      automation,
      CustomerInterestType.CATEGORY,
    );
    const currentBrandIds = this.getInterestIds(
      automation,
      CustomerInterestType.BRAND,
    );
    const categoryWasProvided = data.segmentCategoryIds !== undefined;
    const brandWasProvided = data.segmentBrandIds !== undefined;
    const segmentCategoryIds =
      audienceType === CampaignAudienceType.SEGMENTED
        ? categoryWasProvided
          ? (data.segmentCategoryIds ?? [])
          : currentCategoryIds
        : [];
    const segmentBrandIds =
      audienceType === CampaignAudienceType.SEGMENTED
        ? brandWasProvided
          ? (data.segmentBrandIds ?? [])
          : currentBrandIds
        : [];

    const segmentation =
      audienceType === CampaignAudienceType.SEGMENTED
        ? normalizeCampaignSegmentation({
            ...automation,
            ...this.pickSegmentationInput(data),
          })
        : EMPTY_CAMPAIGN_SEGMENTATION;
    assertCampaignAudienceConfiguration(audienceType, segmentation, {
      segmentCategoryIds,
      segmentBrandIds,
    });

    try {
      const updated = await this.prisma.$transaction(async (prisma) => {
        await this.assertValidCampaignInterestOptions(
          prisma,
          companyId,
          categoryWasProvided ? segmentCategoryIds : [],
          brandWasProvided ? segmentBrandIds : [],
        );

        if (audienceType !== CampaignAudienceType.SEGMENTED) {
          await prisma.campaignInterestFilter.deleteMany({
            where: { companyId, automationId: id },
          });
        } else {
          await this.replaceCampaignInterestFilterGroup(
            prisma,
            companyId,
            id,
            CustomerInterestType.CATEGORY,
            segmentCategoryIds,
            categoryWasProvided,
          );
          await this.replaceCampaignInterestFilterGroup(
            prisma,
            companyId,
            id,
            CustomerInterestType.BRAND,
            segmentBrandIds,
            brandWasProvided,
          );
        }

        return prisma.automation.update({
          where: { id },
          data: {
            ...(data.name === undefined ? {} : { name: data.name.trim() }),
            ...(data.isActive === undefined ? {} : { isActive: data.isActive }),
            campaignAudienceType: audienceType,
            ...messagingChannelUpdate,
            ...segmentation,
          },
          include: this.campaignInterestFilterInclude(),
        });
      });
      return this.toAutomationResponse(updated);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        !this.isCampaignInterestFilterUniqueViolation(error)
      ) {
        throw new ConflictException('Já existe uma automação com esse nome.');
      }
      throw error;
    }
  }

  private hasSegmentationInput(
    input: CampaignSegmentationInput & {
      segmentCategoryIds?: readonly string[] | null;
      segmentBrandIds?: readonly string[] | null;
    },
  ): boolean {
    return (
      Object.keys(this.pickSegmentationInput(input)).length > 0 ||
      input.segmentCategoryIds !== undefined ||
      input.segmentBrandIds !== undefined
    );
  }

  private async resolveConfiguredChannel(
    companyId: string,
    messagingChannelId?: string,
  ): Promise<string | undefined> {
    if (messagingChannelId === undefined) return undefined;

    const selection =
      await this.messagingChannelRoutingService.resolveForEnqueue(
        companyId,
        messagingChannelId,
      );
    return selection.messagingChannelId;
  }

  private async prepareChannelUpdate(
    companyId: string,
    messagingChannelId?: string | null,
  ): Promise<{ messagingChannelId?: string | null }> {
    if (messagingChannelId === undefined) return {};
    if (messagingChannelId === null) return { messagingChannelId: null };

    return {
      messagingChannelId: await this.resolveConfiguredChannel(
        companyId,
        messagingChannelId,
      ),
    };
  }

  private pickSegmentationInput(
    input: CampaignSegmentationInput,
  ): CampaignSegmentationInput {
    const result: CampaignSegmentationInput = {};
    const keys = [
      'segmentGender',
      'segmentCity',
      'segmentState',
      'segmentMinAge',
      'segmentMaxAge',
      'segmentLastPurchaseBefore',
      'segmentLastPurchaseAfter',
    ] as const;

    for (const key of keys) {
      if (input[key] !== undefined) result[key] = input[key] as never;
    }
    return result;
  }

  private campaignInterestFilterInclude() {
    return {
      campaignInterestFilters: {
        select: {
          interestOptionId: true,
          interestOption: { select: { type: true } },
        },
      },
    } satisfies Prisma.AutomationInclude;
  }

  private getInterestIds(
    automation: {
      campaignInterestFilters?: Array<{
        interestOptionId: string;
        interestOption: { type: CustomerInterestType };
      }>;
    },
    type: CustomerInterestType,
  ): string[] {
    return (automation.campaignInterestFilters ?? [])
      .filter((filter) => filter.interestOption.type === type)
      .map((filter) => filter.interestOptionId);
  }

  private toAutomationResponse<
    T extends {
      type: AutomationType;
      campaignInterestFilters?: Array<{
        interestOptionId: string;
        interestOption: { type: CustomerInterestType };
      }>;
    },
  >(automation: T) {
    const { campaignInterestFilters: _filters, ...response } = automation;
    void _filters;
    if (automation.type !== AutomationType.CAMPAIGN) return response;

    return {
      ...response,
      segmentCategoryIds: this.getInterestIds(
        automation,
        CustomerInterestType.CATEGORY,
      ),
      segmentBrandIds: this.getInterestIds(
        automation,
        CustomerInterestType.BRAND,
      ),
    };
  }

  private async assertValidCampaignInterestOptions(
    prisma: Pick<Prisma.TransactionClient, 'customerInterestOption'>,
    companyId: string,
    segmentCategoryIds: readonly string[],
    segmentBrandIds: readonly string[],
  ): Promise<void> {
    const interestOptionIds = [...segmentCategoryIds, ...segmentBrandIds];
    if (interestOptionIds.length === 0) return;

    const options = await prisma.customerInterestOption.findMany({
      where: {
        companyId,
        active: true,
        id: { in: interestOptionIds },
      },
      select: { id: true, type: true },
    });
    const optionTypes = new Map(
      options.map((option) => [option.id, option.type]),
    );
    const valid =
      options.length === interestOptionIds.length &&
      segmentCategoryIds.every(
        (id) => optionTypes.get(id) === CustomerInterestType.CATEGORY,
      ) &&
      segmentBrandIds.every(
        (id) => optionTypes.get(id) === CustomerInterestType.BRAND,
      );
    if (!valid) {
      throw new BadRequestException(
        'Uma ou mais opções de interesse da campanha são inválidas.',
      );
    }
  }

  private async replaceCampaignInterestFilterGroup(
    prisma: Pick<Prisma.TransactionClient, 'campaignInterestFilter'>,
    companyId: string,
    automationId: string,
    type: CustomerInterestType,
    interestOptionIds: readonly string[],
    replace: boolean,
  ): Promise<void> {
    if (!replace) return;

    await prisma.campaignInterestFilter.deleteMany({
      where: {
        companyId,
        automationId,
        interestOption: { is: { type } },
      },
    });
    if (interestOptionIds.length > 0) {
      await prisma.campaignInterestFilter.createMany({
        data: interestOptionIds.map((interestOptionId) => ({
          companyId,
          automationId,
          interestOptionId,
        })),
      });
    }
  }

  private isCampaignInterestFilterUniqueViolation(
    error: Prisma.PrismaClientKnownRequestError,
  ): boolean {
    const target = error.meta?.target;
    const fields = Array.isArray(target)
      ? target.map(String)
      : typeof target === 'string'
        ? [target]
        : [];
    return (
      fields.some((field) => field.includes('automationId')) &&
      fields.some((field) => field.includes('interestOptionId'))
    );
  }

  async remove(id: string, companyId: string) {
    return this.prisma.$transaction(async (prisma) => {
      const automation = await prisma.automation.findFirst({
        where: this.automationTenantWhere(id, companyId),
      });

      if (!automation) {
        throw new NotFoundException('Automação não encontrada.');
      }

      if (automation.isSystem) {
        throw new ForbiddenException(
          'Automações padrão do sistema não podem ser excluídas.',
        );
      }

      await prisma.messageLog.deleteMany({
        where: {
          automationId: automation.id,
          automation: {
            is: {
              companyId,
            },
          },
        },
      });

      await prisma.automation.deleteMany({
        where: this.automationTenantWhere(id, companyId),
      });

      return {
        message: 'Automação excluída com sucesso.',
        automation,
      };
    });
  }
}
