import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';

import { ROLES_KEY } from '../decorators/roles.decorator';
import type { RequestWithUser } from '../types/request-with-user';

const ROLE_HIERARCHY: Record<UserRole, UserRole[]> = {
  [UserRole.PLATFORM_ADMIN]: [
    UserRole.PLATFORM_ADMIN,
    UserRole.SUPPORT,
    UserRole.OWNER,
    UserRole.MANAGER,
    UserRole.OPERATOR,
    UserRole.VIEWER,
  ],

  [UserRole.SUPPORT]: [UserRole.SUPPORT],

  [UserRole.OWNER]: [
    UserRole.OWNER,
    UserRole.MANAGER,
    UserRole.OPERATOR,
    UserRole.VIEWER,
  ],

  [UserRole.MANAGER]: [UserRole.MANAGER, UserRole.OPERATOR, UserRole.VIEWER],

  [UserRole.OPERATOR]: [UserRole.OPERATOR, UserRole.VIEWER],

  [UserRole.VIEWER]: [UserRole.VIEWER],
};

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // Se a rota não exigir roles específicas, libera.
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();

    const user = request.user;

    const userPermissions = ROLE_HIERARCHY[user.role];

    const hasPermission = requiredRoles.some((role) =>
      userPermissions.includes(role),
    );

    if (!hasPermission) {
      throw new ForbiddenException(
        'Você não possui permissão para acessar este recurso.',
      );
    }

    return true;
  }
}
