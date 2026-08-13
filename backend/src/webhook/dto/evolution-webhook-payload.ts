/**
 * Boundary type for Evolution webhook payloads. Values stay unknown until the
 * webhook service validates them because the external shape varies by version.
 */
export interface EvolutionWebhookPayload {
  readonly event?: unknown;
  readonly instance?: unknown;
  readonly data?: unknown;
  readonly [field: string]: unknown;
}
