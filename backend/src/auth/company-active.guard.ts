import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { RequestWithUser } from '../auth/types/request-with-user';

@Injectable()
export class CompanyActiveGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();

    const user = request.user;

    if (!user) return true;

    if (user.isAdmin) {
      return true;
    }

    const company = await this.prisma.company.findUnique({
      where: { id: user.companyId },
    });

    if (!company) {
      throw new ForbiddenException('Empresa não encontrada');
    }

    if (company.status !== 'ACTIVE') {
      throw new ForbiddenException({
        code: 'COMPANY_PENDING',
      });
    }

    return true;
  }
}
