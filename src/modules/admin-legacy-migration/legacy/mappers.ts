import {
  AttendanceStatus,
  PaymentLegType,
  ReportPaymentMode,
  VisitorType,
} from '@prisma/client';

export function money3(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  return (Math.round((n + Number.EPSILON) * 1000) / 1000).toFixed(3);
}

export function normalizeTitle(value: string | null | undefined): string {
  return (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function slugify(value: string): string {
  const base = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return base || `legacy-event-${Date.now()}`;
}

export function formatDisplayTime(time: string | null | undefined): string {
  if (!time) return 'All Day';
  // MySQL TIME often comes as HH:MM:SS
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(time).trim());
  if (!m) return String(time).trim() || 'All Day';
  let hour = Number(m[1]);
  const minute = m[2];
  const ampm = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12;
  if (hour === 0) hour = 12;
  return `${hour}:${minute} ${ampm}`;
}

/**
 * Calendar day in Asia/Qatar for legacy MySQL DATE/DATETIME values.
 * MySQL midnight Qatar is often returned as previous-day 21:00/18:30 UTC —
 * naive `.slice(0, 10)` on a JS Date shifts bookings one day earlier.
 * With dateStrings:true, DATE/DATETIME come as `YYYY-MM-DD` / `YYYY-MM-DD HH:MM:SS`
 * (already local calendar days) — take the date prefix without reinterpreting TZ.
 */
export function legacyDateOnlyQatar(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Qatar',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(value);
  }
  const raw = String(value).trim();
  // MySQL DATE or DATETIME string — calendar day is already correct.
  const mysqlDay = /^(\d{4}-\d{2}-\d{2})(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/.exec(raw);
  if (mysqlDay) return mysqlDay[1];
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw.slice(0, 10) || null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Qatar',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function parseDateOnly(value: string | Date | null | undefined): Date | null {
  const s = legacyDateOnlyQatar(value);
  if (!s) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Line discount from legacy bookings (promo reward + bulk, else price×qty − net). */
export function legacyLineDiscount(row: {
  price?: number | string | null;
  quantity?: number | string | null;
  net_price?: number | string | null;
  promocode_reward?: number | string | null;
  bulk_discount?: number | string | null;
}): number {
  const reward = Number(row.promocode_reward ?? 0);
  const bulk = Number(row.bulk_discount ?? 0);
  if (reward > 0 || bulk > 0) {
    return Math.max(0, Math.round((reward + bulk + Number.EPSILON) * 1000) / 1000);
  }
  const qty = Number(row.quantity ?? 1) || 1;
  const gross = Number(row.price ?? 0) * qty;
  const net = Number(row.net_price ?? 0);
  return Math.max(0, Math.round((gross - net + Number.EPSILON) * 1000) / 1000);
}

export function classifyVisitorType(row: {
  net_price: number | string | null;
  promocode_id: number | null;
  free_booking_type: string | null;
  booked_via: string | null;
  is_pos_only?: number | boolean | null;
  only_for_third_party?: number | boolean | null;
}): VisitorType {
  if (row.only_for_third_party) return VisitorType.third_party;
  if (row.is_pos_only) return VisitorType.pos_only;
  const net = Number(row.net_price ?? 0);
  const freeType = (row.free_booking_type || '').toLowerCase();
  if (freeType === 'special_need') return VisitorType.special_need;
  if (net <= 0 && row.promocode_id) return VisitorType.comp_promo;
  if (net <= 0) return VisitorType.comp;
  if (row.promocode_id) return VisitorType.promocode;
  return VisitorType.paid;
}

export function classifyPaymentMode(input: {
  payment_type: string | null;
  payment_cash_card: string | null;
  net_total: number;
  has_split?: boolean;
}): { mode: ReportPaymentMode; label: string } {
  if (input.net_total <= 0) {
    return { mode: ReportPaymentMode.comp, label: 'Comp' };
  }
  if (input.has_split) {
    return { mode: ReportPaymentMode.split, label: 'Split' };
  }
  const type = (input.payment_type || 'online').toLowerCase();
  if (type === 'offline') {
    const tender = (input.payment_cash_card || 'cash').toLowerCase();
    if (tender === 'card') {
      return { mode: ReportPaymentMode.offline_card, label: 'Card' };
    }
    return { mode: ReportPaymentMode.offline_cash, label: 'Cash' };
  }
  return { mode: ReportPaymentMode.online, label: 'Online' };
}

/** Separate addons use booking_type ONLINE/OFFLINE + payment_type cash/card. */
export function classifyAddonPaymentMode(input: {
  booking_type: string | null;
  payment_type: string | null;
  net_total: number;
}): { mode: ReportPaymentMode; label: string } {
  if (input.net_total <= 0) {
    return { mode: ReportPaymentMode.comp, label: 'Comp' };
  }
  const bookingType = (input.booking_type || 'OFFLINE').toUpperCase();
  if (bookingType === 'ONLINE') {
    return { mode: ReportPaymentMode.online, label: 'Online' };
  }
  const tender = (input.payment_type || 'cash').toLowerCase();
  if (tender === 'card') {
    return { mode: ReportPaymentMode.offline_card, label: 'Card' };
  }
  return { mode: ReportPaymentMode.offline_cash, label: 'Cash' };
}

/** Map legacy e3_bookings.payment_srouce (typo column) to report payment mode. */
export function classifyE3PaymentMode(
  paymentSrouce: string | null,
  netTotal: number,
): { mode: ReportPaymentMode; label: string } {
  if (netTotal <= 0) {
    return { mode: ReportPaymentMode.comp, label: 'Comp' };
  }
  const raw = (paymentSrouce || '').toLowerCase().trim();
  if (!raw) return { mode: ReportPaymentMode.offline_cash, label: 'Cash' };
  if (raw.includes('card') || raw.includes('credit') || raw.includes('debit')) {
    return { mode: ReportPaymentMode.offline_card, label: 'Card' };
  }
  if (raw.includes('online') || raw.includes('myfatoorah') || raw.includes('gateway')) {
    return { mode: ReportPaymentMode.online, label: 'Online' };
  }
  if (raw.includes('cash')) {
    return { mode: ReportPaymentMode.offline_cash, label: 'Cash' };
  }
  return { mode: ReportPaymentMode.offline_cash, label: paymentSrouce || 'Cash' };
}

/** Map time_extension_purchases.payment_method to report payment mode. */
export function classifyTimeExtensionPaymentMode(
  paymentMethod: string | null,
  netTotal: number,
): { mode: ReportPaymentMode; label: string } {
  return classifyE3PaymentMode(paymentMethod, netTotal);
}

export function cafePaymentLegs(
  totalCash: number,
  totalCard: number,
  totalSales: number,
): {
  mode: ReportPaymentMode;
  label: string;
  cashAmount: number;
  cardAmount: number;
  legs: Array<{ legType: PaymentLegType; methodKey: string; amount: number }>;
} {
  const cash = Math.max(0, Number(totalCash || 0));
  const card = Math.max(0, Number(totalCard || 0));
  const total = Math.max(0, Number(totalSales || 0));
  if (total <= 0) {
    return {
      mode: ReportPaymentMode.comp,
      label: 'Comp',
      cashAmount: 0,
      cardAmount: 0,
      legs: [{ legType: PaymentLegType.comp, methodKey: 'comp', amount: 0 }],
    };
  }
  if (cash > 0 && card > 0) {
    return {
      mode: ReportPaymentMode.split,
      label: 'Split',
      cashAmount: cash,
      cardAmount: card,
      legs: [
        { legType: PaymentLegType.cash, methodKey: 'cash', amount: cash },
        { legType: PaymentLegType.card, methodKey: 'card', amount: card },
      ],
    };
  }
  if (card > 0 || (cash <= 0 && card <= 0 && total > 0)) {
    // Prefer card if only card, or fall back to cash for unlabeled remainder
    if (card > 0) {
      return {
        mode: ReportPaymentMode.offline_card,
        label: 'Card',
        cashAmount: 0,
        cardAmount: card || total,
        legs: [{ legType: PaymentLegType.card, methodKey: 'card', amount: card || total }],
      };
    }
  }
  return {
    mode: ReportPaymentMode.offline_cash,
    label: 'Cash',
    cashAmount: cash || total,
    cardAmount: 0,
    legs: [{ legType: PaymentLegType.cash, methodKey: 'cash', amount: cash || total }],
  };
}

export function paymentLegsForMode(
  mode: ReportPaymentMode,
  total: number,
): Array<{ legType: PaymentLegType; methodKey: string; amount: number }> {
  if (total <= 0 || mode === ReportPaymentMode.comp || mode === ReportPaymentMode.free) {
    return [{ legType: PaymentLegType.comp, methodKey: 'comp', amount: 0 }];
  }
  if (mode === ReportPaymentMode.offline_cash) {
    return [{ legType: PaymentLegType.cash, methodKey: 'cash', amount: total }];
  }
  if (mode === ReportPaymentMode.offline_card) {
    return [{ legType: PaymentLegType.card, methodKey: 'card', amount: total }];
  }
  if (mode === ReportPaymentMode.split) {
    const half = Math.round((total / 2) * 1000) / 1000;
    const rest = Math.round((total - half) * 1000) / 1000;
    return [
      { legType: PaymentLegType.cash, methodKey: 'cash', amount: half },
      { legType: PaymentLegType.card, methodKey: 'card', amount: rest },
    ];
  }
  return [
    {
      legType: PaymentLegType.online_gateway,
      methodKey: 'online',
      amount: total,
    },
  ];
}

export function attendanceFromCheckedIn(checkedIn: number | boolean | null | undefined): AttendanceStatus {
  return checkedIn ? AttendanceStatus.checked_in : AttendanceStatus.not_checked_in;
}

export function guestEmail(seed: string): string {
  const clean = seed.replace(/[^a-zA-Z0-9]/g, '').slice(-20) || 'guest';
  return `legacy-guest-${clean}@bookingqube.local`;
}

export function safeEmail(email: string | null | undefined, fallbackSeed: string): string {
  const e = (email || '').trim().toLowerCase();
  if (e && e.includes('@')) return e;
  return guestEmail(fallbackSeed);
}

export function safePhone(phone: string | null | undefined): string | null {
  const p = (phone || '').trim();
  if (!p || p === '0' || p === 'null') return null;
  return p.slice(0, 32);
}
