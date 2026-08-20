import { OrderItemType, ReportPaymentMode, VisitorType } from '@prisma/client';

import { OrderReportingEnricher } from './order-reporting.enricher';

describe('OrderReportingEnricher', () => {
  const enricher = new OrderReportingEnricher();

  it('splits tickets vs addons and classifies visitor types', () => {
    const lines = [
      {
        itemType: OrderItemType.ticket_type,
        quantity: 2,
        unitPrice: 50,
        lineTotal: 100,
        admitCount: 1,
      },
      {
        itemType: OrderItemType.addon,
        quantity: 1,
        unitPrice: 10,
        lineTotal: 10,
      },
      {
        itemType: OrderItemType.customization,
        quantity: 2,
        unitPrice: 5,
        lineTotal: 10,
      },
    ];
    const header = enricher.buildHeader(lines, {
      organizationId: 'org',
      eventSlug: 'evt',
      eventTitle: 'Event',
      isSummerCamp: false,
      customerName: 'A',
      customerEmail: 'a@b.c',
      source: 'web',
      hasPromo: true,
      isPaid: true,
    });
    expect(header.ticketsNet).toBe(100);
    expect(header.addonsNet).toBe(10);
    expect(header.extensionsNet).toBe(10);
    expect(header.totalQuantity).toBe(2);
    expect(header.totalAdmits).toBe(2);
    expect(header.paymentMode).toBe(ReportPaymentMode.online);

    const line = enricher.classifyLine(lines[0], { hasPromo: true, source: 'web' });
    expect(line.visitorType).toBe(VisitorType.promocode);
  });

  it('maps explicit POS offline payment modes', () => {
    const lines = [
      {
        itemType: OrderItemType.ticket_type,
        quantity: 1,
        unitPrice: 50,
        lineTotal: 50,
      },
    ];
    const cash = enricher.buildHeader(lines, {
      organizationId: 'org',
      eventSlug: 'evt',
      eventTitle: 'Event',
      isSummerCamp: false,
      customerName: 'A',
      customerEmail: 'a@b.c',
      source: 'pos',
      hasPromo: false,
      isPaid: true,
      offlinePaymentMode: 'card',
    });
    expect(cash.paymentMode).toBe(ReportPaymentMode.offline_card);
    expect(cash.paymentMethodLabel).toBe('Card');

    const split = enricher.buildHeader(lines, {
      organizationId: 'org',
      eventSlug: 'evt',
      eventTitle: 'Event',
      isSummerCamp: false,
      customerName: 'A',
      customerEmail: 'a@b.c',
      source: 'pos',
      hasPromo: false,
      isPaid: true,
      offlinePaymentMode: 'split',
    });
    expect(split.paymentMode).toBe(ReportPaymentMode.split);

    const advance = enricher.buildHeader(lines, {
      organizationId: 'org',
      eventSlug: 'evt',
      eventTitle: 'Event',
      isSummerCamp: false,
      customerName: 'A',
      customerEmail: 'a@b.c',
      source: 'pos',
      hasPromo: false,
      isPaid: true,
      offlinePaymentMode: 'advance',
    });
    expect(advance.paymentMode).toBe(ReportPaymentMode.advance);
  });

  it('maps online payment method ids to MyFatoorah / QPay / MPGS labels', () => {
    const lines = [
      {
        itemType: OrderItemType.ticket_type,
        quantity: 1,
        unitPrice: 50,
        lineTotal: 50,
      },
    ];

    const googlePay = enricher.buildHeader(lines, {
      organizationId: 'org',
      eventSlug: 'evt',
      eventTitle: 'Event',
      isSummerCamp: false,
      customerName: 'A',
      customerEmail: 'a@b.c',
      source: 'web',
      hasPromo: false,
      isPaid: true,
      paymentMethodId: 11,
    });
    expect(googlePay.paymentMode).toBe(ReportPaymentMode.online);
    expect(googlePay.paymentMethodLabel).toBe('Myfatoorah . Googlepay');

    const applePay = enricher.buildHeader(lines, {
      organizationId: 'org',
      eventSlug: 'evt',
      eventTitle: 'Event',
      isSummerCamp: false,
      customerName: 'A',
      customerEmail: 'a@b.c',
      source: 'web',
      hasPromo: false,
      isPaid: true,
      paymentMethodId: 10,
    });
    expect(applePay.paymentMethodLabel).toBe('Myfatoorah . ApplePay');

    const card = enricher.buildHeader(lines, {
      organizationId: 'org',
      eventSlug: 'evt',
      eventTitle: 'Event',
      isSummerCamp: false,
      customerName: 'A',
      customerEmail: 'a@b.c',
      source: 'web',
      hasPromo: false,
      isPaid: true,
      paymentMethodId: 12,
    });
    expect(card.paymentMethodLabel).toBe('Myfatoorah . Card');

    const qpay = enricher.buildHeader(lines, {
      organizationId: 'org',
      eventSlug: 'evt',
      eventTitle: 'Event',
      isSummerCamp: false,
      customerName: 'A',
      customerEmail: 'a@b.c',
      source: 'web',
      hasPromo: false,
      isPaid: true,
      paymentMethodId: 7,
    });
    expect(qpay.paymentMethodLabel).toBe('Qpay');
  });

  it('keeps cafe menu sales out of ticketsNet but still paid (not free)', () => {
    const lines = [
      {
        itemType: OrderItemType.cafe_item,
        quantity: 2,
        unitPrice: 12,
        lineTotal: 24,
        ticketIsCafe: true,
      },
    ];
    const header = enricher.buildHeader(lines, {
      organizationId: 'org',
      eventSlug: 'evt',
      eventTitle: 'Event',
      isSummerCamp: false,
      customerName: 'Guest',
      customerEmail: 'g@b.c',
      source: 'pos_cafe',
      hasPromo: false,
      isPaid: true,
      offlinePaymentMode: 'cash',
    });
    expect(header.ticketsNet).toBe(0);
    expect(header.totalAdmits).toBe(0);
    expect(header.totalQuantity).toBe(0);
    expect(header.paymentMode).toBe(ReportPaymentMode.offline_cash);
    expect(header.paymentMethodLabel).toBe('Cash');
  });
});
