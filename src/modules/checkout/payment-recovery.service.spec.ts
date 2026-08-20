import {
  CustomerPaymentRecoveryReason,
  CustomerPaymentRecoveryStatus,
} from '@prisma/client';

import { PaymentRecoveryService } from './payment-recovery.service';

describe('PaymentRecoveryService', () => {
  const update = jest.fn();
  const create = jest.fn();
  const findFirst = jest.fn();
  const updateMany = jest.fn();

  const prisma = {
    customerPaymentRecovery: {
      findFirst,
      update,
      create,
      updateMany,
    },
  };

  const service = new PaymentRecoveryService(prisma as never);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('treats web source without offline payment as customer online', () => {
    expect(service.isCustomerOnlineSource('web', false)).toBe(true);
    expect(service.isCustomerOnlineSource('mobile', false)).toBe(true);
    expect(service.isCustomerOnlineSource('pos', false)).toBe(false);
    expect(service.isCustomerOnlineSource('web', true)).toBe(false);
  });

  it('accepts only a matching provider-verified customer payment', async () => {
    findFirst.mockResolvedValue({
      id: 'r1',
      amount: 75,
      currency: 'QAR',
    });

    await expect(
      service.assertVerifiedCustomerPayment({
        gateway: 'myfatoorah',
        customerId: 'customer-1',
        providerSessionId: 'session-1',
        providerPaymentId: 'payment-1',
        amount: 75,
        currency: 'QAR',
      }),
    ).resolves.toMatchObject({ id: 'r1' });

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          gateway: 'myfatoorah',
          customerId: 'customer-1',
          status: CustomerPaymentRecoveryStatus.open,
        }),
      }),
    );
  });

  it('rejects a verified payment with the wrong total', async () => {
    findFirst.mockResolvedValue({ amount: 10, currency: 'QAR' });

    await expect(
      service.assertVerifiedCustomerPayment({
        gateway: 'myfatoorah',
        providerPaymentId: 'payment-1',
        amount: 75,
        currency: 'QAR',
      }),
    ).rejects.toThrow(/amount or currency/i);
  });

  it('maps hosted payment methods to gateways', () => {
    expect(service.gatewayFromPaymentMethod(7)).toBe('qpay');
    expect(service.gatewayFromPaymentMethod(8)).toBe('mastercard');
    expect(service.gatewayFromPaymentMethod(12)).toBe('myfatoorah');
  });

  it('creates an open recovery when none exists', async () => {
    findFirst.mockResolvedValue(null);
    create.mockResolvedValue({ id: 'r1', status: 'open' });

    await service.upsertOpen({
      commonOrder: 'BQ-1',
      gateway: 'mastercard',
      amount: 100,
      currency: 'QAR',
      idempotencyKey: 'key-1',
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          commonOrder: 'BQ-1',
          status: CustomerPaymentRecoveryStatus.open,
          reason: CustomerPaymentRecoveryReason.awaiting_confirm,
        }),
      }),
    );
  });

  it('resolves an open recovery match', async () => {
    findFirst.mockResolvedValue({ id: 'r1' });
    update.mockResolvedValue({ id: 'r1', status: 'resolved' });

    await service.resolve({ commonOrder: 'BQ-1' });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'r1' },
        data: expect.objectContaining({
          status: CustomerPaymentRecoveryStatus.resolved,
        }),
      }),
    );
  });

  it('merges checkout snapshots so payment updates keep cart fields', async () => {
    findFirst.mockResolvedValue({
      id: 'r1',
      commonOrder: 'BQ-1',
      orderId: 'o1',
      customerId: null,
      customerEmail: 'a@b.com',
      eventId: null,
      eventSlug: 'show',
      currency: 'QAR',
      idempotencyKey: 'key-1',
      providerSessionId: null,
      providerInvoiceId: null,
      providerPaymentId: null,
      failureMessage: null,
      checkoutSnapshotJson: {
        event_slug: 'show',
        schedule: { date: '2026-08-01', time: '19:00' },
        tickets: [{ ticket_id: 't1', quantity: 1 }],
        customer: { email: 'a@b.com' },
      },
    });
    update.mockResolvedValue({ id: 'r1' });

    await service.upsertOpen({
      commonOrder: 'BQ-1',
      gateway: 'myfatoorah',
      amount: 50,
      currency: 'QAR',
      providerPaymentId: 'pay-1',
      checkoutSnapshot: {
        provider_response: { paymentId: 'pay-1' },
        customer: { email: 'a@b.com', name: 'Ann' },
      },
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          checkoutSnapshotJson: expect.objectContaining({
            event_slug: 'show',
            tickets: [{ ticket_id: 't1', quantity: 1 }],
            schedule: { date: '2026-08-01', time: '19:00' },
            provider_response: { paymentId: 'pay-1' },
            customer: { email: 'a@b.com', name: 'Ann' },
          }),
        }),
      }),
    );
  });
});
