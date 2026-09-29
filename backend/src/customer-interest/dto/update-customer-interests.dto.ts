import { ArrayMaxSize, ArrayUnique, IsArray, IsUUID } from 'class-validator';

export const MAX_CUSTOMER_INTEREST_OPTIONS = 100;

export class UpdateCustomerInterestsDto {
  @IsArray()
  @ArrayMaxSize(MAX_CUSTOMER_INTEREST_OPTIONS)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  interestOptionIds: string[];
}
