import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  CustomerPaymentRecoveryReason,
  CustomerPaymentRecoveryStatus,
  PaymentGateway,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';

export type UpsertCustomerPaymentRecoveryInput = {
  commonOrder?: string | null;
  orderId?: string | null;
  customerId?: string | null;
  customerEmail?: string | null;
  eventId?: string | null;
  eventSlug?: string | null;
  gateway: PaymentGateway;
  reason?: CustomerPaymentRecoveryReason;
  amount: number;
  currency: string;
  idempotencyKey?: string | null;
  providerSessionId?: string | null;
  providerInvoiceId?: string | null;
  providerPaymentId?: string | null;
  checkoutSnapshot?: Record<string, unknown> | null;
  failureMessage?: string | null;
};

@Injectable()
export class PaymentRecoveryService {
  private readonly logger = new Logger(PaymentRecoveryService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Customer web/mobile online only — never POS / offline. */
  isCustomerOnlineSource(source?: string | null, hasOfflinePayment?: boolean) {
    if (hasOfflinePayment) return false;
    const normalized = (source || 'web').trim().toLowerCase();
    return (
      normalized === 'web' ||
      normalized === 'mobile' ||
      normalized === 'customer' ||
      normalized === ''
    );
  }

  async assertVerifiedCustomerPayment(input: {
    gateway: PaymentGateway;
    customerId?: string | null;
    providerSessionId?: string | null;
    providerPaymentId?: string | null;
    amount: number;
    currency: string;
  }) {
    const providerSessionId = input.providerSessionId?.trim() || null;
    const providerPaymentId = input.providerPaymentId?.trim() || null;
    if (!providerSessionId && !providerPaymentId) {
      throw new BadRequestException('Verified payment reference is required.');
    }

    const recovery = await this.prisma.customerPaymentRecovery.findFirst({
      where: {
        gateway: input.gateway,
        status: CustomerPaymentRecoveryStatus.open,
        ...(input.customerId ? { customerId: input.customerId } : {}),
        OR: [
          ...(providerSessionId ? [{ providerSessionId }] : []),
          ...(providerPaymentId ? [{ providerPaymentId }] : []),
        ],
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!recovery) {
      throw new BadRequestException(
        'Payment has not been verified by the payment provider or was already used.',
      );
    }

    const verifiedAmount = Number(recovery.amount);
    const expectedAmount = Number(input.amount);
    if (
      verifiedAmount <= 0 ||
      Math.abs(verifiedAmount - expectedAmount) > 0.01 ||
      recovery.currency.toUpperCase() !== input.currency.toUpperCase()
    ) {
      throw new BadRequestException(
        'Verified payment amount or currency does not match this booking.',
      );
    }

    return recovery;
  }

  gatewayFromPaymentMethod(paymentMethod: number | null | undefined): PaymentGateway | null {
    if (paymentMethod === 7) return 'qpay';
    if (paymentMethod === 8) return 'mastercard';
    // MyFatoorah card / Apple Pay / Google Pay / etc.
    if (
      paymentMethod === 10 ||
      paymentMethod === 11 ||
      paymentMethod === 12 ||
      paymentMethod === 2 ||
      paymentMethod === 1
    ) {
      return 'myfatoorah';
    }
    return null;
  }

  async upsertOpen(input: UpsertCustomerPaymentRecoveryInput) {
    try {
      const existing = await this.findOpenMatch(input);
      const incoming = (input.checkoutSnapshot ?? {}) as Record<string, unknown>;
      const reason = input.reason ?? CustomerPaymentRecoveryReason.awaiting_confirm;

      if (existing) {
        const previous =
          (existing.checkoutSnapshotJson as Record<string, unknown> | null) ?? {};
        // Merge so payment-return updates don't wipe cart fields needed to rebuild.
        const mergedSnapshot = {
          ...previous,
          ...incoming,
          schedule:
            (incoming.schedule as object | undefined) ??
            (previous.schedule as object | undefined) ??
            undefined,
          tickets:
            (incoming.tickets as unknown[] | undefined) ??
            (previous.tickets as unknown[] | undefined) ??
            undefined,
          addons:
            (incoming.addons as unknown[] | undefined) ??
            (previous.addons as unknown[] | undefined) ??
            undefined,
          customer:
            (incoming.customer as object | undefined) ??
            (previous.customer as object | undefined) ??
            undefined,
        } as Prisma.InputJsonValue;

        return this.prisma.customerPaymentRecovery.update({
          where: { id: existing.id },
          data: {
            commonOrder: input.commonOrder ?? existing.commonOrder,
            orderId: input.orderId ?? existing.orderId,
            customerId: input.customerId ?? existing.customerId,
            customerEmail: input.customerEmail ?? existing.customerEmail,
            eventId: input.eventId ?? existing.eventId,
            eventSlug: input.eventSlug ?? existing.eventSlug,
            gateway: input.gateway,
            status: CustomerPaymentRecoveryStatus.open,
            reason,
            amount: input.amount,
            currency: input.currency || existing.currency,
            idempotencyKey: input.idempotencyKey ?? existing.idempotencyKey,
            providerSessionId: input.providerSessionId ?? existing.providerSessionId,
            providerInvoiceId: input.providerInvoiceId ?? existing.providerInvoiceId,
            providerPaymentId: input.providerPaymentId ?? existing.providerPaymentId,
            checkoutSnapshotJson: mergedSnapshot,
            failureMessage: input.failureMessage ?? existing.failureMessage,
            resolvedAt: null,
          },
        });
      }

      return this.prisma.customerPaymentRecovery.create({
        data: {
          commonOrder: input.commonOrder ?? null,
          orderId: input.orderId ?? null,
          customerId: input.customerId ?? null,
          customerEmail: input.customerEmail ?? null,
          eventId: input.eventId ?? null,
          eventSlug: input.eventSlug ?? null,
          gateway: input.gateway,
          status: CustomerPaymentRecoveryStatus.open,
          reason,
          amount: input.amount,
          currency: input.currency || 'QAR',
          idempotencyKey: input.idempotencyKey ?? null,
          providerSessionId: input.providerSessionId ?? null,
          providerInvoiceId: input.providerInvoiceId ?? null,
          providerPaymentId: input.providerPaymentId ?? null,
          checkoutSnapshotJson: incoming as Prisma.InputJsonValue,
          failureMessage: input.failureMessage ?? null,
        },
      });
    } catch (error) {
      this.logger.error('Failed to upsert customer payment recovery', error);
      return null;
    }
  }

  async resolve(keys: {
    commonOrder?: string | null;
    orderId?: string | null;
    idempotencyKey?: string | null;
    providerSessionId?: string | null;
  }) {
    try {
      const open = await this.findOpenMatch(keys);
      if (!open) return null;
      return this.prisma.customerPaymentRecovery.update({
        where: { id: open.id },
        data: {
          status: CustomerPaymentRecoveryStatus.resolved,
          resolvedAt: new Date(),
          failureMessage: null,
          ...(keys.commonOrder ? { commonOrder: keys.commonOrder } : {}),
          ...(keys.orderId ? { orderId: keys.orderId } : {}),
        },
      });
    } catch (error) {
      this.logger.error('Failed to resolve customer payment recovery', error);
      return null;
    }
  }

  async markConfirmNeverCalled(orderIds: string[]) {
    if (!orderIds.length) return 0;
    try {
      const result = await this.prisma.customerPaymentRecovery.updateMany({
        where: {
          orderId: { in: orderIds },
          status: CustomerPaymentRecoveryStatus.open,
          reason: CustomerPaymentRecoveryReason.awaiting_confirm,
        },
        data: {
          reason: CustomerPaymentRecoveryReason.confirm_never_called,
        },
      });
      return result.count;
    } catch (error) {
      this.logger.error('Failed to mark recoveries confirm_never_called', error);
      return 0;
    }
  }

  private async findOpenMatch(keys: {
    commonOrder?: string | null;
    orderId?: string | null;
    idempotencyKey?: string | null;
    providerSessionId?: string | null;
  }) {
    const or: Prisma.CustomerPaymentRecoveryWhereInput[] = [];
    if (keys.commonOrder?.trim()) {
      or.push({ commonOrder: keys.commonOrder.trim() });
    }
    if (keys.orderId?.trim()) {
      or.push({ orderId: keys.orderId.trim() });
    }
    if (keys.idempotencyKey?.trim()) {
      or.push({ idempotencyKey: keys.idempotencyKey.trim() });
    }
    if (keys.providerSessionId?.trim()) {
      or.push({ providerSessionId: keys.providerSessionId.trim() });
    }
    if (!or.length) return null;

    return this.prisma.customerPaymentRecovery.findFirst({
      where: {
        status: CustomerPaymentRecoveryStatus.open,
        OR: or,
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
