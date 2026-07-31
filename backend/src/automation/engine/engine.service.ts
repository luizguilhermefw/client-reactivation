import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  LogStatus,
  OutboundMessageSource,
  OutboundMessageStatus,
} from '@prisma/client';
import { QueueService } from '../../queue/queue.service';

@Injectable()
export class EngineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
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
    const customers = await this.prisma.customer.findMany({
      where: {
        companyId: automation.companyId,
        isActiveForAutomation: true,
      },
    });

    for (const customer of customers) {
      if (!customer.lastPurchaseDate) continue;

      const lastPurchase = new Date(customer.lastPurchaseDate);
      const today = new Date();

      const diffDays = Math.floor(
        (today.getTime() - lastPurchase.getTime()) / (1000 * 60 * 60 * 24),
      );

      if (diffDays < automation.daysAfter) continue;

      const canSend = await this.canSendMessage(customer.id, automation);
      if (!canSend) continue;

      await this.sendMessage(customer, automation);
    }
  }

  async handleBirthday(automation: any) {
    const customers = await this.prisma.customer.findMany({
      where: {
        companyId: automation.companyId,
        birthDate: { not: null },
        isActiveForAutomation: true,
      },
    });

    const todayDay = this.formatDateInAppTimezone(new Date()).slice(5);

    for (const customer of customers) {
      if (!customer.birthDate) continue;

      const birthDate = new Date(customer.birthDate);
      const birthDay = [
        String(birthDate.getUTCMonth() + 1).padStart(2, '0'),
        String(birthDate.getUTCDate()).padStart(2, '0'),
      ].join('-');

      if (birthDay !== todayDay) continue;

      const canSend = await this.canSendMessage(customer.id, automation);
      if (!canSend) continue;

      await this.sendMessage(customer, automation);
    }
  }

  async handleMaintenance(automation: any) {
    await this.handleReactivation(automation);
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

  async sendMessage(customer: any, automation: any) {
    if (customer.companyId !== automation.companyId) {
      throw new Error('Cliente e automação pertencem a empresas diferentes');
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
