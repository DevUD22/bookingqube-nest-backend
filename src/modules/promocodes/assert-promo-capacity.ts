import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export async function assertPromoRedemptionCapacity(
  tx: Prisma.TransactionClient,
  input: {
    promoCodeId: string;
    customerId: string;
    maxRedemptions: number | null;
    maxRedemptionsPerCustomer: number | null;
  },
) {
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "promo_codes" WHERE id = ${input.promoCodeId}::uuid FOR UPDATE`,
  );

  if (input.maxRedemptions !== null) {
    const count = await tx.promoCodeRedemption.count({
      where: { promoCodeId: input.promoCodeId },
    });
    if (count >= input.maxRedemptions) {
      throw new BadRequestException('Promo code is invalid or no longer available.');
    }
  }

  if (input.maxRedemptionsPerCustomer !== null) {
    const perCustomer = await tx.promoCodeRedemption.count({
      where: { promoCodeId: input.promoCodeId, customerId: input.customerId },
    });
    if (perCustomer >= input.maxRedemptionsPerCustomer) {
      throw new BadRequestException('Promo code is invalid or no longer available.');
    }
  }
}
