import { BadRequestException } from '@nestjs/common';

import { assertPromoRedemptionCapacity } from './assert-promo-capacity';

describe('assertPromoRedemptionCapacity', () => {
  function txMock(options?: { total?: number; perCustomer?: number }) {
    return {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'promo-1' }]),
      promoCodeRedemption: {
        count: jest
          .fn()
          .mockResolvedValueOnce(options?.total ?? 0)
          .mockResolvedValueOnce(options?.perCustomer ?? 0),
      },
    };
  }

  it('locks the promo row then allows a redemption under the cap', async () => {
    const tx = txMock({ total: 2, perCustomer: 0 });
    await assertPromoRedemptionCapacity(tx as never, {
      promoCodeId: '11111111-1111-4111-a111-111111111111',
      customerId: '22222222-2222-4222-a222-222222222222',
      maxRedemptions: 10,
      maxRedemptionsPerCustomer: 1,
    });
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.promoCodeRedemption.count).toHaveBeenCalledTimes(2);
  });

  it('rejects when the global cap is already reached', async () => {
    const tx = txMock({ total: 10 });
    await expect(
      assertPromoRedemptionCapacity(tx as never, {
        promoCodeId: '11111111-1111-4111-a111-111111111111',
        customerId: '22222222-2222-4222-a222-222222222222',
        maxRedemptions: 10,
        maxRedemptionsPerCustomer: null,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects when the per-customer cap is already reached', async () => {
    const tx = txMock({ total: 1, perCustomer: 1 });
    await expect(
      assertPromoRedemptionCapacity(tx as never, {
        promoCodeId: '11111111-1111-4111-a111-111111111111',
        customerId: '22222222-2222-4222-a222-222222222222',
        maxRedemptions: 10,
        maxRedemptionsPerCustomer: 1,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
