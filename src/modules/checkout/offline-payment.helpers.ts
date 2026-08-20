import { BadRequestException } from '@nestjs/common';
import { PaymentLegType, PaymentProvider, PaymentTransactionStatus, Prisma } from '@prisma/client';

import { OfflinePaymentMode } from '../reporting/order-reporting.enricher';
import { OfflinePaymentDto } from './dto/book-ticket.dto';

export type NormalizedOfflinePayment = {
  mode: OfflinePaymentMode;
  splitCashAmount: number;
  splitCardAmount: number;
  advanceAmount: number;
  advanceType: 'cash' | 'card' | null;
  /** Preferred: POS agent user id stored as Order.bookedByAgentId */
  bookedByAgentId: string | null;
};

export function normalizeOfflinePayment(
  input: OfflinePaymentDto | undefined,
  fallbackAgentId?: string | null,
): NormalizedOfflinePayment | null {
  if (!input?.mode) return null;
  const mode = input.mode;
  const allowed: OfflinePaymentMode[] = ['cash', 'card', 'split', 'advance', 'comp'];
  if (!allowed.includes(mode)) {
    throw new BadRequestException('Invalid offline payment mode.');
  }
  return {
    mode,
    splitCashAmount: roundMoney(Number(input.split_cash_amount) || 0),
    splitCardAmount: roundMoney(Number(input.split_card_amount) || 0),
    advanceAmount: roundMoney(Number(input.advance_amount) || 0),
    advanceType: input.advance_type === 'card' ? 'card' : input.advance_type === 'cash' ? 'cash' : null,
    bookedByAgentId:
      input.agent_id?.trim() ||
      input.booked_by_agent_id?.trim() ||
      input.sold_by_user_id?.trim() ||
      fallbackAgentId ||
      null,
  };
}

export function assertOfflinePayment(
  offline: NormalizedOfflinePayment | null,
  totalAmount: number,
) {
  if (!offline) return;
  if (offline.mode === 'split') {
    const sum = roundMoney(offline.splitCashAmount + offline.splitCardAmount);
    if (offline.splitCashAmount < 0 || offline.splitCardAmount < 0) {
      throw new BadRequestException('Split amounts must be non-negative.');
    }
    if (sum !== roundMoney(totalAmount)) {
      throw new BadRequestException(
        `Split cash + card (${sum}) must equal order total (${totalAmount}).`,
      );
    }
  }
  if (offline.mode === 'advance') {
    if (!offline.advanceType) {
      throw new BadRequestException('advance_type must be cash or card.');
    }
    if (offline.advanceAmount <= 0 || offline.advanceAmount >= totalAmount) {
      throw new BadRequestException('advance_amount must be greater than 0 and less than total.');
    }
  }
}

export type TenderAmounts = {
  cashAmount: number;
  cardAmount: number;
  onlineAmount: number;
  compAmount: number;
};

export function resolveTenderAmounts(
  offline: NormalizedOfflinePayment | null,
  totalAmount: number,
  isPaid: boolean,
  isOnlinePaid = false,
): TenderAmounts {
  if (!isPaid) {
    return { cashAmount: 0, cardAmount: 0, onlineAmount: 0, compAmount: 0 };
  }
  if (!offline) {
    return {
      cashAmount: 0,
      cardAmount: 0,
      onlineAmount: isOnlinePaid ? totalAmount : 0,
      compAmount: 0,
    };
  }
  switch (offline.mode) {
    case 'cash':
      return { cashAmount: totalAmount, cardAmount: 0, onlineAmount: 0, compAmount: 0 };
    case 'card':
      return { cashAmount: 0, cardAmount: totalAmount, onlineAmount: 0, compAmount: 0 };
    case 'split':
      return {
        cashAmount: offline.splitCashAmount,
        cardAmount: offline.splitCardAmount,
        onlineAmount: 0,
        compAmount: 0,
      };
    case 'comp':
      return { cashAmount: 0, cardAmount: 0, onlineAmount: 0, compAmount: totalAmount };
    case 'advance':
      return { cashAmount: 0, cardAmount: 0, onlineAmount: 0, compAmount: 0 };
  }
}

export function tenderFromAdvanceLegs(
  advanceAmount: number,
  advanceType: 'cash' | 'card',
  remainingAmount: number,
  remainingType: 'cash' | 'card',
): TenderAmounts {
  let cashAmount = 0;
  let cardAmount = 0;
  if (advanceType === 'cash') cashAmount += advanceAmount;
  else cardAmount += advanceAmount;
  if (remainingType === 'cash') cashAmount += remainingAmount;
  else cardAmount += remainingAmount;
  return {
    cashAmount: roundMoney(cashAmount),
    cardAmount: roundMoney(cardAmount),
    onlineAmount: 0,
    compAmount: 0,
  };
}

export async function createOfflinePaymentLegs(
  tx: Prisma.TransactionClient,
  args: {
    orderId: string;
    offline: NormalizedOfflinePayment | null;
    onlinePaid?: {
      provider: string;
      amount: number;
      currency: string;
      paymentMethod: number | null;
      providerResponse?: {
        invoiceId?: string;
        paymentId?: string;
        sessionId?: string;
      };
    } | null;
    totalAmount: number;
    currency: string;
    defaultLegType: PaymentLegType;
    collectedByUserId: string | null;
    now: Date;
    /** Extra legs for advance complete (advance + remaining). */
    extraLegs?: Array<{
      legType: PaymentLegType;
      amount: number;
      methodKey: string;
    }>;
  },
) {
  const {
    orderId,
    offline,
    onlinePaid,
    totalAmount,
    currency,
    defaultLegType,
    collectedByUserId,
    now,
    extraLegs,
  } = args;

  if (extraLegs && extraLegs.length > 0) {
    await tx.payment.createMany({
      data: extraLegs.map((leg) => ({
        orderId,
        provider: PaymentProvider.internal,
        methodKey: leg.methodKey,
        legType: leg.legType,
        status: PaymentTransactionStatus.paid,
        amount: leg.amount,
        currency,
        collectedByUserId,
        paidAt: now,
      })),
    });
    return;
  }

  if (offline?.mode === 'split') {
    const legs = [
      { amount: offline.splitCashAmount, legType: PaymentLegType.cash, methodKey: 'pos-cash' },
      { amount: offline.splitCardAmount, legType: PaymentLegType.card, methodKey: 'pos-card' },
    ].filter((leg) => leg.amount > 0);
    await tx.payment.createMany({
      data: legs.map((leg) => ({
        orderId,
        provider: PaymentProvider.internal,
        methodKey: leg.methodKey,
        legType: leg.legType,
        status: PaymentTransactionStatus.paid,
        amount: leg.amount,
        currency,
        collectedByUserId,
        paidAt: now,
      })),
    });
    return;
  }

  if (offline) {
    const methodKey =
      offline.mode === 'cash'
        ? 'pos-cash'
        : offline.mode === 'card'
          ? 'pos-card'
          : offline.mode === 'comp'
            ? 'pos-comp'
            : `pos-${offline.mode}`;
    await tx.payment.create({
      data: {
        orderId,
        provider: PaymentProvider.internal,
        methodKey,
        legType: defaultLegType,
        status: PaymentTransactionStatus.paid,
        amount: offline.mode === 'comp' ? 0 : totalAmount,
        currency,
        collectedByUserId,
        paidAt: now,
      },
    });
    return;
  }

  if (onlinePaid) {
    const isMock = onlinePaid.provider === 'mock';
    await tx.payment.create({
      data: {
        orderId,
        provider: isMock ? PaymentProvider.internal : PaymentProvider.myfatoorah,
        providerPaymentMethodId: onlinePaid.paymentMethod,
        methodKey: isMock ? 'mock-payment' : `myfatoorah-${onlinePaid.paymentMethod ?? 'unknown'}`,
        legType: PaymentLegType.online_gateway,
        status: PaymentTransactionStatus.paid,
        amount: onlinePaid.amount,
        currency: onlinePaid.currency,
        providerInvoiceId: onlinePaid.providerResponse?.invoiceId ?? null,
        providerPaymentId: onlinePaid.providerResponse?.paymentId ?? null,
        providerSessionId: onlinePaid.providerResponse?.sessionId ?? null,
        providerResponse: onlinePaid.providerResponse ?? undefined,
        collectedByUserId,
        paidAt: now,
      },
    });
  }
}

export function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}
