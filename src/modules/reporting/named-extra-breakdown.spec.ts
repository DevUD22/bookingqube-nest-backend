import { OrderItemType } from '@prisma/client';

import {
  buildNamedExtraBuckets,
  buildNamedExtraRollupBuckets,
  mergeNamedExtraDailyRows,
} from './named-extra-breakdown';

describe('buildNamedExtraBuckets', () => {
  it('groups addons and time extensions by name with qty and attachment split', () => {
    const rows = buildNamedExtraBuckets([
      {
        itemId: 'addon-1',
        itemType: OrderItemType.addon,
        displayName: 'Locker',
        quantity: 2,
        totalAmount: 20,
        parentOrderItemId: null,
        orderId: 'o1',
      },
      {
        itemId: 'addon-1',
        itemType: OrderItemType.addon,
        displayName: 'Locker',
        quantity: 1,
        totalAmount: 10,
        parentOrderItemId: null,
        orderId: 'o2',
      },
      {
        itemId: 'te-1',
        itemType: OrderItemType.customization,
        displayName: '+30 min',
        quantity: 1,
        totalAmount: 15,
        parentOrderItemId: 'ticket-line',
        orderId: 'o1',
      },
      {
        itemId: 'te-legacy-random',
        itemType: OrderItemType.customization,
        displayName: '+30 min',
        quantity: 1,
        totalAmount: 15,
        parentOrderItemId: null,
        orderId: 'o3',
      },
    ]);

    expect(rows).toHaveLength(2);
    const locker = rows.find((r) => r.kind === 'addon');
    const te = rows.find((r) => r.kind === 'time_extension');
    expect(locker).toMatchObject({
      name: 'Locker',
      quantity: 3,
      order_count: 2,
      revenue: 30,
      standalone_qty: 3,
      with_ticket_qty: 0,
      product_id: 'addon-1',
    });
    expect(te).toMatchObject({
      name: '+30 min',
      quantity: 2,
      order_count: 2,
      revenue: 30,
      with_ticket_qty: 1,
      standalone_qty: 1,
    });
  });

  it('builds per-order rollup buckets for fast daily upserts', () => {
    const rows = buildNamedExtraRollupBuckets([
      {
        itemId: 'addon-1',
        itemType: OrderItemType.addon,
        displayName: 'Locker',
        quantity: 2,
        totalAmount: 20,
        parentOrderItemId: null,
        orderId: 'o1',
        thirdPartyVendorId: 'vendor-1',
      },
      {
        itemId: 'te-1',
        itemType: OrderItemType.customization,
        displayName: '+30 min',
        quantity: 1,
        totalAmount: 15,
        parentOrderItemId: 'ticket-line',
        orderId: 'o1',
        thirdPartyVendorId: 'vendor-1',
      },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.orderCount === 1)).toBe(true);
    expect(rows.find((r) => r.productKind === 'addon')?.nameKey).toBe(
      'addon|locker',
    );
  });

  it('merges daily rollup rows without rescanning order_items', () => {
    const rows = mergeNamedExtraDailyRows([
      {
        productKind: 'addon',
        productId: 'addon-1',
        productLabel: 'Locker',
        orderCount: 2,
        itemQty: 3,
        withTicketQty: 0,
        standaloneQty: 3,
        revenueTotal: 30,
      },
      {
        productKind: 'addon',
        productId: 'addon-1',
        productLabel: 'Locker',
        orderCount: 1,
        itemQty: 1,
        withTicketQty: 0,
        standaloneQty: 1,
        revenueTotal: 10,
      },
    ]);
    expect(rows).toEqual([
      expect.objectContaining({
        kind: 'addon',
        name: 'Locker',
        quantity: 4,
        order_count: 3,
        revenue: 40,
      }),
    ]);
  });

  it('ignores ticket lines', () => {
    const rows = buildNamedExtraBuckets([
      {
        itemId: 't1',
        itemType: OrderItemType.ticket_type,
        displayName: 'Adult',
        quantity: 1,
        totalAmount: 100,
        parentOrderItemId: null,
        orderId: 'o1',
      },
    ]);
    expect(rows).toEqual([]);
  });
});
