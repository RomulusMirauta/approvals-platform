import type { Money, Priority, RequestStatus, RequestType } from '@approvals/contracts';

export const TYPE_LABELS: Record<RequestType, string> = {
  invoice_exception: 'Invoice exception',
  purchase: 'Purchase',
  access: 'Access',
  other: 'Other',
};

export const STATUS_LABELS: Record<RequestStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

export const PRIORITY_LABELS: Record<Priority, string> = { low: 'Low', normal: 'Normal', high: 'High' };

// Currencies differ in how many minor units make a major one (2 for RON, 0 for JPY), and Intl knows them.
export function minorDigits(currency: string) {
  return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
}

export function formatMoney({ amountMinor, currency }: Money) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(
    amountMinor / 10 ** minorDigits(currency),
  );
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
];

// "3 hours ago" reads faster in a queue than a timestamp; the full date is in the title tooltip.
export function formatAge(timestamp: string, now = Date.now()) {
  const seconds = Math.round((new Date(timestamp).getTime() - now) / 1000);
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return 'just now';
}

export function formatDateTime(timestamp: string) {
  return new Date(timestamp).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
