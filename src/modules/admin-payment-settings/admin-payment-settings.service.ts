import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PaymentGateway,
  PaymentGatewayEnvironment,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { buildMastercardSessionUrl as buildMpgsSessionUrl } from '../checkout/mpgs-url.util';
import {
  TestPaymentGatewayDto,
  UpsertPaymentGatewayConfigDto,
} from './dto/admin-payment-settings.dto';

const SECRET_KEYS = new Set([
  'api_key',
  'password',
  'secret_key',
  'security_salt',
]);

const DEFAULTS: Record<
  PaymentGateway,
  Partial<Record<PaymentGatewayEnvironment, Record<string, string>>>
> = {
  myfatoorah: {
    sandbox: {
      api_key: '',
      country_iso: 'QAT',
      api_base_url: 'https://apitest.myfatoorah.com',
      session_script_url: '',
      legacy_session_script_url: '',
    },
    live: {
      api_key: '',
      country_iso: 'QAT',
      api_base_url: 'https://api-qa.myfatoorah.com',
      session_script_url: '',
      legacy_session_script_url: '',
    },
  },
  mastercard: {
    sandbox: {
      merchant_name: '',
      username: '',
      password: '',
      api_version: '100',
      endpoint_url: 'https://test-gateway.mastercard.com',
      security_salt: '',
      checkout_js_url:
        'https://test-cbq.mtf.gateway.mastercard.com/static/checkout/checkout.min.js',
    },
    live: {
      merchant_name: '',
      username: '',
      password: '',
      api_version: '100',
      endpoint_url: 'https://cbq.gateway.mastercard.com',
      security_salt: '',
      checkout_js_url:
        'https://cbq.gateway.mastercard.com/static/checkout/checkout.min.js',
    },
  },
  qpay: {
    live: {
      secret_key: '',
      merchant_id: '',
      bank_id: '',
      endpoint_url: '',
      refund_url: '',
    },
  },
};

function maskSecret(value: string) {
  if (!value) return '';
  if (value.length <= 8) return '••••••••';
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

function isMasked(value: string) {
  return value.includes('••••');
}

@Injectable()
export class AdminPaymentSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const rows = await this.prisma.paymentGatewayConfig.findMany({
      orderBy: [{ gateway: 'asc' }, { environment: 'asc' }],
    });

    const byGateway = {
      myfatoorah: this.serializeGateway('myfatoorah', rows),
      mastercard: this.serializeGateway('mastercard', rows),
      qpay: this.serializeGateway('qpay', rows),
    };

    return { success: true, data: { gateways: byGateway } };
  }

  async get(gateway: PaymentGateway) {
    this.assertGateway(gateway);
    const rows = await this.prisma.paymentGatewayConfig.findMany({
      where: { gateway },
      orderBy: { environment: 'asc' },
    });
    return {
      success: true,
      data: { gateway: this.serializeGateway(gateway, rows) },
    };
  }

  async upsert(gateway: PaymentGateway, input: UpsertPaymentGatewayConfigDto) {
    this.assertGateway(gateway);
    if (gateway === 'qpay' && input.environment !== 'live') {
      throw new BadRequestException('QPay supports live configuration only.');
    }

    const environment = input.environment as PaymentGatewayEnvironment;
    const defaults =
      DEFAULTS[gateway][environment] ??
      Object.values(DEFAULTS[gateway])[0] ??
      {};

    const existing = await this.prisma.paymentGatewayConfig.findUnique({
      where: {
        gateway_environment: { gateway, environment },
      },
    });

    const previous = (existing?.configJson as Record<string, string> | null) ?? {};
    const nextConfig: Record<string, string> = { ...defaults };

    for (const [key, raw] of Object.entries(input.config ?? {})) {
      const value = String(raw ?? '').trim();
      if (SECRET_KEYS.has(key) && (!value || isMasked(value))) {
        nextConfig[key] = previous[key] ?? '';
      } else {
        nextConfig[key] = value;
      }
    }

    for (const key of Object.keys(defaults)) {
      if (!(key in nextConfig)) nextConfig[key] = previous[key] ?? defaults[key] ?? '';
    }

    const enabled = input.enabled ?? existing?.enabled ?? false;
    const isActive =
      input.is_active ?? existing?.isActive ?? environment === 'live';

    const saved = await this.prisma.$transaction(async (tx) => {
      if (isActive) {
        await tx.paymentGatewayConfig.updateMany({
          where: { gateway, NOT: { environment } },
          data: { isActive: false },
        });
      }

      return tx.paymentGatewayConfig.upsert({
        where: { gateway_environment: { gateway, environment } },
        create: {
          gateway,
          environment,
          enabled,
          isActive,
          configJson: nextConfig as Prisma.InputJsonValue,
        },
        update: {
          enabled,
          isActive,
          configJson: nextConfig as Prisma.InputJsonValue,
        },
      });
    });

    return {
      success: true,
      data: {
        config: this.serializeRow(saved),
      },
    };
  }

  async testConnection(gateway: PaymentGateway, input: TestPaymentGatewayDto) {
    this.assertGateway(gateway);
    if (gateway === 'myfatoorah') {
      return this.testMyFatoorahConnection(input);
    }
    if (gateway === 'mastercard') {
      return this.testMastercardConnection(input);
    }
    throw new BadRequestException(
      'Connection test is currently available for MyFatoorah and Mastercard only.',
    );
  }

  private async testMyFatoorahConnection(input: TestPaymentGatewayDto) {
    const environment = input.environment as PaymentGatewayEnvironment;
    const stored = await this.prisma.paymentGatewayConfig.findUnique({
      where: {
        gateway_environment: { gateway: 'myfatoorah', environment },
      },
    });
    const storedConfig =
      (stored?.configJson as Record<string, string> | null) ?? {};

    const apiKey =
      input.api_key && !isMasked(input.api_key)
        ? input.api_key.trim()
        : storedConfig.api_key?.trim() || '';
    const countryIso = (
      input.country_iso ||
      storedConfig.country_iso ||
      'QAT'
    ).toUpperCase();
    const apiBaseUrl = (
      input.api_base_url ||
      storedConfig.api_base_url ||
      (environment === 'sandbox'
        ? 'https://apitest.myfatoorah.com'
        : this.liveMyFatoorahBase(countryIso))
    ).replace(/\/$/, '');

    if (!apiKey) {
      throw new BadRequestException(
        `Save or provide a MyFatoorah API key for ${environment} before testing.`,
      );
    }

    // MyFatoorah has no GetPaymentMethods route; InitiatePayment returns enabled methods.
    const response = await fetch(`${apiBaseUrl}/v2/InitiatePayment`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        InvoiceAmount: 1,
        CurrencyIso: this.currencyFromCountryIso(countryIso),
      }),
    });

    const body = (await response.json().catch(() => null)) as {
      IsSuccess?: boolean;
      Message?: string;
      ValidationErrors?: unknown;
      Data?: { PaymentMethods?: unknown[] };
    } | null;

    if (!response.ok || !body?.IsSuccess) {
      return {
        success: false,
        data: {
          environment,
          ok: false,
          status: response.status,
          message:
            body?.Message ||
            `MyFatoorah ${environment} connection failed (${response.status}).`,
          validation_errors: body?.ValidationErrors ?? null,
        },
      };
    }

    return {
      success: true,
      data: {
        environment,
        ok: true,
        status: response.status,
        message: `MyFatoorah ${environment} connection OK.`,
        payment_methods: body.Data?.PaymentMethods?.length ?? 0,
      },
    };
  }

  private async testMastercardConnection(input: TestPaymentGatewayDto) {
    const environment = input.environment as PaymentGatewayEnvironment;
    const stored = await this.prisma.paymentGatewayConfig.findUnique({
      where: {
        gateway_environment: { gateway: 'mastercard', environment },
      },
    });
    const storedConfig =
      (stored?.configJson as Record<string, string> | null) ?? {};
    const defaults = DEFAULTS.mastercard[environment] ?? {};

    const merchantName = (
      input.merchant_name ||
      storedConfig.merchant_name ||
      ''
    ).trim();
    const username = (
      input.username ||
      storedConfig.username ||
      ''
    ).trim();
    const password =
      input.password && !isMasked(input.password)
        ? input.password.trim()
        : storedConfig.password?.trim() || '';
    const endpointUrl = (
      input.endpoint_url ||
      storedConfig.endpoint_url ||
      defaults.endpoint_url ||
      ''
    ).trim();
    const apiVersion = (
      input.api_version ||
      storedConfig.api_version ||
      defaults.api_version ||
      '100'
    )
      .trim()
      .replace(/[^\d]/g, '');

    if (!merchantName || !username || !password || !endpointUrl) {
      throw new BadRequestException(
        `Save or provide Mastercard merchant name, username, password, and endpoint URL for ${environment} before testing.`,
      );
    }
    if (!apiVersion) {
      throw new BadRequestException(
        'Mastercard API version is required (e.g. 100).',
      );
    }

    // Docs: POST {host}/api/rest/version/{version}/merchant/{merchantId}/session
    // apiOperation INITIATE_CHECKOUT; interaction.operation + merchant.name required.
    const sessionUrl = buildMpgsSessionUrl(
      endpointUrl,
      merchantName,
      apiVersion,
    );
    const orderId = `bq-test-${Date.now()}`;
    const payload = {
      apiOperation: 'INITIATE_CHECKOUT',
      interaction: {
        operation: environment === 'live' ? 'PURCHASE' : 'AUTHORIZE',
        merchant: {
          name: merchantName,
          url: 'https://bookingqube.com',
        },
      },
      order: {
        currency: 'QAR',
        id: orderId,
        amount: 1.0,
      },
    };

    const response = await fetch(sessionUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const body = (await response.json().catch(() => null)) as {
      result?: string;
      successIndicator?: string;
      error?: { explanation?: string; cause?: string; field?: string };
      session?: { id?: string };
      message?: string;
    } | null;

    const sessionId = body?.session?.id;
    const ok =
      response.ok &&
      Boolean(sessionId) &&
      (body?.result === 'SUCCESS' || Boolean(body?.successIndicator));

    if (!ok) {
      return {
        success: false,
        data: {
          environment,
          ok: false,
          status: response.status,
          api_version: apiVersion,
          session_url: sessionUrl,
          message:
            body?.error?.explanation ||
            body?.error?.cause ||
            body?.message ||
            `Mastercard ${environment} connection failed (${response.status}).`,
        },
      };
    }

    return {
      success: true,
      data: {
        environment,
        ok: true,
        status: response.status,
        api_version: apiVersion,
        session_url: sessionUrl,
        message: `Mastercard ${environment} connection OK (API v${apiVersion}).`,
        session_id: sessionId,
        success_indicator: body?.successIndicator ?? null,
      },
    };
  }

  private serializeGateway(
    gateway: PaymentGateway,
    rows: Array<{
      gateway: PaymentGateway;
      environment: PaymentGatewayEnvironment;
      enabled: boolean;
      isActive: boolean;
      configJson: Prisma.JsonValue;
      updatedAt: Date;
    }>,
  ) {
    const environments = (Object.keys(DEFAULTS[gateway]) as PaymentGatewayEnvironment[]).map(
      (environment) => {
        const row = rows.find(
          (item) => item.gateway === gateway && item.environment === environment,
        );
        if (row) return this.serializeRow(row);
        return {
          gateway,
          environment,
          enabled: false,
          is_active: false,
          config: this.maskConfig(DEFAULTS[gateway][environment] ?? {}),
          updated_at: null,
        };
      },
    );

    return {
      gateway,
      label:
        gateway === 'myfatoorah'
          ? 'MyFatoorah'
          : gateway === 'mastercard'
            ? 'Mastercard Payment Gateway'
            : 'QPay',
      supports_sandbox: gateway !== 'qpay',
      environments,
    };
  }

  private serializeRow(row: {
    gateway: PaymentGateway;
    environment: PaymentGatewayEnvironment;
    enabled: boolean;
    isActive: boolean;
    configJson: Prisma.JsonValue;
    updatedAt: Date;
  }) {
    const defaults = DEFAULTS[row.gateway][row.environment] ?? {};
    const stored = (row.configJson as Record<string, string>) ?? {};
    const config = { ...defaults, ...stored };
    return {
      gateway: row.gateway,
      environment: row.environment,
      enabled: row.enabled,
      is_active: row.isActive,
      config: this.maskConfig(config),
      updated_at: row.updatedAt.toISOString(),
    };
  }

  private maskConfig(config: Record<string, string>) {
    const next: Record<string, string> = {};
    for (const [key, value] of Object.entries(config)) {
      next[key] = SECRET_KEYS.has(key) ? maskSecret(value || '') : value || '';
    }
    return next;
  }

  private liveMyFatoorahBase(countryIso: string) {
    if (countryIso === 'QAT') return 'https://api-qa.myfatoorah.com';
    return 'https://api.myfatoorah.com';
  }

  private currencyFromCountryIso(countryIso: string) {
    const map: Record<string, string> = {
      QAT: 'QAR',
      KWT: 'KWD',
      SAU: 'SAR',
      ARE: 'AED',
      BHR: 'BHD',
      OMN: 'OMR',
      JOR: 'JOD',
      EGY: 'EGP',
    };
    return map[countryIso] ?? countryIso;
  }

  private assertGateway(gateway: string): asserts gateway is PaymentGateway {
    if (!['myfatoorah', 'mastercard', 'qpay'].includes(gateway)) {
      throw new NotFoundException(`Unknown payment gateway: ${gateway}`);
    }
  }
}
