import { Injectable, ConflictException } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { CreateCompanyDto } from './dto/create-company.dto';

@Injectable()
export class CompanyService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createCompanyDto: CreateCompanyDto) {
    const { name, cnpj } = createCompanyDto;

    // 🔥 normalização
    const normalizedName = name.trim().toLowerCase();
    const normalizedCnpj = cnpj.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

    // 🔍 valida duplicidade por CNPJ (PRINCIPAL)
    const companyByCnpj = await this.prisma.company.findUnique({
      where: {
        cnpj: normalizedCnpj,
      },
    });

    if (companyByCnpj) {
      throw new ConflictException('CNPJ já cadastrado.');
    }

    // 🔍 valida duplicidade por nome (SECUNDÁRIO)
    const companyByName = await this.prisma.company.findFirst({
      where: {
        name: normalizedName,
      },
    });

    if (companyByName) {
      throw new ConflictException('Empresa já cadastrada.');
    }

    // 🏢 cria empresa
    const company = await this.prisma.company.create({
      data: {
        name: normalizedName,
        displayName: name,
        cnpj: normalizedCnpj,
      },
    });

    return company;
  }

  async findAll() {
    return this.prisma.company.findMany();
  }
}
