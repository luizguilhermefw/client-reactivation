import { IsBoolean } from 'class-validator';

export class UpdateCustomerInterestOptionStatusDto {
  @IsBoolean()
  active: boolean;
}
