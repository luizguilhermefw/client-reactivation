import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { MAX_CUSTOMER_INTEREST_NAME_LENGTH } from '../customer-interest-normalization';

export class UpdateCustomerInterestOptionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_CUSTOMER_INTEREST_NAME_LENGTH)
  name: string;
}
