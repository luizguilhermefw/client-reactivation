import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { CreateAutomationDto } from './dto/create-automation.dto';
import { UpdateAutomationDto } from './dto/update-automation.dto';

@Injectable()
export class AutomationService {
  private readonly customAutomationLimit = 5;

  constructor(private readonly prisma: PrismaService) {}

  private automationTenantWhere(id: string, companyId: string) {
    return {
      id,
      companyId,
    };
  }

  async findAll(companyId: string) {
    return this.prisma.automation.findMany({
      where: {
        companyId,
      },
      orderBy: [
        {
          isSystem: 'desc',
        },
        {
          createdAt: 'desc',
        },
      ],
    });
  }

  async create(data: CreateAutomationDto, companyId: string) {
    const customAutomationCount = await this.prisma.automation.count({
      where: {
        companyId,
        isSystem: false,
      },
    });

    if (customAutomationCount >= this.customAutomationLimit) {
      throw new ConflictException(
        `Limite de ${this.customAutomationLimit} automações personalizadas atingido.`,
      );
    }

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

  async update(id: string, data: UpdateAutomationDto, companyId: string) {
    const automation = await this.prisma.automation.findFirst({
      where: this.automationTenantWhere(id, companyId),
    });

    if (!automation) {
      throw new NotFoundException('Automação não encontrada.');
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
