import { Injectable, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateUserDto, companyId: string) {
    // 🔍 Verifica se já existe usuário com esse email
    const userExists = await this.prisma.user.findUnique({
      where: { email: data.email },
    });

    if (userExists) {
      throw new ConflictException('Email já cadastrado.');
    }

    // 🔐 Hash da senha
    const hashedPassword = await bcrypt.hash(data.password, 10);

    // 💾 Cria usuário
    const user = await this.prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
        password: hashedPassword,
        companyId,
      },
    });

    const { password: _, ...result } = user;

    return result;
  }
}