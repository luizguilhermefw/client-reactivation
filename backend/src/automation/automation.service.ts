import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAutomationDto } from './dto/create-automation.dto';

@Injectable()
export class AutomationService {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateAutomationDto, companyId: string) {
    return this.prisma.automation.create({
      data: {
        ...data,
        companyId,
      },
    });
  }

  async findAll(companyId: string) {
    return this.prisma.automation.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
    });
  }
}