import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentGatewayEnvironment, Prisma } from '@prisma/client';
import { createDecipheriv, createHash } from 'crypto';
import { CustomerPaymentRecoveryReason } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { CustomerPaymentMethodsService } from '../admin-payment-settings/customer-payment-methods.service';
import {
  coerceOnlinePaymentMethodId,
  resolveMyFatoorahMethodIdFromHints,
} from '../admin-payment-settings/payment-method-labels';
import { PaymentRecoveryService } from '../checkout/payment-recovery.service';
import { extractMyFatoorahSettlement } from '../checkout/payment-verification';
import {
  CreateMyFatoorahSessionDto,
  MyFatoorahPaymentStatusDto,
} from './dto/myfatoorah.dto';
import {
  ConfirmMyFatoorahPaymentDto,
  InitiateEmbeddedSessionsDto,
  MYFATOORAH_EMBEDDED_METHODS,
  MyFatoorahEmbeddedMethod,
} from './dto/customer-myfatoorah.dto';

type GatewayConfig = {
  api_key?: string;
  country_iso?: string;
  api_base_url?: string;
  session_script_url?: string;
};

type SessionCacheEntry = {
  encryptionKey: string;
  environment: PaymentGatewayEnvironment;
  expiresAt: number;
};

const EMBEDDED_METHOD_MAP: Record<
  MyFatoorahEmbeddedMethod,
  { supported: string[]; suffix: string }
> = {
  google_pay: { supported: ['googlepay'], suffix: 'googlepay' },
  apple_pay: { supported: ['applepay'], suffix: 'applepay' },
  myfatoorah_card: { supported: ['card'], suffix: 'card' },
};

@Injectable()
export class MyFatoorahService {
  private readonly logger = new Logger(MyFatoorahService.name);
  private readonly sessionCache = new Map<string, SessionCacheEntry>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentMethods: CustomerPaymentMethodsService,
    private readonly paymentRecovery: PaymentRecoveryService,
    private readonly appConfig: ConfigService,
  ) {}

  async createEmbeddedSession(input: CreateMyFatoorahSessionDto) {
    const environment = (input.environment ??
      (await this.resolveActiveEnvironment())) as PaymentGatewayEnvironment;
    const { apiKey, config } = await this.loadCredentials(environment);
    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('A positive amount is required.');
    }

    const currency = this.resolveCurrency(
      input.currency || '',
      config.country_iso || 'QAT',
      environment,
    );
    const externalIdentifier = (input.external_identifier || '')
      .trim()
      .slice(0, 50);

    const created = await this.createSessionInternal({
      apiKey,
      config,
      environment,
      amount,
      currency,
      externalIdentifier: externalIdentifier || undefined,
      customerName: input.customer_name,
      customerEmail: input.customer_email,
      checkoutRef: externalIdentifier || undefined,
    });

    return {
      success: true,
      data: {
        sessionId: created.sessionId,
        sessionExpiry: created.sessionExpiry,
        operationType: created.operationType,
        amount: created.amount,
        currency: created.currency,
        countryCode: (config.country_iso || 'QAT').toUpperCase(),
        scriptUrl: this.sessionScriptUrl(config, environment),
        integration: 'v3',
        paymentMode: 'COMPLETE_PAYMENT',
        environment,
        externalIdentifier: externalIdentifier || null,
      },
    };
  }

  async createBatchEmbeddedSessions(
    input: InitiateEmbeddedSessionsDto,
    customer?: { id?: string; name?: string; email?: string },
  ) {
    await this.paymentMethods.assertGatewayEnabled('myfatoorah');

    const checkoutRef = (
      input.idempotency_key ||
      input.temp_order_id ||
      ''
    ).trim();
    if (!checkoutRef) {
      throw new BadRequestException(
        'idempotency_key or temp_order_id is required.',
      );
    }

    const pendingOrder = await this.prisma.order.findFirst({
      where: {
        OR: [{ idempotencyKey: checkoutRef }, { commonOrder: checkoutRef }],
        status: { in: ['pending_payment', 'expired'] },
      },
      select: {
        id: true,
        commonOrder: true,
        totalAmount: true,
        currency: true,
        customerId: true,
      },
    });
    const amount = pendingOrder
      ? Number(pendingOrder.totalAmount)
      : Number(input.amount);
    if (!Number.isFinite(amount) || amount < 0.1) {
      throw new BadRequestException('Amount must be at least 0.1.');
    }
    if (pendingOrder && customer?.id && pendingOrder.customerId !== customer.id) {
      throw new BadRequestException('This checkout does not belong to the signed-in customer.');
    }

    const environment = await this.resolveActiveEnvironment();
    const { apiKey, config } = await this.loadCredentials(environment);
    const currency = this.resolveCurrency(
      pendingOrder?.currency || input.currency || '',
      config.country_iso || 'QAT',
      environment,
    );
    const methods =
      input.embedded_methods && input.embedded_methods.length > 0
        ? input.embedded_methods
        : [...MYFATOORAH_EMBEDDED_METHODS];

    const scriptUrl = this.sessionScriptUrl(config, environment);
    const sessions: Record<string, Record<string, unknown>> = {};
    const errors: Record<string, string> = {};
    const checkoutDraft = this.normalizeCheckoutDraft(
      input.checkout_snapshot,
      checkoutRef,
      amount,
      currency,
      customer,
    );

    for (const method of methods) {
      const map = EMBEDDED_METHOD_MAP[method];
      const methodRef = this.normalizeExternalIdentifier(
        `${checkoutRef}_${map.suffix}`,
      );
      try {
        const created = await this.createSessionInternal({
          apiKey,
          config,
          environment,
          amount: Number(amount.toFixed(3)),
          currency,
          externalIdentifier: methodRef,
          customerName: customer?.name,
          customerEmail: customer?.email,
          customerReference: customer?.id
            ? `customer-${customer.id}`
            : undefined,
          supportedPaymentMethods: map.supported,
          checkoutRef: methodRef,
          checkoutDraft,
          orderId: pendingOrder?.id,
          commonOrder: pendingOrder?.commonOrder,
        });

        sessions[method] = {
          sessionId: created.sessionId,
          sessionExpiry: created.sessionExpiry,
          operationType: created.operationType,
          amount: created.amount,
          currency: created.currency,
          countryCode: (config.country_iso || 'QAT').toUpperCase(),
          currencyCode: created.currency,
          scriptUrl,
          integration: 'v3',
          temp_order_id: methodRef,
          checkout_ref: methodRef,
        };
      } catch (error) {
        errors[method] =
          error instanceof Error
            ? error.message
            : 'Failed to create MyFatoorah session.';
      }
    }

    // Do not open a recovery yet — only store cart draft on the hosted session.
    // Recovery is created when the gateway reports paid (confirmCustomerPayment)
    // and resolved when book-ticket / payments/confirm succeeds.

    const hasSessions = Object.keys(sessions).length > 0;
    const hasErrors = Object.keys(errors).length > 0;
    const success = hasSessions && !hasErrors;

    return {
      success,
      message: success
        ? 'Sessions created successfully.'
        : hasSessions
          ? 'Some payment methods failed to initialize.'
          : 'Failed to create MyFatoorah sessions.',
      data: {
        scriptUrl,
        integration: 'v3',
        sessions,
        ...(hasErrors ? { errors } : {}),
      },
    };
  }

  async confirmCustomerPayment(
    input: ConfirmMyFatoorahPaymentDto,
    customer?: { id?: string; email?: string; name?: string },
  ) {
    await this.paymentMethods.assertGatewayEnabled('myfatoorah');

    const sessionId = (input.session_id || input.sessionId || '').trim();
    const paymentData = (input.payment_data || input.paymentData || '').trim();
    const paymentId = (input.payment_id || input.paymentId || '').trim();

    if (!sessionId) {
      throw new BadRequestException('session_id is required.');
    }

    const stored = await this.prisma.hostedCheckoutSession.findUnique({
      where: { sid: sessionId },
    });
    const environment =
      stored?.environment ?? (await this.resolveActiveEnvironment());

    const result = await this.resolvePaymentStatus({
      environment,
      session_id: sessionId,
      payment_data: paymentData || undefined,
      payment_id: paymentId || undefined,
      encryptionKeyOverride: stored?.encryptionKey ?? undefined,
    });

    if (stored) {
      await this.prisma.hostedCheckoutSession.update({
        where: { id: stored.id },
        data: {
          status: result.paid ? 'paid' : 'failed',
          paramsJson: {
            ...((stored.paramsJson as object) ?? {}),
            providerResponse: result.data.providerResponse,
            payment: result.data.payment,
          } as Prisma.InputJsonValue,
        },
      });
    }

    if (!result.paid) {
      return {
        success: false,
        paid: false,
        message: result.message || 'Payment not completed.',
        data: null,
      };
    }

    const checkoutRef = stored?.checkoutRef ?? null;
    const idempotencyKey = checkoutRef
      ? checkoutRef.replace(/_(googlepay|applepay|card)$/i, '')
      : null;
    const hostedParams = (stored?.paramsJson as Record<string, unknown>) ?? {};
    const checkoutDraft =
      (hostedParams.checkout_draft as Record<string, unknown> | undefined) ??
      null;
    const paymentMethod = resolveMyFatoorahMethodIdFromHints({
      paymentMethod: checkoutDraft?.payment_method,
      checkoutRef,
      supportedPaymentMethods: hostedParams.supportedPaymentMethods,
      paymentDetail: result.data.payment,
    });
    const verifiedPayment = this.verifiedPaymentTotals(
      result.data.payment,
      stored ? Number(stored.amount) : 0,
      stored?.currency ?? 'QAR',
    );

    await this.paymentRecovery.upsertOpen({
      commonOrder: stored?.commonOrder ?? null,
      orderId: stored?.orderId ?? null,
      customerId: customer?.id ?? null,
      customerEmail: customer?.email ?? null,
      eventSlug:
        typeof checkoutDraft?.event_slug === 'string'
          ? checkoutDraft.event_slug
          : null,
      gateway: 'myfatoorah',
      reason: CustomerPaymentRecoveryReason.awaiting_confirm,
      amount: verifiedPayment.amount,
      currency: verifiedPayment.currency,
      idempotencyKey,
      providerSessionId: result.data.sessionId ?? sessionId,
      providerInvoiceId:
        result.data.invoiceId != null ? String(result.data.invoiceId) : null,
      providerPaymentId: result.data.paymentId ?? null,
      checkoutSnapshot: {
        ...(checkoutDraft ?? {}),
        payment_method: paymentMethod,
        checkout_ref: checkoutRef,
        supportedPaymentMethods: hostedParams.supportedPaymentMethods ?? null,
        idempotency_key: idempotencyKey,
        customer: customer ?? checkoutDraft?.customer ?? null,
        provider_response: result.data.providerResponse ?? null,
      },
    });

    return {
      success: true,
      paid: true,
      message: 'Payment completed successfully.',
      data: {
        sessionId: result.data.sessionId,
        invoiceId: result.data.invoiceId,
        paymentId: result.data.paymentId,
        payment: result.data.payment,
        providerResponse: {
          isSuccess: true,
          sessionId: result.data.sessionId,
          invoiceId: result.data.invoiceId,
          paymentId: result.data.paymentId,
          provider: 'myfatoorah',
        },
      },
    };
  }

  async resolvePaymentStatus(
    input: MyFatoorahPaymentStatusDto & { encryptionKeyOverride?: string },
  ) {
    const environment = (input.environment ??
      (await this.resolveActiveEnvironment())) as PaymentGatewayEnvironment;
    const sessionId = (input.session_id || input.sessionId || '').trim();
    const paymentId = (input.payment_id || input.paymentId || '').trim();
    const invoiceKey = (input.invoice_id || input.invoiceId || '').trim();
    const paymentData = (input.payment_data || input.paymentData || '').trim();

    if (!sessionId && !paymentId && !paymentData && !invoiceKey) {
      throw new BadRequestException(
        'session_id, payment_id, invoice_id, or payment_data is required.',
      );
    }

    const { apiKey, config } = await this.loadCredentials(environment);
    const baseUrl = this.apiBaseUrl(config, environment);

    let paid = false;
    let invoiceId: string | number | null = null;
    let resolvedPaymentId: string | null = paymentId || null;
    let details: Record<string, unknown> | null = null;
    let settlementAmount: number | null = null;
    let settlementCurrency: string | null = null;

    if (paymentData && sessionId) {
      const encryptionKey =
        input.encryptionKeyOverride ||
        this.sessionCache.get(sessionId)?.encryptionKey ||
        (
          await this.prisma.hostedCheckoutSession.findUnique({
            where: { sid: sessionId },
            select: { encryptionKey: true },
          })
        )?.encryptionKey ||
        '';

      if (!encryptionKey) {
        throw new BadRequestException(
          'Session encryption key expired or not found. Retry payment or pass payment_id.',
        );
      }
      const decryptedJson = this.decryptPaymentData(paymentData, encryptionKey);
      if (!decryptedJson) {
        throw new BadRequestException('Could not decrypt payment data.');
      }
      const decrypted = JSON.parse(decryptedJson) as Record<string, unknown>;
      details = decrypted;
      const invoice = (decrypted.Invoice ?? {}) as Record<string, unknown>;
      const txn = (decrypted.Transaction ?? {}) as Record<string, unknown>;
      const settlement = extractMyFatoorahSettlement(decrypted);
      paid = settlement.paid;
      settlementAmount = settlement.amount;
      settlementCurrency = settlement.currency;
      invoiceId = (invoice.Id as string | number | null) ?? null;
      resolvedPaymentId =
        String(txn.PaymentId ?? txn.Id ?? paymentId ?? '').trim() || null;
    } else if (paymentId) {
      const status = await this.postJson(baseUrl, '/v2/GetPaymentStatus', apiKey, {
        Key: paymentId,
        KeyType: 'PaymentId',
      });
      details = status;
      const data = (status.Data ?? {}) as Record<string, unknown>;
      const settlement = extractMyFatoorahSettlement(status);
      paid = settlement.paid;
      settlementAmount = settlement.amount;
      settlementCurrency = settlement.currency;
      invoiceId = (data.InvoiceId as string | number | null) ?? null;
      resolvedPaymentId = paymentId;
    } else if (invoiceKey) {
      const status = await this.postJson(baseUrl, '/v2/GetPaymentStatus', apiKey, {
        Key: invoiceKey,
        KeyType: 'InvoiceId',
      });
      details = status;
      const data = (status.Data ?? {}) as Record<string, unknown>;
      const settlement = extractMyFatoorahSettlement(status);
      paid = settlement.paid;
      settlementAmount = settlement.amount;
      settlementCurrency = settlement.currency;
      invoiceId = (data.InvoiceId as string | number | null) ?? invoiceKey;
      const invoiceTransactions = Array.isArray(data.InvoiceTransactions)
        ? (data.InvoiceTransactions as Array<Record<string, unknown>>)
        : [];
      const successTxn = invoiceTransactions.find((txn) =>
        ['SUCCESS', 'Succss', 'CAPTURED', 'SUCCESSFUL'].includes(
          String(txn.TransactionStatus ?? '').toUpperCase(),
        ),
      );
      resolvedPaymentId =
        String(
          successTxn?.PaymentId ?? invoiceTransactions[0]?.PaymentId ?? '',
        ).trim() || null;
    } else {
      throw new BadRequestException(
        'Provide payment_id, invoice_id, or session_id with payment_data.',
      );
    }

    return {
      success: true,
      paid,
      message: paid
        ? 'Payment completed successfully.'
        : 'Payment not completed.',
      data: {
        sessionId: sessionId || null,
        invoiceId,
        paymentId: resolvedPaymentId,
        amount: settlementAmount,
        currency: settlementCurrency,
        payment: details,
        providerResponse: {
          isSuccess: paid,
          sessionId: sessionId || null,
          invoiceId,
          paymentId: resolvedPaymentId,
          provider: 'myfatoorah',
        },
      },
    };
  }

  private verifiedPaymentTotals(
    payment: Record<string, unknown> | null,
    fallbackAmount: number,
    fallbackCurrency: string,
  ) {
    const root = payment ?? {};
    const data = ((root.Data as Record<string, unknown> | undefined) ?? root);
    const invoice = ((data.Invoice as Record<string, unknown> | undefined) ?? {});
    const amountCandidate =
      data.InvoiceValue ??
      data.InvoiceDisplayValue ??
      invoice.Value ??
      invoice.Amount ??
      fallbackAmount;
    const parsedAmount = Number.parseFloat(String(amountCandidate ?? ''));
    const currencyCandidate =
      data.InvoiceCurrency ??
      data.CurrencyIso ??
      invoice.Currency ??
      fallbackCurrency;
    return {
      amount: Number.isFinite(parsedAmount) ? parsedAmount : fallbackAmount,
      currency: String(currencyCandidate || fallbackCurrency).trim().toUpperCase(),
    };
  }

  private async createSessionInternal(input: {
    apiKey: string;
    config: GatewayConfig;
    environment: PaymentGatewayEnvironment;
    amount: number;
    currency: string;
    externalIdentifier?: string;
    customerName?: string;
    customerEmail?: string;
    customerReference?: string;
    supportedPaymentMethods?: string[];
    checkoutRef?: string;
    checkoutDraft?: Record<string, unknown> | null;
    orderId?: string;
    commonOrder?: string;
  }) {
    const payload: Record<string, unknown> = {
      PaymentMode: 'COMPLETE_PAYMENT',
      Order: {
        Amount: input.amount,
        Currency: input.currency,
        ...(input.externalIdentifier
          ? { ExternalIdentifier: input.externalIdentifier }
          : {}),
      },
    };

    if (input.supportedPaymentMethods?.length) {
      payload.SupportedPaymentMethods = input.supportedPaymentMethods;
    }

    const customer: Record<string, string> = {};
    if (input.customerReference?.trim()) {
      customer.Reference = input.customerReference.trim().slice(0, 100);
    }
    if (input.customerName?.trim()) {
      customer.Name = input.customerName.trim().slice(0, 100);
    }
    if (input.customerEmail?.trim()) {
      customer.Email = input.customerEmail.trim().slice(0, 100);
    }
    if (Object.keys(customer).length) {
      payload.Customer = customer;
    }

    const response = await this.postJson(
      this.apiBaseUrl(input.config, input.environment),
      '/v3/sessions',
      input.apiKey,
      payload,
    );

    if (!response.IsSuccess) {
      throw new BadRequestException(
        this.formatError(response, 'Could not create MyFatoorah session.'),
      );
    }

    const data = (response.Data ?? {}) as Record<string, unknown>;
    const sessionId = String(data.SessionId ?? '').trim();
    const encryptionKey = String(data.EncryptionKey ?? '').trim();
    if (!sessionId || !encryptionKey) {
      throw new BadRequestException(
        'MyFatoorah session response is incomplete.',
      );
    }

    this.sessionCache.set(sessionId, {
      encryptionKey,
      environment: input.environment,
      expiresAt: Date.now() + 60 * 60 * 1000,
    });

    const order = (data.Order ?? {}) as Record<string, unknown>;
    const amount = Number(order.Amount ?? input.amount);
    const currency = String(order.Currency ?? input.currency);

    await this.prisma.hostedCheckoutSession.upsert({
      where: { sid: sessionId },
      create: {
        sid: sessionId,
        gateway: 'myfatoorah',
        environment: input.environment,
        encryptionKey,
        paramsJson: {
          operationType: data.OperationType ?? 'PAY',
          supportedPaymentMethods: input.supportedPaymentMethods ?? null,
          ...(input.checkoutDraft
            ? { checkout_draft: input.checkoutDraft }
            : {}),
        } as Prisma.InputJsonValue,
        amount,
        currency,
        status: 'pending',
        checkoutRef: input.checkoutRef ?? null,
        orderId: input.orderId ?? null,
        commonOrder: input.commonOrder ?? null,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
      update: {
        encryptionKey,
        amount,
        currency,
        status: 'pending',
        checkoutRef: input.checkoutRef ?? null,
        orderId: input.orderId ?? undefined,
        commonOrder: input.commonOrder ?? undefined,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        paramsJson: {
          operationType: data.OperationType ?? 'PAY',
          supportedPaymentMethods: input.supportedPaymentMethods ?? null,
          ...(input.checkoutDraft
            ? { checkout_draft: input.checkoutDraft }
            : {}),
        } as Prisma.InputJsonValue,
      },
    });

    return {
      sessionId,
      sessionExpiry: data.SessionExpiry ?? null,
      operationType: data.OperationType ?? 'PAY',
      amount,
      currency,
      encryptionKey,
    };
  }

  private normalizeCheckoutDraft(
    raw: Record<string, unknown> | undefined,
    idempotencyKey: string,
    amount: number,
    currency: string,
    customer?: { id?: string; name?: string; email?: string },
  ): Record<string, unknown> | null {
    if (!raw || typeof raw !== 'object') return null;
    const eventSlug =
      (typeof raw.event_slug === 'string' && raw.event_slug) ||
      (typeof raw.eventSlug === 'string' && raw.eventSlug) ||
      '';
    const scheduleRaw = (raw.schedule as Record<string, unknown> | undefined) ?? {};
    const date =
      (typeof scheduleRaw.date === 'string' && scheduleRaw.date) ||
      (typeof raw.selectedDate === 'string' && raw.selectedDate) ||
      '';
    const time =
      (typeof scheduleRaw.time === 'string' && scheduleRaw.time) ||
      (typeof raw.selectedTimeSlot === 'string' && raw.selectedTimeSlot) ||
      '';
    const tickets = Array.isArray(raw.tickets) ? raw.tickets : [];
    if (!eventSlug || !date || !time || tickets.length === 0) return null;

    const customerRaw =
      (raw.customer as Record<string, unknown> | undefined) ?? {};
    return {
      event_slug: eventSlug,
      schedule: { date, time },
      tickets,
      addons: Array.isArray(raw.addons) ? raw.addons : [],
      payment_method: coerceOnlinePaymentMethodId(raw.payment_method),
      idempotency_key: idempotencyKey,
      customer: {
        user_id:
          customerRaw.user_id ??
          customerRaw.id ??
          customer?.id ??
          null,
        name:
          (typeof customerRaw.name === 'string' && customerRaw.name) ||
          customer?.name ||
          null,
        email:
          (typeof customerRaw.email === 'string' && customerRaw.email) ||
          customer?.email ||
          null,
        phone:
          (typeof customerRaw.phone === 'string' && customerRaw.phone) ||
          null,
      },
      totals: {
        total: amount,
        currency,
        ...((raw.totals as object | undefined) ?? {}),
      },
    };
  }

  private normalizeExternalIdentifier(raw: string) {
    const trimmed = raw.trim();
    if (/^[A-Za-z0-9_-]{1,36}$/.test(trimmed)) return trimmed;
    return `BQ${createHash('sha256').update(trimmed).digest('hex').slice(0, 24)}`;
  }

  private async resolveActiveEnvironment(): Promise<PaymentGatewayEnvironment> {
    const active = await this.prisma.paymentGatewayConfig.findFirst({
      where: { gateway: 'myfatoorah', isActive: true, enabled: true },
    });
    if (active) return active.environment;

    const sandbox = await this.prisma.paymentGatewayConfig.findUnique({
      where: {
        gateway_environment: { gateway: 'myfatoorah', environment: 'sandbox' },
      },
    });
    if (sandbox?.enabled) return 'sandbox';
    return 'live';
  }

  private async loadCredentials(environment: PaymentGatewayEnvironment) {
    const row = await this.prisma.paymentGatewayConfig.findUnique({
      where: {
        gateway_environment: { gateway: 'myfatoorah', environment },
      },
    });
    const storedConfig = ((row?.configJson as GatewayConfig | null) ??
      {}) as GatewayConfig;
    const config: GatewayConfig = {
      ...storedConfig,
      api_base_url:
        storedConfig.api_base_url ||
        this.appConfig.get<string>('MYFATOORAH_API_BASE_URL') ||
        undefined,
      country_iso:
        storedConfig.country_iso ||
        this.appConfig.get<string>('MYFATOORAH_COUNTRY_CODE') ||
        'QAT',
    };
    const apiKey = (
      config.api_key ||
      this.appConfig.get<string>('MYFATOORAH_API_KEY') ||
      ''
    ).trim();
    if (!apiKey) {
      throw new BadRequestException(
        `Save a MyFatoorah API key for ${environment} in Payment settings first.`,
      );
    }
    return { apiKey, config, enabled: row?.enabled ?? false };
  }

  private apiBaseUrl(
    config: GatewayConfig,
    environment: PaymentGatewayEnvironment,
  ) {
    const configured = (config.api_base_url || '').trim().replace(/\/+$/, '');
    if (configured) return configured;

    if (environment === 'sandbox') {
      return 'https://apitest.myfatoorah.com';
    }

    const country = (config.country_iso || 'QAT').toUpperCase();
    if (country === 'QAT') return 'https://api-qa.myfatoorah.com';
    if (country === 'ARE') return 'https://api-ae.myfatoorah.com';
    if (country === 'SAU') return 'https://api-sa.myfatoorah.com';
    if (country === 'EGY') return 'https://api-eg.myfatoorah.com';
    return 'https://api.myfatoorah.com';
  }

  private sessionScriptUrl(
    config: GatewayConfig,
    environment: PaymentGatewayEnvironment,
  ) {
    const configured = (config.session_script_url || '').trim();
    if (configured) return configured;

    if (environment === 'sandbox') {
      return 'https://demo.myfatoorah.com/sessions/v1/session.js';
    }

    const country = (config.country_iso || 'QAT').toUpperCase();
    if (country === 'QAT') return 'https://qa.myfatoorah.com/sessions/v1/session.js';
    if (country === 'ARE') return 'https://ae.myfatoorah.com/sessions/v1/session.js';
    if (country === 'SAU') return 'https://sa.myfatoorah.com/sessions/v1/session.js';
    if (country === 'EGY') return 'https://eg.myfatoorah.com/sessions/v1/session.js';
    return 'https://portal.myfatoorah.com/sessions/v1/session.js';
  }

  private resolveCurrency(
    requested: string,
    countryIso: string,
    environment: PaymentGatewayEnvironment,
  ) {
    if (environment === 'sandbox' && !requested.trim()) {
      return 'KWD';
    }
    const normalized = requested.trim().toUpperCase();
    if (normalized) return normalized;

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
    return map[countryIso.toUpperCase()] ?? 'QAR';
  }

  private async postJson(
    baseUrl: string,
    path: string,
    apiKey: string,
    payload: Record<string, unknown>,
  ) {
    const url = `${baseUrl.replace(/\/+$/, '')}${path}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const body = (await response.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;

    if (!response.ok) {
      this.logger.warn(
        `MyFatoorah API error ${response.status} ${url}: ${JSON.stringify(body)}`,
      );
      return {
        IsSuccess: false,
        Message:
          (body?.Message as string) ||
          `MyFatoorah API request failed (HTTP ${response.status}).`,
        ValidationErrors: body?.ValidationErrors ?? null,
        ...(body ?? {}),
      };
    }

    return body ?? { IsSuccess: false, Message: 'Empty response from MyFatoorah.' };
  }

  private formatError(response: Record<string, unknown>, fallback: string) {
    const message = String(response.Message ?? '').trim() || fallback;
    const errors = response.ValidationErrors;
    if (!Array.isArray(errors) || errors.length === 0) return message;
    const details = errors
      .map((item) => {
        if (typeof item === 'string') return item;
        if (!item || typeof item !== 'object') return '';
        const row = item as Record<string, unknown>;
        const name = String(row.Name ?? row.Field ?? '').trim();
        const error = String(row.Error ?? row.Message ?? '').trim();
        if (name && error) return `${name}: ${error}`;
        return error || name;
      })
      .filter(Boolean);
    return details.length ? `${message} (${details.join('; ')})` : message;
  }

  private decryptPaymentData(encryptedText: string, encryptionKey: string) {
    try {
      const key = Buffer.alloc(16, 0);
      Buffer.from(encryptionKey, 'utf8').copy(key, 0, 0, 16);
      const encrypted = Buffer.from(encryptedText, 'base64');
      const decipher = createDecipheriv('aes-128-cbc', key, key);
      const decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]);
      return decrypted.toString('utf8');
    } catch (error) {
      this.logger.warn(
        `MyFatoorah decrypt failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return '';
    }
  }
}
