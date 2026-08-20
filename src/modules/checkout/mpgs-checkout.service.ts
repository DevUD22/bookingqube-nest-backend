import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { PaymentGatewayEnvironment, Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { createPendingHostedPayment } from './hosted-payment-records';
import { buildMastercardSessionUrl } from './mpgs-url.util';
import { PaymentRecoveryService } from './payment-recovery.service';
import { extractMpgsSettlement } from './payment-verification';

type MastercardConfig = {
  merchant_name?: string;
  username?: string;
  password?: string;
  endpoint_url?: string;
  checkout_js_url?: string;
  api_version?: string;
};

@Injectable()
export class MpgsCheckoutService {
  private readonly logger = new Logger(MpgsCheckoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly paymentRecovery: PaymentRecoveryService,
    private readonly moduleRef: ModuleRef,
  ) {}

  async createHostedCheckout(input: {
    commonOrder: string;
    orderId: string;
    amount: number;
    currency: string;
    description: string;
    successUrl?: string | null;
    failedUrl?: string | null;
    baseDomain?: string | null;
  }) {
    const environment = await this.resolveActiveEnvironment();
    const { config: gateway } = await this.loadCredentials(environment);
    const endpoint = (gateway.endpoint_url || '').trim();
    const merchantName = (gateway.merchant_name || '').trim();
    if (!endpoint) {
      throw new BadRequestException('Mastercard endpoint URL is not configured.');
    }
    if (!merchantName) {
      throw new BadRequestException(
        'Mastercard merchant name is not configured in Payment settings.',
      );
    }

    const sessionUrl = buildMastercardSessionUrl(
      endpoint,
      merchantName,
      gateway.api_version || '100',
    );

    // Sandbox CBQ/MPGS typically authorizes; live purchases. Match admin connection test.
    const interactionOperation =
      environment === 'sandbox' ? 'AUTHORIZE' : 'PURCHASE';
    // Do not send localhost as merchant display URL — breaks some 3DS / acquirer checks.
    const merchantDisplayUrl = (
      this.config.get<string>('APP_PUBLIC_URL') ||
      'https://bookingqube.com'
    ).replace(/\/+$/, '');
    const orderReference = input.commonOrder.slice(0, 40);

    const payload = {
      apiOperation: 'INITIATE_CHECKOUT',
      interaction: {
        operation: interactionOperation,
        merchant: {
          name: (merchantName || 'BookingQube').slice(0, 40),
          url: merchantDisplayUrl,
        },
        returnUrl: input.successUrl || undefined,
        cancelUrl: input.failedUrl || undefined,
      },
      order: {
        currency: (input.currency || 'QAR').toUpperCase(),
        description: (input.description || 'BookingQube').slice(0, 120),
        id: orderReference,
        reference: orderReference,
        amount: Number(Number(input.amount).toFixed(2)),
      },
      transaction: {
        reference: orderReference,
      },
    };

    const auth = Buffer.from(
      `${gateway.username || ''}:${gateway.password || ''}`,
    ).toString('base64');

    const response = await fetch(sessionUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
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
        `MPGS INITIATE_CHECKOUT failed ${response.status}: ${JSON.stringify(body)} url=${sessionUrl}`,
      );
      throw new BadRequestException(
        (body?.error as { explanation?: string } | undefined)?.explanation ||
          (body?.result as string) ||
          'Could not start Mastercard checkout.',
      );
    }

    const session = (body?.session as Record<string, unknown> | undefined) ?? {};
    const sessionId = String(session.id ?? '').trim();
    const successIndicator = String(body?.successIndicator ?? '').trim();
    if (!sessionId) {
      throw new BadRequestException('Mastercard session id missing from response.');
    }

    const successUrl = this.appendQuery(
      input.successUrl || '/mpgs-success',
      { sid: sessionId, gateway: 'mastercard' },
    );
    const failedUrl = this.appendQuery(
      input.failedUrl || '/mpgs-fail',
      { sid: sessionId, gateway: 'mastercard' },
    );

    await this.prisma.hostedCheckoutSession.create({
      data: {
        sid: sessionId,
        gateway: 'mastercard',
        environment,
        commonOrder: input.commonOrder,
        orderId: input.orderId,
        paramsJson: {
          successIndicator,
          checkout_js_url: gateway.checkout_js_url || null,
          merchant_name: merchantName || 'BookingQube',
          success_url: successUrl,
          failed_url: failedUrl,
        },
        amount: input.amount,
        currency: input.currency || 'QAR',
        status: 'pending',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    await createPendingHostedPayment(this.prisma, {
      orderId: input.orderId,
      gateway: 'mastercard',
      sessionId,
      amount: input.amount,
      currency: input.currency || 'QAR',
    });

    const apiPrefix = this.config.get<string>('API_PREFIX') ?? 'api';
    const apiVersion = this.config.get<string>('API_VERSION') ?? 'v2';
    const backendPublic =
      this.config.get<string>('BACKEND_PUBLIC_URL') ||
      `http://localhost:${this.config.get<number>('PORT') ?? 4000}`;
    const url = `${backendPublic.replace(/\/+$/, '')}/${apiPrefix}/${apiVersion}/payments/mpgs/checkout?sid=${encodeURIComponent(sessionId)}`;

    return {
      redirect_required: true,
      payment_flow: 'legacy_redirect',
      payment_method: 8,
      url,
      mpgs_session_id: sessionId,
      success_indicator: successIndicator || null,
    };
  }

  /** Record browser return, verify with Mastercard, then settle the pending order. */
  async recordReturn(input: {
    sid?: string | null;
    resultIndicator?: string | null;
    status?: 'paid' | 'failed';
  }) {
    const sessionId = (input.sid || '').trim();
    if (!sessionId) {
      throw new BadRequestException('sid is required.');
    }
    const row = await this.prisma.hostedCheckoutSession.findUnique({
      where: { sid: sessionId },
    });
    if (!row || row.gateway !== 'mastercard') {
      throw new BadRequestException('Mastercard session not found.');
    }

    const params = (row.paramsJson as Record<string, unknown>) ?? {};
    const expected = String(params.successIndicator ?? '').trim();
    const resultIndicator = (input.resultIndicator || '').trim();
    const indicatorOk =
      !expected || (Boolean(resultIndicator) && expected === resultIndicator);

    let retrievedPaid = false;
    if (row.commonOrder) {
      try {
        const retrieved = await this.retrieveOrderStatus(row.commonOrder);
        retrievedPaid = retrieved.paid === true;
      } catch (error) {
        this.logger.warn(
          `MPGS return retrieve failed for ${row.commonOrder}: ${
            error instanceof Error ? error.message : error
          }`,
        );
      }
    }

    const paid = retrievedPaid && indicatorOk;
    const status =
      row.status === 'paid' || paid
        ? 'paid'
        : input.status === 'failed'
          ? 'failed'
          : 'pending';

    const providerResponse = {
      sessionId,
      resultIndicator: resultIndicator || null,
      provider: 'mastercard',
      isSuccess: status === 'paid',
      // Use order reference as invoice-style id for ops matching.
      invoiceId: row.commonOrder,
      paymentId: sessionId,
    };

    await this.prisma.hostedCheckoutSession.update({
      where: { id: row.id },
      data: {
        status,
        paramsJson: {
          ...params,
          resultIndicator: resultIndicator || null,
          mpgs_return_status: status,
          mpgs_verified: status === 'paid',
          providerResponse,
        } as Prisma.InputJsonValue,
      },
    });

    if (row.orderId) {
      await this.prisma.payment.updateMany({
        where: {
          orderId: row.orderId,
          status: 'pending',
          providerSessionId: sessionId,
        },
        data: {
          providerInvoiceId: row.commonOrder,
          providerPaymentId: sessionId,
          providerResponse: providerResponse as Prisma.InputJsonValue,
          ...(status === 'failed'
            ? {
                status: 'failed' as const,
                failedAt: new Date(),
                failureMessage: 'Mastercard return indicated failure.',
              }
            : {}),
        },
      });
    }

    await this.paymentRecovery.upsertOpen({
      commonOrder: row.commonOrder,
      orderId: row.orderId,
      gateway: 'mastercard',
      amount: Number(row.amount),
      currency: row.currency,
      providerSessionId: sessionId,
      providerInvoiceId: row.commonOrder,
      providerPaymentId: sessionId,
      failureMessage:
        status === 'paid' ? '' : 'Mastercard return indicated failure.',
      checkoutSnapshot: {
        provider_response: providerResponse,
        mpgs_return: {
          resultIndicator: resultIndicator || null,
          status,
        },
        mpgs_verified: status === 'paid',
      },
    });

    if (status === 'paid') {
      await this.settlePaidHostedOrder({
        commonOrder: row.commonOrder,
        sessionId,
        paymentId: sessionId,
        invoiceId: row.commonOrder,
      });
    }

    return {
      success: true,
      data: {
        sid: sessionId,
        status,
        common_order: row.commonOrder,
        providerResponse,
      },
    };
  }

  async getCheckoutPage(sid: string) {
    const sessionId = (sid || '').trim();
    if (!sessionId) {
      throw new BadRequestException('sid is required.');
    }

    const row = await this.prisma.hostedCheckoutSession.findUnique({
      where: { sid: sessionId },
    });
    if (!row || row.gateway !== 'mastercard') {
      throw new BadRequestException('Mastercard session not found.');
    }

    const params = (row.paramsJson as Record<string, unknown>) ?? {};
    const checkoutJs =
      String(params.checkout_js_url ?? '').trim() ||
      'https://cbq.gateway.mastercard.com/static/checkout/checkout.min.js';
    const successUrl = String(params.success_url ?? '/mpgs-success');
    const failedUrl = String(params.failed_url ?? '/mpgs-fail');
    const apiPrefix = this.config.get<string>('API_PREFIX') ?? 'api';
    const apiVersion = this.config.get<string>('API_VERSION') ?? 'v2';
    const recordPath = `/${apiPrefix}/${apiVersion}/payments/mpgs/return`;

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Complete payment</title>
  <script src="${checkoutJs}"
    data-error="errorCallback"
    data-cancel="cancelCallback"
    data-complete="completeCallback"></script>
  <script>
    function go(url) { window.location.replace(url); }
    function recordReturn(status, resultIndicator, thenUrl) {
      var body = {
        sid: ${JSON.stringify(sessionId)},
        status: status,
        resultIndicator: resultIndicator || null
      };
      fetch(${JSON.stringify(recordPath)}, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
        keepalive: true
      }).catch(function () {}).finally(function () { go(thenUrl); });
    }
    function errorCallback(error) {
      console.error('MPGS payment error', error);
      recordReturn('failed', null, ${JSON.stringify(failedUrl)});
    }
    function cancelCallback() {
      recordReturn('failed', null, ${JSON.stringify(failedUrl)});
    }
    function completeCallback(resultIndicator) {
      var expected = ${JSON.stringify(String(params.successIndicator ?? ''))};
      if (expected && resultIndicator && resultIndicator !== expected) {
        recordReturn('failed', resultIndicator, ${JSON.stringify(failedUrl)});
        return;
      }
      var success = ${JSON.stringify(successUrl)};
      var sep = success.indexOf('?') >= 0 ? '&' : '?';
      var withIndicator = success + sep + 'resultIndicator=' + encodeURIComponent(resultIndicator || '');
      recordReturn('paid', resultIndicator, withIndicator);
    }
    // API version 67+: configure() may only include session; merchant/interaction
    // must already be set in INITIATE_CHECKOUT.
    Checkout.configure({
      session: { id: ${JSON.stringify(sessionId)} }
    });
    Checkout.showPaymentPage();
  </script>
</head>
<body>
  <p style="font-family: system-ui, sans-serif; text-align: center; margin-top: 3rem;">
    Redirecting to secure card payment…
  </p>
</body>
</html>`;
  }

  private appendQuery(
    url: string,
    params: Record<string, string>,
  ): string {
    const base = (url || '').trim() || '/mpgs-success';
    try {
      const absolute = /^https?:\/\//i.test(base)
        ? new URL(base)
        : new URL(base, 'https://bookingqube.local');
      for (const [key, value] of Object.entries(params)) {
        if (value) absolute.searchParams.set(key, value);
      }
      if (/^https?:\/\//i.test(base)) return absolute.toString();
      return `${absolute.pathname}${absolute.search}${absolute.hash}`;
    } catch {
      const sep = base.includes('?') ? '&' : '?';
      const qs = Object.entries(params)
        .filter(([, v]) => v)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&');
      return qs ? `${base}${sep}${qs}` : base;
    }
  }

  private async resolveActiveEnvironment(): Promise<PaymentGatewayEnvironment> {
    const active = await this.prisma.paymentGatewayConfig.findFirst({
      where: { gateway: 'mastercard', isActive: true, enabled: true },
    });
    if (active) return active.environment;
    const sandbox = await this.prisma.paymentGatewayConfig.findUnique({
      where: {
        gateway_environment: {
          gateway: 'mastercard',
          environment: 'sandbox',
        },
      },
    });
    if (sandbox?.enabled) return 'sandbox';
    return 'live';
  }

  private async settlePaidHostedOrder(input: {
    commonOrder: string | null;
    sessionId: string;
    paymentId?: string | null;
    invoiceId?: string | null;
  }) {
    const commonOrder = input.commonOrder?.trim();
    if (!commonOrder) return;
    try {
      const { CheckoutService } = await import('./checkout.service');
      await this.moduleRef.get(CheckoutService, { strict: false }).confirmPayment({
        common_order: commonOrder,
        provider: 'mastercard',
        providerResponse: {
          sessionId: input.sessionId,
          paymentId: input.paymentId || undefined,
          invoiceId: input.invoiceId || undefined,
        },
      });
    } catch (error) {
      this.logger.warn(
        `MPGS order settle failed for ${commonOrder}: ${
          error instanceof Error ? error.message : error
        }`,
      );
    }
  }

  private async loadCredentials(environment: PaymentGatewayEnvironment) {
    const row = await this.prisma.paymentGatewayConfig.findUnique({
      where: {
        gateway_environment: { gateway: 'mastercard', environment },
      },
    });
    const config = ((row?.configJson as MastercardConfig | null) ??
      {}) as MastercardConfig;
    if (!(config.username || '').trim() || !(config.password || '').trim()) {
      throw new BadRequestException(
        `Save Mastercard credentials for ${environment} in Payment settings first.`,
      );
    }
    return { config, enabled: row?.enabled ?? false };
  }

  /**
   * Live order lookup by merchant order id (our common_order truncated to 40).
   * Used by payment-recovery admin verify.
   */
  async retrieveOrderStatus(orderReference: string) {
    const orderId = (orderReference || '').trim().slice(0, 40);
    if (!orderId) {
      throw new BadRequestException('Order reference is required.');
    }

    const environment = await this.resolveActiveEnvironment();
    const { config: gateway } = await this.loadCredentials(environment);
    const endpoint = (gateway.endpoint_url || '').trim();
    const merchantName = (gateway.merchant_name || '').trim();
    if (!endpoint || !merchantName) {
      throw new BadRequestException(
        'Mastercard endpoint / merchant name is not configured.',
      );
    }

    const host = (() => {
      const trimmed = endpoint.replace(/\/+$/, '');
      try {
        const parsed = new URL(
          /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`,
        );
        return `${parsed.protocol}//${parsed.host}`;
      } catch {
        return trimmed.replace(/\/api\/rest\/.*$/i, '').replace(/\/+$/, '');
      }
    })();
    const version = (gateway.api_version || '100').replace(/[^\d]/g, '') || '100';
    const url = `${host}/api/rest/version/${version}/merchant/${encodeURIComponent(merchantName)}/order/${encodeURIComponent(orderId)}`;
    const auth = Buffer.from(
      `${gateway.username || ''}:${gateway.password || ''}`,
    ).toString('base64');

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: 'application/json',
      },
    });
    const body = (await response.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;

    if (!response.ok) {
      this.logger.warn(
        `MPGS RETRIEVE order failed ${response.status}: ${JSON.stringify(body)}`,
      );
      return {
        success: false,
        paid: false,
        message:
          (body?.error as { explanation?: string } | undefined)?.explanation ||
          (body?.result as string) ||
          `Mastercard order lookup failed (${response.status}).`,
        data: { orderId, gateway: body },
      };
    }

    const settlement = extractMpgsSettlement(body);
    const status = String(
      (body?.status as string) ||
        ((body?.order as Record<string, unknown> | undefined)?.status as string) ||
        '',
    ).toUpperCase();
    const result = String(body?.result ?? '').toUpperCase();

    const txn = Array.isArray(body?.transaction)
      ? (body?.transaction as Array<Record<string, unknown>>)[0]
      : (body?.transaction as Record<string, unknown> | undefined);

    return {
      success: true,
      paid: settlement.paid,
      message: settlement.paid
        ? `Mastercard order ${status || result || 'SUCCESS'}.`
        : `Mastercard order status: ${status || result || 'UNKNOWN'}.`,
      data: {
        orderId,
        status: status || null,
        result: result || null,
        paymentId: txn?.id ? String(txn.id) : orderId,
        invoiceId: orderId,
        amount: settlement.amount,
        currency: settlement.currency,
        gateway: body,
      },
    };
  }
}
