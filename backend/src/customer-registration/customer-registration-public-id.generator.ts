import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

@Injectable()
export class CustomerRegistrationPublicIdGenerator {
  generate(): string {
    return randomBytes(32).toString('base64url');
  }
}
