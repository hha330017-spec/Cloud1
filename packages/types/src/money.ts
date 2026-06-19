/**
 * Money is ALWAYS integer cents (BIGINT in the DB). Never float arithmetic.
 * These helpers keep formatting/parsing in one place.
 */

export type Cents = number; // integer; never fractional

export function formatCents(cents: Cents, currency = 'USD', locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(
    cents / 100,
  );
}

/** Parse a user-entered major-unit string ("12.99") into integer cents. */
export function toCents(major: string | number): Cents {
  const value = typeof major === 'number' ? major : Number(major);
  if (!Number.isFinite(value)) throw new Error(`Invalid money value: ${major}`);
  // Round to avoid float drift (0.1 + 0.2 problems) before truncation.
  return Math.round(value * 100);
}

/** Commission split in integer cents using basis points (no fractional %). */
export function commissionCents(amountCents: Cents, bps: number): Cents {
  return Math.round((amountCents * bps) / 10_000);
}
