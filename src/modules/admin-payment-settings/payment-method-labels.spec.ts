import {
  coerceOnlinePaymentMethodId,
  formatPaymentProviderLabel,
  normalizePaymentMethodLabel,
  onlinePaymentMethodIdFromLabel,
  resolveMyFatoorahMethodIdFromHints,
  resolveOnlinePaymentMethodLabel,
  resolvePaymentMethodKeyLabel,
} from './payment-method-labels';

describe('payment-method-labels', () => {
  it('resolves known method ids', () => {
    expect(resolveOnlinePaymentMethodLabel(10)).toBe('Myfatoorah . ApplePay');
    expect(resolveOnlinePaymentMethodLabel(11)).toBe('Myfatoorah . Googlepay');
    expect(resolveOnlinePaymentMethodLabel(12)).toBe('Myfatoorah . Card');
    expect(resolveOnlinePaymentMethodLabel(7)).toBe('Qpay');
    expect(resolveOnlinePaymentMethodLabel(8)).toBe('MPGS');
    expect(resolveOnlinePaymentMethodLabel(null)).toBe('Online');
  });

  it('normalizes legacy MyFatoorah-N labels', () => {
    expect(normalizePaymentMethodLabel('MyFatoorah-11')).toBe(
      'Myfatoorah . Googlepay',
    );
    expect(normalizePaymentMethodLabel('MyFatoorah-10')).toBe(
      'Myfatoorah . ApplePay',
    );
    expect(normalizePaymentMethodLabel('MyFatoorah-12')).toBe(
      'Myfatoorah . Card',
    );
    expect(normalizePaymentMethodLabel('Cash')).toBe('Cash');
  });

  it('resolves method_key values used on payment rows', () => {
    expect(resolvePaymentMethodKeyLabel('myfatoorah-11')).toBe(
      'Myfatoorah . Googlepay',
    );
    expect(resolvePaymentMethodKeyLabel('myfatoorah-10')).toBe(
      'Myfatoorah . ApplePay',
    );
    expect(resolvePaymentMethodKeyLabel('myfatoorah-12')).toBe(
      'Myfatoorah . Card',
    );
    expect(resolvePaymentMethodKeyLabel('qpay-7')).toBe('Qpay');
    expect(resolvePaymentMethodKeyLabel('mastercard-8')).toBe('MPGS');
    expect(resolvePaymentMethodKeyLabel('pos-cash')).toBe('Cash');
    expect(formatPaymentProviderLabel('myfatoorah')).toBe('MyFatoorah');
    expect(formatPaymentProviderLabel('mastercard')).toBe('Mastercard');
    expect(formatPaymentProviderLabel('qpay')).toBe('QPay');
  });

  it('coerces numeric payment_method values from snapshots', () => {
    expect(coerceOnlinePaymentMethodId(11)).toBe(11);
    expect(coerceOnlinePaymentMethodId('11')).toBe(11);
    expect(coerceOnlinePaymentMethodId(null)).toBeNull();
    expect(coerceOnlinePaymentMethodId('')).toBeNull();
  });

  it('infers MyFatoorah method from checkout_ref / supported methods', () => {
    expect(
      resolveMyFatoorahMethodIdFromHints({
        checkoutRef: 'abc123_googlepay',
      }),
    ).toBe(11);
    expect(
      resolveMyFatoorahMethodIdFromHints({
        checkoutRef: 'abc123_applepay',
      }),
    ).toBe(10);
    expect(
      resolveMyFatoorahMethodIdFromHints({
        checkoutRef: 'abc123_card',
      }),
    ).toBe(12);
    expect(
      resolveMyFatoorahMethodIdFromHints({
        supportedPaymentMethods: ['googlepay'],
      }),
    ).toBe(11);
    expect(
      resolveMyFatoorahMethodIdFromHints({
        paymentDetail: { Data: { PaymentGateway: 'GooglePay' } },
      }),
    ).toBe(11);
    expect(
      resolveMyFatoorahMethodIdFromHints({
        paymentMethod: null,
        checkoutRef: null,
      }),
    ).toBeNull();
  });
});
