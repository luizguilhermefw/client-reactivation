import {
  DEFAULT_MEDIA_READ_URL_TTL_SECONDS,
  EnvMediaReadUrlConfig,
  MediaReadUrlConfigurationError,
} from './media-read-url.config';

describe('EnvMediaReadUrlConfig', () => {
  const config = (value: string | undefined) =>
    new EnvMediaReadUrlConfig(() => value);

  it('usa TTL padrão de 900 segundos quando a variável está ausente', () => {
    expect(config(undefined).getTtlSeconds()).toBe(
      DEFAULT_MEDIA_READ_URL_TTL_SECONDS,
    );
  });

  it.each([
    ['mínimo', '60', 60],
    ['máximo', '3600', 3_600],
  ])('aceita o limite %s', (_case, value, expected) => {
    expect(config(value).getTtlSeconds()).toBe(expected);
  });

  it.each([
    ['abaixo do mínimo', '59'],
    ['acima do máximo', '3601'],
    ['não numérico', 'fifteen-minutes'],
    ['vazio', ''],
    ['somente espaços', '   '],
  ])('rejeita valor %s', (_case, value) => {
    expect(() => config(value)).toThrow(MediaReadUrlConfigurationError);
  });
});
