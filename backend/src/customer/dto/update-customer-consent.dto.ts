import { CustomerContactConsentStatus } from '@prisma/client';
import { IsIn } from 'class-validator';

export type ManagedCustomerConsentStatus = Exclude<
  CustomerContactConsentStatus,
  'UNKNOWN'
>;

export class UpdateCustomerConsentDto {
  @IsIn([
    CustomerContactConsentStatus.GRANTED,
    CustomerContactConsentStatus.OPTED_OUT,
  ])
  status: ManagedCustomerConsentStatus;
}
