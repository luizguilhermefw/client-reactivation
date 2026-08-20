import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  CampaignAudienceType,
  CustomerGender,
  LogStatus,
  Prisma,
  OutboundMessageSource,
  OutboundMessageStatus,
  OutboundMessageType,
  UnknownContactPolicy,
} from '@prisma/client';
import { CustomerEligibilityService } from '../../customer/customer-eligibility.service';
import { QueueService } from '../../queue/queue.service';
import { MAX_IMAGE_CAPTION_LENGTH } from '../../queue/dto/enqueue-message.input';
import {
  buildCampaignOutboundContent,
  MAX_CAMPAIGN_TEXT_LENGTH,
} from '../campaign/campaign-message';
import {
  assertCampaignAudienceConfiguration,
  buildSegmentedCustomerWhere,
  normalizeCampaignCustomerIds,
  normalizeCampaignSegmentation,
} from '../campaign/campaign-segmentation';

export interface EnqueueCampaignInput {
  audienceType?: CampaignAudienceType;
  customerIds?: string[];
  content?: string;
  mediaAssetId?: string;
  caption?: string;
}

export interface EnqueueCampaignResult {
  eligibleCustomers: number;
  processed: number;
}

export interface CampaignAudiencePreviewResult {
  audienceType: CampaignAudienceType;
  matched: number;
  eligible: number;
  blocked: number;
}

export interface PreviewCampaignAudienceInput {
  audienceType?: CampaignAudienceType;
  customerIds?: string[];
}

interface CompanyMessagingPolicy {
  unknownContactPolicy: UnknownContactPolicy;
  includeOptOutInstructions: boolean;
}

@Injectable()
export class EngineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
    private readonly customerEligibilityService: CustomerEligibilityService,
  ) {}

  @Cron('*/1 * * * *')
  async handleCron() {
    console.log('🚀 Rodando automations...');

    const automations = await this.prisma.automation.findMany({
      where: { isActive: true },
    });

    for (const automation of automations) {
      switch (automation.type) {
        case 'REACTIVATION':
          await this.handleReactivation(automation);
          break;

        case 'BIRTHDAY':
          await this.handleBirthday(automation);
          break;

        case 'CAMPAIGN':
          break;

        case 'MAINTENANCE':
          await this.handleMaintenance(automation);
          break;

        default:
          console.log(`⚠️ Tipo desconhecido: ${automation.type}`);
      }
    }
  }

  async handleReactivation(automation: any) {
    this.assertRecurringAutomationConfiguration(automation, true);

    const messagingPolicy = await this.getCompanyMessagingPolicy(
      automation.companyId,
    );
    if (!messagingPolicy) return;

    const customers = await this.prisma.customer.findMany({
      where: {
        companyId: automation.companyId,
        isActiveForAutomation: true,
      },
    });

    for (const customer of customers) {
      if (
        !this.customerEligibilityService.isEligibleForAutomation(
          customer,
          messagingPolicy.unknownContactPolicy,
        )
      ) {
        continue;
      }

      if (!customer.lastPurchaseDate) continue;

      const lastPurchase = new Date(customer.lastPurchaseDate);
      const today = new Date();

      const diffDays = Math.floor(
        (today.getTime() - lastPurchase.getTime()) / (1000 * 60 * 60 * 24),
      );

      if (diffDays < automation.daysAfter) continue;

      const canSend = await this.canSendMessage(customer.id, automation);
      if (!canSend) continue;

      await this.sendMessage(
        customer,
        automation,
        messagingPolicy.unknownContactPolicy,
        messagingPolicy.includeOptOutInstructions,
      );
    }
  }

  async handleBirthday(automation: any) {
    this.assertRecurringAutomationConfiguration(automation, false);

    const messagingPolicy = await this.getCompanyMessagingPolicy(
      automation.companyId,
    );
    if (!messagingPolicy) return;

    const customers = await this.prisma.customer.findMany({
      where: {
        companyId: automation.companyId,
        birthDate: { not: null },
        isActiveForAutomation: true,
      },
    });

    const todayDay = this.formatDateInAppTimezone(new Date()).slice(5);

    for (const customer of customers) {
      if (
        !this.customerEligibilityService.isEligibleForAutomation(
          customer,
          messagingPolicy.unknownContactPolicy,
        )
      ) {
        continue;
      }

      if (!customer.birthDate) continue;

      const birthDate = new Date(customer.birthDate);
      const birthDay = [
        String(birthDate.getUTCMonth() + 1).padStart(2, '0'),
        String(birthDate.getUTCDate()).padStart(2, '0'),
      ].join('-');

      if (birthDay !== todayDay) continue;

      const canSend = await this.canSendMessage(customer.id, automation);
      if (!canSend) continue;

      await this.sendMessage(
        customer,
        automation,
        messagingPolicy.unknownContactPolicy,
        messagingPolicy.includeOptOutInstructions,
      );
    }
  }

  async handleMaintenance(automation: any) {
    await this.handleReactivation(automation);
  }

  async enqueueCampaign(
    companyId: string,
    automationId: string,
    input: EnqueueCampaignInput = {},
  ): Promise<EnqueueCampaignResult> {
    if (
      !input.mediaAssetId &&
      (typeof input.content !== 'string' || !input.content.trim())
    ) {
      throw new BadRequestException('Campaign text content is required');
    }

    const automation = await this.prisma.automation.findFirst({
      where: {
        id: automationId,
        companyId,
        type: 'CAMPAIGN',
        isActive: true,
      },
    });

    if (!automation) {
      throw new NotFoundException('Campanha não encontrada');
    }

    const customerIds = normalizeCampaignCustomerIds(input.customerIds);
    const audienceType =
      input.audienceType ??
      (customerIds === undefined
        ? CampaignAudienceType.ALL_ELIGIBLE
        : CampaignAudienceType.CUSTOMER_IDS);
    this.assertPersistedCampaignAudienceAllows(
      automation.campaignAudienceType ?? CampaignAudienceType.ALL_ELIGIBLE,
      audienceType,
    );
    this.assertCampaignCustomerIdsMatchAudience(audienceType, customerIds);
    const where = this.buildCampaignAudienceWhere(
      companyId,
      automation,
      audienceType,
      customerIds,
    );
    const messagingPolicy = await this.getCompanyMessagingPolicy(companyId);
    if (!messagingPolicy) {
      return { eligibleCustomers: 0, processed: 0 };
    }
    const customers = await this.prisma.customer.findMany({
      where,
    });

    const eligibleCustomers = customers.filter((customer) =>
      this.customerEligibilityService.isEligibleForAutomation(
        customer,
        messagingPolicy.unknownContactPolicy,
      ),
    );

    for (const customer of eligibleCustomers) {
      this.prepareCampaignOutboundContent(
        customer,
        input,
        messagingPolicy.includeOptOutInstructions,
      );
    }

    for (const customer of eligibleCustomers) {
      await this.enqueueCampaignMessage(
        customer,
        automation,
        input,
        messagingPolicy.includeOptOutInstructions,
      );
    }

    return {
      eligibleCustomers: eligibleCustomers.length,
      processed: eligibleCustomers.length,
    };
  }

  async previewCampaignAudience(
    companyId: string,
    automationId: string,
    input: PreviewCampaignAudienceInput = {},
  ): Promise<CampaignAudiencePreviewResult> {
    const automation = await this.prisma.automation.findFirst({
      where: {
        id: automationId,
        companyId,
        type: 'CAMPAIGN',
      },
    });

    if (!automation) {
      throw new NotFoundException('Campanha não encontrada');
    }

    const persistedAudienceType =
      automation.campaignAudienceType ?? CampaignAudienceType.ALL_ELIGIBLE;
    const audienceType = input.audienceType ?? persistedAudienceType;
    const customerIds = normalizeCampaignCustomerIds(input.customerIds);
    this.assertPersistedCampaignAudienceAllows(
      persistedAudienceType,
      audienceType,
    );
    this.assertCampaignCustomerIdsMatchAudience(audienceType, customerIds);

    const customers = await this.prisma.customer.findMany({
      where: this.buildCampaignAudienceWhere(
        companyId,
        automation,
        audienceType,
        customerIds,
        false,
      ),
      select: {
        isActiveForAutomation: true,
        contactConsentStatus: true,
      },
    });
    const messagingPolicy = await this.getCompanyMessagingPolicy(companyId);
    const eligible = messagingPolicy
      ? customers.filter((customer) =>
          this.customerEligibilityService.isEligibleForAutomation(
            customer,
            messagingPolicy.unknownContactPolicy,
          ),
        ).length
      : 0;

    return {
      audienceType,
      matched: customers.length,
      eligible,
      blocked: customers.length - eligible,
    };
  }

  private assertPersistedCampaignAudienceAllows(
    persistedAudienceType: CampaignAudienceType,
    requestedAudienceType: CampaignAudienceType,
  ): void {
    if (
      persistedAudienceType === CampaignAudienceType.SEGMENTED &&
      requestedAudienceType !== CampaignAudienceType.SEGMENTED
    ) {
      throw new BadRequestException(
        'Segmented campaign audience cannot be overridden',
      );
    }
  }

  private assertCampaignCustomerIdsMatchAudience(
    audienceType: CampaignAudienceType,
    customerIds: string[] | undefined,
  ): void {
    if (
      (audienceType !== CampaignAudienceType.CUSTOMER_IDS &&
        customerIds !== undefined) ||
      (audienceType === CampaignAudienceType.CUSTOMER_IDS &&
        customerIds === undefined)
    ) {
      throw new BadRequestException(
        'Campaign audience does not match the supplied customer IDs',
      );
    }
  }

  private buildCampaignAudienceWhere(
    companyId: string,
    automation: {
      campaignAudienceType?: CampaignAudienceType;
      segmentGender?: CustomerGender | null;
      segmentCity?: string | null;
      segmentState?: string | null;
      segmentMinAge?: number | null;
      segmentMaxAge?: number | null;
      segmentLastPurchaseBefore?: Date | null;
      segmentLastPurchaseAfter?: Date | null;
    },
    audienceType: CampaignAudienceType,
    customerIds?: string[],
    activeOnly = true,
  ): Prisma.CustomerWhereInput {
    if (audienceType === CampaignAudienceType.SEGMENTED) {
      if (automation.campaignAudienceType !== CampaignAudienceType.SEGMENTED) {
        throw new BadRequestException(
          'Segmented campaign filters are not configured',
        );
      }
      const segmentation = normalizeCampaignSegmentation(automation);
      assertCampaignAudienceConfiguration(audienceType, segmentation);
      return buildSegmentedCustomerWhere(companyId, segmentation);
    }

    return {
      companyId,
      ...(activeOnly ? { isActiveForAutomation: true } : {}),
      ...(audienceType === CampaignAudienceType.CUSTOMER_IDS
        ? { id: { in: customerIds ?? [] } }
        : {}),
    };
  }

  private async enqueueCampaignMessage(
    customer: any,
    automation: any,
    input: EnqueueCampaignInput,
    includeOptOutInstructions: boolean,
  ): Promise<void> {
    if (customer.companyId !== automation.companyId) {
      throw new Error('Cliente e automação pertencem a empresas diferentes');
    }

    const activeMessage = await this.prisma.outboundMessage.findFirst({
      where: {
        companyId: automation.companyId,
        customerId: customer.id,
        automationId: automation.id,
        status: {
          in: [OutboundMessageStatus.PENDING, OutboundMessageStatus.PROCESSING],
        },
      },
      select: {
        id: true,
      },
    });

    if (activeMessage) {
      return;
    }

    const idempotencyKey = `campaign:${automation.id}:customer:${customer.id}`;

    if (input.mediaAssetId) {
      const personalizedCaption = buildCampaignOutboundContent(
        input.caption,
        customer.name,
        MAX_IMAGE_CAPTION_LENGTH,
        includeOptOutInstructions,
      );

      await this.queueService.enqueue({
        companyId: automation.companyId,
        customerId: customer.id,
        automationId: automation.id,
        source: OutboundMessageSource.CAMPAIGN,
        type: OutboundMessageType.IMAGE,
        mediaAssetId: input.mediaAssetId,
        recipientPhone: customer.phone,
        payload: { caption: personalizedCaption },
        idempotencyKey,
      });
      return;
    }

    if (typeof input.content !== 'string' || !input.content.trim()) {
      throw new BadRequestException('Campaign text content is required');
    }

    const personalizedText = buildCampaignOutboundContent(
      input.content,
      customer.name,
      MAX_CAMPAIGN_TEXT_LENGTH,
      includeOptOutInstructions,
    );

    await this.queueService.enqueue({
      companyId: automation.companyId,
      customerId: customer.id,
      automationId: automation.id,
      source: OutboundMessageSource.CAMPAIGN,
      type: OutboundMessageType.TEXT,
      recipientPhone: customer.phone,
      content: personalizedText,
      idempotencyKey,
    });
  }

  private prepareCampaignOutboundContent(
    customer: { name: string },
    input: EnqueueCampaignInput,
    includeOptOutInstructions: boolean,
  ): void {
    buildCampaignOutboundContent(
      input.mediaAssetId ? input.caption : input.content,
      customer.name,
      input.mediaAssetId ? MAX_IMAGE_CAPTION_LENGTH : MAX_CAMPAIGN_TEXT_LENGTH,
      includeOptOutInstructions,
    );
  }

  async canSendMessage(customerId: string, automation: any) {
    const cooldown = automation.cooldownHours ?? 24;

    const recentLog = await this.prisma.messageLog.findFirst({
      where: {
        companyId: automation.companyId,
        customerId,
        automationId: automation.id,
        status: LogStatus.SENT,
        sentAt: {
          gte: new Date(Date.now() - cooldown * 60 * 60 * 1000),
        },
      },
    });

    if (recentLog) {
      console.log(`⏱️ BLOQUEADO (${cooldown}h) → customer ${customerId}`);
      return false;
    }

    return true;
  }

  async sendMessage(
    customer: any,
    automation: any,
    resolvedUnknownContactPolicy?: UnknownContactPolicy,
    resolvedIncludeOptOutInstructions?: boolean,
  ) {
    if (customer.companyId !== automation.companyId) {
      throw new Error('Cliente e automação pertencem a empresas diferentes');
    }

    const resolvedMessagingPolicy =
      resolvedUnknownContactPolicy === undefined ||
      resolvedIncludeOptOutInstructions === undefined
        ? await this.getCompanyMessagingPolicy(automation.companyId)
        : null;
    const unknownContactPolicy =
      resolvedUnknownContactPolicy ??
      resolvedMessagingPolicy?.unknownContactPolicy ??
      null;
    const includeOptOutInstructions =
      resolvedIncludeOptOutInstructions ??
      resolvedMessagingPolicy?.includeOptOutInstructions ??
      true;

    if (
      !unknownContactPolicy ||
      !this.customerEligibilityService.isEligibleForAutomation(
        customer,
        unknownContactPolicy,
      )
    ) {
      return;
    }

    const activeMessage = await this.prisma.outboundMessage.findFirst({
      where: {
        companyId: customer.companyId,
        customerId: customer.id,
        automationId: automation.id,
        status: {
          in: [OutboundMessageStatus.PENDING, OutboundMessageStatus.PROCESSING],
        },
      },
      select: {
        id: true,
      },
    });

    if (activeMessage) {
      return;
    }

    if (typeof automation.message !== 'string' || !automation.message.trim()) {
      throw new Error('Automation configuration is invalid');
    }

    const personalizedMessage = buildCampaignOutboundContent(
      automation.message,
      customer.name,
      MAX_CAMPAIGN_TEXT_LENGTH,
      includeOptOutInstructions,
    );

    await this.queueService.enqueue({
      companyId: customer.companyId,
      customerId: customer.id,
      automationId: automation.id,
      source: OutboundMessageSource.AUTOMATION,
      recipientPhone: customer.phone,
      content: personalizedMessage,
      idempotencyKey: this.buildIdempotencyKey(customer.id, automation),
    });
  }

  private buildIdempotencyKey(customerId: string, automation: any): string {
    const date = this.formatDateInAppTimezone(new Date());
    const cycle = automation.type === 'BIRTHDAY' ? 'birthday' : 'cycle';

    return `automation:${automation.id}:customer:${customerId}:${cycle}:${date}`;
  }

  private async getCompanyMessagingPolicy(
    companyId: string,
  ): Promise<CompanyMessagingPolicy | null> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: {
        unknownContactPolicy: true,
        includeOptOutInstructions: true,
      },
    });

    return company
      ? {
          unknownContactPolicy: company.unknownContactPolicy,
          includeOptOutInstructions:
            company.includeOptOutInstructions !== false,
        }
      : null;
  }

  private assertRecurringAutomationConfiguration(
    automation: any,
    requiresDaysAfter: boolean,
  ): void {
    const hasMessage =
      typeof automation.message === 'string' && automation.message.trim();
    const hasDaysAfter =
      Number.isInteger(automation.daysAfter) && automation.daysAfter > 0;

    if (!hasMessage || (requiresDaysAfter && !hasDaysAfter)) {
      throw new Error('Automation configuration is invalid');
    }
  }

  private formatDateInAppTimezone(date: Date): string {
    const timeZone = process.env.APP_TIMEZONE?.trim() || 'America/Sao_Paulo';
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const dateParts = Object.fromEntries(
      parts.map(({ type, value }) => [type, value]),
    );

    return `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
  }
}
