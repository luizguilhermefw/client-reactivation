import { isIP } from 'node:net';
import {
  MediaUrlNotAllowedError,
  MediaUrlPolicy,
} from './media-url-policy.interface';

export class EnvMediaUrlPolicy implements MediaUrlPolicy {
  constructor(
    private readonly readAllowedHosts: () => string | undefined = () =>
      process.env.IMAGE_MEDIA_ALLOWED_HOSTS,
  ) {}

  assertAllowed(mediaUrl: string): void {
    const allowedHosts = this.resolveAllowedHosts();
    let parsedUrl: URL;

    try {
      parsedUrl = new URL(mediaUrl);
    } catch {
      throw new MediaUrlNotAllowedError();
    }

    const hostname = parsedUrl.hostname.toLowerCase();

    if (
      parsedUrl.protocol !== 'https:' ||
      parsedUrl.port !== '' ||
      this.hasExplicitPort(mediaUrl) ||
      parsedUrl.username !== '' ||
      parsedUrl.password !== '' ||
      !hostname ||
      this.isLocalOrIpHost(hostname) ||
      !allowedHosts.has(hostname)
    ) {
      throw new MediaUrlNotAllowedError();
    }
  }

  private hasExplicitPort(mediaUrl: string): boolean {
    const authorityStart = mediaUrl.indexOf('://');

    if (authorityStart < 0) {
      return false;
    }

    const remainder = mediaUrl.slice(authorityStart + 3);
    const authorityEndCandidates = ['/', '?', '#']
      .map((separator) => remainder.indexOf(separator))
      .filter((index) => index >= 0);
    const authorityEnd =
      authorityEndCandidates.length === 0
        ? remainder.length
        : Math.min(...authorityEndCandidates);
    const authority = remainder.slice(0, authorityEnd);
    const hostAndPort = authority.slice(authority.lastIndexOf('@') + 1);

    return hostAndPort.includes(':');
  }

  private resolveAllowedHosts(): Set<string> {
    const configuredHosts = this.readAllowedHosts();

    if (!configuredHosts?.trim()) {
      throw new MediaUrlNotAllowedError();
    }

    const rawHosts = configuredHosts.split(',').map((host) => host.trim());

    if (rawHosts.some((host) => !host)) {
      throw new MediaUrlNotAllowedError();
    }

    const normalizedHosts = rawHosts.map((host) =>
      this.normalizeConfiguredHost(host),
    );

    if (normalizedHosts.some((host) => host === undefined)) {
      throw new MediaUrlNotAllowedError();
    }

    return new Set(normalizedHosts as string[]);
  }

  private normalizeConfiguredHost(host: string): string | undefined {
    if (host.includes('*')) {
      return undefined;
    }

    let parsedHost: URL;

    try {
      parsedHost = new URL(`https://${host}`);
    } catch {
      return undefined;
    }

    const hostname = parsedHost.hostname.toLowerCase();

    if (
      hostname !== host.toLowerCase() ||
      parsedHost.username !== '' ||
      parsedHost.password !== '' ||
      parsedHost.port !== '' ||
      parsedHost.pathname !== '/' ||
      parsedHost.search !== '' ||
      parsedHost.hash !== '' ||
      this.isLocalOrIpHost(hostname)
    ) {
      return undefined;
    }

    return hostname;
  }

  private isLocalOrIpHost(hostname: string): boolean {
    const unwrappedHostname =
      hostname.startsWith('[') && hostname.endsWith(']')
        ? hostname.slice(1, -1)
        : hostname;

    return (
      unwrappedHostname === 'localhost' ||
      unwrappedHostname.endsWith('.localhost') ||
      isIP(unwrappedHostname) !== 0
    );
  }
}
