export class MediaUrlNotAllowedError extends Error {
  readonly name = 'MediaUrlNotAllowedError';

  constructor() {
    super('Media URL is not allowed');
  }
}

export interface MediaUrlPolicy {
  assertAllowed(mediaUrl: string): void;
}
