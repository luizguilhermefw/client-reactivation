export const QUEUE_WORKER_CONFIG = Symbol('QUEUE_WORKER_CONFIG');

export interface QueueWorkerConfig {
  isEnabled(): boolean;
}

export class EnvQueueWorkerConfig implements QueueWorkerConfig {
  constructor(
    private readonly readEnabledValue: () => string | undefined = () =>
      process.env.MESSAGE_WORKER_ENABLED,
  ) {}

  isEnabled(): boolean {
    return this.readEnabledValue()?.trim().toLowerCase() === 'true';
  }
}
