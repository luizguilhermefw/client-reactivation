import { IsBoolean } from 'class-validator';

export class UpdateCustomerRegistrationLinkStatusDto {
  @IsBoolean()
  active: boolean;
}
