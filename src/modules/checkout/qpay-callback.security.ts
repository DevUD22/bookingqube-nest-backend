import { createHash, timingSafeEqual } from 'crypto';

const QPAY_HASH_EXCLUDED_KEYS = new Set([
  'SecureHash',
  'Response_SecureHash',
]);

/** Request-form aliases the bank may echo; Response_* fields are always hashed. */
const QPAY_HASHABLE_ALIASES = new Set([
  'Action',
  'Amount',
  'BankID',
  'CurrencyCode',
  'Lang',
  'MerchantID',
  'MerchantModuleSessionID',
  'PUN',
  'PaymentDescription',
  'Quantity',
  'TransactionRequestDate',
]);

function isQpayHashableKey(key: string) {
  if (QPAY_HASH_EXCLUDED_KEYS.has(key)) return false;
  return key.startsWith('Response_') || QPAY_HASHABLE_ALIASES.has(key);
}

export const QPAY_CALLBACK_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const QPAY_CALLBACK_FUTURE_SKEW_MS = 5 * 60 * 1000;

export function buildQpaySecureHash(
  parameters: Record<string, string | number>,
  secret: string,
) {
  const hashParams = { ...parameters };
  delete hashParams.SecureHash;
  delete hashParams.Response_SecureHash;
  const keys = Object.keys(hashParams).sort();
  let ordered = secret;
  for (const key of keys) {
    ordered += String(hashParams[key] ?? '');
  }
  return createHash('sha256').update(ordered).digest('hex');
}

export function presentedQpayHash(raw: Record<string, unknown>) {
  return String(raw.Response_SecureHash ?? raw.SecureHash ?? '')
    .trim()
    .toLowerCase();
}

/** SHA-256(secret + sorted field values), same as outbound checkout params. */
export function verifyQpayCallbackSignature(
  raw: Record<string, unknown>,
  secret: string,
): boolean {
  const presented = presentedQpayHash(raw);
  if (!presented || !secret.trim()) return false;

  const params: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!isQpayHashableKey(key)) continue;
    if (value === undefined || value === null) continue;
    params[key] = typeof value === 'number' ? value : String(value);
  }

  const expected = buildQpaySecureHash(params, secret).toLowerCase();
  try {
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(presented, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function formatQpayRequestDate(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    pad(date.getDate()) +
    pad(date.getMonth() + 1) +
    date.getFullYear() +
    pad(date.getHours()) +
    pad(date.getMinutes()) +
    pad(date.getSeconds())
  );
}

export function parseQpayRequestDate(value: string): Date | null {
  const raw = String(value || '').trim();
  if (!/^\d{14}$/.test(raw)) return null;
  const day = Number(raw.slice(0, 2));
  const month = Number(raw.slice(2, 4));
  const year = Number(raw.slice(4, 8));
  const hour = Number(raw.slice(8, 10));
  const minute = Number(raw.slice(10, 12));
  const second = Number(raw.slice(12, 14));
  const parsed = new Date(year, month - 1, day, hour, minute, second);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getDate() !== day ||
    parsed.getMonth() !== month - 1 ||
    parsed.getFullYear() !== year
  ) {
    return null;
  }
  return parsed;
}

export function isQpayCallbackStale(input: {
  now?: Date;
  requestDate?: string | null;
  createdAt?: Date | null;
}) {
  const now = input.now ?? new Date();
  const stamped =
    (input.requestDate ? parseQpayRequestDate(input.requestDate) : null) ??
    input.createdAt ??
    null;
  if (!stamped) return true;
  const delta = now.getTime() - stamped.getTime();
  if (delta < -QPAY_CALLBACK_FUTURE_SKEW_MS) return true;
  return delta > QPAY_CALLBACK_MAX_AGE_MS;
}

export function qpayCallbackAmountMatches(
  sessionAmountMajor: number,
  responseAmount: number | null,
) {
  if (responseAmount == null || !Number.isFinite(responseAmount)) return false;
  const major = Number(sessionAmountMajor);
  const minor = Math.round(major * 100);
  return (
    Math.abs(responseAmount - major) <= 0.01 ||
    Math.abs(responseAmount - minor) <= 1
  );
}

export function qpaySanitizePun(orderNumber: string) {
  const pun = orderNumber.replace(/[^A-Za-z0-9]/g, '');
  return (pun || `${Date.now()}`).slice(0, 40);
}
