import {
  Injectable,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterCompanyDto } from './dto/register-company.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  // =========================
  // LOGIN
  // =========================
  async login(loginDto: LoginDto) {
    const { email, password } = loginDto;

    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user || !(await bcrypt.compare(password, user.password))) {
      throw new UnauthorizedException('Credenciais inválidas.');
    }

    const payload = {
      userId: user.id,
      email: user.email,
      companyId: user.companyId,
    };

    return {
      access_token: this.jwtService.sign(payload, {
        expiresIn: process.env.JWT_EXPIRES_IN || '1d',
      }),
    };
  }

  // =========================
  // REGISTER COMPANY
  // =========================
  async registerCompany(data: RegisterCompanyDto) {
    const { companyName, cnpj, email, password } = data;

    const normalizedName = companyName.trim();
    const normalizedCnpj = cnpj.replace(/\D/g, '');

    // verifica se empresa já existe
    const companyExists = await this.prisma.company.findUnique({
      where: { cnpj: normalizedCnpj },
    });

    if (companyExists) {
      throw new ConflictException('CNPJ já cadastrado.');
    }

    // verifica se usuário já existe
    const userExists = await this.prisma.user.findUnique({
      where: { email },
    });

    if (userExists) {
      throw new ConflictException('Email já cadastrado.');
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // transaction segura
    const result = await this.prisma.$transaction(async (prisma) => {
      const company = await prisma.company.create({
        data: {
          name: normalizedName,
          cnpj: normalizedCnpj,
        },
      });

      const user = await prisma.user.create({
        data: {
          name: email, // simples no MVP
          email,
          password: hashedPassword,
          companyId: company.id,
        },
      });

      return { company, user };
    });

    const payload = {
      userId: result.user.id,
      email: result.user.email,
      companyId: result.user.companyId,
    };

    const { password: _, ...safeUser } = result.user;

    return {
      access_token: this.jwtService.sign(payload, {
        expiresIn: process.env.JWT_EXPIRES_IN || '1d',
      }),
      user: safeUser,
      company: result.company,
    };
  }
}