import {
  PaymentGateway,
  PaymentLegType,
  PaymentProvider,
  PaymentTransactionStatus,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';

export type HostedProviderRefs = {
  sessionId?: string | null;
  paymentId?: string | null;
  invoiceId?: string | null;
  resultIndicator?: string | null;
  gateway?: PaymentGateway | string | null;
  /** Safe subset of bank/gateway callback fields (no full PAN/CVV). */
  gatewayPayload?: Record<string, unknown> | null;
};

export function paymentProviderFromGateway(
  gateway: PaymentGateway | string | null | undefined,
): PaymentProvider {
  if (gateway === 'qpay') return PaymentProvider.qpay;
  if (gateway === 'mastercard') return PaymentProvider.mastercard;
  if (gateway === 'myfatoorah') return PaymentProvider.myfatoorah;
  return PaymentProvider.myfatoorah;
}

export function methodKeyForGateway(
  gateway: PaymentGateway | string | null | undefined,
  methodId: number | null | undefined,
): string {
  if (gateway === 'qpay') return `qpay-${methodId ?? 7}`;
  if (gateway === 'mastercard') return `mastercard-${methodId ?? 8}`;
  if (methodId != null) return `myfatoorah-${methodId}`;
  return 'myfatoorah-confirm';
}

export function methodIdForGateway(
  gateway: PaymentGateway | string | null | undefined,
): number | null {
  if (gateway === 'qpay') return 7;
  if (gateway === 'mastercard') return 8;
  return null;
}

/** Persist a pending payment row as soon as hosted checkout starts (failure recovery). */
export async function createPendingHostedPayment(
  prisma: PrismaService,
  input: {
    orderId: string;
    gateway: PaymentGateway;
    sessionId: string;
    amount: number;
    currency: string;
  },
) {
  const methodId = methodIdForGateway(input.gateway);
  return prisma.payment.create({
    data: {
      orderId: input.orderId,
      provider: paymentProviderFromGateway(input.gateway),
      providerPaymentMethodId: methodId,
      methodKey: methodKeyForGateway(input.gateway, methodId),
      legType: PaymentLegType.online_gateway,
      status: PaymentTransactionStatus.pending,
      amount: input.amount,
      currency: input.currency || 'QAR',
      providerSessionId: input.sessionId,
      providerResponse: {
        sessionId: input.sessionId,
        provider: input.gateway,
        status: 'pending',
      },
    },
  });
}

export function mergeProviderRefs(
  ...sources: Array<HostedProviderRefs | null | undefined>
): HostedProviderRefs {
  const merged: HostedProviderRefs = {};
  for (const source of sources) {
    if (!source) continue;
    if (source.sessionId) merged.sessionId = String(source.sessionId);
    if (source.paymentId) merged.paymentId = String(source.paymentId);
    if (source.invoiceId) merged.invoiceId = String(source.invoiceId);
    if (source.resultIndicator) {
      merged.resultIndicator = String(source.resultIndicator);
    }
    if (source.gateway) merged.gateway = source.gateway;
    if (source.gatewayPayload && typeof source.gatewayPayload === 'object') {
      merged.gatewayPayload = {
        ...(merged.gatewayPayload ?? {}),
        ...source.gatewayPayload,
      };
    }
  }
  return merged;
}

export function refsFromHostedParams(
  params: Record<string, unknown> | null | undefined,
  sid?: string | null,
): HostedProviderRefs {
  const root = params ?? {};
  const stored =
    (root.providerResponse as Record<string, unknown> | undefined) ?? {};
  const gatewayCallback =
    (root.gateway_callback as Record<string, unknown> | undefined) ??
    (root.qpay_callback as Record<string, unknown> | undefined) ??
    {};

  const paymentId =
    (stored.paymentId as string | undefined) ??
    (gatewayCallback.Response_ConfirmationID as string | undefined) ??
    (gatewayCallback.confirmationId as string | undefined) ??
    null;
  const invoiceId =
    (stored.invoiceId as string | undefined) ??
    (gatewayCallback.Response_PUN as string | undefined) ??
    (gatewayCallback.pun as string | undefined) ??
    null;
  const sessionId =
    (stored.sessionId as string | undefined) ??
    sid ??
    (gatewayCallback.Response_MerchantModuleSessionID as string | undefined) ??
    null;

  return {
    sessionId,
    paymentId: paymentId ? String(paymentId) : null,
    invoiceId: invoiceId ? String(invoiceId) : null,
    resultIndicator:
      (stored.resultIndicator as string | undefined) ??
      (root.resultIndicator as string | undefined) ??
      null,
    gatewayPayload: Object.keys(gatewayCallback).length
      ? sanitizeGatewayCallback(gatewayCallback)
      : null,
  };
}

/** Keep only safe gateway callback fields — never raw card secrets. */
export function sanitizeGatewayCallback(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const allowed = [
    'Response_Status',
    'Response_StatusMessage',
    'Response_ConfirmationID',
    'Response_PUN',
    'Response_MerchantModuleSessionID',
    'Response_CardNumber', // typically masked by bank
    'Response_Amount',
    'Response_CurrencyCode',
    'Response_BankID',
    'Response_MerchantID',
    'Response_TransactionRequestDate',
    'MerchantModuleSessionID',
    'confirmationId',
    'pun',
    'status',
    'message',
    'resultIndicator',
    'sessionId',
    'paymentId',
    'invoiceId',
  ];
  const out: Record<string, unknown> = {};
  for (const key of allowed) {
    if (raw[key] !== undefined && raw[key] !== null && raw[key] !== '') {
      out[key] = raw[key];
    }
  }
  return out;
}

export function buildProviderResponseJson(
  refs: HostedProviderRefs,
  extras?: Record<string, unknown>,
): Prisma.InputJsonValue {
  return {
    isSuccess: true,
    sessionId: refs.sessionId ?? null,
    invoiceId: refs.invoiceId ?? null,
    paymentId: refs.paymentId ?? null,
    resultIndicator: refs.resultIndicator ?? null,
    provider: refs.gateway ?? null,
    ...(refs.gatewayPayload ? { gateway: refs.gatewayPayload } : {}),
    ...(extras ?? {}),
  } as Prisma.InputJsonValue;
}
