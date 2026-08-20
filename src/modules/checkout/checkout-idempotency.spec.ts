import { createHash } from 'node:crypto';

import { CheckoutService } from './checkout.service';

describe('CheckoutService idempotency replay secrets (H12)', () => {
  const service = new CheckoutService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const internals = service as unknown as {
    shouldReturnBookingSecrets: (
      orderCustomerId: string | null | undefined,
      input: { offlinePayment?: unknown; holdReleaseToken?: string | null },
      authenticatedUserId?: string,
      releaseTokenHash?: string | null,
    ) => boolean;
    redactBookingSecretsIfNeeded: (
      response: Record<string, unknown>,
      canSeeSecrets: boolean,
    ) => Record<string, unknown>;
    parseIdempotentCache: (raw: string) => {
      v: 2;
      customerId: string | null;
      releaseTokenHash: string | null;
      response: Record<string, unknown>;
    } | null;
    releaseTokenMatches: (storedHash: string, presented: string) => boolean;
  };

  const fullResponse = {
    success: true,
    data: {
      common_order: 'BQ-1',
      status: 'pending_payment',
      ticket_orders: [{ order_number: 'T-SECRET', ticket_title: 'Adult' }],
      hold_release_token: 'plaintext-hold-secret',
      qpay_token: 'qpay-secret',
    },
  };

  it('does not return ticket codes to a logged-in stranger', () => {
    expect(
      internals.shouldReturnBookingSecrets('owner-id', {}, 'stranger-id', null),
    ).toBe(false);
    const redacted = internals.redactBookingSecretsIfNeeded(fullResponse, false);
    expect(redacted.data).toEqual(
      expect.objectContaining({
        common_order: 'BQ-1',
        ticket_orders: [],
        hold_release_token: null,
        qpay_token: null,
      }),
    );
  });

  it('returns secrets to the owning customer', () => {
    expect(
      internals.shouldReturnBookingSecrets('owner-id', {}, 'owner-id', null),
    ).toBe(true);
  });

  it('does not treat metadata.source=pos or a random JWT as ownership', () => {
    expect(
      internals.shouldReturnBookingSecrets('owner-id', { offlinePayment: null }, 'anyone'),
    ).toBe(false);
  });

  it('returns secrets to POS when offline payment is actually enabled', () => {
    expect(
      internals.shouldReturnBookingSecrets('cust-1', { offlinePayment: { mode: 'cash' } }),
    ).toBe(true);
  });

  it('returns secrets to a guest who presents the original hold token', () => {
    const presented = 'hold-secret';
    const hash = createHash('sha256').update(presented).digest('hex');
    expect(
      internals.shouldReturnBookingSecrets(
        'guest-id',
        { holdReleaseToken: presented },
        undefined,
        hash,
      ),
    ).toBe(true);
    expect(
      internals.shouldReturnBookingSecrets(
        'guest-id',
        { holdReleaseToken: 'wrong' },
        undefined,
        hash,
      ),
    ).toBe(false);
  });

  it('wraps v2 cache envelopes and treats legacy cache as unowned', () => {
    const v2 = internals.parseIdempotentCache(
      JSON.stringify({
        v: 2,
        customerId: 'owner-id',
        releaseTokenHash: 'abc',
        response: fullResponse,
      }),
    );
    expect(v2?.customerId).toBe('owner-id');
    expect(v2?.response).toEqual(fullResponse);

    const legacy = internals.parseIdempotentCache(JSON.stringify(fullResponse));
    expect(legacy?.customerId).toBeNull();
    expect(legacy?.response).toEqual(fullResponse);
  });
});
