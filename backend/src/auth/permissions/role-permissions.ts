import { UserRole } from '@prisma/client';
import { Permission } from './permissions';

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  [UserRole.PLATFORM_ADMIN]: Object.values(Permission),

  [UserRole.SUPPORT]: [
    Permission.COMPANY_READ,
    Permission.COMPANY_APPROVE,
  ],

  [UserRole.OWNER]: [
    Permission.CUSTOMER_CREATE,
    Permission.CUSTOMER_READ,
    Permission.CUSTOMER_UPDATE,
    Permission.CUSTOMER_DELETE,

    Permission.USER_CREATE,
    Permission.USER_READ,
    Permission.USER_UPDATE,
    Permission.USER_DELETE,

    Permission.AUTOMATION_CREATE,
    Permission.AUTOMATION_READ,
    Permission.AUTOMATION_UPDATE,
    Permission.AUTOMATION_DELETE,

    Permission.COMPANY_READ,
    Permission.COMPANY_UPDATE,
  ],

  [UserRole.MANAGER]: [
    Permission.CUSTOMER_CREATE,
    Permission.CUSTOMER_READ,
    Permission.CUSTOMER_UPDATE,

    Permission.USER_READ,

    Permission.AUTOMATION_CREATE,
    Permission.AUTOMATION_READ,
    Permission.AUTOMATION_UPDATE,

    Permission.COMPANY_READ,
  ],

  [UserRole.OPERATOR]: [
    Permission.CUSTOMER_CREATE,
    Permission.CUSTOMER_READ,
    Permission.CUSTOMER_UPDATE,

    Permission.AUTOMATION_READ,

    Permission.COMPANY_READ,
  ],

  [UserRole.VIEWER]: [
    Permission.CUSTOMER_READ,
    Permission.USER_READ,
    Permission.AUTOMATION_READ,
    Permission.COMPANY_READ,
  ],
};