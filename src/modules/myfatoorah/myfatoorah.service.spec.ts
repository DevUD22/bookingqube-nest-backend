import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { MyFatoorahService } from './myfatoorah.service';

describe('MyFatoorahService.createBatchEmbeddedSessions', () => {
  const customer = {
    id: 'cust-1',
    name: 'Ada',
    email: 'ada@example.test',
  };

  function buildService(order: unknown) {
    const prisma = {
      order: {
        findFirst: jest.fn().mockResolvedValue(order),
        findUnique: jest.fn().mockResolvedValue(order),
      },
      paymentGatewayConfig: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
      },
      hostedCheckoutSession: {
        upsert: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    const paymentMethods = {
      assertGatewayEnabled: jest.fn().mockResolvedValue(undefined),
    };
    const paymentRecovery = { upsertOpen: jest.fn() };
    const service = new MyFatoorahService(
      prisma as never,
      paymentMethods as never,
      paymentRecovery as never,
      { get: jest.fn(), getOrThrow: jest.fn() } as never,
    );
    return { service, prisma, paymentRecovery };
  }

  it('uses the client amount when no pending order exists', async () => {
    const { service, paymentRecovery } = buildService(null);
    jest
      .spyOn(service as any, 'resolveActiveEnvironment')
      .mockResolvedValue('sandbox');
    jest.spyOn(service as any, 'loadCredentials').mockResolvedValue({
      apiKey: 'test-key',
      config: { country_iso: 'QAT' },
    });
    jest
      .spyOn(service as any, 'sessionScriptUrl')
      .mockReturnValue('https://example.test/session.js');
    const createSession = jest
      .spyOn(service as any, 'createSessionInternal')
      .mockResolvedValue({
        sessionId: 'QAR-session',
        sessionExpiry: null,
        operationType: 'PAY',
        amount: 85,
        currency: 'QAR',
      });

    const result = await service.createBatchEmbeddedSessions(
      {
        amount: 85,
        currency: 'QAR',
        idempotency_key: 'key-1',
        embedded_methods: ['myfatoorah_card'],
      },
      customer,
    );

    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 85 }),
    );
    expect(result.success).toBe(true);
    expect(paymentRecovery.upsertOpen).not.toHaveBeenCalled();
  });

  it('uses the pending order total instead of the client amount', async () => {
    const { service } = buildService({
      id: 'order-1',
      commonOrder: 'BQ-1',
      totalAmount: new Prisma.Decimal(85),
      currency: 'QAR',
      customerId: 'cust-1',
    });
    jest
      .spyOn(service as any, 'resolveActiveEnvironment')
      .mockResolvedValue('sandbox');
    jest.spyOn(service as any, 'loadCredentials').mockResolvedValue({
      apiKey: 'test-key',
      config: { country_iso: 'QAT' },
    });
    jest
      .spyOn(service as any, 'sessionScriptUrl')
      .mockReturnValue('https://example.test/session.js');
    const createSession = jest
      .spyOn(service as any, 'createSessionInternal')
      .mockResolvedValue({
        sessionId: 'QAR-session',
        sessionExpiry: null,
        operationType: 'PAY',
        amount: 85,
        currency: 'QAR',
      });

    const result = await service.createBatchEmbeddedSessions(
      {
        amount: 0.1,
        currency: 'QAR',
        idempotency_key: 'key-1',
        embedded_methods: ['myfatoorah_card'],
      },
      customer,
    );

    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 85,
        orderId: 'order-1',
      }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects when the pending order belongs to another customer', async () => {
    const { service } = buildService({
      id: 'order-1',
      commonOrder: 'BQ-1',
      totalAmount: new Prisma.Decimal(85),
      currency: 'QAR',
      customerId: 'other-customer',
    });

    await expect(
      service.createBatchEmbeddedSessions(
        { amount: 85, idempotency_key: 'key-1' },
        customer,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('admin session create uses the requested amount', async () => {
    const { service } = buildService(null);
    jest
      .spyOn(service as any, 'resolveActiveEnvironment')
      .mockResolvedValue('sandbox');
    jest.spyOn(service as any, 'loadCredentials').mockResolvedValue({
      apiKey: 'test-key',
      config: { country_iso: 'QAT' },
    });
    jest
      .spyOn(service as any, 'sessionScriptUrl')
      .mockReturnValue('https://example.test/session.js');
    const createSession = jest
      .spyOn(service as any, 'createSessionInternal')
      .mockResolvedValue({
        sessionId: 'admin-session',
        sessionExpiry: null,
        operationType: 'PAY',
        amount: 85,
        currency: 'QAR',
      });

    await service.createEmbeddedSession({
      amount: 85,
      currency: 'QAR',
      external_identifier: 'BQ-1',
      customer_email: 'ada@example.test',
    });

    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 85 }),
    );
  });
});
