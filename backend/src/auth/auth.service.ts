import {
  Injectable,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtSignOptions } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterCompanyDto } from './dto/register-company.dto';
import * as bcrypt from 'bcrypt';
import { UserRole } from '@prisma/client';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  // =============================
  // LOGIN
  // =============================
  async login(loginDto: LoginDto) {
    const { password } = loginDto;

    const normalizedEmail = loginDto.email.trim().toLowerCase();

    const user = await this.prisma.user.findUnique({
      where: {
        email: normalizedEmail,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Credenciais inválidas.');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Credenciais inválidas.');
    }

    const payload = {
      userId: user.id,
      name: user.name,
      email: user.email,
      companyId: user.companyId,
      role: user.role,
    };

    const options: JwtSignOptions = {
      expiresIn: (process.env.JWT_EXPIRES_IN ||
        '1d') as unknown as import('ms').StringValue,
    };

    return {
      access_token: this.jwtService.sign(payload, options),
    };
  }

  // =============================
  // REGISTER COMPANY (SaaS ENTRY POINT)
  // =============================
  async registerCompany(data: RegisterCompanyDto) {
    const { name, cnpj, userName, password } = data;

    const normalizedName = name.trim().toLowerCase();
    const normalizedDisplayName = name.trim();
    const normalizedUserName = userName.trim();
    const normalizedEmail = data.email.trim().toLowerCase();
    const normalizedCnpj = cnpj.replace(/\D/g, '');

    // Verifica se empresa já existe
    const companyExists = await this.prisma.company.findUnique({
      where: {
        cnpj: normalizedCnpj,
      },
    });

    if (companyExists) {
      throw new ConflictException('CNPJ já cadastrado.');
    }

    // Verifica se usuário já existe
    const userExists = await this.prisma.user.findUnique({
      where: {
        email: normalizedEmail,
      },
    });

    if (userExists) {
      throw new ConflictException('Email já cadastrado.');
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await this.prisma.$transaction(async (prisma) => {
      const company = await prisma.company.create({
        data: {
          name: normalizedName,
          displayName: normalizedDisplayName,
          cnpj: normalizedCnpj,
        },
      });

      const user = await prisma.user.create({
        data: {
          name: normalizedUserName,
          email: normalizedEmail,
          password: hashedPassword,
          companyId: company.id,
          role: UserRole.OWNER,
        },
      });

      return { company, user };
    });

    const payload = {
      userId: result.user.id,
      name: result.user.name,
      email: result.user.email,
      companyId: result.user.companyId,
      role: result.user.role,
    };

    const options: JwtSignOptions = {
      expiresIn: (process.env.JWT_EXPIRES_IN ||
        '1d') as unknown as import('ms').StringValue,
    };

    const { password: _, ...safeUser } = result.user;

    return {
      access_token: this.jwtService.sign(payload, options),
      user: safeUser,
      company: result.company,
    };
  }
}
