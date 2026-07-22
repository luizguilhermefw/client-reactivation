import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import { LogStatus } from '@prisma/client';
import { MessageService } from '../../message/message.service';

@Injectable()
export class EngineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly messageService: MessageService, // 👈 novo
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

    const today = new Date();
    const todayDay = today.toISOString().slice(5, 10); // "MM-DD"

    for (const customer of customers) {
      if (!customer.birthDate) continue;

      const birth = new Date(customer.birthDate);
      const birthDay = birth.toISOString().slice(5, 10);

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
        customerId,
        automationId: automation.id,
        customer: {
          is: {
            companyId: automation.companyId,
          },
        },
        automation: {
          is: {
            companyId: automation.companyId,
          },
        },
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

    try {
      console.log(`Enviando mensagem de automação ${automation.id}`);

      const personalizedMessage = automation.message.replace(
        /{{\s*nome\s*}}/gi,
        customer.name,
      );

      await this.messageService.sendMessage({
        to: customer.phone,
        type: 'text',
        content: personalizedMessage,
      });

      await this.prisma.messageLog.create({
        data: {
          customerId: customer.id,
          automationId: automation.id,
          scheduledDate: new Date(),
          sentAt: new Date(),
          status: LogStatus.SENT,
        },
      });
    } catch {
      console.log(`Erro ao enviar mensagem da automação ${automation.id}`);

      await this.prisma.messageLog.create({
        data: {
          customerId: customer.id,
          automationId: automation.id,
          scheduledDate: new Date(),
          status: LogStatus.FAILED,
        },
      });
    }
  }
}
