export interface BirthDateRange {
  gt?: Date;
  lte?: Date;
}

function anniversaryBoundary(referenceDate: Date, yearsAgo: number): Date {
  const targetYear = referenceDate.getUTCFullYear() - yearsAgo;
  const month = referenceDate.getUTCMonth();
  const lastDayOfMonth = new Date(
    Date.UTC(targetYear, month + 1, 0),
  ).getUTCDate();
  const day = Math.min(referenceDate.getUTCDate(), lastDayOfMonth);

  return new Date(Date.UTC(targetYear, month, day, 23, 59, 59, 999));
}

export function buildBirthDateRange(
  minAge?: number,
  maxAge?: number,
  referenceDate = new Date(),
): BirthDateRange | undefined {
  if (minAge === undefined && maxAge === undefined) return undefined;

  return {
    ...(maxAge === undefined
      ? {}
      : { gt: anniversaryBoundary(referenceDate, maxAge + 1) }),
    ...(minAge === undefined
      ? {}
      : { lte: anniversaryBoundary(referenceDate, minAge) }),
  };
}
