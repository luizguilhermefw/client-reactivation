import { EnvMediaUrlPolicy } from './env-media-url-policy';
import { MediaUrlNotAllowedError } from './media-url-policy.interface';

describe('EnvMediaUrlPolicy', () => {
  const allowedHost = 'storage.example.com';

  const policy = (configuredHosts?: string): EnvMediaUrlPolicy =>
    new EnvMediaUrlPolicy(() => configuredHosts);

  it('aceita HTTPS de host permitido', () => {
    expect(() =>
      policy(allowedHost).assertAllowed(
        'https://storage.example.com/images/campaign.jpg',
      ),
    ).not.toThrow();
  });

  it('rejeita porta alternativa', () => {
    expect(() =>
      policy(allowedHost).assertAllowed(
        'https://storage.example.com:8443/image.jpg',
      ),
    ).toThrow('Media URL is not allowed');
  });

  it('rejeita porta 443 explícita', () => {
    expect(() =>
      policy(allowedHost).assertAllowed(
        'https://storage.example.com:443/image.jpg',
      ),
    ).toThrow('Media URL is not allowed');
  });

  it('aceita query string assinada', () => {
    expect(() =>
      policy(allowedHost).assertAllowed(
        'https://storage.example.com/image.jpg?signature=value&expires=123',
      ),
    ).not.toThrow();
  });

  it('rejeita configuração ausente', () => {
    expect(() =>
      policy(undefined).assertAllowed('https://storage.example.com/image.jpg'),
    ).toThrow(MediaUrlNotAllowedError);
  });

  it.each(['', '   ', ','])('rejeita lista vazia: %s', (value) => {
    expect(() =>
      policy(value).assertAllowed('https://storage.example.com/image.jpg'),
    ).toThrow(MediaUrlNotAllowedError);
  });

  it('rejeita host não permitido', () => {
    expect(() =>
      policy(allowedHost).assertAllowed(
        'https://untrusted.example.com/image.jpg',
      ),
    ).toThrow(MediaUrlNotAllowedError);
  });

  it('rejeita subdomínio não listado', () => {
    expect(() =>
      policy(allowedHost).assertAllowed(
        'https://cdn.storage.example.com/image.jpg',
      ),
    ).toThrow(MediaUrlNotAllowedError);
  });

  it('rejeita HTTP', () => {
    expect(() =>
      policy(allowedHost).assertAllowed('http://storage.example.com/image.jpg'),
    ).toThrow(MediaUrlNotAllowedError);
  });

  it.each([
    'data:text/plain,content',
    'file:///tmp/image.jpg',
    'ftp://storage.example.com/image.jpg',
  ])('rejeita esquema não HTTPS: %s', (mediaUrl) => {
    expect(() => policy(allowedHost).assertAllowed(mediaUrl)).toThrow(
      MediaUrlNotAllowedError,
    );
  });

  it.each([
    ['localhost', 'https://localhost/image.jpg'],
    ['127.0.0.1', 'https://127.0.0.1/image.jpg'],
    ['10.0.0.1', 'https://10.0.0.1/image.jpg'],
    ['192.168.1.1', 'https://192.168.1.1/image.jpg'],
  ])('rejeita host local ou IP: %s', (configuredHost, mediaUrl) => {
    expect(() => policy(configuredHost).assertAllowed(mediaUrl)).toThrow(
      MediaUrlNotAllowedError,
    );
  });

  it('rejeita URL com username ou password', () => {
    expect(() =>
      policy(allowedHost).assertAllowed(
        'https://username:password@storage.example.com/image.jpg',
      ),
    ).toThrow(MediaUrlNotAllowedError);
  });

  it('compara hostname sem diferenciar maiúsculas e minúsculas', () => {
    expect(() =>
      policy('  STORAGE.EXAMPLE.COM , cdn.example.com  ').assertAllowed(
        'https://Storage.Example.Com/image.jpg',
      ),
    ).not.toThrow();
  });

  it('rejeita URL sem host', () => {
    expect(() => policy(allowedHost).assertAllowed('https://')).toThrow(
      MediaUrlNotAllowedError,
    );
  });

  it.each([
    '*.example.com',
    'https://storage.example.com',
    'storage.example.com/path',
  ])(
    'rejeita item inválido ou curinga na configuração: %s',
    (configuredHost) => {
      expect(() =>
        policy(configuredHost).assertAllowed(
          'https://storage.example.com/image.jpg',
        ),
      ).toThrow(MediaUrlNotAllowedError);
    },
  );

  it('não inclui URL nem host recebido no erro', () => {
    const receivedHost = 'private-host.example.com';
    const receivedUrl = `https://${receivedHost}/secret.jpg`;

    try {
      policy(allowedHost).assertAllowed(receivedUrl);
      throw new Error('Expected media URL policy to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(MediaUrlNotAllowedError);
      expect((error as Error).message).toBe('Media URL is not allowed');
      expect((error as Error).message).not.toContain(receivedHost);
      expect((error as Error).message).not.toContain(receivedUrl);
    }
  });

  it('não inclui porta recebida no erro', () => {
    const receivedPort = '8443';

    try {
      policy(allowedHost).assertAllowed(
        `https://storage.example.com:${receivedPort}/secret.jpg`,
      );
      throw new Error('Expected media URL policy to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(MediaUrlNotAllowedError);
      expect((error as Error).message).toBe('Media URL is not allowed');
      expect((error as Error).message).not.toContain(receivedPort);
    }
  });
});
