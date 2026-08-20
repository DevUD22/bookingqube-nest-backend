import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../../database/prisma.service';

export type SmsChannel = 'online' | 'offline';
export type BookingSmsChannel = SmsChannel;

export type SmsConfig = {
  enabled: boolean;
  provider: string;
  authKey: string;
  authToken: string;
  senderId: string;
  apiBaseUrl: string;
  sendSmsOnline: boolean;
  sendSmsOffline: boolean;
};

export type SendSmsResult = {
  ok: boolean;
  skipped?: boolean;
  status: 'Sent' | 'Failed' | 'Skipped';
  apiId?: string;
  messageUuid?: string;
  message?: string;
  error?: string;
};

function isTruthyFlag(value: string | undefined | null, defaultValue = true): boolean {
  if (value == null || String(value).trim() === '') return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  return !['0', 'false', 'off', 'no', 'disabled'].includes(normalized);
}

/**
 * SMSCountry `Number` must be digits only with country code, no +, -, spaces, etc.
 * Examples: 9745xxxxxxx, 9198xxxxxxx, 4478xxxxxxxx.
 * Local 8-digit Qatar mobiles are prefixed with 974 (same as POS customer normalize).
 */
function normalizeSmsCountryNumber(phone: string): string | null {
  let digits = phone.trim();
  if (!digits) return null;

  // 00 international prefix → drop so remaining digits start with country code
  if (digits.startsWith('00')) digits = digits.slice(2);

  // Keep digits only (strip +, -, spaces, parentheses, letters, etc.)
  digits = digits.replace(/\D/g, '');
  if (!digits) return null;

  // Local Qatar mobile (8 digits) → append country code 974
  if (/^\d{8}$/.test(digits)) digits = `974${digits}`;

  // E.164 without '+': country code + subscriber, 8–15 digits, not starting with 0
  if (!/^[1-9]\d{7,14}$/.test(digits)) return null;

  return digits;
}

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async isEnabledForChannel(channel: SmsChannel): Promise<boolean> {
    const smsConfig = await this.resolveSmsConfig();
    if (!smsConfig.enabled) return false;
    if (channel === 'online') return smsConfig.sendSmsOnline;
    return smsConfig.sendSmsOffline;
  }

  async sendSms(input: {
    to: string;
    text: string;
    channel?: SmsChannel;
  }): Promise<SendSmsResult> {
    const smsConfig = await this.resolveSmsConfig();
    if (!smsConfig.enabled) {
      this.logger.debug('SMS disabled — skip send');
      return { ok: false, skipped: true, status: 'Skipped', message: 'SMS disabled' };
    }

    if (input.channel === 'online' && !smsConfig.sendSmsOnline) {
      return {
        ok: false,
        skipped: true,
        status: 'Skipped',
        message: 'Online SMS disabled',
      };
    }
    if (input.channel === 'offline' && !smsConfig.sendSmsOffline) {
      return {
        ok: false,
        skipped: true,
        status: 'Skipped',
        message: 'Offline/POS SMS disabled',
      };
    }

    const phone = normalizeSmsCountryNumber(input.to);
    if (!phone) {
      return {
        ok: false,
        status: 'Failed',
        error:
          'Destination mobile must include country code and digits only (e.g. 9745xxxxxxx). No +, - or spaces.',
      };
    }

    const text = (input.text || '').trim();
    if (!text) {
      return { ok: false, status: 'Failed', error: 'SMS text is required.' };
    }

    if (smsConfig.provider !== 'smscountry') {
      return {
        ok: false,
        status: 'Failed',
        error: `Unsupported SMS provider: ${smsConfig.provider}`,
      };
    }

    return this.sendViaSmsCountry(smsConfig, phone, text);
  }

  /**
   * Booking confirmation SMS (mirrors MailService booking email gates).
   * Respects SMS enabled + send_sms_online / send_sms_offline.
   */
  async sendBookingConfirmationSms(
    commonOrder: string,
    channel: BookingSmsChannel,
  ): Promise<boolean> {
    const smsConfig = await this.resolveSmsConfig();
    if (!smsConfig.enabled) {
      this.logger.debug(`SMS disabled — skip booking SMS for ${commonOrder}`);
      return false;
    }
    if (channel === 'online' && !smsConfig.sendSmsOnline) {
      this.logger.debug(`Online booking SMS disabled — skip ${commonOrder}`);
      return false;
    }
    if (channel === 'offline' && !smsConfig.sendSmsOffline) {
      this.logger.debug(`Offline/POS booking SMS disabled — skip ${commonOrder}`);
      return false;
    }

    const order = await this.prisma.order.findUnique({
      where: { commonOrder },
      include: {
        customer: { select: { phone: true, name: true } },
        event: { include: { translations: true } },
      },
    });

    if (!order) {
      this.logger.warn(`Order ${commonOrder} not found for booking SMS`);
      return false;
    }

    const phone = (order.customerPhone || order.customer?.phone || '').trim();
    if (!phone) {
      this.logger.debug(`No customer phone for booking SMS ${commonOrder}`);
      return false;
    }

    const eventTitle =
      order.eventTitle ||
      order.event.translations.find((t) => t.locale === 'en')?.title ||
      order.event.translations[0]?.title ||
      order.event.slug;

    const customerName = (order.customerName || order.customer?.name || '').trim();
    const firstName = customerName.split(/\s+/)[0] || 'there';
    const ticketsUrl = await this.buildTicketsUrl(order.event.slug, order.commonOrder);
    const text = [
      `Hi ${firstName}.`,
      `Your booking for ${eventTitle} is confirmed (${order.commonOrder}).`,
      `View tickets: ${ticketsUrl}`,
    ].join(' ');

    const result = await this.sendSms({ to: phone, text, channel });
    if (result.skipped) return false;
    if (!result.ok) {
      this.logger.warn(
        `Booking SMS failed for ${commonOrder}: ${result.error || result.message || 'unknown'}`,
      );
      return false;
    }
    return true;
  }

  /** Fire-and-forget so checkout is never blocked by SMSCountry. */
  queueBookingConfirmationSms(commonOrder: string, channel: BookingSmsChannel) {
    void this.sendBookingConfirmationSms(commonOrder, channel).catch((error) => {
      this.logger.error(
        `Failed booking SMS for ${commonOrder}: ${error instanceof Error ? error.message : error}`,
      );
    });
  }

  async resolveSmsConfig(): Promise<SmsConfig> {
    const row = await this.prisma.appSetting.findUnique({ where: { group: 'sms' } });
    const config =
      row?.configJson && typeof row.configJson === 'object' && !Array.isArray(row.configJson)
        ? (row.configJson as Record<string, string>)
        : {};

    const provider =
      (config.sms_provider || 'smscountry').trim().toLowerCase() || 'smscountry';
    const authKey =
      (config.sms_auth_key || '').trim() ||
      this.config.get<string>('SMS_AUTH_KEY')?.trim() ||
      '';
    const authToken =
      (config.sms_auth_token || '').trim() ||
      this.config.get<string>('SMS_AUTH_TOKEN')?.trim() ||
      '';
    const senderId =
      (config.sms_sender_id || '').trim() ||
      this.config.get<string>('SMS_SENDER_ID')?.trim() ||
      'BookingQube';
    const apiBaseUrl = (
      (config.sms_api_base_url || '').trim() ||
      this.config.get<string>('SMS_API_BASE_URL')?.trim() ||
      'https://restapi.smscountry.com/v0.1'
    ).replace(/\/$/, '');

    return {
      enabled: Boolean(row?.enabled),
      provider,
      authKey,
      authToken,
      senderId,
      apiBaseUrl,
      sendSmsOnline: isTruthyFlag(config.send_sms_online, true),
      sendSmsOffline: isTruthyFlag(config.send_sms_offline, true),
    };
  }

  private async buildTicketsUrl(eventSlug: string, commonOrder: string): Promise<string> {
    const siteUrl =
      this.config.get<string>('APP_PUBLIC_URL')?.replace(/\/$/, '') ||
      (await this.websiteSiteUrl()) ||
      'https://bookingqube.com';
    return `${siteUrl}/events/${encodeURIComponent(eventSlug)}/checkout/confirmation?ref=${encodeURIComponent(commonOrder)}`;
  }

  private async websiteSiteUrl(): Promise<string | null> {
    const row = await this.prisma.appSetting.findUnique({
      where: { group: 'website' },
      select: { configJson: true },
    });
    if (!row?.configJson || typeof row.configJson !== 'object' || Array.isArray(row.configJson)) {
      return null;
    }
    const raw = (row.configJson as Record<string, unknown>).site_url;
    if (typeof raw !== 'string' || !raw.trim()) return null;
    return raw.trim().replace(/\/$/, '');
  }

  private async sendViaSmsCountry(
    smsConfig: SmsConfig,
    phone: string,
    text: string,
  ): Promise<SendSmsResult> {
    if (!smsConfig.authKey || !smsConfig.authToken) {
      return {
        ok: false,
        status: 'Failed',
        error: 'SMSCountry Auth Key / Auth Token are not configured.',
      };
    }

    const auth = Buffer.from(
      `${smsConfig.authKey}:${smsConfig.authToken}`,
    ).toString('base64');

    const body = new URLSearchParams({
      Text: text,
      Number: phone,
      SenderId: smsConfig.senderId,
      DRNotifyUrl: 'https://www.domainname.com/notifyurl',
      DRNotifyHttpMethod: 'POST',
      Tool: 'API',
    });

    try {
      const response = await fetch(
        `${smsConfig.apiBaseUrl}/Accounts/${encodeURIComponent(smsConfig.authKey)}/SMSes/`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${auth}`,
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body,
        },
      );

      const rawText = await response.text();
      type SmsCountrySendResponse = {
        Success?: string | boolean;
        ApiId?: string;
        MessageUUID?: string | string[];
        Message?: string;
      };
      let payload: SmsCountrySendResponse | null = null;
      try {
        payload = JSON.parse(rawText) as SmsCountrySendResponse;
      } catch {
        payload = null;
      }

      const successRaw = payload?.Success;
      const success =
        successRaw === true ||
        String(successRaw ?? '').toLowerCase() === 'true';

      if (response.ok && success) {
        const uuid = Array.isArray(payload?.MessageUUID)
          ? payload?.MessageUUID[0]
          : payload?.MessageUUID;
        this.logger.log(`SMS sent to ${phone} via SMSCountry`);
        return {
          ok: true,
          status: 'Sent',
          apiId: payload?.ApiId,
          messageUuid: uuid,
          message: payload?.Message,
        };
      }

      const error =
        payload?.Message ||
        `SMSCountry HTTP ${response.status}${rawText ? `: ${rawText.slice(0, 200)}` : ''}`;
      this.logger.warn(`SMS send failed to ${phone}: ${error}`);
      return { ok: false, status: 'Failed', error };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'SMS send failed.';
      this.logger.error(`SMS send failed to ${phone}: ${message}`);
      return { ok: false, status: 'Failed', error: message };
    }
  }
}
