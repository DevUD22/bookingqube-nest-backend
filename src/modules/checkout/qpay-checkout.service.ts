import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import {
  createPendingHostedPayment,
  sanitizeGatewayCallback,
} from './hosted-payment-records';
import { PaymentRecoveryService } from './payment-recovery.service';
import {
  buildQpaySecureHash,
  formatQpayRequestDate,
  isQpayCallbackStale,
  qpayCallbackAmountMatches,
  qpaySanitizePun,
  verifyQpayCallbackSignature,
} from './qpay-callback.security';

const QPAY_TOKEN_TTL_SECONDS = 900;
const QPAY_ALLOWED_PARAM_KEYS = [
  'Action',
  'Amount',
  'BankID',
  'CurrencyCode',
  'Lang',
  'MerchantID',
  'MerchantModuleSessionID',
  'PUN',
  'PaymentDescription',
  'Quantity',
  'TransactionRequestDate',
  'SecureHash',
] as const;

type QpayConfig = {
  secret_key?: string;
  merchant_id?: string;
  bank_id?: string;
  endpoint_url?: string;
};

@Injectable()
export class QpayCheckoutService {
  private readonly logger = new Logger(QpayCheckoutService.name);

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
    const { config: gateway } = await this.loadCredentials();
    const sid = randomBytes(12).toString('hex').slice(0, 20);
    const amountMinor = Math.round(Number(input.amount) * 100);
    const pun = this.sanitizePun(input.commonOrder);
    const requestDate = this.formatRequestDate(new Date());

    const parameters: Record<string, string | number> = {
      Action: 0,
      Amount: amountMinor,
      BankID: gateway.bank_id || '',
      CurrencyCode: '634',
      Lang: 'En',
      MerchantID: gateway.merchant_id || '',
      MerchantModuleSessionID: sid,
      PUN: pun,
      PaymentDescription: (input.description || 'BookingQube').slice(0, 100),
      Quantity: '1',
      TransactionRequestDate: requestDate,
    };

    const secureHash = this.buildSecureHash(parameters, gateway.secret_key || '');
    parameters.SecureHash = secureHash;

    await this.prisma.hostedCheckoutSession.create({
      data: {
        sid,
        gateway: 'qpay',
        environment: 'live',
        commonOrder: input.commonOrder,
        orderId: input.orderId,
        paramsJson: {
          v2_checkout_redirect: true,
          qpay_params: parameters,
          success_url: input.successUrl ?? null,
          failed_url: input.failedUrl ?? null,
        },
        amount: input.amount,
        currency: input.currency || 'QAR',
        status: 'pending',
        expiresAt: new Date(Date.now() + QPAY_TOKEN_TTL_SECONDS * 1000),
      },
    });

    await createPendingHostedPayment(this.prisma, {
      orderId: input.orderId,
      gateway: 'qpay',
      sessionId: sid,
      amount: input.amount,
      currency: input.currency || 'QAR',
    });

    const issued = this.issueToken(sid);
    const frontendOrigin = this.resolveFrontendOrigin(
      input.baseDomain,
      input.successUrl,
    );
    const url = frontendOrigin
      ? `${frontendOrigin.replace(/\/+$/, '')}/qpay-redirect?sid=${encodeURIComponent(sid)}&token=${encodeURIComponent(issued.token)}&exp=${issued.exp}`
      : null;

    return {
      redirect_required: Boolean(url),
      payment_flow: url ? 'v2_qpay_hosted' : 'legacy_redirect',
      payment_method: 7,
      url,
      qpay_sid: sid,
      qpay_token: issued.token,
      qpay_exp: issued.exp,
      qpay_endpoint_url: gateway.endpoint_url || null,
    };
  }

  async getCheckoutParams(sid: string, token: string, expRaw: string) {
    const sessionId = (sid || '').trim();
    const exp = Number(expRaw);
    if (!sessionId || !/^[A-Za-z0-9]{10,64}$/.test(sessionId)) {
      throw new BadRequestException('Invalid payment session.');
    }
    if (!this.tokenIsValid(sessionId, token, exp)) {
      throw new ForbiddenException('Payment session token is invalid or expired.');
    }

    const row = await this.prisma.hostedCheckoutSession.findUnique({
      where: { sid: sessionId },
    });
    if (!row || row.gateway !== 'qpay') {
      throw new NotFoundException('Payment session not found.');
    }
    if (row.expiresAt.getTime() < Date.now()) {
      throw new ForbiddenException('Payment session has expired.');
    }

    const paramsRoot = (row.paramsJson as Record<string, unknown>) ?? {};
    if (!paramsRoot.v2_checkout_redirect) {
      throw new NotFoundException('Payment session is not a V2 QPay checkout.');
    }

    const rawParams = (paramsRoot.qpay_params as Record<string, unknown>) ?? {};
    const { config: gateway } = await this.loadCredentials();
    const sanitized = this.sanitizeGatewayParams(rawParams, gateway.secret_key || '');

    if (JSON.stringify(sanitized) !== JSON.stringify(rawParams)) {
      await this.prisma.hostedCheckoutSession.update({
        where: { id: row.id },
        data: {
          paramsJson: {
            ...paramsRoot,
            qpay_params: sanitized,
          } as Prisma.InputJsonValue,
        },
      });
    }

    const qpayParams: Record<string, string | number> = {};
    for (const key of QPAY_ALLOWED_PARAM_KEYS) {
      if (sanitized[key] !== undefined && sanitized[key] !== null) {
        qpayParams[key] = sanitized[key] as string | number;
      }
    }

    if (!qpayParams.SecureHash || !qpayParams.MerchantModuleSessionID) {
      throw new NotFoundException('Payment session payload is incomplete.');
    }
    if (String(qpayParams.MerchantModuleSessionID) !== sessionId) {
      throw new NotFoundException('Payment session id mismatch.');
    }

    const endpoint = (gateway.endpoint_url || '').trim();
    if (!endpoint) {
      throw new BadRequestException('QPay endpoint URL is not configured.');
    }

    return {
      success: true,
      data: {
        qpay_endpoint_url: endpoint,
        qpay_params: qpayParams,
        qpay_sid: sessionId,
      },
    };
  }

  /**
   * Bank/NAPS posts here after payment. Signature-verified callbacks settle
   * the pending order immediately (same as the old customer QPay return).
   */
  async handleBankCallback(raw: Record<string, unknown>) {
    const body = raw ?? {};
    const sessionId = String(
      body.Response_MerchantModuleSessionID ??
        body.MerchantModuleSessionID ??
        '',
    ).trim();

    if (!sessionId) {
      return {
        success: false,
        paid: false,
        message: 'QPay session id is missing.',
        redirect_url: '/mpgs-fail',
        data: null,
      };
    }

    const { config: gateway } = await this.loadCredentials();
    if (!verifyQpayCallbackSignature(body, gateway.secret_key || '')) {
      throw new ForbiddenException('Invalid QPay callback signature.');
    }

    const row = await this.prisma.hostedCheckoutSession.findUnique({
      where: { sid: sessionId },
    });
    if (!row || row.gateway !== 'qpay') {
      return {
        success: false,
        paid: false,
        message: 'QPay session not found.',
        redirect_url: '/mpgs-fail',
        data: null,
      };
    }

    const params = (row.paramsJson as Record<string, unknown>) ?? {};
    if (row.status === 'paid' && params.qpay_verified === true) {
      const stored = (params.qpay_callback as Record<string, unknown>) ?? {};
      const confirmationId = String(params.qpay_event_id ?? '');
      const pun = this.sanitizePun(row.commonOrder ?? '');
      await this.settlePaidHostedOrder({
        commonOrder: row.commonOrder,
        sessionId: row.sid,
        paymentId: confirmationId,
        invoiceId: pun || row.commonOrder,
        provider: 'qpay',
      });
      return this.callbackResult(
        row,
        params,
        stored,
        confirmationId,
        pun,
        true,
      );
    }

    const qpayParams = (params.qpay_params as Record<string, unknown>) ?? {};
    const requestDate = String(
      body.Response_TransactionRequestDate ??
        qpayParams.TransactionRequestDate ??
        '',
    );
    if (
      isQpayCallbackStale({
        requestDate: requestDate || null,
        createdAt: row.createdAt,
      })
    ) {
      throw new ForbiddenException('QPay callback timestamp is stale.');
    }

    const payload = sanitizeGatewayCallback(body);
    const pun = String(payload.Response_PUN ?? payload.pun ?? '')
      .replace(/[^A-Za-z0-9]/g, '')
      .trim();
    const confirmationId = String(
      payload.Response_ConfirmationID ?? payload.confirmationId ?? '',
    ).trim();
    const statusCode = String(payload.Response_Status ?? payload.status ?? '').trim();
    const responseAmount = Number(body.Response_Amount ?? body.Amount);
    const amountMatches = qpayCallbackAmountMatches(
      Number(row.amount),
      Number.isFinite(responseAmount) ? responseAmount : null,
    );
    const expectedPun = this.sanitizePun(row.commonOrder ?? '');
    const punMatches = Boolean(pun) && pun === expectedPun;
    const merchantId = String(
      body.Response_MerchantID ?? body.MerchantID ?? '',
    ).trim();
    const merchantMatches =
      !merchantId || merchantId === String(gateway.merchant_id || '').trim();
    const currencyCode = String(
      body.Response_CurrencyCode ?? body.CurrencyCode ?? '',
    ).trim();
    const currencyMatches =
      !currencyCode ||
      currencyCode === '634' ||
      currencyCode.toUpperCase() === String(row.currency || 'QAR').toUpperCase();

    const paid =
      statusCode === '0000' &&
      Boolean(confirmationId) &&
      amountMatches &&
      punMatches &&
      merchantMatches &&
      currencyMatches;

    if (confirmationId) {
      const replay = await this.prisma.hostedCheckoutSession.findFirst({
        where: {
          gateway: 'qpay',
          NOT: { id: row.id },
          OR: [
            {
              paramsJson: {
                path: ['providerResponse', 'paymentId'],
                equals: confirmationId,
              },
            },
            {
              paramsJson: {
                path: ['qpay_event_id'],
                equals: confirmationId,
              },
            },
          ],
        },
        select: { id: true },
      });
      if (replay) {
        throw new ForbiddenException('QPay confirmation has already been used.');
      }
    }

    const providerResponse = {
      isSuccess: paid,
      sessionId: row.sid,
      paymentId: confirmationId || null,
      invoiceId: pun || row.commonOrder,
      provider: 'qpay',
      qpay_verified: paid,
      gateway: payload,
    };

    await this.prisma.hostedCheckoutSession.update({
      where: { id: row.id },
      data: {
        status: paid ? 'paid' : 'failed',
        paramsJson: {
          ...params,
          qpay_callback: payload,
          qpay_verified: paid,
          qpay_event_id: confirmationId || null,
          qpay_callback_received_at: new Date().toISOString(),
          providerResponse,
        } as Prisma.InputJsonValue,
      },
    });

    if (row.orderId) {
      await this.prisma.payment.updateMany({
        where: {
          orderId: row.orderId,
          status: 'pending',
          OR: [
            { providerSessionId: row.sid },
            { methodKey: { startsWith: 'qpay-' } },
          ],
        },
        data: {
          providerSessionId: row.sid,
          providerPaymentId: confirmationId || null,
          providerInvoiceId: pun || row.commonOrder,
          providerResponse: providerResponse as Prisma.InputJsonValue,
          ...(paid
            ? {}
            : {
                status: 'failed' as const,
                failedAt: new Date(),
                failureCode: statusCode || null,
                failureMessage: paid
                  ? null
                  : String(
                      payload.Response_StatusMessage ??
                        payload.message ??
                        'QPay payment not completed.',
                    ),
              }),
        },
      });
    }

    await this.paymentRecovery.upsertOpen({
      commonOrder: row.commonOrder,
      orderId: row.orderId,
      gateway: 'qpay',
      amount: Number(row.amount),
      currency: row.currency,
      providerSessionId: row.sid,
      providerInvoiceId: pun || row.commonOrder,
      providerPaymentId: confirmationId || null,
      failureMessage: paid
        ? ''
        : String(
            payload.Response_StatusMessage ??
              payload.message ??
              'QPay payment not completed.',
          ),
      checkoutSnapshot: {
        provider_response: providerResponse,
        qpay_callback: payload,
        qpay_verified: paid,
      },
    });

    if (paid) {
      await this.settlePaidHostedOrder({
        commonOrder: row.commonOrder,
        sessionId: row.sid,
        paymentId: confirmationId,
        invoiceId: pun || row.commonOrder,
        provider: 'qpay',
      });
    }

    return this.callbackResult(
      { ...row, status: paid ? 'paid' : 'failed' },
      params,
      payload,
      confirmationId,
      pun,
      paid,
    );
  }

  private async settlePaidHostedOrder(input: {
    commonOrder: string | null;
    sessionId: string;
    paymentId?: string | null;
    invoiceId?: string | null;
    provider: 'qpay';
  }) {
    const commonOrder = input.commonOrder?.trim();
    if (!commonOrder) return;
    try {
      const { CheckoutService } = await import('./checkout.service');
      await this.moduleRef.get(CheckoutService, { strict: false }).confirmPayment({
        common_order: commonOrder,
        provider: input.provider,
        providerResponse: {
          sessionId: input.sessionId,
          paymentId: input.paymentId || undefined,
          invoiceId: input.invoiceId || undefined,
        },
      });
    } catch (error) {
      this.logger.warn(
        `QPay order settle failed for ${commonOrder}: ${
          error instanceof Error ? error.message : error
        }`,
      );
    }
  }

  private callbackResult(
    row: { sid: string; commonOrder: string | null; status: string },
    params: Record<string, unknown>,
    payload: Record<string, unknown>,
    confirmationId: string,
    pun: string,
    paid: boolean,
  ) {
    const successUrl = String(params.success_url ?? '/mpgs-success');
    const failedUrl = String(params.failed_url ?? '/mpgs-fail');
    const target = paid ? successUrl : failedUrl;
    const redirectUrl = this.appendCallbackQuery(target, {
      sid: row.sid,
      paymentId: confirmationId,
      invoiceId: pun || row.commonOrder || '',
      gateway: 'qpay',
    });
    return {
      success: true,
      paid,
      message: paid
        ? 'QPay payment recorded.'
        : String(
            payload.Response_StatusMessage ??
              payload.message ??
              'QPay payment not completed.',
          ),
      redirect_url: redirectUrl,
      data: {
        common_order: row.commonOrder,
        providerResponse: {
          isSuccess: paid,
          sessionId: row.sid,
          paymentId: confirmationId || null,
          invoiceId: pun || row.commonOrder,
          provider: 'qpay',
          qpay_verified: paid,
          gateway: payload,
        },
      },
    };
  }

  private appendCallbackQuery(
    url: string,
    params: Record<string, string>,
  ): string {
    const base = (url || '').trim() || '/mpgs-fail';
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

  private async loadCredentials() {
    const row = await this.prisma.paymentGatewayConfig.findUnique({
      where: {
        gateway_environment: { gateway: 'qpay', environment: 'live' },
      },
    });
    const config = ((row?.configJson as QpayConfig | null) ?? {}) as QpayConfig;
    if (!(config.secret_key || '').trim() || !(config.merchant_id || '').trim()) {
      throw new BadRequestException(
        'Save QPay live credentials in Payment settings first.',
      );
    }
    return { config, enabled: row?.enabled ?? false };
  }

  private issueToken(sid: string) {
    const exp = Math.floor(Date.now() / 1000) + QPAY_TOKEN_TTL_SECONDS;
    return { token: this.makeToken(sid, exp), exp };
  }

  private makeToken(sid: string, exp: number) {
    const secret = this.config.getOrThrow<string>('JWT_ACCESS_SECRET');
    return createHmac('sha256', secret).update(`${sid}|${exp}`).digest('hex');
  }

  private tokenIsValid(sid: string, token: string, exp: number) {
    if (!sid || !token || !Number.isFinite(exp) || exp <= 0) return false;
    const now = Math.floor(Date.now() / 1000);
    if (exp < now) return false;
    if (exp > now + QPAY_TOKEN_TTL_SECONDS + 120) return false;
    const expected = this.makeToken(sid, exp);
    try {
      const a = Buffer.from(expected);
      const b = Buffer.from(token);
      return a.length === b.length && timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  private sanitizePun(orderNumber: string) {
    return qpaySanitizePun(orderNumber);
  }

  private sanitizeGatewayParams(
    parameters: Record<string, unknown>,
    secret: string,
  ) {
    const next: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(parameters)) {
      if (value === undefined || value === null) continue;
      next[key] = value as string | number;
    }
    const originalPun = String(next.PUN ?? '');
    const safePun = this.sanitizePun(originalPun);
    next.PUN = safePun;
    next.SecureHash = this.buildSecureHash(next, secret);
    return next;
  }

  private buildSecureHash(
    parameters: Record<string, string | number>,
    secret: string,
  ) {
    return buildQpaySecureHash(parameters, secret);
  }

  private formatRequestDate(date: Date) {
    return formatQpayRequestDate(date);
  }

  private resolveFrontendOrigin(
    baseDomain?: string | null,
    successUrl?: string | null,
  ) {
    const base = (baseDomain || '').trim().replace(/\/+$/, '');
    if (/^https?:\/\//i.test(base)) return base;

    const success = (successUrl || '').trim();
    if (!success) {
      return this.config.get<string>('APP_PUBLIC_URL') || null;
    }
    try {
      const url = new URL(success);
      return url.origin;
    } catch {
      return this.config.get<string>('APP_PUBLIC_URL') || null;
    }
  }
}
