/**
 * Human-readable online payment labels for orders / reports / admin lists.
 * Method IDs align with CustomerPaymentMethodsService (10/11/12 MyFatoorah, 7 QPay, 8 MPGS).
 */
const ONLINE_PAYMENT_METHOD_LABELS: Record<number, string> = {
  7: 'Qpay',
  8: 'MPGS',
  10: 'Myfatoorah . ApplePay',
  11: 'Myfatoorah . Googlepay',
  12: 'Myfatoorah . Card',
};

const LEGACY_NUMERIC_LABEL = /^(?:MyFatoorah|myfatoorah|Myfatoorah)[-_ ]?(\d+)$/i;
const METHOD_KEY_NUMERIC = /^(?:myfatoorah|qpay|mpgs|mastercard)[-_](\d+)$/i;

const POS_METHOD_KEY_LABELS: Record<string, string> = {
  'pos-cash': 'Cash',
  'pos-card': 'Card',
  'pos-comp': 'Comp',
  'pos-split': 'Split',
  'pos-advance': 'Advance',
  cash: 'Cash',
  card: 'Card',
  comp: 'Comp',
  online: 'Online',
  'mock-payment': 'Mock payment',
};

export function resolveOnlinePaymentMethodLabel(
  methodId: number | null | undefined,
): string {
  if (methodId == null) {
    return 'Online';
  }
  if (methodId === 0) {
    return 'Free';
  }
  return ONLINE_PAYMENT_METHOD_LABELS[methodId] ?? `Online-${methodId}`;
}

/**
 * Convert stored legacy labels like `MyFatoorah-11` into display labels.
 * Leaves already-human labels untouched.
 */
export function normalizePaymentMethodLabel(
  label: string | null | undefined,
  methodId?: number | null,
): string {
  const trimmed = label?.trim() ?? '';
  if (methodId != null && ONLINE_PAYMENT_METHOD_LABELS[methodId]) {
    return ONLINE_PAYMENT_METHOD_LABELS[methodId];
  }

  const fromLegacy = trimmed.match(LEGACY_NUMERIC_LABEL);
  if (fromLegacy) {
    const id = Number(fromLegacy[1]);
    if (Number.isFinite(id)) {
      return resolveOnlinePaymentMethodLabel(id);
    }
  }

  if (trimmed) {
    return trimmed;
  }

  return resolveOnlinePaymentMethodLabel(methodId);
}

/**
 * Human label for a payment row `method_key` (e.g. `myfatoorah-11`, `pos-cash`).
 */
export function resolvePaymentMethodKeyLabel(
  methodKey: string | null | undefined,
  providerPaymentMethodId?: number | null,
): string {
  if (
    providerPaymentMethodId != null &&
    ONLINE_PAYMENT_METHOD_LABELS[providerPaymentMethodId]
  ) {
    return ONLINE_PAYMENT_METHOD_LABELS[providerPaymentMethodId];
  }

  const key = methodKey?.trim() ?? '';
  if (!key) {
    return resolveOnlinePaymentMethodLabel(providerPaymentMethodId);
  }

  const fromPos = POS_METHOD_KEY_LABELS[key.toLowerCase()];
  if (fromPos) {
    return fromPos;
  }

  const fromKey = key.match(METHOD_KEY_NUMERIC) ?? key.match(LEGACY_NUMERIC_LABEL);
  if (fromKey) {
    const id = Number(fromKey[1]);
    if (Number.isFinite(id)) {
      return resolveOnlinePaymentMethodLabel(id);
    }
  }

  return normalizePaymentMethodLabel(key, providerPaymentMethodId);
}

export function onlinePaymentMethodIdFromLabel(
  label: string | null | undefined,
): number | null {
  const trimmed = label?.trim() ?? '';
  const fromLegacy = trimmed.match(LEGACY_NUMERIC_LABEL);
  if (fromLegacy) {
    const id = Number(fromLegacy[1]);
    return Number.isFinite(id) ? id : null;
  }

  const entry = Object.entries(ONLINE_PAYMENT_METHOD_LABELS).find(
    ([, value]) => value.toLowerCase() === trimmed.toLowerCase(),
  );
  return entry ? Number(entry[0]) : null;
}

/** Coerce snapshot / DTO payment_method values (number or numeric string). */
export function coerceOnlinePaymentMethodId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const asNum = Number(value.trim());
    if (Number.isFinite(asNum) && asNum > 0) {
      return asNum;
    }
    return onlinePaymentMethodIdFromLabel(value);
  }
  return null;
}

/**
 * Infer MyFatoorah method id (10/11/12) when checkout snapshots omit payment_method.
 * Embedded sessions store a suffix on checkout_ref and SupportedPaymentMethods on the session.
 */
export function resolveMyFatoorahMethodIdFromHints(hints: {
  paymentMethod?: unknown;
  checkoutRef?: string | null;
  supportedPaymentMethods?: unknown;
  paymentDetail?: unknown;
}): number | null {
  const fromExplicit = coerceOnlinePaymentMethodId(hints.paymentMethod);
  if (fromExplicit === 10 || fromExplicit === 11 || fromExplicit === 12) {
    return fromExplicit;
  }

  const ref = String(hints.checkoutRef ?? '').toLowerCase();
  if (/_(?:googlepay|google_pay)(?:$|[^a-z0-9])/i.test(ref) || /googlepay$/i.test(ref)) {
    return 11;
  }
  if (/_(?:applepay|apple_pay)(?:$|[^a-z0-9])/i.test(ref) || /applepay$/i.test(ref)) {
    return 10;
  }
  if (/_(?:myfatoorah_)?card(?:$|[^a-z0-9])/i.test(ref) || /(?:^|_)card$/i.test(ref)) {
    return 12;
  }

  const supportedList = Array.isArray(hints.supportedPaymentMethods)
    ? hints.supportedPaymentMethods.map((item) => String(item).toLowerCase())
    : typeof hints.supportedPaymentMethods === 'string'
      ? [hints.supportedPaymentMethods.toLowerCase()]
      : [];
  if (supportedList.some((item) => item.includes('google'))) return 11;
  if (supportedList.some((item) => item.includes('apple'))) return 10;
  if (supportedList.some((item) => item.includes('card'))) return 12;

  const gatewayName = extractMyFatoorahGatewayName(hints.paymentDetail);
  if (gatewayName.includes('google')) return 11;
  if (gatewayName.includes('apple')) return 10;
  if (
    gatewayName.includes('card') ||
    gatewayName.includes('visa') ||
    gatewayName.includes('master') ||
    gatewayName.includes('mada')
  ) {
    return 12;
  }

  return fromExplicit;
}

function extractMyFatoorahGatewayName(detail: unknown): string {
  if (!detail || typeof detail !== 'object') {
    return typeof detail === 'string' ? detail.toLowerCase() : '';
  }

  const row = detail as Record<string, unknown>;
  const data = (row.Data as Record<string, unknown> | undefined) ?? row;
  const txn = (row.Transaction as Record<string, unknown> | undefined) ?? {};
  const invoiceTxns = Array.isArray(data.InvoiceTransactions)
    ? (data.InvoiceTransactions as Array<Record<string, unknown>>)
    : [];
  const candidates = [
    row.PaymentGateway,
    row.paymentGateway,
    row.PaymentMethod,
    data.PaymentGateway,
    data.PaymentMethod,
    txn.PaymentGateway,
    txn.PaymentMethod,
    invoiceTxns[0]?.PaymentGateway,
    invoiceTxns[0]?.PaymentMethod,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.toLowerCase();
    }
  }
  return '';
}

export function formatPaymentProviderLabel(provider: string | null | undefined): string {
  const value = (provider ?? '').trim().toLowerCase();
  if (value === 'myfatoorah') return 'MyFatoorah';
  if (value === 'mastercard' || value === 'mpgs') return 'Mastercard';
  if (value === 'qpay') return 'QPay';
  if (value === 'internal') return 'Internal';
  if (!value) return 'Online';
  return value.charAt(0).toUpperCase() + value.slice(1);
}
