import { Request } from 'express';

export interface RequestWithUser extends Request {
  user: {
    userId: string;
    name: string;
    email: string;
    companyId: string;
    isAdmin: boolean;
  };
}