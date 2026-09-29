import { CustomerInterestType } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { MAX_CUSTOMER_INTEREST_NAME_LENGTH } from '../customer-interest-normalization';

export class CreateCustomerInterestOptionDto {
  @IsEnum(CustomerInterestType)
  type: CustomerInterestType;

  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_CUSTOMER_INTEREST_NAME_LENGTH)
  name: string;
}
