/**
 * One-off backfill helper: recompute order snapshots from related rows.
 * Usage: npx tsx prisma/backfill-order-report-snapshots.ts
 */
import { PrismaClient, ReportPaymentMode } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const batchSize = 100;
  let cursor: string | undefined;
  let updated = 0;

  for (;;) {
    const orders = await prisma.order.findMany({
      take: batchSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      include: {
        items: true,
        customer: true,
        event: { include: { translations: true } },
        eventSession: { include: { eventDate: true } },
      },
    });
    if (orders.length === 0) break;

    for (const order of orders) {
      const ticketsNet = order.items
        .filter((i) => i.itemType === 'ticket_type' || i.itemType === 'ticket_variant')
        .reduce((s, i) => s + i.totalAmount.toNumber(), 0);
      const addonsNet = order.items
        .filter((i) => i.itemType === 'addon' || i.itemType === 'addon_variant')
        .reduce((s, i) => s + i.totalAmount.toNumber(), 0);
      const totalQuantity = order.items
        .filter((i) => i.itemType === 'ticket_type' || i.itemType === 'ticket_variant')
        .reduce((s, i) => s + i.quantity, 0);
      const totalAdmits = order.items
        .filter((i) => i.itemType === 'ticket_type' || i.itemType === 'ticket_variant')
        .reduce((s, i) => s + i.admitCount * i.quantity, 0);

      const eventTitle =
        order.event.translations.find((t) => t.locale === 'en')?.title ??
        order.event.translations[0]?.title ??
        order.event.slug;

      let paymentMode: ReportPaymentMode = order.paymentMode;
      let paymentMethodLabel = order.paymentMethodLabel;
      if (order.totalAmount.toNumber() <= 0) {
        paymentMode = ReportPaymentMode.free;
        paymentMethodLabel = 'Free';
      }

      await prisma.order.update({
        where: { id: order.id },
        data: {
          organizationId: order.event.organizationId,
          venueId: order.event.venueId,
          eventSlug: order.event.slug,
          eventTitle,
          eventStartDate: order.eventSession.eventDate?.date ?? null,
          eventStartTime: order.eventSession.displayTime,
          customerName: order.customer.name,
          customerEmail: order.customer.email,
          customerPhone: order.customer.phone,
          ticketsNet,
          addonsNet,
          totalQuantity,
          totalAdmits,
          isSummerCamp: order.event.eventType === 'summer_camp',
          paymentMode,
          paymentMethodLabel,
          reportSyncPending: true,
          reportVersion: { increment: 1 },
        },
      });
      updated += 1;
    }

    cursor = orders[orders.length - 1]?.id;
    if (orders.length < batchSize) break;
  }

  console.log(`Backfilled ${updated} orders (reportSyncPending=true). Run sweeper or sync jobs.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
