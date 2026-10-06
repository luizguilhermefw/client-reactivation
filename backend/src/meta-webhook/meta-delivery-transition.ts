import { OutboundDeliveryStatus as Status } from '@prisma/client';

// FAILED is terminal here: a late SENT must not hide a reported failure.
export function canAdvanceDelivery(
  current: Status | null,
  next: Status,
): boolean {
  if (current === null) return true;
  if (current === Status.SENT) return next !== Status.SENT;
  return current === Status.DELIVERED && next === Status.READ;
}
