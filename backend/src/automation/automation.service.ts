import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAutomationDto } from './dto/create-automation.dto';

@Injectable()
export class AutomationService {
  constructor(private readonly prisma: PrismaService) {}

  private automationTenantWhere(id: string, companyId: string) {
    return { id, companyId };
  }

  async findAll(companyId: string) {
    return this.prisma.automation.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(data: CreateAutomationDto, companyId: string) {
    const { name, daysAfter, message } = data;

    try {
      return await this.prisma.automation.create({
        data: {
          name,
          daysAfter,
          message,
          companyId,
        },
      });
    } catch (error) {
      if (error.code === 'P2002') {
        throw new ConflictException('Já existe uma automação com esse nome');
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
        throw new NotFoundException('Automação não encontrada');
      }

      await prisma.messageLog.deleteMany({
        where: {
          automationId: id,
          automation: {
            companyId,
          },
        },
      });

      await prisma.automation.deleteMany({
        where: this.automationTenantWhere(id, companyId),
      });

      return automation;
    });
  }
}
