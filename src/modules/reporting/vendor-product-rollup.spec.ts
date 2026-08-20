import { OrderItemType } from '@prisma/client';

import {
  SEPARATE_ADDON_PRODUCT_ID,
  TIME_EXTENSION_PRODUCT_ID,
  buildVendorProductBuckets,
  legacyBookingSortKeysByTicketCode,
  withLegacyLineSortKeys,
} from './vendor-product-rollup';

describe('buildVendorProductBuckets', () => {
  const base = {
    id: 'a',
    itemId: 'ticket-1',
    itemType: OrderItemType.ticket_type,
    displayName: 'Pro Pass',
    quantity: 2,
    admitCount: 1,
    totalAmount: 100,
    discountAmount: 10,
    thirdPartyVendorId: 'vendor-1',
    ticketIsCafe: false,
    parentOrderItemId: null as string | null,
    createdAt: new Date('2026-01-01T10:00:00.000Z'),
  };

  it('attributes with-ticket addons to the first ticket and computes net/discount', () => {
    const rows = buildVendorProductBuckets({
      orderDiscountAmount: 0,
      items: [
        base,
        {
          ...base,
          id: 'b',
          itemId: 'ticket-2',
          displayName: 'Rookie Pass',
          totalAmount: 50,
          discountAmount: 0,
          createdAt: new Date('2026-01-01T10:00:01.000Z'),
        },
        {
          ...base,
          id: 'c',
          itemId: 'addon-1',
          itemType: OrderItemType.addon,
          displayName: 'Locker',
          quantity: 1,
          admitCount: 0,
          totalAmount: 20,
          discountAmount: 0,
        },
      ],
    });

    const pro = rows.find((r) => r.productId === 'ticket-1');
    const rookie = rows.find((r) => r.productId === 'ticket-2');
    expect(pro?.addonAmount).toBe(20);
    expect(pro?.ticketRevenue).toBe(100);
    expect(pro?.discountAmount).toBe(10);
    // Line discountAmount means totalAmount is already net — do not subtract again.
    expect(pro?.netRevenue).toBe(120);
    expect(rookie?.addonAmount).toBe(0);
    expect(rookie?.netRevenue).toBe(50);
  });

  it('subtracts order-level promo from ticket net revenue', () => {
    const rows = buildVendorProductBuckets({
      orderDiscountAmount: 29.5,
      items: [
        {
          ...base,
          discountAmount: 0,
          totalAmount: 150,
          displayName: 'Adult Pass',
          itemId: 'adult',
        },
        {
          ...base,
          id: 'b',
          itemId: 'vip',
          displayName: 'VIP Pass',
          totalAmount: 100,
          discountAmount: 0,
          createdAt: new Date('2026-01-01T10:00:01.000Z'),
        },
        {
          ...base,
          id: 'c',
          itemId: 'child',
          displayName: 'Child Pass',
          totalAmount: 45,
          discountAmount: 0,
          createdAt: new Date('2026-01-01T10:00:02.000Z'),
        },
        {
          ...base,
          id: 'd',
          itemId: 'addon-1',
          itemType: OrderItemType.addon,
          displayName: 'Locker',
          quantity: 1,
          admitCount: 0,
          totalAmount: 50,
          discountAmount: 0,
        },
      ],
    });

    const adult = rows.find((r) => r.productId === 'adult');
    const vip = rows.find((r) => r.productId === 'vip');
    const child = rows.find((r) => r.productId === 'child');
    expect(adult?.discountAmount).toBe(29.5);
    expect(adult?.addonAmount).toBe(50);
    expect(adult?.ticketRevenue).toBe(150);
    expect(adult?.netRevenue).toBe(170.5); // 150 + 50 - 29.5
    expect(vip?.netRevenue).toBe(100);
    expect(child?.netRevenue).toBe(45);
    const netSum = rows.reduce((s, r) => s + r.netRevenue, 0);
    expect(netSum).toBe(315.5);
  });

  it('creates separate addon and time extension rows', () => {
    const rows = buildVendorProductBuckets({
      orderDiscountAmount: 0,
      items: [
        {
          ...base,
          id: 'a1',
          itemId: 'addon-x',
          itemType: OrderItemType.addon,
          displayName: 'Merch',
          admitCount: 0,
          totalAmount: 35,
          discountAmount: 0,
        },
        {
          ...base,
          id: 't1',
          itemId: 'te-x',
          itemType: OrderItemType.customization,
          displayName: 'Time Extension',
          admitCount: 0,
          totalAmount: 15,
          discountAmount: 0,
          parentOrderItemId: null,
        },
      ],
    });

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          productKind: 'separate_addon',
          productId: SEPARATE_ADDON_PRODUCT_ID,
          addonAmount: 35,
          netRevenue: 35,
        }),
        expect.objectContaining({
          productKind: 'time_extension',
          productId: TIME_EXTENSION_PRODUCT_ID,
          timeExtensionAmount: 15,
          netRevenue: 15,
        }),
      ]),
    );
  });

  it('attributes parent-linked customizations as time extensions on the ticket', () => {
    const rows = buildVendorProductBuckets({
      orderDiscountAmount: 0,
      items: [
        base,
        {
          ...base,
          id: 'te-child',
          itemId: 'te-opt',
          itemType: OrderItemType.customization,
          displayName: 'Extra 15 Mins',
          admitCount: 0,
          totalAmount: 25,
          discountAmount: 0,
          parentOrderItemId: 'a',
        },
      ],
    });
    const pro = rows.find((r) => r.productId === 'ticket-1');
    expect(pro?.addonAmount).toBe(0);
    expect(pro?.timeExtensionAmount).toBe(25);
    expect(pro?.netRevenue).toBe(125);
  });

  it('uses legacy lineSortKey over identical createdAt / UUID order', () => {
    const sameTime = new Date('2026-01-01T10:00:00.000Z');
    const rows = buildVendorProductBuckets({
      orderDiscountAmount: 0,
      items: withLegacyLineSortKeys(
        [
          {
            ...base,
            // UUID that would sort BEFORE City if we only used id
            id: '00000000-0000-4000-8000-000000000002',
            itemId: 'companion',
            displayName: 'Companion',
            totalAmount: 25,
            discountAmount: 0,
            createdAt: sameTime,
            ticketCode: 'comp-order-no',
          },
          {
            ...base,
            id: 'ffffffff-0000-4000-8000-000000000001',
            itemId: 'city',
            displayName: 'City Pass',
            totalAmount: 100,
            discountAmount: 0,
            createdAt: sameTime,
            ticketCode: 'city-order-no',
          },
          {
            ...base,
            id: 'addon',
            itemId: 'addon-1',
            itemType: OrderItemType.addon,
            displayName: 'Locker',
            quantity: 1,
            admitCount: 0,
            totalAmount: 15,
            discountAmount: 0,
            createdAt: sameTime,
          },
        ],
        {
          legacy: {
            booking_lines: [
              { booking_id: 100, order_number: 'city-order-no', ticket_title: 'City Pass' },
              { booking_id: 101, order_number: 'comp-order-no', ticket_title: 'Companion' },
            ],
          },
        },
      ),
    });

    const city = rows.find((r) => r.productId === 'city');
    const companion = rows.find((r) => r.productId === 'companion');
    expect(city?.addonAmount).toBe(15);
    expect(companion?.addonAmount).toBe(0);
  });

  it('excludes zero-net ticket qty/admits but still attributes addons when first', () => {
    const rows = buildVendorProductBuckets({
      orderDiscountAmount: 0,
      items: [
        {
          ...base,
          id: 'free',
          itemId: 'virgin-city',
          displayName: 'Virgin City Pass',
          quantity: 2,
          admitCount: 1,
          totalAmount: 0,
          discountAmount: 0,
          lineSortKey: 1,
        },
        {
          ...base,
          id: 'paid',
          itemId: 'city',
          displayName: 'City Pass',
          totalAmount: 100,
          discountAmount: 0,
          lineSortKey: 2,
          createdAt: new Date('2026-01-01T10:00:01.000Z'),
        },
        {
          ...base,
          id: 'addon',
          itemId: 'addon-1',
          itemType: OrderItemType.addon,
          displayName: 'Locker',
          quantity: 1,
          admitCount: 0,
          totalAmount: 30,
          discountAmount: 0,
        },
      ],
    });

    const virgin = rows.find((r) => r.productId === 'virgin-city');
    expect(virgin?.ticketQty).toBe(0);
    expect(virgin?.admitCount).toBe(0);
    expect(virgin?.addonAmount).toBe(30);
    expect(virgin?.netRevenue).toBe(30);
  });

  it('uses legacyFirstAddonAmount instead of summing addon lines', () => {
    const rows = buildVendorProductBuckets({
      orderDiscountAmount: 0,
      legacyFirstAddonAmount: 40,
      items: [
        base,
        {
          ...base,
          id: 'c',
          itemId: 'addon-1',
          itemType: OrderItemType.addon,
          displayName: 'Locker',
          quantity: 1,
          admitCount: 0,
          totalAmount: 55,
          discountAmount: 0,
        },
      ],
    });
    const pro = rows.find((r) => r.productId === 'ticket-1');
    expect(pro?.addonAmount).toBe(40);
    expect(pro?.netRevenue).toBe(140);
  });

  it('does not invent Separate Addons when cart has event-owner tickets', () => {
    const rows = buildVendorProductBuckets({
      orderDiscountAmount: 0,
      items: [
        {
          ...base,
          thirdPartyVendorId: null,
          displayName: 'Adult Pass',
          itemId: 'adult',
        },
        {
          ...base,
          id: 'addon',
          itemId: 'meal',
          itemType: OrderItemType.addon,
          displayName: 'Meal Combo',
          admitCount: 0,
          totalAmount: 50,
          discountAmount: 0,
          thirdPartyVendorId: 'vendor-shareholder',
        },
      ],
    });
    expect(rows).toHaveLength(0);
  });
});

describe('legacyBookingSortKeysByTicketCode', () => {
  it('maps order_number to booking_id', () => {
    const map = legacyBookingSortKeysByTicketCode({
      legacy: {
        booking_lines: [
          { booking_id: 42, order_number: 'abc' },
          { booking_id: '43', order_number: 99 },
        ],
      },
    });
    expect(map.get('abc')).toBe(42);
    expect(map.get('99')).toBe(43);
  });
});
