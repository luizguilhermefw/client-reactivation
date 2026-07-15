import { Request } from 'express';
import { UserRole } from '@prisma/client';

export interface RequestWithUser extends Request {
  user: {
    userId: string;
    name: string;
    email: string;
    companyId: string;
    role: UserRole;
  };
}