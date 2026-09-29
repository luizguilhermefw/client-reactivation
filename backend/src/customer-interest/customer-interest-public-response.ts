import { Prisma } from '@prisma/client';

export const CUSTOMER_INTEREST_OPTION_PUBLIC_SELECT = {
  id: true,
  type: true,
  name: true,
  active: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.CustomerInterestOptionSelect;

export type CustomerInterestOptionPublicResponse =
  Prisma.CustomerInterestOptionGetPayload<{
    select: typeof CUSTOMER_INTEREST_OPTION_PUBLIC_SELECT;
  }>;
