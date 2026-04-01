import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAutomationDto } from './dto/create-automation.dto';

@Injectable()
export class AutomationService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(companyId: string) {
    return this.prisma.automation.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(data: CreateAutomationDto, companyId: string) {
    try {
      return await this.prisma.automation.create({
        data: {
          ...data,
          companyId,
        },
      });
    } catch (error) {
      if (error.code === 'P2002') {
        throw new Error('Já existe uma automação com esse nome');
      }

      throw error;
    }
  }

  async remove(id: string, companyId: string) {
    return this.prisma.$transaction(async (prisma) => {
      const automation = await prisma.automation.findFirst({
        where: { id, companyId },
      });

      if (!automation) {
        throw new Error('Automação não encontrada');
      }

      await prisma.messageLog.deleteMany({
        where: { automationId: id },
      });

      return prisma.automation.delete({
        where: {
          id,
        },
      });
    });
  }
}
