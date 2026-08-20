/**
 * Adds an obvious repeat-purchaser pattern to the sample event's existing orders.
 * Safe to rerun: the same five orders are assigned to the same demo customer.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const event = await prisma.event.findUnique({
    where: { slug: 'sample-family-experience' },
    select: { id: true },
  });
  if (!event) throw new Error('Run the main seed first; the sample event was not found.');

  const orders = await prisma.order.findMany({
    where: {
      eventId: event.id,
      status: { in: ['paid', 'refunded', 'partially_refunded'] },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 5,
    select: { id: true, holdId: true },
  });
  if (orders.length < 2) {
    throw new Error('At least two completed sample-event orders are required for repeat-customer insights.');
  }

  const customer = await prisma.user.upsert({
    where: { email: 'repeat.customer@bookingqube.test' },
    update: { name: 'Repeat Customer (Insights Demo)', status: 'active' },
    create: {
      email: 'repeat.customer@bookingqube.test',
      name: 'Repeat Customer (Insights Demo)',
      status: 'active',
      customerProfile: { create: { defaultLocale: 'en' } },
    },
  });

  await prisma.$transaction(async (tx) => {
    for (const order of orders) {
      await tx.order.update({
        where: { id: order.id },
        data: {
          customerId: customer.id,
          customerName: customer.name,
          customerEmail: customer.email,
          customerPhone: customer.phone,
        },
      });
      if (order.holdId) {
        await tx.ticketHold.update({
          where: { id: order.holdId },
          data: { customerId: customer.id },
        });
      }
      await tx.promoCodeRedemption.updateMany({
        where: { orderId: order.id },
        data: { customerId: customer.id },
      });
      await tx.registrationSubmission.updateMany({
        where: { orderId: order.id },
        data: { customerId: customer.id },
      });
    }
  });

  const completed = await prisma.order.findMany({
    where: {
      eventId: event.id,
      status: { in: ['paid', 'refunded', 'partially_refunded'] },
    },
    include: { refunds: { where: { status: 'succeeded' }, select: { amount: true } } },
  });
  const netRevenue = completed.reduce(
    (sum, order) =>
      sum + order.totalAmount.toNumber() -
      order.refunds.reduce((refundSum, refund) => refundSum + refund.amount.toNumber(), 0),
    0,
  );
  const customers = new Set(completed.map((order) => order.customerId)).size;
  console.log({
    event: 'sample-family-experience',
    repeat_customer_orders: orders.length,
    completed_orders: completed.length,
    distinct_customers: customers,
    average_order_value: completed.length ? netRevenue / completed.length : 0,
    average_customer_spend: customers ? netRevenue / customers : 0,
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
