import {
  buildQpaySecureHash,
  isQpayCallbackStale,
  parseQpayRequestDate,
  qpayCallbackAmountMatches,
  verifyQpayCallbackSignature,
} from './qpay-callback.security';

describe('qpay-callback.security', () => {
  const secret = 'merchant-secret';

  it('accepts a callback whose SecureHash matches the merchant secret', () => {
    const payload: Record<string, string | number> = {
      Response_Status: '0000',
      Response_ConfirmationID: 'CNF-1',
      Response_MerchantModuleSessionID: 'sid1234567890',
      Response_PUN: 'ORD1',
      Response_Amount: 8500,
    };
    const hash = buildQpaySecureHash(payload, secret);
    expect(
      verifyQpayCallbackSignature({ ...payload, Response_SecureHash: hash }, secret),
    ).toBe(true);
  });

  it('rejects a missing or forged SecureHash', () => {
    const payload = {
      Response_Status: '0000',
      Response_MerchantModuleSessionID: 'sid1234567890',
      Response_PUN: 'ORD1',
      Response_Amount: 8500,
    };
    expect(verifyQpayCallbackSignature(payload, secret)).toBe(false);
    expect(
      verifyQpayCallbackSignature(
        { ...payload, Response_SecureHash: 'deadbeef' },
        secret,
      ),
    ).toBe(false);
  });

  it('parses TransactionRequestDate and rejects stale callbacks', () => {
    const now = new Date(2026, 7, 16, 12, 0, 0);
    const fresh = parseQpayRequestDate('16082026115500');
    expect(fresh).toEqual(new Date(2026, 7, 16, 11, 55, 0));
    expect(
      isQpayCallbackStale({
        now,
        requestDate: '16082026115500',
      }),
    ).toBe(false);
    expect(
      isQpayCallbackStale({
        now,
        requestDate: '15082025120000',
      }),
    ).toBe(true);
  });

  it('ignores non-QPay extra fields when verifying the hash', () => {
    const payload: Record<string, string | number> = {
      Response_Status: '0000',
      Response_ConfirmationID: 'CNF-1',
      Response_MerchantModuleSessionID: 'sid1234567890',
      Response_PUN: 'ORD1',
      Response_Amount: 8500,
    };
    const hash = buildQpaySecureHash(payload, secret);
    expect(
      verifyQpayCallbackSignature(
        { ...payload, Response_SecureHash: hash, utm_source: 'spoof' },
        secret,
      ),
    ).toBe(true);
  });

  it('matches QPay amounts in major or minor units', () => {
    expect(qpayCallbackAmountMatches(85, 85)).toBe(true);
    expect(qpayCallbackAmountMatches(85, 8500)).toBe(true);
    expect(qpayCallbackAmountMatches(85, 0.1)).toBe(false);
  });
});

