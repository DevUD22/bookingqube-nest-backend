import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderItemType } from '@prisma/client';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import * as QRCode from 'qrcode';

import { PrismaService } from '../../database/prisma.service';
import {
  BookingPassLine,
  renderBookingConfirmationHtml,
  renderEmailChangeNoticeHtml,
  renderEmailChangeOtpHtml,
  renderPasswordResetOtpHtml,
  renderRegistrationConfirmationHtml,
  renderUserRegisterHtml,
} from './mail-templates';

export type BookingEmailChannel = 'online' | 'offline';

type MailConfig = {
  enabled: boolean;
  driver: string;
  host: string;
  port: number;
  encryption: string;
  username: string;
  password: string;
  senderEmail: string;
  senderName: string;
  sendEmailOnline: boolean;
  sendEmailOffline: boolean;
};

type SendMailInput = {
  to: string;
  subject: string;
  html: string;
  attachments?: Array<{
    filename: string;
    content: Buffer;
    contentType?: string;
    cid?: string;
  }>;
};

const PASS_ICON_COLORS = ['#ede9fe', '#fce7f3', '#dbeafe', '#dcfce7'];
const PASS_ICON_TEXT = ['#7c3aed', '#db2777', '#2563eb', '#16a34a'];
const PASS_ICON_GLYPHS = ['&#127915;', '&#128663;', '&#127928;', '&#127378;'];
const ADDON_ICON_COLORS = ['#fce7f3', '#ffedd5', '#e0f2fe'];
const ADDON_ICON_TEXT = ['#db2777', '#ea580c', '#0284c7'];

const DEFAULT_LOGO =
  'https://bookingqube.blob.core.windows.net/bqcontainer/static/logo.png';
const DEFAULT_HOTLINE = '+974 5113 8418';
const DEFAULT_HOTLINE_HOURS = 'Everyday 09:00 AM - 12:00 PM';

function isTruthyFlag(value: string | undefined | null, defaultValue = true): boolean {
  if (value == null || String(value).trim() === '') return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  return !['0', 'false', 'off', 'no', 'disabled'].includes(normalized);
}

function isLocalGuestEmail(email: string): boolean {
  return /@bookingqube\.local$/i.test(email.trim());
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async sendUserRegistrationEmail(input: {
    to: string;
    name?: string;
    password?: string;
    actionUrl?: string;
  }): Promise<boolean> {
    if (isLocalGuestEmail(input.to)) return false;

    const branding = await this.getBranding();
    const html = renderUserRegisterHtml({
      siteName: branding.siteName,
      siteSlogan: branding.siteSlogan,
      logoUrl: branding.logoUrl,
      siteUrl: branding.siteUrl,
      actionUrl: input.actionUrl,
      password: input.password,
    });

    return this.sendMailSafe({
      to: input.to,
      subject: `Welcome to ${branding.siteName}`,
      html,
    });
  }

  async sendPasswordResetOtp(input: {
    to: string;
    name?: string;
    otp: string;
  }): Promise<boolean> {
    if (isLocalGuestEmail(input.to)) return false;

    const branding = await this.getBranding();
    const html = renderPasswordResetOtpHtml({
      siteName: branding.siteName,
      logoUrl: branding.logoUrl,
      name: input.name,
      otp: input.otp,
    });

    return this.sendMailSafe({
      to: input.to,
      subject: `${branding.siteName} password reset code`,
      html,
    });
  }

  async sendEmailChangeOtp(input: {
    to: string;
    name?: string;
    otp: string;
    newEmail: string;
  }): Promise<boolean> {
    if (isLocalGuestEmail(input.to)) return false;

    const branding = await this.getBranding();
    const html = renderEmailChangeOtpHtml({
      siteName: branding.siteName,
      name: input.name,
      otp: input.otp,
      newEmail: input.newEmail,
    });

    return this.sendMailSafe({
      to: input.to,
      subject: `${branding.siteName} email change code`,
      html,
    });
  }

  async sendEmailChangeNotice(input: {
    to: string;
    name?: string;
    newEmail: string;
  }): Promise<boolean> {
    if (isLocalGuestEmail(input.to)) return false;

    const branding = await this.getBranding();
    const html = renderEmailChangeNoticeHtml({
      siteName: branding.siteName,
      name: input.name,
      newEmail: input.newEmail,
    });

    return this.sendMailSafe({
      to: input.to,
      subject: `${branding.siteName} email change requested`,
      html,
    });
  }

  async sendEventRegistrationEmail(input: {
    to: string;
    customerName: string;
    registrationNo: string;
    eventId: string;
  }): Promise<boolean> {
    if (isLocalGuestEmail(input.to)) return false;

    const event = await this.prisma.event.findUnique({
      where: { id: input.eventId },
      include: {
        translations: true,
        venue: { include: { translations: true } },
        category: { include: { translations: true } },
        primaryMedia: true,
      },
    });
    if (!event) {
      this.logger.warn(`Event ${input.eventId} not found for registration email`);
      return false;
    }

    const branding = await this.getBranding();
    const eventTitle =
      event.translations.find((t) => t.locale === 'en')?.title ??
      event.translations[0]?.title ??
      event.slug;
    const venueName =
      event.venue?.translations.find((t) => t.locale === 'en')?.name ??
      event.venue?.name ??
      '';
    const city = event.venue?.city ?? '';
    const categoryName =
      event.category?.translations.find((t) => t.locale === 'en')?.name ??
      event.category?.name ??
      '';
    const posterUrl = event.primaryMedia?.url ?? '';
    const qrCid = 'registration-qr';
    const qrBuffer = await QRCode.toBuffer(input.registrationNo, {
      type: 'png',
      width: 240,
      margin: 1,
    });

    const start = event.startsAt ?? new Date();
    const end = event.endsAt ?? new Date(start.getTime() + 60 * 60 * 1000);
    const locationLine = [venueName, city].filter(Boolean).join(', ');
    const siteUrl = branding.siteUrl;
    const manageUrl = `${siteUrl}/register/${encodeURIComponent(event.slug)}`;
    const calendarUrl = this.buildCalendarUrl({
      title: eventTitle,
      start,
      end,
      details: `Registration ref: ${input.registrationNo}`,
      location: locationLine,
    });
    const directionsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(locationLine || eventTitle)}`;

    const html = renderRegistrationConfirmationHtml({
      mailSubject: `Registration confirmed — ${eventTitle}`,
      eventTitle,
      eventSlug: event.slug,
      registrationNo: input.registrationNo,
      customerName: input.customerName,
      customerEmail: input.to,
      venue: venueName,
      city,
      categoryName,
      posterUrl,
      eventDateLabel: this.formatDateLabel(start),
      timeLabel: this.formatTimeRange(start, end),
      orderDateLabel: this.formatDateLabel(new Date()),
      manageUrl,
      helpUrl: siteUrl,
      calendarUrl,
      directionsUrl,
      logoUrl: branding.logoUrl,
      ticketHotline: branding.phone || DEFAULT_HOTLINE,
      ticketHotlineHours: DEFAULT_HOTLINE_HOURS,
      registrationQrCid: qrCid,
    });

    return this.sendMailSafe({
      to: input.to,
      subject: `Registration confirmed — ${eventTitle}`,
      html,
      attachments: [
        {
          filename: 'registration-qr.png',
          content: qrBuffer,
          contentType: 'image/png',
          cid: qrCid,
        },
      ],
    });
  }

  async sendBookingConfirmationEmail(
    commonOrder: string,
    channel: BookingEmailChannel,
  ): Promise<boolean> {
    const mailConfig = await this.resolveMailConfig();
    if (!mailConfig.enabled) {
      this.logger.debug(`Mail disabled — skip booking email for ${commonOrder}`);
      return false;
    }
    if (channel === 'online' && !mailConfig.sendEmailOnline) {
      this.logger.debug(`Online booking emails disabled — skip ${commonOrder}`);
      return false;
    }
    if (channel === 'offline' && !mailConfig.sendEmailOffline) {
      this.logger.debug(`Offline/POS booking emails disabled — skip ${commonOrder}`);
      return false;
    }

    const order = await this.prisma.order.findUnique({
      where: { commonOrder },
      include: {
        items: true,
        event: {
          include: {
            translations: true,
            venue: { include: { translations: true } },
            category: { include: { translations: true } },
            primaryMedia: true,
          },
        },
        eventSession: true,
      },
    });

    if (!order) {
      this.logger.warn(`Order ${commonOrder} not found for booking email`);
      return false;
    }

    const to = (order.customerEmail || '').trim();
    if (!to || isLocalGuestEmail(to)) {
      this.logger.debug(`No deliverable customer email for ${commonOrder}`);
      return false;
    }

    const branding = await this.getBranding();
    const event = order.event;
    const eventTitle =
      order.eventTitle ||
      event.translations.find((t) => t.locale === 'en')?.title ||
      event.translations[0]?.title ||
      event.slug;
    const venueName =
      event.venue?.translations.find((t) => t.locale === 'en')?.name ??
      event.venue?.name ??
      '';
    const city = event.venue?.city ?? '';
    const categoryName =
      event.category?.translations.find((t) => t.locale === 'en')?.name ??
      event.category?.name ??
      '';
    const posterUrl = event.primaryMedia?.url ?? '';

    const passLines = this.aggregateLines(
      order.items.filter(
        (item) =>
          item.itemType === OrderItemType.ticket_type ||
          item.itemType === OrderItemType.ticket_variant,
      ),
      PASS_ICON_COLORS,
      PASS_ICON_TEXT,
      PASS_ICON_GLYPHS,
    );
    const addonLines = this.aggregateLines(
      order.items.filter((item) => item.itemType === OrderItemType.addon),
      ADDON_ICON_COLORS,
      ADDON_ICON_TEXT,
      ['&#127378;'],
    );

    const totalNet = Number(order.totalAmount);
    const siteUrl = branding.siteUrl;
    const manageBookingUrl = `${siteUrl}/events/${encodeURIComponent(event.slug)}/checkout/confirmation?ref=${encodeURIComponent(order.commonOrder)}`;
    const downloadUrl = manageBookingUrl;
    const helpUrl = siteUrl;

    const startDate = order.eventStartDate
      ? new Date(order.eventStartDate)
      : event.startsAt ?? order.createdAt;
    const startTime = order.eventStartTime || order.eventSession.displayTime || '00:00';
    const end = event.endsAt ?? new Date(startDate.getTime() + 60 * 60 * 1000);
    const locationLine = [venueName, city].filter(Boolean).join(', ');
    const calendarStart = this.combineDateAndTime(startDate, startTime);
    const calendarUrl = this.buildCalendarUrl({
      title: eventTitle,
      start: calendarStart,
      end,
      details: `Booking ref: ${order.commonOrder}`,
      location: locationLine,
    });
    const directionsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(locationLine || eventTitle)}`;

    const qrPayload =
      order.items.find((item) => item.qrCodePayload || item.ticketCode)?.qrCodePayload ||
      order.items.find((item) => item.ticketCode)?.ticketCode ||
      order.commonOrder;
    const qrCid = 'booking-qr';
    const qrBuffer = await QRCode.toBuffer(qrPayload, {
      type: 'png',
      width: 240,
      margin: 1,
    });

    const html = renderBookingConfirmationHtml({
      mailSubject: `Booking confirmed — ${eventTitle}`,
      bookingRef: order.commonOrder,
      customerName: order.customerName || 'there',
      customerEmail: to,
      eventTitle,
      eventSlug: event.slug,
      currency: order.currency || 'QAR',
      venue: venueName,
      city,
      categoryName,
      posterUrl,
      eventDateLabel: this.formatDateLabel(calendarStart),
      timeLabel: order.eventSession.displayTime || this.formatTimeRange(calendarStart, end),
      orderDateLabel: this.formatDateLabel(order.createdAt),
      passLines,
      addonLines,
      totalNet,
      downloadUrl,
      manageBookingUrl,
      helpUrl,
      calendarUrl,
      directionsUrl,
      logoUrl: branding.logoUrl,
      ticketHotline: branding.phone || DEFAULT_HOTLINE,
      ticketHotlineHours: DEFAULT_HOTLINE_HOURS,
      bookingQrCid: qrCid,
      skipPdfAttachments: true,
    });

    return this.sendMailSafe({
      to,
      subject: `Booking confirmed — ${eventTitle}`,
      html,
      attachments: [
        {
          filename: 'booking-qr.png',
          content: qrBuffer,
          contentType: 'image/png',
          cid: qrCid,
        },
      ],
    });
  }

  /** Fire-and-forget wrapper so checkout is never blocked by SMTP. */
  queueBookingConfirmationEmail(commonOrder: string, channel: BookingEmailChannel) {
    void this.sendBookingConfirmationEmail(commonOrder, channel).catch((error) => {
      this.logger.error(
        `Failed booking email for ${commonOrder}: ${error instanceof Error ? error.message : error}`,
      );
    });
  }

  queueUserRegistrationEmail(input: {
    to: string;
    name?: string;
    password?: string;
    actionUrl?: string;
  }) {
    void this.sendUserRegistrationEmail(input).catch((error) => {
      this.logger.error(
        `Failed registration welcome email to ${input.to}: ${error instanceof Error ? error.message : error}`,
      );
    });
  }

  async sendEventRegistrationEmailSafe(input: {
    to: string;
    customerName: string;
    registrationNo: string;
    eventId: string;
  }): Promise<boolean> {
    try {
      return await this.sendEventRegistrationEmail(input);
    } catch (error) {
      this.logger.error(
        `Failed event registration email to ${input.to}: ${error instanceof Error ? error.message : error}`,
      );
      return false;
    }
  }

  private aggregateLines(
    items: Array<{
      displayName: string;
      quantity: number;
      unitPrice: { toNumber(): number } | number;
      totalAmount: { toNumber(): number } | number;
    }>,
    iconColors: string[],
    iconText: string[],
    iconGlyphs: string[],
  ): BookingPassLine[] {
    const map = new Map<string, BookingPassLine>();

    for (const item of items) {
      const name = item.displayName || 'Ticket';
      const unitPrice =
        typeof item.unitPrice === 'number' ? item.unitPrice : item.unitPrice.toNumber();
      const total =
        typeof item.totalAmount === 'number'
          ? item.totalAmount
          : item.totalAmount.toNumber();
      const existing = map.get(name);
      if (existing) {
        existing.quantity += item.quantity;
        existing.total += total;
      } else {
        const index = map.size;
        map.set(name, {
          name,
          unitPrice,
          quantity: item.quantity,
          total,
          iconBg: iconColors[index % iconColors.length],
          iconColor: iconText[index % iconText.length],
          iconGlyph: iconGlyphs[index % iconGlyphs.length],
        });
      }
    }

    return [...map.values()];
  }

  private async sendMailSafe(input: SendMailInput): Promise<boolean> {
    try {
      const mailConfig = await this.resolveMailConfig();
      if (!mailConfig.enabled && mailConfig.driver !== 'log') {
        this.logger.debug(`Mail transport disabled — skip email to ${input.to}`);
        return false;
      }

      if (mailConfig.driver === 'log' || (!mailConfig.enabled && !mailConfig.host)) {
        this.logger.log(
          `[mail:log] to=${input.to} subject=${input.subject} attachments=${input.attachments?.length ?? 0}`,
        );
        return true;
      }

      const transporter = this.createTransport(mailConfig);
      await transporter.sendMail({
        from: `"${mailConfig.senderName}" <${mailConfig.senderEmail}>`,
        to: input.to,
        subject: input.subject,
        html: input.html,
        attachments: input.attachments?.map((attachment) => ({
          filename: attachment.filename,
          content: attachment.content,
          contentType: attachment.contentType,
          cid: attachment.cid,
        })),
      });
      this.logger.log(`Email sent to ${input.to}: ${input.subject}`);
      return true;
    } catch (error) {
      this.logger.error(
        `Email send failed to ${input.to}: ${error instanceof Error ? error.message : error}`,
      );
      return false;
    }
  }

  private createTransport(mailConfig: MailConfig): Transporter {
    const encryption = mailConfig.encryption.toLowerCase();
    const secure = encryption === 'ssl' || mailConfig.port === 465;

    return nodemailer.createTransport({
      host: mailConfig.host,
      port: mailConfig.port,
      secure,
      requireTLS: encryption === 'tls' || encryption === 'starttls',
      auth:
        mailConfig.username || mailConfig.password
          ? {
              user: mailConfig.username,
              pass: mailConfig.password,
            }
          : undefined,
    });
  }

  private async resolveMailConfig(): Promise<MailConfig> {
    const row = await this.prisma.appSetting.findUnique({ where: { group: 'mail' } });
    const config =
      row?.configJson && typeof row.configJson === 'object' && !Array.isArray(row.configJson)
        ? (row.configJson as Record<string, string>)
        : {};

    const driver = (config.mail_driver || 'smtp').trim().toLowerCase() || 'smtp';
    const host = (config.mail_host || '').trim();
    const port = Number(config.mail_port || 587) || 587;
    const encryption = (config.mail_encryption || '').trim().toLowerCase();
    const username = (config.mail_username || '').trim();
    const password = (config.mail_password || '').trim();
    const senderEmail =
      (config.mail_sender_email || '').trim() ||
      this.config.get<string>('MAIL_FROM') ||
      'noreply@bookingqube.com';
    const senderName =
      (config.mail_sender_name || '').trim() ||
      this.config.get<string>('MAIL_FROM_NAME') ||
      'BookingQube';

    // Prefer DB custom SMTP when enabled; otherwise allow log driver for local/dev.
    const enabled = Boolean(row?.enabled) || driver === 'log';

    return {
      enabled,
      driver,
      host,
      port,
      encryption,
      username,
      password,
      senderEmail,
      senderName,
      sendEmailOnline: isTruthyFlag(config.send_email_online, true),
      sendEmailOffline: isTruthyFlag(config.send_email_offline, true),
    };
  }

  private async getBranding() {
    const website = await this.prisma.appSetting.findUnique({ where: { group: 'website' } });

    const config =
      website?.configJson &&
      typeof website.configJson === 'object' &&
      !Array.isArray(website.configJson)
        ? (website.configJson as Record<string, string>)
        : {};

    const siteUrl =
      this.config.get<string>('APP_PUBLIC_URL')?.replace(/\/$/, '') ||
      'http://localhost:3000';

    return {
      siteName: (config.site_name || 'BookingQube').trim() || 'BookingQube',
      siteSlogan: (config.site_slogan || '').trim(),
      logoUrl: (config.logo || '').trim() || DEFAULT_LOGO,
      phone: (config.phone || '').trim(),
      siteUrl,
    };
  }

  private formatDateLabel(date: Date): string {
    return new Intl.DateTimeFormat('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(date);
  }

  private formatTimeRange(start: Date, end: Date): string {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    return `${fmt.format(start)} – ${fmt.format(end)}`;
  }

  private combineDateAndTime(date: Date, time: string): Date {
    const [hours, minutes] = time.split(':').map((part) => Number(part) || 0);
    const combined = new Date(date);
    combined.setHours(hours, minutes, 0, 0);
    return combined;
  }

  private buildCalendarUrl(input: {
    title: string;
    start: Date;
    end: Date;
    details: string;
    location: string;
  }) {
    const pad = (value: number) => String(value).padStart(2, '0');
    const toStamp = (date: Date) =>
      `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;

    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: input.title,
      dates: `${toStamp(input.start)}/${toStamp(input.end)}`,
      details: input.details,
      location: input.location,
    });
    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  }
}
