/**
 * One-off: rewrite legacy payment labels like `MyFatoorah-11` → `Myfatoorah . Googlepay`.
 * Usage: npx tsx prisma/backfill-payment-method-labels.ts
 */
import { PrismaClient } from '@prisma/client';

import {
  normalizePaymentMethodLabel,
  resolveOnlinePaymentMethodLabel,
} from '../src/modules/admin-payment-settings/payment-method-labels';

const prisma = new PrismaClient();

const LEGACY_IDS = [7, 8, 10, 11, 12] as const;

async function main() {
  let orderUpdates = 0;
  let dailyUpdates = 0;

  for (const id of LEGACY_IDS) {
    const legacy = `MyFatoorah-${id}`;
    const next = resolveOnlinePaymentMethodLabel(id);

    const orders = await prisma.order.updateMany({
      where: { paymentMethodLabel: legacy },
      data: { paymentMethodLabel: next },
    });
    orderUpdates += orders.count;

    const daily = await prisma.bookingReportPaymentDaily.findMany({
      where: { paymentMethodLabel: legacy },
    });

    for (const row of daily) {
      const existing = await prisma.bookingReportPaymentDaily.findUnique({
        where: {
          eventId_reportDay_reportBasis_paymentMethodLabel_currency: {
            eventId: row.eventId,
            reportDay: row.reportDay,
            reportBasis: row.reportBasis,
            paymentMethodLabel: next,
            currency: row.currency,
          },
        },
      });

      if (existing) {
        await prisma.bookingReportPaymentDaily.update({
          where: { id: existing.id },
          data: {
            orderCount: existing.orderCount + row.orderCount,
            admitCount: existing.admitCount + row.admitCount,
            revenueTotal: existing.revenueTotal.add(row.revenueTotal),
          },
        });
        await prisma.bookingReportPaymentDaily.delete({ where: { id: row.id } });
      } else {
        await prisma.bookingReportPaymentDaily.update({
          where: { id: row.id },
          data: { paymentMethodLabel: next },
        });
      }
      dailyUpdates += 1;
    }
  }

  // Catch any remaining MyFatoorah-* variants (e.g. MyFatoorah-confirm).
  const leftover = await prisma.order.findMany({
    where: { paymentMethodLabel: { startsWith: 'MyFatoorah-' } },
    select: { id: true, paymentMethodLabel: true },
  });
  for (const order of leftover) {
    const next = normalizePaymentMethodLabel(order.paymentMethodLabel);
    if (next !== order.paymentMethodLabel) {
      await prisma.order.update({
        where: { id: order.id },
        data: { paymentMethodLabel: next },
      });
      orderUpdates += 1;
    }
  }

  console.log(
    `Updated ${orderUpdates} order label(s) and ${dailyUpdates} payment-daily row(s).`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
