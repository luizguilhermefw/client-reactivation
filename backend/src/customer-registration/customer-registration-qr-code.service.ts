import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import QRCode from 'qrcode';
import { CustomerRegistrationLinkService } from './customer-registration-link.service';
import {
  PublicRegistrationBaseUrlConfig,
  PublicRegistrationBaseUrlConfigurationError,
} from './public-registration-base-url.config';

export interface CustomerRegistrationQrCodeResponse {
  publicUrl: string;
  qrCodeDataUrl: string;
}

@Injectable()
export class CustomerRegistrationQrCodeService {
  constructor(
    private readonly linkService: CustomerRegistrationLinkService,
    private readonly baseUrlConfig: PublicRegistrationBaseUrlConfig,
  ) {}

  async generate(
    companyId: string,
  ): Promise<CustomerRegistrationQrCodeResponse> {
    const link = await this.linkService.get(companyId);

    let baseUrl: string;
    try {
      baseUrl = this.baseUrlConfig.getRequired();
    } catch (error) {
      if (error instanceof PublicRegistrationBaseUrlConfigurationError) {
        throw new ServiceUnavailableException(
          'QR Code de cadastro indisponível.',
        );
      }
      throw error;
    }

    const publicUrl = `${baseUrl}${link.publicPath}`;
    const qrCodeDataUrl = await QRCode.toDataURL(publicUrl, {
      type: 'image/png',
    });

    return { publicUrl, qrCodeDataUrl };
  }
}
