import { createHash } from 'node:crypto';
import { HttpException, HttpStatus } from '@nestjs/common';

export const PAYMENT_AMOUNT_TOLERANCE = 0.01;

const PAID_INVOICE_STATUSES = new Set(['PAID', 'SUCC', 'SUCCESS']);
const PAID_TXN_STATUSES = new Set([
  'SUCCESS',
  'SUCCSS',
  'CAPTURED',
  'SUCCESSFUL',
  'PAID',
]);

export type GatewaySettlement = {
  paid: boolean;
  amount: number | null;
  currency: string | null;
};

export function paymentNotVerified(message: string): HttpException {
  return new HttpException(
    {
      statusCode: HttpStatus.PAYMENT_REQUIRED,
      error: 'Payment Required',
      message,
    },
    HttpStatus.PAYMENT_REQUIRED,
  );
}

export function roundMoney(value: number) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}

export function currenciesMatch(expected: string, actual: string | null | undefined) {
  const left = (expected || 'QAR').trim().toUpperCase();
  const right = (actual || left).trim().toUpperCase();
  return left === right;
}

export function amountsMatch(
  expected: number,
  actual: number | null | undefined,
  tolerance = PAYMENT_AMOUNT_TOLERANCE,
) {
  if (actual == null || !Number.isFinite(Number(actual))) return false;
  return Math.abs(roundMoney(expected) - roundMoney(Number(actual))) <= tolerance;
}

export function assertAmountAndCurrencyMatch(input: {
  expectedAmount: number;
  expectedCurrency: string;
  actualAmount: number | null | undefined;
  actualCurrency?: string | null;
  source: string;
}) {
  if (!amountsMatch(input.expectedAmount, input.actualAmount)) {
    throw paymentNotVerified(
      `Paid amount from ${input.source} does not match the order total.`,
    );
  }
  if (!currenciesMatch(input.expectedCurrency, input.actualCurrency)) {
    throw paymentNotVerified(
      `Paid currency from ${input.source} does not match the order currency.`,
    );
  }
}

export function myFatoorahInvoiceIsPaid(data: Record<string, unknown> | null | undefined) {
  if (!data) return false;
  const invoiceStatus = String(
    data.InvoiceStatus ?? data.Status ?? '',
  ).toUpperCase();
  if (PAID_INVOICE_STATUSES.has(invoiceStatus)) return true;

  const transactions = Array.isArray(data.InvoiceTransactions)
    ? (data.InvoiceTransactions as Array<Record<string, unknown>>)
    : [];
  return transactions.some((txn) =>
    PAID_TXN_STATUSES.has(String(txn.TransactionStatus ?? '').toUpperCase()),
  );
}

function numericAmount(value: unknown): number | null {
  if (value == null || typeof value === 'object') return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

function extractV3AmountBlock(value: unknown): {
  amount: number | null;
  currency: string | null;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { amount: numericAmount(value), currency: null };
  }
  const block = value as Record<string, unknown>;
  return {
    amount: numericAmount(
      block.ValueInPayCurrency ??
        block.ValueInDisplayCurrency ??
        block.ValueInBaseCurrency ??
        block.Value,
    ),
    currency:
      String(
        block.PayCurrency ??
          block.DisplayCurrency ??
          block.BaseCurrency ??
          '',
      ).trim() || null,
  };
}

export function extractMyFatoorahSettlement(
  payload: Record<string, unknown> | null | undefined,
): GatewaySettlement {
  if (!payload) {
    return { paid: false, amount: null, currency: null };
  }

  const invoice = (payload.Invoice ?? payload.Data ?? payload) as Record<
    string,
    unknown
  >;
  const txn = (payload.Transaction ?? {}) as Record<string, unknown>;
  const order = (
    payload.Order && typeof payload.Order === 'object'
      ? payload.Order
      : {}
  ) as Record<string, unknown>;
  const data = (payload.Data as Record<string, unknown> | undefined) ?? invoice;
  const v3Amount = extractV3AmountBlock(payload.Amount ?? data.Amount ?? invoice.Amount);

  const invoiceStatus = String(invoice.Status ?? data.InvoiceStatus ?? '').toUpperCase();
  const txnStatus = String(txn.Status ?? txn.TransactionStatus ?? '').toUpperCase();
  const paid =
    myFatoorahInvoiceIsPaid(data) ||
    PAID_INVOICE_STATUSES.has(invoiceStatus) ||
    PAID_TXN_STATUSES.has(txnStatus);

  const amount =
    numericAmount(data.InvoiceValue) ??
    numericAmount(invoice.Value) ??
    numericAmount(invoice.Amount) ??
    numericAmount(txn.Amount) ??
    numericAmount(payload.InvoiceValue) ??
    numericAmount(order.Amount) ??
    v3Amount.amount;
  const currency =
    String(
      data.InvoiceCurrencyIso ??
        data.Currency ??
        invoice.CurrencyIso ??
        invoice.Currency ??
        txn.Currency ??
        payload.Currency ??
        v3Amount.currency ??
        order.Currency ??
        '',
    ).trim() || null;

  return {
    paid,
    amount,
    currency,
  };
}

const MYFATOORAH_CHECKOUT_SUFFIXES = ['googlepay', 'applepay', 'card'] as const;

const MYFATOORAH_BIND_KEYS = new Set([
  'externalidentifier',
  'external_identifier',
  'userdefinedfield',
  'invoicedisplayvalue',
  'invoicereference',
  'sessionid',
  'customeridentifier',
]);

export function normalizeMyFatoorahExternalIdentifier(raw: string) {
  const trimmed = raw.trim();
  if (/^[A-Za-z0-9_-]{1,36}$/.test(trimmed)) return trimmed;
  return `BQ${createHash('sha256').update(trimmed).digest('hex').slice(0, 24)}`;
}

export function myFatoorahCheckoutRefsForKey(idempotencyKey: string) {
  const key = idempotencyKey.trim();
  if (!key) return [];
  const raw = [key, ...MYFATOORAH_CHECKOUT_SUFFIXES.map((suffix) => `${key}_${suffix}`)];
  return [
    ...new Set(raw.flatMap((value) => [value, normalizeMyFatoorahExternalIdentifier(value)])),
  ];
}

export function expectedMyFatoorahBindTokens(input: {
  commonOrder: string;
  idempotencyKey?: string | null;
  hostedSid?: string | null;
  hostedCheckoutRef?: string | null;
  hostedInvoiceId?: string | null;
}) {
  const raw: string[] = [];
  const push = (value?: string | null) => {
    const trimmed = (value ?? '').trim();
    if (trimmed) raw.push(trimmed);
  };
  push(input.commonOrder);
  push(input.idempotencyKey);
  push(input.hostedSid);
  push(input.hostedCheckoutRef);
  push(input.hostedInvoiceId);
  if (input.idempotencyKey?.trim()) {
    raw.push(...myFatoorahCheckoutRefsForKey(input.idempotencyKey));
  }
  return [
    ...new Set(
      raw.flatMap((value) => [
        normalizeBindToken(value),
        normalizeBindToken(normalizeMyFatoorahExternalIdentifier(value)),
      ]),
    ),
  ].filter(Boolean);
}

export function extractMyFatoorahBindTokens(
  payload: Record<string, unknown> | null | undefined,
): string[] {
  const tokens = new Set<string>();
  collectMyFatoorahBindTokens(payload, tokens, 0);
  return [...tokens];
}

export function myFatoorahSettlementMatchesOrder(
  presented: Array<string | number | null | undefined>,
  expected: string[],
) {
  if (expected.length === 0) return false;
  const wanted = new Set(expected.map(normalizeBindToken).filter(Boolean));
  return presented
    .map((value) => (value == null ? '' : normalizeBindToken(String(value))))
    .filter(Boolean)
    .some((token) => wanted.has(token));
}

function normalizeBindToken(value: string) {
  return value.trim().toLowerCase();
}

function collectMyFatoorahBindTokens(
  value: unknown,
  out: Set<string>,
  depth: number,
) {
  if (value == null || depth > 5) return;
  if (typeof value === 'string' || typeof value === 'number') {
    const token = normalizeBindToken(String(value));
    if (token && !token.startsWith('customer-')) out.add(token);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectMyFatoorahBindTokens(item, out, depth + 1);
    return;
  }
  if (typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (MYFATOORAH_BIND_KEYS.has(key.replace(/_/g, '').toLowerCase())) {
      collectMyFatoorahBindTokens(nested, out, depth + 1);
    } else if (nested && typeof nested === 'object') {
      collectMyFatoorahBindTokens(nested, out, depth + 1);
    }
  }
}

export function extractMpgsSettlement(
  payload: Record<string, unknown> | null | undefined,
): GatewaySettlement {
  if (!payload) {
    return { paid: false, amount: null, currency: null };
  }
  const order = (payload.order as Record<string, unknown> | undefined) ?? {};
  const status = String(
    (payload.status as string) || (order.status as string) || '',
  ).toUpperCase();
  const result = String(payload.result ?? '').toUpperCase();
  const paid =
    result === 'SUCCESS' &&
    ['CAPTURED', 'AUTHORIZED', 'PAID', 'SUCCESS'].includes(status);
  const rawAmount = payload.amount ?? order.amount ?? order.totalCapturedAmount;
  const amount = rawAmount == null ? null : Number(rawAmount);
  const currency =
    String(payload.currency ?? order.currency ?? '').trim() || null;

  return {
    paid,
    amount: Number.isFinite(amount as number) ? Number(amount) : null,
    currency,
  };
}
