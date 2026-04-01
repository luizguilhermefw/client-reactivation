import {
  Injectable,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterCompanyDto } from './dto/register-company.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async register(registerDto: RegisterDto) {
    const { name, email, password, companyId } = registerDto;

    const userExists = await this.prisma.user.findUnique({
      where: { email },
    });

    if (userExists) {
      throw new ConflictException('Um usuário com este e-mail já existe.');
    }

    const companyExists = await this.prisma.company.findUnique({
      where: { id: companyId },
    });

    if (!companyExists) {
      throw new UnauthorizedException('Empresa não encontrada.');
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await this.prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        companyId,
      },
    });

    const { password: _, ...result } = user;
    return result;
  }

  async login(loginDto: LoginDto) {
    const { email, password } = loginDto;

    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user || !(await bcrypt.compare(password, user.password))) {
      throw new UnauthorizedException('Credenciais inválidas.');
    }

    const payload = {
      userId: user.id,
      email: user.email,
      companyId: user.companyId,
    };
    return {
      access_token: this.jwtService.sign(payload),
    };
  }

  // 🔥 AGORA SIM DENTRO DA CLASSE
  async registerCompany(data: RegisterCompanyDto) {
    const { name, cnpj, userName, email, password } = data;

    const normalizedName = name.trim().toLowerCase();
    const normalizedCnpj = cnpj.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

    const companyExists = await this.prisma.company.findUnique({
      where: { cnpj: normalizedCnpj },
    });

    if (companyExists) {
      throw new ConflictException('CNPJ já cadastrado.');
    }

    const userExists = await this.prisma.user.findUnique({
      where: { email },
    });

    if (userExists) {
      throw new ConflictException('Email já cadastrado.');
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await this.prisma.$transaction(async (prisma) => {
      const company = await prisma.company.create({
        data: {
          name: normalizedName,
          displayName: name,
          cnpj: normalizedCnpj,
        },
      });

      const user = await prisma.user.create({
        data: {
          name: userName,
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
      access_token: this.jwtService.sign(payload),
      user: safeUser,
      company: result.company,
    };
  }
}
