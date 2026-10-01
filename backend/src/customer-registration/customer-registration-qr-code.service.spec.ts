import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import QRCode from 'qrcode';
import { CustomerRegistrationLinkService } from './customer-registration-link.service';
import { CustomerRegistrationQrCodeService } from './customer-registration-qr-code.service';
import { PublicRegistrationBaseUrlConfig } from './public-registration-base-url.config';

jest.mock('qrcode', () => ({
  __esModule: true,
  default: { toDataURL: jest.fn() },
}));

describe('CustomerRegistrationQrCodeService', () => {
  const linkService = { get: jest.fn() };
  const baseUrlConfig = { getRequired: jest.fn() };
  const toDataURL = QRCode.toDataURL as jest.MockedFunction<
    typeof QRCode.toDataURL
  >;
  const service = new CustomerRegistrationQrCodeService(
    linkService as unknown as CustomerRegistrationLinkService,
    baseUrlConfig as unknown as PublicRegistrationBaseUrlConfig,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    baseUrlConfig.getRequired.mockReturnValue('https://app.example.test');
    linkService.get.mockResolvedValue({
      publicId: 'current-public-id',
      active: true,
      publicPath: '/register/current-public-id',
    });
    toDataURL.mockResolvedValue('data:image/png;base64,generated');
  });

  it('generates the QR code using exactly the official publicPath', async () => {
    linkService.get.mockResolvedValue({
      publicId: 'must-not-be-used-to-build-the-route',
      active: true,
      publicPath: '/official/customer-registration/path',
    });

    await expect(service.generate('company-from-jwt')).resolves.toEqual({
      publicUrl:
        'https://app.example.test/official/customer-registration/path',
      qrCodeDataUrl: 'data:image/png;base64,generated',
    });
    expect(linkService.get).toHaveBeenCalledWith('company-from-jwt');
    expect(toDataURL).toHaveBeenCalledWith(
      'https://app.example.test/official/customer-registration/path',
      { type: 'image/png' },
    );
    expect(toDataURL).not.toHaveBeenCalledWith(
      expect.stringContaining('must-not-be-used-to-build-the-route'),
      expect.anything(),
    );
  });

  it('allows generating the QR code for an inactive link', async () => {
    linkService.get.mockResolvedValue({
      publicId: 'inactive-public-id',
      active: false,
      publicPath: '/register/inactive-public-id',
    });

    await expect(service.generate('company-from-jwt')).resolves.toMatchObject({
      publicUrl: 'https://app.example.test/register/inactive-public-id',
    });
  });

  it('preserves the existing not-found response when the link does not exist', async () => {
    linkService.get.mockRejectedValue(
      new NotFoundException('Link de cadastro não encontrado'),
    );

    await expect(service.generate('company-from-jwt')).rejects.toThrow(
      'Link de cadastro não encontrado',
    );
    expect(toDataURL).not.toHaveBeenCalled();
  });

  it('fails safely when the base URL is unavailable', async () => {
    delete process.env.PUBLIC_REGISTRATION_BASE_URL;
    const serviceWithRealConfig = new CustomerRegistrationQrCodeService(
      linkService as unknown as CustomerRegistrationLinkService,
      new PublicRegistrationBaseUrlConfig(),
    );

    await expect(
      serviceWithRealConfig.generate('company-from-jwt'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(toDataURL).not.toHaveBeenCalled();
  });

  it('uses the newly returned publicPath after link rotation', async () => {
    linkService.get
      .mockResolvedValueOnce({
        publicId: 'irrelevant-before-id',
        active: true,
        publicPath: '/register/before-rotation-path',
      })
      .mockResolvedValueOnce({
        publicId: 'irrelevant-after-id',
        active: true,
        publicPath: '/register/after-rotation-path',
      });

    const before = await service.generate('company-from-jwt');
    const after = await service.generate('company-from-jwt');

    expect(before.publicUrl).toBe(
      'https://app.example.test/register/before-rotation-path',
    );
    expect(after.publicUrl).toBe(
      'https://app.example.test/register/after-rotation-path',
    );
  });
});
