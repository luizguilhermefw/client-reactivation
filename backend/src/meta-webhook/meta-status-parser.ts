import { OutboundDeliveryStatus } from '@prisma/client';

export interface MetaStatusEvent {
  providerMessageId: string;
  status: OutboundDeliveryStatus;
  timestamp?: Date;
  errorCode?: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function parseMetaStatuses(payload: unknown): MetaStatusEvent[] {
  const result: MetaStatusEvent[] = [];
  if (!record(payload) || !Array.isArray(payload.entry)) return result;
  for (const entry of payload.entry) {
    if (!record(entry) || !Array.isArray(entry.changes)) continue;
    for (const change of entry.changes) {
      if (
        !record(change) ||
        !record(change.value) ||
        !Array.isArray(change.value.statuses)
      )
        continue;
      for (const value of change.value.statuses) {
        if (!record(value) || typeof value.id !== 'string' || !value.id.trim())
          continue;
        const statuses: Record<string, OutboundDeliveryStatus> = {
          sent: 'SENT',
          delivered: 'DELIVERED',
          read: 'READ',
          failed: 'FAILED',
        };
        const status =
          typeof value.status === 'string' &&
          Object.prototype.hasOwnProperty.call(statuses, value.status)
            ? statuses[value.status]
            : undefined;
        if (!status) continue;
        let timestamp: Date | undefined;
        if (
          typeof value.timestamp === 'string' &&
          /^\d{1,12}$/.test(value.timestamp)
        ) {
          const date = new Date(Number(value.timestamp) * 1000);
          if (!Number.isNaN(date.getTime())) timestamp = date;
        }
        const firstError: unknown = Array.isArray(value.errors)
          ? value.errors[0]
          : undefined;
        const code = record(firstError) ? firstError.code : undefined;
        // Only a bounded numeric code is retained, never provider descriptions.
        const errorCode =
          status === 'FAILED' &&
          typeof code === 'number' &&
          Number.isSafeInteger(code) &&
          code >= 0
            ? `META_${code}`
            : undefined;
        result.push({
          providerMessageId: value.id.trim(),
          status,
          ...(timestamp ? { timestamp } : {}),
          ...(errorCode ? { errorCode } : {}),
        });
      }
    }
  }
  return result;
}
