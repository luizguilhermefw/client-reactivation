import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';
import { CustomerContactConsentStatus, CustomerGender } from '@prisma/client';
import {
  BRAZILIAN_STATE_CODES,
  normalizeBrazilianState,
} from '../customer-state';

const parseBooleanQuery = ({ value }: { value: unknown }): unknown => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
};

function IsAgeRangeValid(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string): void => {
    registerDecorator({
      name: 'isAgeRangeValid',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          const dto = args.object as CustomerFilterDto;
          return (
            value === undefined ||
            dto.minAge === undefined ||
            (typeof value === 'number' && dto.minAge <= value)
          );
        },
      },
    });
  };
}

export class CustomerFilterDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(CustomerGender)
  gender?: CustomerGender;

  @IsOptional()
  @IsString()
  city?: string;

  @Transform(({ value }) => normalizeBrazilianState(value) ?? undefined)
  @IsOptional()
  @IsString()
  @IsIn(BRAZILIAN_STATE_CODES)
  state?: string;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(120)
  minAge?: number;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(120)
  @IsAgeRangeValid({
    message: 'maxAge must be greater than or equal to minAge',
  })
  maxAge?: number;

  @IsOptional()
  @IsDateString()
  lastPurchaseBefore?: string;

  @IsOptional()
  @IsDateString()
  lastPurchaseAfter?: string;

  @IsOptional()
  @IsEnum(CustomerContactConsentStatus)
  contactConsentStatus?: CustomerContactConsentStatus;

  @Transform(parseBooleanQuery)
  @IsOptional()
  @IsBoolean()
  isActiveForAutomation?: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}
