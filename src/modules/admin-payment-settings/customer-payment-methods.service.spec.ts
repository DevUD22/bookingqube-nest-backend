import { BadRequestException } from '@nestjs/common';

import { CustomerPaymentMethodsService } from './customer-payment-methods.service';

describe('CustomerPaymentMethodsService', () => {
  const findMany = jest.fn();
  const service = new CustomerPaymentMethodsService({
    paymentGatewayConfig: { findMany },
  } as never, {
    get: jest.fn().mockReturnValue(undefined),
  } as never);

  beforeEach(() => {
    findMany.mockReset();
  });

  it('lists V2 methods only for enabled+active gateways', async () => {
    findMany.mockResolvedValue([{ gateway: 'myfatoorah' }, { gateway: 'mastercard' }]);

    await expect(service.listEnabledPaymentMethods()).resolves.toEqual([
      { id: 10, name: 'Apple Pay' },
      { id: 11, name: 'Google Pay' },
      { id: 12, name: 'MyFatoorah Card' },
      { id: 8, name: 'Visa/MasterCard' },
    ]);
  });

  it('allows free and unknown legacy method ids', async () => {
    findMany.mockResolvedValue([]);
    await expect(service.isPaymentMethodAllowed(0)).resolves.toBe(true);
    await expect(service.isPaymentMethodAllowed(2)).resolves.toBe(true);
    await expect(service.assertPaymentMethodAllowed(0)).resolves.toBeUndefined();
    await expect(service.assertPaymentMethodAllowed(2)).resolves.toBeUndefined();
  });

  it('rejects gateway methods when the admin gateway is disabled', async () => {
    findMany.mockResolvedValue([]);
    await expect(service.assertPaymentMethodAllowed(12)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.assertGatewayEnabled('qpay')).rejects.toThrow(/QPay/i);
  });
});
