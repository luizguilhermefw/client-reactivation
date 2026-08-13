import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  LogStatus,
  OutboundMessageSource,
  OutboundMessageStatus,
  OutboundMessageType,
  UnknownContactPolicy,
} from '@prisma/client';
import { CustomerEligibilityService } from '../../customer/customer-eligibility.service';
import { QueueService } from '../../queue/queue.service';

export interface EnqueueCampaignInput {
  customerIds?: string[];
  content?: string;
  mediaAssetId?: string;
  caption?: string;
}

export interface EnqueueCampaignResult {
  eligibleCustomers: number;
  processed: number;
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

    const unknownContactPolicy = await this.getUnknownContactPolicy(
      automation.companyId,
    );
    if (!unknownContactPolicy) return;

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
          unknownContactPolicy,
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

      await this.sendMessage(customer, automation, unknownContactPolicy);
    }
  }

  async handleBirthday(automation: any) {
    this.assertRecurringAutomationConfiguration(automation, false);

    const unknownContactPolicy = await this.getUnknownContactPolicy(
      automation.companyId,
    );
    if (!unknownContactPolicy) return;

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
          unknownContactPolicy,
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

      await this.sendMessage(customer, automation, unknownContactPolicy);
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

    const unknownContactPolicy = await this.getUnknownContactPolicy(companyId);
    if (!unknownContactPolicy) {
      return { eligibleCustomers: 0, processed: 0 };
    }

    const customerIds = input.customerIds
      ? [...new Set(input.customerIds.filter(Boolean))]
      : undefined;
    const customers = await this.prisma.customer.findMany({
      where: {
        companyId,
        isActiveForAutomation: true,
        ...(customerIds === undefined ? {} : { id: { in: customerIds } }),
      },
    });

    const eligibleCustomers = customers.filter((customer) =>
      this.customerEligibilityService.isEligibleForAutomation(
        customer,
        unknownContactPolicy,
      ),
    );

    for (const customer of eligibleCustomers) {
      await this.enqueueCampaignMessage(customer, automation, input);
    }

    return {
      eligibleCustomers: eligibleCustomers.length,
      processed: eligibleCustomers.length,
    };
  }

  private async enqueueCampaignMessage(
    customer: any,
    automation: any,
    input: EnqueueCampaignInput,
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
      const personalizedCaption = input.caption?.replace(
        /{{\s*nome\s*}}/gi,
        customer.name,
      );

      await this.queueService.enqueue({
        companyId: automation.companyId,
        customerId: customer.id,
        automationId: automation.id,
        source: OutboundMessageSource.CAMPAIGN,
        type: OutboundMessageType.IMAGE,
        mediaAssetId: input.mediaAssetId,
        recipientPhone: customer.phone,
        payload:
          personalizedCaption === undefined
            ? {}
            : { caption: personalizedCaption },
        idempotencyKey,
      });
      return;
    }

    if (typeof input.content !== 'string' || !input.content.trim()) {
      throw new BadRequestException('Campaign text content is required');
    }

    const personalizedText = input.content.replace(
      /{{\s*nome\s*}}/gi,
      customer.name,
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
  ) {
    if (customer.companyId !== automation.companyId) {
      throw new Error('Cliente e automação pertencem a empresas diferentes');
    }

    const unknownContactPolicy =
      resolvedUnknownContactPolicy ??
      (await this.getUnknownContactPolicy(automation.companyId));

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

    const personalizedMessage = automation.message.replace(
      /{{\s*nome\s*}}/gi,
      customer.name,
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

  private async getUnknownContactPolicy(
    companyId: string,
  ): Promise<UnknownContactPolicy | null> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { unknownContactPolicy: true },
    });

    return company?.unknownContactPolicy ?? null;
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
