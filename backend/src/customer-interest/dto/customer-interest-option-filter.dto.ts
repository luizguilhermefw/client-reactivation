import { Transform } from 'class-transformer';
import { CustomerInterestType } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';

const parseBooleanQuery = ({ value }: { value: unknown }): unknown => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
};

export class CustomerInterestOptionFilterDto {
  @IsOptional()
  @IsEnum(CustomerInterestType)
  type?: CustomerInterestType;

  @Transform(parseBooleanQuery)
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
