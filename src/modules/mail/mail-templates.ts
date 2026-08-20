export type BookingPassLine = {
  name: string;
  unitPrice: number;
  quantity: number;
  total: number;
  iconBg: string;
  iconColor: string;
  iconGlyph: string;
};

export type BookingEmailTemplateData = {
  mailSubject: string;
  bookingRef: string;
  customerName: string;
  customerEmail: string;
  eventTitle: string;
  eventSlug: string;
  currency: string;
  venue: string;
  city: string;
  categoryName: string;
  posterUrl: string;
  eventDateLabel: string;
  timeLabel: string;
  orderDateLabel: string;
  passLines: BookingPassLine[];
  addonLines: BookingPassLine[];
  totalNet: number;
  downloadUrl: string;
  manageBookingUrl: string;
  helpUrl: string;
  calendarUrl: string;
  directionsUrl: string;
  logoUrl: string;
  ticketHotline: string;
  ticketHotlineHours: string;
  bookingQrCid?: string;
  skipPdfAttachments?: boolean;
};

export type RegistrationEmailTemplateData = {
  mailSubject: string;
  eventTitle: string;
  eventSlug: string;
  registrationNo: string;
  customerName: string;
  customerEmail: string;
  venue: string;
  city: string;
  categoryName: string;
  posterUrl: string;
  eventDateLabel: string;
  timeLabel: string;
  orderDateLabel: string;
  manageUrl: string;
  helpUrl: string;
  calendarUrl: string;
  directionsUrl: string;
  logoUrl: string;
  ticketHotline: string;
  ticketHotlineHours: string;
  registrationQrCid?: string;
  qrcodeUrl?: string;
};

export type UserRegisterEmailTemplateData = {
  siteName: string;
  siteSlogan: string;
  logoUrl: string;
  siteUrl: string;
  actionUrl?: string;
  password?: string;
};

export type PasswordResetOtpEmailTemplateData = {
  siteName: string;
  logoUrl: string;
  name?: string;
  otp: string;
};

export type EmailChangeOtpEmailTemplateData = {
  siteName: string;
  name?: string;
  otp: string;
  newEmail: string;
};

export type EmailChangeNoticeTemplateData = {
  siteName: string;
  name?: string;
  newEmail: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatMoney(value: number, decimals = 0): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function renderPassLines(lines: BookingPassLine[], currency: string): string {
  return lines
    .map(
      (line) => `
                                            <tr>
                                                <td style="padding:8px 0;border-top:1px solid #f3f4f6;">
                                                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                                                        <tr>
                                                            <td width="38" valign="top" style="padding-right:10px;">
                                                                <div style="width:34px;height:34px;border-radius:10px;background:${line.iconBg};color:${line.iconColor};font-size:16px;line-height:34px;text-align:center;">
                                                                    ${line.iconGlyph}
                                                                </div>
                                                            </td>
                                                            <td valign="top" style="font-family:Arial,Helvetica,sans-serif;">
                                                                <p style="margin:0;font-size:14px;line-height:20px;font-weight:700;color:#111827;">${escapeHtml(line.name)}</p>
                                                                <p style="margin:2px 0 0;font-size:12px;line-height:18px;color:#9ca3af;">${escapeHtml(currency)} ${formatMoney(line.unitPrice)} &middot; x${line.quantity}</p>
                                                            </td>
                                                            <td align="right" valign="top" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;font-weight:800;color:#111827;white-space:nowrap;">
                                                                ${escapeHtml(currency)} ${formatMoney(line.total)}
                                                            </td>
                                                        </tr>
                                                    </table>
                                                </td>
                                            </tr>`,
    )
    .join('');
}

/** Port of legacy `email_templates/v2_booking.blade.php`. */
export function renderBookingConfirmationHtml(data: BookingEmailTemplateData): string {
  const customerFirstName = escapeHtml(
    (data.customerName.trim().split(/\s+/)[0] || 'there'),
  );
  const eventTitle = escapeHtml(data.eventTitle);
  const locationLine = [data.venue, data.city].filter(Boolean).join(', ');
  const eventMetaSuffix = locationLine ? ` · ${escapeHtml(locationLine)}` : '';
  const footerEmailSuffix = data.customerEmail
    ? ` · Sent to ${escapeHtml(data.customerEmail)}`
    : '';
  const passCount = data.passLines.reduce((sum, line) => sum + line.quantity, 0);
  const addonCount = data.addonLines.reduce((sum, line) => sum + line.quantity, 0);
  const passCountLabel = passCount === 1 ? 'pass' : 'passes';
  const addonCountLabel = addonCount === 1 ? 'add-on' : 'add-ons';
  const ticketVerbLabel = passCount === 1 ? 'ticket is' : 'tickets are';
  const eventInitials = escapeHtml(
    (data.eventTitle || 'EV').slice(0, 2).toUpperCase(),
  );
  const showPoster = Boolean(data.posterUrl);
  const showCategory = Boolean(data.categoryName);
  const showQrImage = Boolean(data.bookingQrCid);
  const showTicketStub = Boolean(data.bookingRef);
  const showAddons = addonCount > 0;
  const showAttachmentNotice = !data.skipPdfAttachments;
  const heroAttachmentNote = data.skipPdfAttachments
    ? '.'
    : ' — and attached as a printable PDF.';
  const attachmentNoticeText = showAttachmentNotice
    ? `Your <strong>${passCount} ${ticketVerbLabel}</strong> ready to download as a printable PDF — use the button below. Each pass has its own scannable code.`
    : '';

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="x-apple-disable-message-reformatting">
    <title>${escapeHtml(data.mailSubject)}</title>
    <style>
        table, td { border-collapse: collapse; mso-table-lspace: 0; mso-table-rspace: 0; }
        img { border: 0; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; }
        a { text-decoration: none; }
        @media screen and (max-width: 620px) {
            .stack { display: block !important; width: 100% !important; max-width: 100% !important; }
            .hero-pad { padding-left: 20px !important; padding-right: 20px !important; }
            .btn-pair td { display: block !important; width: 100% !important; padding-bottom: 10px !important; }
        }
    </style>
</head>
<body style="margin:0;padding:0;background-color:#f4f3f7;word-spacing:normal;">
<div role="article" aria-roledescription="email" lang="en" style="background-color:#f4f3f7;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f3f7;">
        <tr>
            <td align="center" style="padding:24px 12px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 24px 60px rgba(24,10,55,0.10);">
                    <tr>
                        <td style="padding:20px 24px 8px 24px;font-family:Arial,Helvetica,sans-serif;">
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                                <tr>
                                    <td width="44" valign="top" style="padding-right:12px;">
                                        <img src="${escapeHtml(data.logoUrl)}" alt="Logo" height="80" style="display:block;height:80px;border-radius:999px;object-fit:contain;">
                                    </td>
                                    <td valign="top" style="font-family:Arial,Helvetica,sans-serif;">
                                        <p style="margin:0;font-size:14px;line-height:20px;font-weight:700;color:#111827;">BookingQube Tickets</p>
                                        <p style="margin:2px 0 0;font-size:12px;line-height:18px;color:#9ca3af;">tickets@bookingqube.com</p>
                                    </td>
                                </tr>
                            </table>
                            <h1 style="margin:18px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:22px;line-height:30px;font-weight:800;color:#111827;">
                                You're all set — your ${eventTitle} passes are confirmed
                            </h1>
                        </td>
                    </tr>
                    <tr>
                        <td class="hero-pad" style="padding:0 24px 20px 24px;">
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:20px;overflow:hidden;background:linear-gradient(180deg,#7c3aed 0%,#6d28d9 55%,#5b21b6 100%);">
                                <tr>
                                    <td align="center" style="padding:28px 20px 30px;font-family:Arial,Helvetica,sans-serif;color:#ffffff;">
                                        <div style="width:72px;height:72px;margin:0 auto 16px;border-radius:999px;background:rgba(255,255,255,0.14);line-height:72px;text-align:center;">
                                            <span style="display:inline-block;width:52px;height:52px;border-radius:999px;background:#34d399;color:#ffffff;font-size:28px;line-height:52px;font-weight:700;">&#10003;</span>
                                        </div>
                                        <p style="margin:0;font-size:28px;line-height:34px;font-weight:800;">You're all set!</p>
                                        <p style="margin:12px auto 0;max-width:420px;font-size:14px;line-height:22px;color:rgba(255,255,255,0.78);">
                                            Your ${eventTitle} passes are confirmed, ${customerFirstName}.
                                            Everything you need is below${heroAttachmentNote}
                                        </p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:0 24px 18px 24px;">
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #ececf1;border-radius:18px;">
                                <tr>
                                    <td style="padding:14px;">
                                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                                            <tr>
                                                <td width="56" valign="top" style="padding-right:12px;">
                                                    ${
                                                      showPoster
                                                        ? `<img src="${escapeHtml(data.posterUrl)}" alt="" width="52" height="52" style="display:block;width:52px;height:52px;border-radius:12px;object-fit:cover;">`
                                                        : `<div style="width:52px;height:52px;border-radius:12px;background:linear-gradient(135deg,#7c3aed,#d946ef);color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:800;line-height:52px;text-align:center;">${eventInitials}</div>`
                                                    }
                                                </td>
                                                <td valign="top" style="font-family:Arial,Helvetica,sans-serif;">
                                                    ${
                                                      showCategory
                                                        ? `<span style="display:inline-block;margin:0 0 6px;padding:4px 10px;border-radius:999px;background:#f3e8ff;color:#7c3aed;font-size:11px;font-weight:700;line-height:14px;">${escapeHtml(data.categoryName)}</span>`
                                                        : ''
                                                    }
                                                    <p style="margin:0;font-size:16px;line-height:22px;font-weight:800;color:#111827;">${eventTitle}</p>
                                                    <p style="margin:4px 0 0;font-size:12px;line-height:18px;color:#9ca3af;">
                                                        ${escapeHtml(data.eventDateLabel)} &middot; ${escapeHtml(data.timeLabel)}${eventMetaSuffix}
                                                    </p>
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:0 24px 18px 24px;">
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                                <tr>
                                    ${
                                      showTicketStub
                                        ? `<td class="stack" width="150" valign="top" style="padding-right:14px;">
                                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:2px dashed #e5e7eb;border-radius:18px;">
                                            <tr>
                                                <td align="center" style="padding:14px 12px;font-family:Arial,Helvetica,sans-serif;">
                                                    ${
                                                      showQrImage
                                                        ? `<img src="cid:${data.bookingQrCid}" alt="Ticket QR code" width="120" height="120" style="display:block;width:120px;height:120px;border-radius:14px;">`
                                                        : ''
                                                    }
                                                    <p style="margin:10px 0 2px;font-size:10px;line-height:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#9ca3af;">REF</p>
                                                    <p style="margin:0;font-size:11px;line-height:16px;font-weight:700;font-family:Consolas,Monaco,monospace;color:#111827;word-break:break-all;">${escapeHtml(data.bookingRef)}</p>
                                                </td>
                                            </tr>
                                        </table>
                                    </td>`
                                        : ''
                                    }
                                    <td class="stack" valign="top">
                                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                                            <tr>
                                                <td style="padding-bottom:10px;font-family:Arial,Helvetica,sans-serif;">
                                                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                                                        <tr>
                                                            <td style="font-size:11px;line-height:14px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#9ca3af;">Your passes</td>
                                                            <td align="right">
                                                                <span style="display:inline-block;padding:4px 10px;border-radius:999px;background:#f3e8ff;color:#7c3aed;font-size:11px;font-weight:700;line-height:14px;">
                                                                    ${passCount} ${passCountLabel} &middot; admit 1 each
                                                                </span>
                                                            </td>
                                                        </tr>
                                                    </table>
                                                </td>
                                            </tr>
                                            ${renderPassLines(data.passLines, data.currency)}
                                            ${
                                              showAddons
                                                ? `<tr>
                                                <td style="padding:16px 0 8px;">
                                                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                                                        <tr>
                                                            <td style="font-size:11px;line-height:14px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#9ca3af;">Your add-ons</td>
                                                            <td align="right">
                                                                <span style="display:inline-block;padding:4px 10px;border-radius:999px;background:#fce7f3;color:#db2777;font-size:11px;font-weight:700;line-height:14px;">
                                                                    ${addonCount} ${addonCountLabel}
                                                                </span>
                                                            </td>
                                                        </tr>
                                                    </table>
                                                </td>
                                            </tr>
                                            ${renderPassLines(data.addonLines, data.currency)}`
                                                : ''
                                            }
                                            <tr>
                                                <td style="padding-top:14px;border-top:1px solid #ececf1;">
                                                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                                                        <tr>
                                                            <td style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;font-weight:700;color:#374151;">Total paid</td>
                                                            <td align="right" style="font-family:Arial,Helvetica,sans-serif;font-size:24px;line-height:28px;font-weight:800;color:#7c3aed;">${escapeHtml(data.currency)} ${formatMoney(data.totalNet, 2)}</td>
                                                        </tr>
                                                    </table>
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    ${
                      showAttachmentNotice
                        ? `<tr>
                        <td style="padding:0 24px 18px 24px;">
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f3ff;border-radius:16px;">
                                <tr>
                                    <td style="padding:14px 16px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;color:#4c1d95;">
                                        <span style="font-size:16px;line-height:20px;">&#128206;</span>
                                        ${attachmentNoticeText}
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>`
                        : ''
                    }
                    <tr>
                        <td style="padding:0 24px 12px 24px;">
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                                <tr>
                                    <td align="center" style="border-radius:16px;background:linear-gradient(180deg,#8b5cf6 0%,#7c3aed 100%);box-shadow:0 10px 24px rgba(124,58,237,0.28);">
                                        <a href="${escapeHtml(data.downloadUrl)}" target="_blank" rel="noopener" style="display:block;padding:15px 18px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:20px;font-weight:800;color:#ffffff;">
                                            &#11015;&#65039;&nbsp; View &amp; download tickets
                                        </a>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:0 24px 20px 24px;">
                            <table role="presentation" class="btn-pair" width="100%" cellpadding="0" cellspacing="0">
                                <tr>
                                    <td width="50%" style="padding-right:6px;">
                                        <a href="${escapeHtml(data.calendarUrl)}" target="_blank" rel="noopener" style="display:block;padding:13px 10px;border:2px solid #e5e7eb;border-radius:16px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:18px;font-weight:700;color:#374151;text-align:center;">
                                            &#128197;&nbsp; Add to calendar
                                        </a>
                                    </td>
                                    <td width="50%" style="padding-left:6px;">
                                        <a href="${escapeHtml(data.directionsUrl)}" target="_blank" rel="noopener" style="display:block;padding:13px 10px;border:2px solid #e5e7eb;border-radius:16px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:18px;font-weight:700;color:#374151;text-align:center;">
                                            &#9992;&#65039;&nbsp; Get directions
                                        </a>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:18px 24px 24px 24px;border-top:1px solid #f3f4f6;font-family:Arial,Helvetica,sans-serif;">
                            <p style="margin:0 0 10px;font-size:13px;line-height:20px;color:#4b5563;">
                                &#128222; Need help? Ticket hotline <strong>${escapeHtml(data.ticketHotline)}</strong> &middot; ${escapeHtml(data.ticketHotlineHours)}
                            </p>
                            <p style="margin:0 0 12px;font-size:11px;line-height:18px;color:#9ca3af;">
                                Organized by ${eventTitle} &middot; Order placed ${escapeHtml(data.orderDateLabel)}${footerEmailSuffix}
                            </p>
                            <p style="margin:0;font-size:12px;line-height:18px;">
                                <a href="${escapeHtml(data.manageBookingUrl)}" style="color:#7c3aed;font-weight:700;">Manage booking</a>
                                <span style="color:#d1d5db;"> &middot; </span>
                                <a href="${escapeHtml(data.helpUrl)}" style="color:#7c3aed;font-weight:700;">Help centre</a>
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</div>
</body>
</html>`;
}

/** Port of legacy `email_templates/v2_registration_confirmation.blade.php`. */
export function renderRegistrationConfirmationHtml(
  data: RegistrationEmailTemplateData,
): string {
  const customerFirstName = escapeHtml(
    (data.customerName.trim().split(/\s+/)[0] || 'there'),
  );
  const eventTitle = escapeHtml(data.eventTitle);
  const locationLine = [data.venue, data.city].filter(Boolean).join(', ');
  const eventMetaSuffix = locationLine ? ` · ${escapeHtml(locationLine)}` : '';
  const footerEmailSuffix = data.customerEmail
    ? ` · Sent to ${escapeHtml(data.customerEmail)}`
    : '';
  const eventInitials = escapeHtml(
    (data.eventTitle || 'EV').slice(0, 2).toUpperCase(),
  );
  const showPoster = Boolean(data.posterUrl);
  const showCategory = Boolean(data.categoryName);
  const showQrImage = Boolean(data.registrationQrCid || data.qrcodeUrl);
  const showTicketStub = Boolean(data.registrationNo);
  const customerName = data.customerName.trim();

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${escapeHtml(data.mailSubject)}</title>
    <style>
        table, td { border-collapse: collapse; }
        img { border: 0; outline: none; text-decoration: none; }
        a { text-decoration: none; }
        @media screen and (max-width: 620px) {
            .stack { display: block !important; width: 100% !important; max-width: 100% !important; }
            .hero-pad { padding-left: 20px !important; padding-right: 20px !important; }
            .btn-pair td { display: block !important; width: 100% !important; padding-bottom: 10px !important; }
        }
    </style>
</head>
<body style="margin:0;padding:0;background-color:#f4f3f7;word-spacing:normal;">
<div role="article" aria-roledescription="email" lang="en" style="background-color:#f4f3f7;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f3f7;">
        <tr>
            <td align="center" style="padding:24px 12px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 24px 60px rgba(24,10,55,0.10);">
                    <tr>
                        <td style="padding:20px 24px 8px 24px;font-family:Arial,Helvetica,sans-serif;">
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                                <tr>
                                    <td width="44" valign="top" style="padding-right:12px;">
                                        <img src="${escapeHtml(data.logoUrl)}" alt="Logo" height="80" style="display:block;height:80px;border-radius:999px;object-fit:contain;">
                                    </td>
                                    <td valign="top" style="font-family:Arial,Helvetica,sans-serif;">
                                        <p style="margin:0;font-size:14px;line-height:20px;font-weight:700;color:#111827;">BookingQube Tickets</p>
                                        <p style="margin:2px 0 0;font-size:12px;line-height:18px;color:#9ca3af;">tickets@bookingqube.com</p>
                                    </td>
                                </tr>
                            </table>
                            <h1 style="margin:18px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:22px;line-height:30px;font-weight:800;color:#111827;">
                                You're all set — your ${eventTitle} registration is confirmed
                            </h1>
                        </td>
                    </tr>
                    <tr>
                        <td class="hero-pad" style="padding:0 24px 20px 24px;">
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:20px;overflow:hidden;background:linear-gradient(180deg,#7c3aed 0%,#6d28d9 55%,#5b21b6 100%);">
                                <tr>
                                    <td align="center" style="padding:28px 20px 30px;font-family:Arial,Helvetica,sans-serif;color:#ffffff;">
                                        <div style="width:72px;height:72px;margin:0 auto 16px;border-radius:999px;background:rgba(255,255,255,0.14);line-height:72px;text-align:center;">
                                            <span style="display:inline-block;width:52px;height:52px;border-radius:999px;background:#34d399;color:#ffffff;font-size:28px;line-height:52px;font-weight:700;">&#10003;</span>
                                        </div>
                                        <p style="margin:0;font-size:28px;line-height:34px;font-weight:800;">You're all set!</p>
                                        <p style="margin:12px auto 0;max-width:420px;font-size:14px;line-height:22px;color:rgba(255,255,255,0.78);">
                                            Your ${eventTitle} registration is confirmed, ${customerFirstName}.
                                            Keep this email handy — your QR code is below.
                                        </p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:0 24px 18px 24px;">
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #ececf1;border-radius:18px;">
                                <tr>
                                    <td style="padding:14px;">
                                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                                            <tr>
                                                <td width="56" valign="top" style="padding-right:12px;">
                                                    ${
                                                      showPoster
                                                        ? `<img src="${escapeHtml(data.posterUrl)}" alt="" width="52" height="52" style="display:block;width:52px;height:52px;border-radius:12px;object-fit:cover;">`
                                                        : `<div style="width:52px;height:52px;border-radius:12px;background:linear-gradient(135deg,#7c3aed,#d946ef);color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:800;line-height:52px;text-align:center;">${eventInitials}</div>`
                                                    }
                                                </td>
                                                <td valign="top" style="font-family:Arial,Helvetica,sans-serif;">
                                                    ${
                                                      showCategory
                                                        ? `<span style="display:inline-block;margin:0 0 6px;padding:4px 10px;border-radius:999px;background:#f3e8ff;color:#7c3aed;font-size:11px;font-weight:700;line-height:14px;">${escapeHtml(data.categoryName)}</span>`
                                                        : ''
                                                    }
                                                    <p style="margin:0;font-size:16px;line-height:22px;font-weight:800;color:#111827;">${eventTitle}</p>
                                                    <p style="margin:4px 0 0;font-size:12px;line-height:18px;color:#9ca3af;">
                                                        ${escapeHtml(data.eventDateLabel)} &middot; ${escapeHtml(data.timeLabel)}${eventMetaSuffix}
                                                    </p>
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:0 24px 18px 24px;">
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                                <tr>
                                    ${
                                      showTicketStub
                                        ? `<td class="stack" width="150" valign="top" style="padding-right:14px;">
                                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:2px dashed #e5e7eb;border-radius:18px;">
                                            <tr>
                                                <td align="center" style="padding:14px 12px;font-family:Arial,Helvetica,sans-serif;">
                                                    ${
                                                      data.registrationQrCid
                                                        ? `<img src="cid:${data.registrationQrCid}" alt="Registration QR code" width="120" height="120" style="display:block;width:120px;height:120px;border-radius:14px;">`
                                                        : data.qrcodeUrl
                                                          ? `<img src="${escapeHtml(data.qrcodeUrl)}" alt="Registration QR code" width="120" height="120" style="display:block;width:120px;height:120px;border-radius:14px;">`
                                                          : ''
                                                    }
                                                    <p style="margin:10px 0 2px;font-size:10px;line-height:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#9ca3af;">REF</p>
                                                    <p style="margin:0;font-size:11px;line-height:16px;font-weight:700;font-family:Consolas,Monaco,monospace;color:#111827;word-break:break-all;">${escapeHtml(data.registrationNo)}</p>
                                                </td>
                                            </tr>
                                        </table>
                                    </td>`
                                        : ''
                                    }
                                    <td class="stack" valign="top">
                                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                                            <tr>
                                                <td style="padding-bottom:10px;font-family:Arial,Helvetica,sans-serif;">
                                                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                                                        <tr>
                                                            <td style="font-size:11px;line-height:14px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#9ca3af;">Your registration</td>
                                                            <td align="right">
                                                                <span style="display:inline-block;padding:4px 10px;border-radius:999px;background:#f3e8ff;color:#7c3aed;font-size:11px;font-weight:700;line-height:14px;">
                                                                    Confirmed
                                                                </span>
                                                            </td>
                                                        </tr>
                                                    </table>
                                                </td>
                                            </tr>
                                            <tr>
                                                <td style="padding:8px 0;border-top:1px solid #f3f4f6;">
                                                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                                                        <tr>
                                                            <td width="38" valign="top" style="padding-right:10px;">
                                                                <div style="width:34px;height:34px;border-radius:10px;background:#ede9fe;color:#7c3aed;font-size:16px;line-height:34px;text-align:center;">&#128221;</div>
                                                            </td>
                                                            <td valign="top" style="font-family:Arial,Helvetica,sans-serif;">
                                                                <p style="margin:0;font-size:14px;line-height:20px;font-weight:700;color:#111827;">Registration pass</p>
                                                                <p style="margin:2px 0 0;font-size:12px;line-height:18px;color:#9ca3af;">Show this QR at check-in</p>
                                                            </td>
                                                            <td align="right" valign="top" style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:20px;font-weight:700;color:#7c3aed;white-space:nowrap;">Free</td>
                                                        </tr>
                                                    </table>
                                                </td>
                                            </tr>
                                            ${
                                              customerName
                                                ? `<tr>
                                                <td style="padding:8px 0;border-top:1px solid #f3f4f6;">
                                                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                                                        <tr>
                                                            <td width="38" valign="top" style="padding-right:10px;">
                                                                <div style="width:34px;height:34px;border-radius:10px;background:#dbeafe;color:#2563eb;font-size:16px;line-height:34px;text-align:center;">&#128100;</div>
                                                            </td>
                                                            <td valign="top" style="font-family:Arial,Helvetica,sans-serif;">
                                                                <p style="margin:0;font-size:14px;line-height:20px;font-weight:700;color:#111827;">${escapeHtml(customerName)}</p>
                                                                <p style="margin:2px 0 0;font-size:12px;line-height:18px;color:#9ca3af;">Registered guest</p>
                                                            </td>
                                                        </tr>
                                                    </table>
                                                </td>
                                            </tr>`
                                                : ''
                                            }
                                            <tr>
                                                <td style="padding-top:14px;border-top:1px solid #ececf1;">
                                                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                                                        <tr>
                                                            <td style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;font-weight:700;color:#374151;">Status</td>
                                                            <td align="right" style="font-family:Arial,Helvetica,sans-serif;font-size:18px;line-height:24px;font-weight:800;color:#7c3aed;">Confirmed</td>
                                                        </tr>
                                                    </table>
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:0 24px 18px 24px;">
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f3ff;border-radius:16px;">
                                <tr>
                                    <td style="padding:14px 16px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;color:#4c1d95;">
                                        <span style="font-size:16px;line-height:20px;">&#128241;</span>
                                        Your <strong>registration QR</strong> is ready — save this email or screenshot the code above for check-in.
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:0 24px 20px 24px;">
                            <table role="presentation" class="btn-pair" width="100%" cellpadding="0" cellspacing="0">
                                <tr>
                                    <td width="50%" style="padding-right:6px;">
                                        <a href="${escapeHtml(data.calendarUrl)}" target="_blank" rel="noopener" style="display:block;padding:13px 10px;border:2px solid #e5e7eb;border-radius:16px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:18px;font-weight:700;color:#374151;text-align:center;">
                                            &#128197;&nbsp; Add to calendar
                                        </a>
                                    </td>
                                    <td width="50%" style="padding-left:6px;">
                                        <a href="${escapeHtml(data.directionsUrl)}" target="_blank" rel="noopener" style="display:block;padding:13px 10px;border:2px solid #e5e7eb;border-radius:16px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:18px;font-weight:700;color:#374151;text-align:center;">
                                            &#9992;&#65039;&nbsp; Get directions
                                        </a>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:18px 24px 24px 24px;border-top:1px solid #f3f4f6;font-family:Arial,Helvetica,sans-serif;">
                            <p style="margin:0 0 10px;font-size:13px;line-height:20px;color:#4b5563;">
                                &#128222; Need help? Ticket hotline <strong>${escapeHtml(data.ticketHotline)}</strong> &middot; ${escapeHtml(data.ticketHotlineHours)}
                            </p>
                            <p style="margin:0 0 12px;font-size:11px;line-height:18px;color:#9ca3af;">
                                Organized by ${eventTitle} &middot; Registered ${escapeHtml(data.orderDateLabel)}${footerEmailSuffix}
                            </p>
                            <p style="margin:0;font-size:12px;line-height:18px;">
                                <a href="${escapeHtml(data.manageUrl)}" style="color:#7c3aed;font-weight:700;">View event</a>
                                <span style="color:#d1d5db;"> &middot; </span>
                                <a href="${escapeHtml(data.helpUrl)}" style="color:#7c3aed;font-weight:700;">Help centre</a>
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</div>
</body>
</html>`;
}

/** Port of legacy `email_templates/register.blade.php`. */
export function renderUserRegisterHtml(data: UserRegisterEmailTemplateData): string {
  const siteName = escapeHtml(data.siteName || 'BookingQube');
  const year = new Date().getFullYear();

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Welcome to ${siteName}</title>
    <style>
        table, td, div, h1, p { font-family: Arial, sans-serif; }
        a { text-decoration: none; color: #00bcd4; }
    </style>
</head>
<body style="margin:0;padding:0;word-spacing:normal;background-color:#efefef;">
    <div role="article" aria-roledescription="email" lang="en" style="background-color:#efefef;">
        <table role="presentation" style="width:100%;border:none;border-spacing:0;">
            <tr>
                <td align="center" style="padding:0;">
                    <table role="presentation" style="width:94%;max-width:600px;border:none;border-spacing:0;text-align:center;font-family:Arial,sans-serif;font-size:16px;line-height:22px;color:#363636;">
                        <tr>
                            <td style="padding:40px 30px 30px 30px;text-align:center;font-size:24px;font-weight:bold;">
                                <a href="${escapeHtml(data.siteUrl)}" style="text-decoration:none;">
                                    ${
                                      data.logoUrl
                                        ? `<img src="${escapeHtml(data.logoUrl)}" width="80" alt="Logo" style="width:88px;max-width:80%;height:auto;border:none;text-decoration:none;color:#ffffff;">`
                                        : ''
                                    }
                                    <h3 style="margin-top:8px;margin-bottom:0px;font-size:26px;font-weight:bold;color:#000;text-align:center;">${siteName}</h3>
                                    ${
                                      data.siteSlogan
                                        ? `<h5 style="margin-top:6px;margin-bottom:8px;font-size:20px;font-weight:normal;color:#222;text-align:center;">${escapeHtml(data.siteSlogan)}</h5>`
                                        : ''
                                    }
                                </a>
                            </td>
                        </tr>
                        <tr>
                            <td style="padding:30px;background-color:#ffffff;">
                                <h1 style="margin-top:0;margin-bottom:16px;font-size:26px;line-height:32px;font-weight:bold;letter-spacing:-0.02em;">Thank you for registering!</h1>
                                <p style="margin:0;">You can now start purchasing tickets and managing your bookings.</p>
                            </td>
                        </tr>
                        <tr>
                            <td style="padding:15px 30px 11px 30px;font-size:0;background-color:#ffffff;border-bottom:1px solid #f0f0f5;">
                                ${
                                  data.actionUrl
                                    ? `<div style="display:inline-block;width:100%;vertical-align:top;padding-bottom:20px;font-family:Arial,sans-serif;font-size:16px;line-height:22px;color:#363636;">
                                    <p style="margin:0;"><a href="${escapeHtml(data.actionUrl)}" style="background:#222;text-decoration:none;padding:10px 25px;color:#ffffff;border-radius:4px;display:inline-block;"><span style="font-weight:bold;">Verify email</span></a></p>
                                </div>`
                                    : ''
                                }
                                ${
                                  data.password
                                    ? `<div style="display:inline-block;width:100%;vertical-align:top;padding-bottom:20px;font-family:Arial,sans-serif;font-size:16px;line-height:22px;color:#363636;">
                                    <p style="margin:0;background:#222;text-decoration:none;padding:10px 25px;color:#ffffff;border-radius:4px;display:inline-block;"><span style="font-weight:bold;">Your password: ${escapeHtml(data.password)}</span></p>
                                </div>`
                                    : ''
                                }
                            </td>
                        </tr>
                        <tr>
                            <td style="padding:30px;text-align:center;font-size:16px;background-color:#222;color:#cccccc;">
                                <p style="margin:0;font-size:16px;line-height:30px;text-align:center;"><span>©</span> ${year}
                                    <a style="color:#fff;text-decoration:underline;" href="${escapeHtml(data.siteUrl)}">${siteName}</a>
                                </p>
                            </td>
                        </tr>
                    </table>
                </td>
            </tr>
        </table>
    </div>
</body>
</html>`;
}

export function renderPasswordResetOtpHtml(data: PasswordResetOtpEmailTemplateData): string {
  const siteName = escapeHtml(data.siteName || 'BookingQube');
  const greeting = escapeHtml(data.name?.trim() || 'there');
  const otp = escapeHtml(data.otp);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${siteName} password reset</title>
</head>
<body style="margin:0;padding:24px;background:#f4f4f5;font-family:Arial,sans-serif;color:#18181b;">
  <table role="presentation" style="width:100%;max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;">
    <tr><td>
      <p style="margin:0 0 16px;">Hi ${greeting},</p>
      <p style="margin:0 0 16px;">Use this ${siteName} password-reset code. It expires in 10 minutes.</p>
      <p style="margin:0 0 16px;font-size:28px;letter-spacing:8px;font-weight:700;">${otp}</p>
      <p style="margin:0;color:#71717a;font-size:13px;">If you did not request this, you can ignore this email.</p>
    </td></tr>
  </table>
</body>
</html>`;
}

export function renderEmailChangeOtpHtml(data: EmailChangeOtpEmailTemplateData): string {
  const siteName = escapeHtml(data.siteName || 'BookingQube');
  const greeting = escapeHtml(data.name?.trim() || 'there');
  const otp = escapeHtml(data.otp);
  const newEmail = escapeHtml(data.newEmail);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${siteName} email change</title>
</head>
<body style="margin:0;padding:24px;background:#f4f4f5;font-family:Arial,sans-serif;color:#18181b;">
  <table role="presentation" style="width:100%;max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;">
    <tr><td>
      <p style="margin:0 0 16px;">Hi ${greeting},</p>
      <p style="margin:0 0 16px;">Use this ${siteName} code to confirm <strong>${newEmail}</strong> as your new account email. It expires in 10 minutes.</p>
      <p style="margin:0 0 16px;font-size:28px;letter-spacing:8px;font-weight:700;">${otp}</p>
      <p style="margin:0;color:#71717a;font-size:13px;">If you did not request this, you can ignore this email. Your current login email will not change until this code is used.</p>
    </td></tr>
  </table>
</body>
</html>`;
}

export function renderEmailChangeNoticeHtml(data: EmailChangeNoticeTemplateData): string {
  const siteName = escapeHtml(data.siteName || 'BookingQube');
  const greeting = escapeHtml(data.name?.trim() || 'there');
  const newEmail = escapeHtml(data.newEmail);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${siteName} email change requested</title>
</head>
<body style="margin:0;padding:24px;background:#f4f4f5;font-family:Arial,sans-serif;color:#18181b;">
  <table role="presentation" style="width:100%;max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;">
    <tr><td>
      <p style="margin:0 0 16px;">Hi ${greeting},</p>
      <p style="margin:0 0 16px;">Someone requested changing your ${siteName} account email to <strong>${newEmail}</strong>.</p>
      <p style="margin:0;color:#71717a;font-size:13px;">If this was not you, sign in and cancel the request, then change your password. Your current email stays active until the new address is confirmed.</p>
    </td></tr>
  </table>
</body>
</html>`;
}
