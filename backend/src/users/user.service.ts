import {
  Injectable,
  ConflictException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';

import { UserRole } from '@prisma/client';

import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateUserDto, companyId: string) {
    const normalizedEmail = data.email.trim().toLowerCase();
    const normalizedName = data.name.trim();

    // Verifica se já existe usuário com esse email
    const userExists = await this.prisma.user.findUnique({
      where: {
        email: normalizedEmail,
      },
    });

    if (userExists) {
      throw new ConflictException('Email já cadastrado.');
    }

    const company = await this.prisma.company.findUnique({
      where: {
        id: companyId,
      },
    });

    if (!company) {
      throw new NotFoundException('Empresa não encontrada.');
    }

    // OWNER só pode criar estes perfis
    switch (data.role) {
      case UserRole.MANAGER:
      case UserRole.OPERATOR:
      case UserRole.VIEWER:
        break;

      default:
        throw new ForbiddenException('Role inválida para criação de usuário.');
    }

    const hashedPassword = await bcrypt.hash(data.password, 10);

    const user = await this.prisma.user.create({
      data: {
        name: normalizedName,
        email: normalizedEmail,
        password: hashedPassword,
        companyId,
        role: data.role,
      },
    });

    const { password: _, ...result } = user;

    return result;
  }
}
