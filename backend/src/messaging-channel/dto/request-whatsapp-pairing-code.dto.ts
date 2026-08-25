import { Transform } from 'class-transformer';
import {
  IsString,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import {
  isValidCustomerPhone,
  normalizeCustomerPhone,
} from '../../customer/customer-normalization';

@ValidatorConstraint({ name: 'validCustomerPhone', async: false })
class ValidCustomerPhoneConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && isValidCustomerPhone(value);
  }

  defaultMessage(_arguments: ValidationArguments): string {
    return 'phone must be a valid Brazilian phone number';
  }
}

export class RequestWhatsappPairingCodeDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? normalizeCustomerPhone(value) : value,
  )
  @IsString()
  @Validate(ValidCustomerPhoneConstraint)
  phone: string;
}
