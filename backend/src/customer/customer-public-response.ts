import { Prisma } from '@prisma/client';

export const CUSTOMER_PUBLIC_SELECT = {
  id: true,
  name: true,
  phone: true,
  gender: true,
  city: true,
  state: true,
  lastPurchaseDate: true,
  birthDate: true,
  isActiveForAutomation: true,
  contactConsentStatus: true,
  consentGrantedAt: true,
  optedOutAt: true,
  companyId: true,
  createdAt: true,
} as const satisfies Prisma.CustomerSelect;

export type CustomerPublicResponse = Prisma.CustomerGetPayload<{
  select: typeof CUSTOMER_PUBLIC_SELECT;
}>;

const CUSTOMER_PUBLIC_FIELDS = Object.keys(
  CUSTOMER_PUBLIC_SELECT,
) as Array<keyof CustomerPublicResponse>;

export function toCustomerPublicResponse(
  customer: CustomerPublicResponse,
): CustomerPublicResponse {
  return Object.fromEntries(
    CUSTOMER_PUBLIC_FIELDS.map((field) => [field, customer[field]]),
  ) as CustomerPublicResponse;
}
