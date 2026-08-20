import { ForbiddenException } from '@nestjs/common';

import {
  buildQpaySecureHash,
  formatQpayRequestDate,
} from './qpay-callback.security';
import { QpayCheckoutService } from './qpay-checkout.service';

describe('QpayCheckoutService.handleBankCallback', () => {
  const secret = 'merchant-secret';
  const merchantId = 'MERCH-1';
  const sid = 'sid1234567890abcdef';
  const commonOrder = 'BQ-9024-1';
  const pun = 'BQ90241';
  const requestDate = formatQpayRequestDate(new Date());

  const findUniqueSession = jest.fn();
  const findFirstSession = jest.fn();
  const updateSession = jest.fn();
  const updateManyPayments = jest.fn();
  const findGatewayConfig = jest.fn();
  const upsertOpen = jest.fn();

  const prisma = {
    hostedCheckoutSession: {
      findUnique: findUniqueSession,
      findFirst: findFirstSession,
      update: updateSession,
    },
    payment: { updateMany: updateManyPayments },
    paymentGatewayConfig: { findUnique: findGatewayConfig },
  };

  const confirmPayment = jest.fn().mockResolvedValue({ success: true });
  const service = new QpayCheckoutService(
    prisma as never,
    { getOrThrow: () => 'jwt-secret', get: () => null } as never,
    { upsertOpen } as never,
    { get: () => ({ confirmPayment }) } as never,
  );

  const pendingRow = {
    id: 'session-1',
    sid,
    gateway: 'qpay',
    commonOrder,
    orderId: 'order-1',
    amount: 85,
    currency: 'QAR',
    status: 'pending',
    createdAt: new Date(),
    paramsJson: {
      qpay_params: { PUN: pun, TransactionRequestDate: requestDate },
      success_url: '/mpgs-success',
      failed_url: '/mpgs-fail',
    },
  };

  function signedPayload(overrides: Record<string, string | number> = {}) {
    const payload: Record<string, string | number> = {
      Response_Status: '0000',
      Response_ConfirmationID: 'CNF-1',
      Response_MerchantModuleSessionID: sid,
      Response_PUN: pun,
      Response_Amount: 8500,
      Response_CurrencyCode: '634',
      Response_MerchantID: merchantId,
      Response_TransactionRequestDate: requestDate,
      ...overrides,
    };
    payload.Response_SecureHash = buildQpaySecureHash(payload, secret);
    return payload;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    findGatewayConfig.mockResolvedValue({
      enabled: true,
      configJson: { secret_key: secret, merchant_id: merchantId, bank_id: 'BNK' },
    });
    findUniqueSession.mockResolvedValue({ ...pendingRow });
    findFirstSession.mockResolvedValue(null);
    updateSession.mockResolvedValue({});
    updateManyPayments.mockResolvedValue({ count: 1 });
    upsertOpen.mockResolvedValue({});
  });

  it('marks the hosted session paid after a signed matching callback', async () => {
    const result = await service.handleBankCallback(signedPayload());

    expect(result.paid).toBe(true);
    expect(upsertOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        commonOrder,
        gateway: 'qpay',
        providerSessionId: sid,
        checkoutSnapshot: expect.objectContaining({ qpay_verified: true }),
      }),
    );
    expect(confirmPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        common_order: commonOrder,
        provider: 'qpay',
      }),
    );
    expect(updateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'session-1' },
        data: expect.objectContaining({
          status: 'paid',
          paramsJson: expect.objectContaining({ qpay_verified: true }),
        }),
      }),
    );
    expect(updateManyPayments).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ status: 'failed' }),
      }),
    );
  });

  it('rejects a missing SecureHash and does not update the session', async () => {
    const payload = signedPayload();
    delete payload.Response_SecureHash;

    await expect(service.handleBankCallback(payload)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(updateSession).not.toHaveBeenCalled();
  });

  it('rejects a forged SecureHash and does not update the session', async () => {
    const payload = signedPayload();
    payload.Response_SecureHash = 'deadbeef';

    await expect(service.handleBankCallback(payload)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(updateSession).not.toHaveBeenCalled();
  });

  it('looks up the session by sid only (no PUN contains fallback)', async () => {
    findUniqueSession.mockResolvedValue(null);

    const result = await service.handleBankCallback(signedPayload());

    expect(result.paid).toBe(false);
    expect(result.message).toMatch(/not found/i);
    expect(findFirstSession).not.toHaveBeenCalled();
    expect(updateSession).not.toHaveBeenCalled();
  });

  it('does not mark paid when the response amount does not match the session', async () => {
    const result = await service.handleBankCallback(
      signedPayload({ Response_Amount: 1 }),
    );

    expect(result.paid).toBe(false);
    expect(updateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'failed' }),
      }),
    );
  });

  it('rejects a confirmation id already stored on another session', async () => {
    findFirstSession.mockResolvedValue({ id: 'other-session' });

    await expect(service.handleBankCallback(signedPayload())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(updateSession).not.toHaveBeenCalled();
  });

  it('is a no-op when the same session is already verified paid', async () => {
    findUniqueSession.mockResolvedValue({
      ...pendingRow,
      status: 'paid',
      paramsJson: {
        ...pendingRow.paramsJson,
        qpay_verified: true,
        qpay_event_id: 'CNF-1',
        qpay_callback: { Response_Status: '0000' },
      },
    });

    const result = await service.handleBankCallback(signedPayload());

    expect(result.paid).toBe(true);
    expect(updateSession).not.toHaveBeenCalled();
  });
});
