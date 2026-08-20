import {
  amountsMatch,
  assertAmountAndCurrencyMatch,
  currenciesMatch,
  extractMpgsSettlement,
  extractMyFatoorahBindTokens,
  extractMyFatoorahSettlement,
  myFatoorahInvoiceIsPaid,
  myFatoorahSettlementMatchesOrder,
  expectedMyFatoorahBindTokens,
} from './payment-verification';

describe('payment-verification', () => {
  it('matches rounded amounts and currencies', () => {
    expect(amountsMatch(85, 85)).toBe(true);
    expect(amountsMatch(85, 85.004)).toBe(true);
    expect(amountsMatch(85, 84.5)).toBe(false);
    expect(currenciesMatch('QAR', 'qar')).toBe(true);
    expect(currenciesMatch('QAR', 'USD')).toBe(false);
  });

  it('rejects MyFatoorah IsSuccess without a paid invoice', () => {
    expect(
      myFatoorahInvoiceIsPaid({
        IsSuccess: true,
        InvoiceStatus: 'Failed',
      }),
    ).toBe(false);
    expect(
      myFatoorahInvoiceIsPaid({
        InvoiceStatus: 'Paid',
        InvoiceValue: 85,
      }),
    ).toBe(true);
  });

  it('extracts MyFatoorah paid amount from GetPaymentStatus', () => {
    expect(
      extractMyFatoorahSettlement({
        Data: {
          InvoiceStatus: 'Paid',
          InvoiceValue: 85.5,
          InvoiceCurrencyIso: 'QAR',
        },
      }),
    ).toEqual({ paid: true, amount: 85.5, currency: 'QAR' });
  });

  it('extracts MyFatoorah v3 decrypted Amount.ValueInPayCurrency', () => {
    expect(
      extractMyFatoorahSettlement({
        Invoice: { Id: '6389179', Status: 'PAID' },
        Transaction: { Status: 'SUCCESS', PaymentId: '0707' },
        Amount: {
          BaseCurrency: 'QAR',
          ValueInBaseCurrency: '85',
          DisplayCurrency: 'QAR',
          ValueInDisplayCurrency: '85',
          PayCurrency: 'QAR',
          ValueInPayCurrency: '85',
          ReceivableAmount: '84.20',
        },
      }),
    ).toEqual({ paid: true, amount: 85, currency: 'QAR' });
  });

  it('extracts MPGS captured amount', () => {
    expect(
      extractMpgsSettlement({
        result: 'SUCCESS',
        status: 'CAPTURED',
        order: { amount: 40, currency: 'QAR' },
      }),
    ).toEqual({ paid: true, amount: 40, currency: 'QAR' });
  });

  it('throws when gateway amount does not match the order', () => {
    expect(() =>
      assertAmountAndCurrencyMatch({
        expectedAmount: 100,
        expectedCurrency: 'QAR',
        actualAmount: 0.1,
        actualCurrency: 'QAR',
        source: 'MyFatoorah',
      }),
    ).toThrow(/does not match the order total/);
  });

  it('binds MyFatoorah settlement to this order checkout ref, not another cart', () => {
    const tokens = extractMyFatoorahBindTokens({
      Data: {
        InvoiceId: 99,
        ExternalIdentifier: 'hold-a_card',
        SessionId: 'sess-a',
        CustomerReference: 'customer-someone-else',
      },
    });
    const expectedA = expectedMyFatoorahBindTokens({
      commonOrder: 'BQ-A',
      idempotencyKey: 'hold-a',
      hostedSid: 'sess-a',
    });
    const expectedB = expectedMyFatoorahBindTokens({
      commonOrder: 'BQ-B',
      idempotencyKey: 'hold-b',
      hostedSid: 'sess-b',
    });

    expect(myFatoorahSettlementMatchesOrder(tokens, expectedA)).toBe(true);
    expect(myFatoorahSettlementMatchesOrder(tokens, expectedB)).toBe(false);
    expect(tokens.some((token) => token.startsWith('customer-'))).toBe(false);
  });
});
