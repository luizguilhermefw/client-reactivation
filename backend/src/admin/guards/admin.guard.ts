import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { RequestWithUser } from '../../auth/types/request-with-user';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUser>();

    const user = request.user;

    const allowedRoles = ['PLATFORM_ADMIN'];

    if (!allowedRoles.includes(user.role)) {
      throw new ForbiddenException(
        'Você não possui permissão para acessar esta área.',
      );
    }

    return true;
  }
}
