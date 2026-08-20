import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type { CheckoutEventRecord } from '../catalog/catalog-cache.service';
import { CheckoutService } from './checkout.service';

describe('CheckoutService customizations', () => {
  const service = new CheckoutService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const resolveCustomizations = (
    service as unknown as {
      resolveCustomizationLines: (
        ticket: CheckoutEventRecord['ticketTypes'][number],
        line: {
          ticket_id: string;
          quantity: number;
          customization_options?: Array<{ id: string; qty: number; price?: number }>;
        },
      ) => Array<{ itemId: string; quantity: number; unitPrice: number }>;
    }
  ).resolveCustomizationLines.bind(service);

  const ticket = {
    id: 'ticket-db-id',
    externalKey: 'ticket-public-id',
    isCustomizable: true,
    customizationOptions: [
      {
        id: 'option-db-id',
        externalKey: 'paintball',
        name: 'Paintless Paintball',
        price: new Prisma.Decimal(75),
        currency: 'QAR',
        maxQtyPerTicket: 2,
        status: 'active',
      },
    ],
  } as unknown as CheckoutEventRecord['ticketTypes'][number];

  it('uses catalog identity and price instead of client-provided values', () => {
    const result = resolveCustomizations(ticket, {
      ticket_id: 'ticket-public-id',
      quantity: 1,
      customization_options: [{ id: 'paintball', qty: 2, price: 1 }],
    });

    expect(result).toEqual([
      expect.objectContaining({
        itemId: 'option-db-id',
        quantity: 2,
        unitPrice: 75,
      }),
    ]);
  });

  it('rejects an unavailable customization', () => {
    expect(() =>
      resolveCustomizations(ticket, {
        ticket_id: 'ticket-public-id',
        quantity: 1,
        customization_options: [{ id: 'unknown', qty: 1 }],
      }),
    ).toThrow(BadRequestException);
  });

  it('enforces the per-ticket customization maximum', () => {
    expect(() =>
      resolveCustomizations(ticket, {
        ticket_id: 'ticket-public-id',
        quantity: 2,
        customization_options: [{ id: 'paintball', qty: 5 }],
      }),
    ).toThrow('exceeds the maximum quantity of 4');
  });

  it('prices and attaches a time extension to its explicit eligible ticket', () => {
    const privateService = service as unknown as {
      resolveTimeExtensionLines: (
        event: CheckoutEventRecord,
        lines: Array<{ id: string; quantity: number; ticket_id?: string; unit_price?: number }>,
      ) => Array<Record<string, unknown>>;
      attachTimeExtensionsToTickets: (
        items: Array<Record<string, unknown>>,
        extensions: Array<Record<string, unknown>>,
      ) => void;
    };
    const event = {
      currency: 'QAR',
      moreOpsConfig: {
        time_extensions: [
          {
            id: 'extra-30',
            title: '+30 minutes',
            minutes: 30,
            price: 25,
            ticket_ids: ['ticket-b'],
          },
        ],
      },
    } as unknown as CheckoutEventRecord;
    const extensions = privateService.resolveTimeExtensionLines(event, [
      { id: 'extra-30', quantity: 1, ticket_id: 'ticket-b', unit_price: 1 },
    ]);
    const items = [
      { itemType: 'ticket_type', publicItemId: 'ticket-a', customizations: [] },
      { itemType: 'ticket_type', publicItemId: 'ticket-b', customizations: [] },
    ] as Array<Record<string, unknown>>;

    privateService.attachTimeExtensionsToTickets(items, extensions);

    expect(items[0].customizations).toEqual([]);
    expect(items[1].customizations).toEqual([
      expect.objectContaining({ publicOptionId: 'extra-30', unitPrice: 25 }),
    ]);
  });

  it('rejects a time extension targeted at an ineligible ticket', () => {
    const resolveTimeExtensions = (
      service as unknown as {
        resolveTimeExtensionLines: (
          event: CheckoutEventRecord,
          lines: Array<{ id: string; quantity: number; ticket_id?: string }>,
        ) => Array<Record<string, unknown>>;
      }
    ).resolveTimeExtensionLines.bind(service);
    const event = {
      currency: 'QAR',
      moreOpsConfig: {
        time_extensions: [
          {
            id: 'extra-30',
            title: '+30 minutes',
            minutes: 30,
            price: 25,
            ticket_ids: ['ticket-b'],
          },
        ],
      },
    } as unknown as CheckoutEventRecord;

    expect(() =>
      resolveTimeExtensions(event, [
        { id: 'extra-30', quantity: 1, ticket_id: 'ticket-a' },
      ]),
    ).toThrow('is not available for ticket ticket-a');
  });

  it('applies an order-scoped extension to every regular ticket and charges it once', () => {
    const privateService = service as unknown as {
      resolveTimeExtensionLines: (
        event: CheckoutEventRecord,
        lines: Array<{ id: string; quantity: number; ticket_id?: string }>,
      ) => Array<Record<string, unknown>>;
      attachTimeExtensionsToTickets: (
        items: Array<Record<string, unknown>>,
        extensions: Array<Record<string, unknown>>,
      ) => Array<Record<string, unknown>>;
    };
    const event = {
      currency: 'QAR',
      moreOpsConfig: {
        time_extensions: [
          {
            id: 'social-follow-15',
            title: 'Social Follow Bonus',
            scope: 'order',
            minutes: 15,
            price: 30,
            ticket_ids: ['ignored-for-order-scope'],
          },
        ],
      },
    } as unknown as CheckoutEventRecord;
    const extensions = privateService.resolveTimeExtensionLines(event, [
      { id: 'social-follow-15', quantity: 1 },
    ]);
    const items = [
      { itemType: 'ticket_type', publicItemId: 'ticket-a', quantity: 1, customizations: [] },
      { itemType: 'ticket_variant', publicItemId: 'ticket-b', quantity: 1, customizations: [] },
      { itemType: 'addon', publicItemId: 'addon-a', quantity: 1, customizations: [] },
    ] as Array<Record<string, unknown>>;

    const applied = privateService.attachTimeExtensionsToTickets(items, extensions);

    expect(items[0].customizations).toEqual([
      expect.objectContaining({ publicOptionId: 'social-follow-15', unitPrice: 30 }),
    ]);
    expect(items[1].customizations).toEqual([]);
    expect(items[2].customizations).toEqual([]);
    const chargedAmount = items.reduce(
      (sum, item) => sum + (item.customizations as Array<{ unitPrice: number }>).reduce(
        (lineSum, option) => lineSum + option.unitPrice,
        0,
      ),
      0,
    );
    expect(chargedAmount).toBe(30);
    expect(applied).toEqual([
      expect.objectContaining({
        scope: 'order',
        minutes: 15,
        appliedTicketIds: ['ticket-a', 'ticket-b'],
        appliedTicketCount: 2,
      }),
    ]);
  });

  it('uses the RFID to apply a ticket-scoped extension to one unit on an Open RFID order', () => {
    const privateService = service as unknown as {
      resolveTimeExtensionLines: (
        event: CheckoutEventRecord,
        lines: Array<{ id: string; quantity: number; rfid?: string }>,
      ) => Array<Record<string, unknown>>;
      attachTimeExtensionsToTickets: (
        items: Array<Record<string, unknown>>,
        extensions: Array<Record<string, unknown>>,
        openRfidEvent: boolean,
      ) => Array<Record<string, unknown>>;
    };
    const event = {
      currency: 'QAR',
      moreOpsConfig: {
        entry_access: { pass_type: 'other' },
        time_extensions: [
          {
            id: 'inflatapass-extra-15',
            title: '+15 minutes',
            minutes: 15,
            price: 20,
            ticket_ids: ['inflatapass'],
          },
        ],
      },
    } as unknown as CheckoutEventRecord;
    const extensions = privateService.resolveTimeExtensionLines(event, [
      { id: 'inflatapass-extra-15', quantity: 1, rfid: 'RFID-002' },
    ]);
    expect(extensions[0]).toEqual(
      expect.objectContaining({
        publicOptionId: 'inflatapass-extra-15',
        itemId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/,
        ),
      }),
    );
    const items = [
      {
        itemType: 'ticket_type',
        publicItemId: 'inflatapass',
        quantity: 2,
        rfidCodes: ['RFID-001', 'RFID-002'],
        customizations: [],
      },
      {
        itemType: 'addon',
        publicItemId: 'socks',
        quantity: 1,
        rfidCodes: [],
        customizations: [],
      },
    ] as Array<Record<string, unknown>>;

    const applied = privateService.attachTimeExtensionsToTickets(items, extensions, true);

    expect(items[0].customizations).toEqual([
      expect.objectContaining({ publicOptionId: 'inflatapass-extra-15', unitPrice: 20 }),
    ]);
    expect(items[1].customizations).toEqual([]);
    expect(applied).toEqual([
      expect.objectContaining({
        targetTicketId: 'inflatapass',
        targetRfid: 'RFID-002',
        appliedTicketIds: ['inflatapass'],
        appliedTicketCount: 1,
      }),
    ]);
  });
});

describe('CheckoutService settlement normalization', () => {
  const service = new CheckoutService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const normalizeInput = (
    service as unknown as {
      normalizeInput: (
        input: Record<string, unknown>,
        lang: string,
        userId?: string,
        options?: { allowVerifiedPaid?: boolean; allowOfflinePayment?: boolean },
      ) => {
        paidPayment: { provider: string } | null;
        offlinePayment: { mode: string } | null;
        metadata: { source: string };
      };
    }
  ).normalizeInput.bind(service);

  const cart = {
    event_slug: 'sample-event',
    schedule: { date: '2026-12-01', time: '18:00' },
    tickets: [{ ticket_id: 'child-pass', quantity: 1 }],
    idempotency_key: 'wave1-key',
    customer: { email: 'guest@example.com' },
  };

  it('ignores client paymentDetailPayload.status=paid on the public path', () => {
    const result = normalizeInput(
      {
        ...cart,
        paymentDetailPayload: { status: 'paid', amount: 1, provider: 'myfatoorah' },
        offline_payment: { mode: 'comp' },
        metadata: { source: 'pos' },
      },
      'en',
    );
    expect(result.paidPayment).toBeNull();
    expect(result.offlinePayment).toBeNull();
    expect(result.metadata.source).toBe('web');
  });

  it('allows verified paid only when the caller opts in', () => {
    const result = normalizeInput(
      {
        ...cart,
        paymentDetailPayload: { status: 'paid', amount: 85, provider: 'mock' },
      },
      'en',
      'user-1',
      { allowVerifiedPaid: true },
    );
    expect(result.paidPayment).toEqual(
      expect.objectContaining({ provider: 'mock', amount: 85 }),
    );
  });

  it('allows offline tender only on the POS path', () => {
    const result = normalizeInput(
      {
        ...cart,
        offline_payment: { mode: 'cash', agent_id: 'agent-1' },
      },
      'en',
      'agent-1',
      { allowOfflinePayment: true },
    );
    expect(result.offlinePayment).toEqual(
      expect.objectContaining({ mode: 'cash' }),
    );
    expect(result.metadata.source).toBe('pos');
  });
});
