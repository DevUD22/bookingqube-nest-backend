import { BadRequestException, NotFoundException } from '@nestjs/common';

import { AdminPaymentSettingsService } from './admin-payment-settings.service';

describe('AdminPaymentSettingsService', () => {
  const prisma = {
    paymentGatewayConfig: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const service = new AdminPaymentSettingsService(prisma as never);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('upsert rejects qpay non-live environments', async () => {
    await expect(
      service.upsert('qpay', {
        environment: 'sandbox',
        config: { secret_key: 'secret' },
      } as never),
    ).rejects.toThrow(/live configuration only/);
  });

  it('upsert preserves previous secrets when masked values are sent', async () => {
    prisma.paymentGatewayConfig.findUnique.mockResolvedValue({
      gateway: 'myfatoorah',
      environment: 'sandbox',
      enabled: true,
      isActive: false,
      configJson: { api_key: 'real-secret-key-value', country_iso: 'QAT' },
    });

    const saved = {
      gateway: 'myfatoorah',
      environment: 'sandbox',
      enabled: true,
      isActive: true,
      configJson: {
        api_key: 'real-secret-key-value',
        country_iso: 'QAT',
        api_base_url: 'https://apitest.myfatoorah.com',
        session_script_url: '',
        legacy_session_script_url: '',
      },
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };

    prisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => unknown) =>
      callback({
        ...prisma,
        paymentGatewayConfig: {
          ...prisma.paymentGatewayConfig,
          upsert: jest.fn().mockResolvedValue(saved),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      }),
    );

    const result = await service.upsert('myfatoorah', {
      environment: 'sandbox',
      enabled: true,
      is_active: true,
      config: {
        api_key: 'abcd••••alue',
        country_iso: 'QAT',
      },
    } as never);

    expect(result.data.config.config.api_key).toMatch(/••••/);
    expect(result.data.config.config.api_key).not.toBe('real-secret-key-value');
  });

  it('upsert deactivates other environments when is_active is true', async () => {
    prisma.paymentGatewayConfig.findUnique.mockResolvedValue(null);
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const upsert = jest.fn().mockResolvedValue({
      gateway: 'mastercard',
      environment: 'live',
      enabled: true,
      isActive: true,
      configJson: {},
      updatedAt: new Date(),
    });

    prisma.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback({
        paymentGatewayConfig: { updateMany, upsert },
      }),
    );

    await service.upsert('mastercard', {
      environment: 'live',
      enabled: true,
      is_active: true,
      config: { merchant_name: 'Demo' },
    } as never);

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { gateway: 'mastercard', NOT: { environment: 'live' } },
        data: { isActive: false },
      }),
    );
  });

  it('get masks secret keys in config', async () => {
    prisma.paymentGatewayConfig.findMany.mockResolvedValue([
      {
        gateway: 'myfatoorah',
        environment: 'sandbox',
        enabled: true,
        isActive: true,
        configJson: {
          api_key: 'abcdefghijkl',
          country_iso: 'QAT',
        },
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);

    const result = await service.get('myfatoorah');
    const sandbox = result.data.gateway.environments.find(
      (row: { environment: string }) => row.environment === 'sandbox',
    );
    expect(sandbox).toBeDefined();
    expect(sandbox!.config.api_key).toBe('abcd••••ijkl');
    expect(sandbox!.config.country_iso).toBe('QAT');
  });

  it('assertGateway rejects unknown gateways', () => {
    const assertGateway = (
      service as unknown as { assertGateway: (gateway: string) => void }
    ).assertGateway.bind(service);
    expect(() => assertGateway('unknown')).toThrow(NotFoundException);
  });

  it('testConnection rejects qpay', async () => {
    await expect(
      service.testConnection('qpay', { environment: 'live' } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('currencyFromCountryIso maps QAT to QAR', () => {
    const currencyFromCountryIso = (
      service as unknown as { currencyFromCountryIso: (iso: string) => string }
    ).currencyFromCountryIso.bind(service);
    expect(currencyFromCountryIso('QAT')).toBe('QAR');
  });
});
