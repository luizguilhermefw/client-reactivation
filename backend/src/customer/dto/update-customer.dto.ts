import {
  IsDateString,
  IsOptional,
  IsString,
} from 'class-validator';

export class UpdateCustomerDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsDateString()
  birthDate?: string;

  @IsOptional()
  @IsDateString()
  lastPurchaseDate?: string;
}