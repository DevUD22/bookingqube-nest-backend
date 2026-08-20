import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AdvancePaymentStatus,
  CustomerPaymentRecoveryReason,
  InventoryItemType,
  OrderItemType,
  PaymentLegType,
  PaymentProvider,
  PaymentStatus,
  PaymentTransactionStatus,
  Prisma,
  ReportPaymentMode,
  StaffAssignmentStatus,
} from '@prisma/client';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { PrismaService } from '../../database/prisma.service';
import { CatalogCacheService, CheckoutEventRecord } from '../catalog/catalog-cache.service';
import { InventoryDelta, InventoryService } from '../inventory/inventory.service';
import { idempotencyKey, promoRedeemedKey } from '../inventory/inventory.scripts';
import { BookingJobsService } from '../queues/booking-jobs.service';
import { RedisService } from '../redis/redis.service';
import {
  OrderReportingEnricher,
  orderReportingEnricher,
} from '../reporting/order-reporting.enricher';
import {
  BookAddonLineItemDto,
  BookTicketLineItemDto,
  BookTicketRequestDto,
  BookTimeExtensionLineItemDto,
  CheckoutCustomerDto,
  CheckoutPromoCodeDto,
  CheckoutTotalsDto,
  CheckoutWaiverDto,
  ConfirmPaymentDto,
} from './dto/book-ticket.dto';
import { MyFatoorahService } from '../myfatoorah/myfatoorah.service';
import {
  assertOfflinePayment,
  createOfflinePaymentLegs,
  normalizeOfflinePayment,
  NormalizedOfflinePayment,
  resolveTenderAmounts,
  tenderFromAdvanceLegs,
} from './offline-payment.helpers';
import { MpgsCheckoutService } from './mpgs-checkout.service';
import { PaymentRecoveryService } from './payment-recovery.service';
import { QpayCheckoutService } from './qpay-checkout.service';
import { CustomerPaymentMethodsService } from '../admin-payment-settings/customer-payment-methods.service';
import { assertPromoRedemptionCapacity } from '../promocodes/assert-promo-capacity';
import {
  normalizePaymentMethodLabel,
  onlinePaymentMethodIdFromLabel,
  resolveOnlinePaymentMethodLabel,
} from '../admin-payment-settings/payment-method-labels';
import { MailService } from '../mail/mail.service';
import { SmsService } from '../sms/sms.service';
import {
  buildProviderResponseJson,
  HostedProviderRefs,
  mergeProviderRefs,
  methodIdForGateway,
  methodKeyForGateway,
  paymentProviderFromGateway,
  refsFromHostedParams,
} from './hosted-payment-records';
import {
  assertAmountAndCurrencyMatch,
  expectedMyFatoorahBindTokens,
  extractMyFatoorahBindTokens,
  myFatoorahCheckoutRefsForKey,
  myFatoorahSettlementMatchesOrder,
  paymentNotVerified,
} from './payment-verification';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Time extensions live in event JSON rather than a UUID-backed catalog table.
 * Keep their configured ID public, but derive a stable UUID for OrderItem.itemId.
 */
function timeExtensionOrderItemId(extensionId: string) {
  if (UUID_PATTERN.test(extensionId)) return extensionId;

  const hash = createHash('md5')
    .update(`bookingqube:time-extension:${extensionId}`)
    .digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export type BookTicketOptions = {
  /** Mock checkout / admin recovery after independent gateway verification. */
  allowVerifiedPaid?: boolean;
  /** POS sell path only. Public customer checkout never accepts cash/comp. */
  allowOfflinePayment?: boolean;
};

export type ConfirmPaymentOptions = {
  /** Admin force-confirm only. Public confirm must always verify the gateway. */
  skipGatewayVerification?: boolean;
};

type NormalizedBookTicketInput = {
  eventSlug: string;
  /** Empty when POS should auto-pick current/next session for today. */
  scheduleDate: string;
  scheduleTime: string;
  /** When true, resolve schedule from today's current/next active session after loading the event. */
  autoSchedule: boolean;
  tickets: BookTicketLineItemDto[];
  addons: BookAddonLineItemDto[];
  timeExtensions: BookTimeExtensionLineItemDto[];
  promoCode: CheckoutPromoCodeDto | null;
  paymentMethod: number | null;
  totals: Required<CheckoutTotalsDto>;
  waiver: CheckoutWaiverDto;
  customer: CheckoutCustomerDto;
  metadata: {
    source: string;
    locale: string;
  };
  successUrl: string | null;
  failedUrl: string | null;
  baseDomain: string | null;
  idempotencyKey: string;
  paidPayment: {
    provider: string;
    amount: number;
    currency: string;
    providerResponse?: {
      invoiceId?: string;
      paymentId?: string;
      sessionId?: string;
    };
  } | null;
  offlinePayment: NormalizedOfflinePayment | null;
};

type ResolvedLineItem = {
  publicItemId: string;
  publicVariantId: string | null;
  itemType: OrderItemType;
  inventoryItemType: InventoryItemType;
  itemId: string;
  inventoryItemId: string;
  displayName: string;
  quantity: number;
  unitPrice: number;
  currency: string;
  admitCount: number;
  thirdPartyVendorId: string | null;
  ticketIsCafe: boolean;
  ticketIsPosOnly: boolean;
  ticketHideFromOnline: boolean;
  rfidCodes: string[];
  customizations: ResolvedCustomization[];
};

type ResolvedCustomization = {
  publicOptionId: string;
  itemId: string;
  displayName: string;
  quantity: number;
  unitPrice: number;
  currency: string;
};

type ResolvedTimeExtension = ResolvedCustomization & {
  scope: 'ticket' | 'order';
  minutes: number;
  targetTicketId: string | null;
  targetRfid: string | null;
  eligibleTicketIds: string[];
};

type AppliedTimeExtension = {
  id: string;
  title: string;
  scope: 'ticket' | 'order';
  minutes: number;
  price: number;
  quantity: number;
  targetTicketId: string | null;
  targetRfid: string | null;
  appliedTicketIds: string[];
  appliedTicketCount: number;
};

type PromoRecord = Prisma.PromoCodeGetPayload<{
  include: { targets: true; redemptions: true };
}>;

const HOLD_TTL_MS = 30 * 60 * 1000;
/** Advance deposits stay open until remaining balance is collected (not a checkout TTL). */
const ADVANCE_HOLD_TTL_MS = 2 * 365 * 24 * 60 * 60 * 1000;
const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

@Injectable()
export class CheckoutService {
  private readonly enricher: OrderReportingEnricher = orderReportingEnricher;

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogCacheService,
    private readonly inventory: InventoryService,
    private readonly redis: RedisService,
    private readonly jobs: BookingJobsService,
    private readonly qpay: QpayCheckoutService,
    private readonly mpgs: MpgsCheckoutService,
    private readonly myFatoorah: MyFatoorahService,
    private readonly paymentMethods: CustomerPaymentMethodsService,
    private readonly paymentRecovery: PaymentRecoveryService,
    private readonly mailService: MailService,
    private readonly smsService: SmsService,
  ) {}

  async bookTicket(
    input: BookTicketRequestDto,
    lang: string,
    authenticatedUserId?: string,
    options?: BookTicketOptions,
  ) {

    const normalized = this.normalizeInput(input, lang, authenticatedUserId, options);
    await this.applyVerifiedMyFatoorahPayment(normalized, input);

    const cached = await this.getIdempotentResponse(normalized.idempotencyKey);
    if (cached) {
      const canSeeSecrets = this.shouldReturnBookingSecrets(
        cached.customerId,
        {
          offlinePayment: normalized.offlinePayment,
          holdReleaseToken: input.release_token?.trim() || undefined,
        },
        authenticatedUserId,
        cached.releaseTokenHash,
      );
      return this.redactBookingSecretsIfNeeded(cached.response, canSeeSecrets);
    }

    if (normalized.offlinePayment?.mode === 'advance') {
      const existingAdvance = await this.prisma.advancePayment.findFirst({
        where: {
          bookingData: { path: ['idempotency_key'], equals: normalized.idempotencyKey },
        },
      });
      if (existingAdvance) {
        const response = this.toAdvanceSuccessResponse(existingAdvance);
        await this.cacheIdempotentResponse(normalized.idempotencyKey, response, {
          customerId: existingAdvance.customerId,
        });
        return response;
      }
    }

    const existingOrder = await this.prisma.order.findUnique({
      where: { idempotencyKey: normalized.idempotencyKey },
      include: { items: true },
    });
    if (existingOrder) {
      const canSeeSecrets = this.shouldReturnBookingSecrets(
        existingOrder.customerId,
        {
          offlinePayment: normalized.offlinePayment,
          holdReleaseToken: input.release_token?.trim() || undefined,
        },
        authenticatedUserId,
      );
      const response = this.toSuccessResponse(
        existingOrder,
        normalized,
        canSeeSecrets ? await this.mapTicketOrderItemsAsync(existingOrder.items) : [],
      );
      await this.cacheIdempotentResponse(normalized.idempotencyKey, response, {
        customerId: existingOrder.customerId,
      });
      return this.redactBookingSecretsIfNeeded(response, canSeeSecrets);
    }

    const event = await this.catalog.getPublishedEventBySlug(normalized.eventSlug);
    const isPosSource = Boolean(normalized.offlinePayment) || normalized.metadata.source === 'pos';
    let session: CheckoutEventRecord['sessions'][number];
    if (normalized.autoSchedule) {
      if (!isPosSource) {
        throw new BadRequestException('Booking date and time are required.');
      }
      session = this.findCurrentOrNextSession(event);
      const eventDate = event.dates.find((item) => item.id === session.eventDateId);
      normalized.scheduleDate = eventDate
        ? eventDate.date.toISOString().slice(0, 10)
        : this.qatarDateKey(session.startsAt);
      normalized.scheduleTime = session.displayTime;
    } else {
      session = this.findSession(event, normalized.scheduleDate, normalized.scheduleTime);
    }
    const ticketLines = this.normalizeTicketLines(normalized.tickets);
    if (ticketLines.length === 0) {
      throw new BadRequestException('Select at least one ticket.');
    }

    const addonLines = this.normalizeAddonLines(normalized.addons);
    const bookedByAgentIdEarly =
      normalized.offlinePayment?.bookedByAgentId ??
      (isPosSource ? authenticatedUserId ?? null : null);
    const resolvedItems = [
      ...(await this.resolveTicketLines(event, session, ticketLines)),
      ...(await this.resolveAddonLines(event, session, addonLines, isPosSource)),
    ];
    const openRfidEvent = isPosSource && this.isOpenRfidEvent(event.moreOpsConfig);
    if (openRfidEvent) {
      await this.assertOpenRfidAssignments(event.id, resolvedItems);
    } else if (resolvedItems.some((item) => item.rfidCodes.length > 0)) {
      throw new BadRequestException('RFIDs can only be assigned when this event uses Open RFIDs.');
    }
    const appliedTimeExtensions = this.attachTimeExtensionsToTickets(
      resolvedItems,
      this.resolveTimeExtensionLines(event, normalized.timeExtensions),
      openRfidEvent,
    );
    await this.assignAddonVendors(resolvedItems, {
      eventId: event.id,
      agentUserId: bookedByAgentIdEarly,
    });
    const sortedItems = [...resolvedItems].sort((a, b) =>
      a.inventoryItemId.localeCompare(b.inventoryItemId),
    );

    // POS: authenticated user is the agent, not the customer.
    const customer = await this.findOrCreateCustomer(
      normalized.customer,
      normalized.idempotencyKey,
      normalized.offlinePayment ? undefined : authenticatedUserId,
    );
    const promo = normalized.promoCode?.code
      ? await this.prisma.promoCode.findUnique({
          where: { code: normalized.promoCode.code.trim().toUpperCase() },
          include: { targets: true, redemptions: true },
        })
      : null;
    if (normalized.promoCode?.code && !promo) {
      throw new BadRequestException('Promo code is invalid or no longer available.');
    }
    this.assertSingleCurrency(sortedItems);
    const subtotal = this.roundMoney(
      sortedItems.reduce(
        (sum, item) =>
          sum +
          item.unitPrice * item.quantity +
          item.customizations.reduce(
            (customizationSum, option) => customizationSum + option.unitPrice * option.quantity,
            0,
          ),
        0,
      ),
    );
    const discountAmount = await this.calculatePromoDiscount(
      promo,
      event.id,
      event.organizationId,
      customer.id,
      sortedItems,
    );
    const taxes = isPosSource
      ? []
      : await this.prisma.tax.findMany({
          where: { status: 'active', OR: [{ eventId: event.id }, { eventId: null }] },
        });
    const taxableAmount = this.roundMoney(subtotal - discountAmount);
    const taxLines = taxes.map((tax) => {
      const amount =
        tax.rateType === 'percent'
          ? this.roundMoney(taxableAmount * (tax.rate.toNumber() / 100))
          : this.roundMoney(tax.rate.toNumber());
      return { tax, amount };
    });
    const exclusiveTax = this.roundMoney(
      taxLines
        .filter(({ tax }) => tax.taxType === 'exclusive')
        .reduce((sum, { amount }) => sum + amount, 0),
    );
    const taxAmount = this.roundMoney(taxLines.reduce((sum, { amount }) => sum + amount, 0));
    let totalAmount = this.roundMoney(Math.max(0, taxableAmount + exclusiveTax));
    const currency = sortedItems[0]?.currency ?? 'QAR';
    const now = new Date();
    if (normalized.offlinePayment?.mode === 'comp') {
      totalAmount = 0;
    }
    assertOfflinePayment(normalized.offlinePayment, totalAmount);

    const isOfflinePaid =
      Boolean(normalized.offlinePayment) && normalized.offlinePayment!.mode !== 'advance';
    // Free registration / zero-total tickets settle immediately (no gateway).
    const isFreeCheckout =
      !normalized.offlinePayment &&
      !normalized.paidPayment &&
      totalAmount <= 0;
    const isPaid =
      isOfflinePaid ||
      normalized.paidPayment?.amount !== undefined ||
      isFreeCheckout;
    const isAdvance = normalized.offlinePayment?.mode === 'advance';
    const holdReleaseToken = !isPaid && !isAdvance ? randomBytes(32).toString('hex') : null;
    const holdReleaseTokenHash = holdReleaseToken
      ? createHash('sha256').update(holdReleaseToken).digest('hex')
      : null;

    // Paid online (non-POS) must use a payment method whose gateway is enabled in admin.
    if (!normalized.offlinePayment && !isFreeCheckout) {
      await this.paymentMethods.assertPaymentMethodAllowed(normalized.paymentMethod);
    }

    // Hosted MyFatoorah is already verified on the session. Do not require an
    // open recovery row — admin recoveries still open on confirm-payment and
    // resolve (or stay open) after book-ticket.

    const deltas: InventoryDelta[] = this.inventory.sortDeltas(
      sortedItems.map((item) => ({
        inventoryItemId: item.inventoryItemId,
        quantity: item.quantity,
      })),
    );
    // Capacity hold/sold only when schedule has "Limit tickets per bookable time".
    // Unlimited inventory rows are filtered out inside InventoryService.
    const capacityDeltas = await this.inventory.filterCapacityLimited(deltas);
    const usesCapacityInventory = capacityDeltas.length > 0;
    const usedRedis = this.inventory.usesRedis();
    const reserveMode = isPaid && !isAdvance ? 'sold' : 'hold';
    const bookedByAgentId =
      normalized.offlinePayment?.bookedByAgentId ??
      (isPosSource ? authenticatedUserId ?? null : null);

    await this.inventory.reserve(capacityDeltas, reserveMode);

    let promoSlotTaken = false;
    try {
      if (promo && discountAmount > 0 && promo.maxRedemptions !== null && !isAdvance) {
        await this.claimPromoSlot(promo.id, promo.maxRedemptions);
        promoSlotTaken = true;
      }

      if (isAdvance && normalized.offlinePayment) {
        const advanceResult = await this.persistAdvancePayment({
          event,
          session,
          customer,
          sortedItems,
          normalized,
          deltas: capacityDeltas,
          usesCapacityInventory,
          usedRedis,
          subtotal,
          discountAmount,
          taxAmount,
          totalAmount,
          currency,
          bookedByAgentId,
          appliedTimeExtensions,
          now,
        });
        // Advance deposits stay open until remaining payment is collected
        // (event day or any later day) — do not schedule short checkout hold expiry.
        const response = this.toAdvanceSuccessResponse(advanceResult.advance);
        await this.cacheIdempotentResponse(normalized.idempotencyKey, response, {
          customerId: advanceResult.advance.customerId,
        });
        return response;
      }

      const tender = resolveTenderAmounts(
        normalized.offlinePayment,
        totalAmount,
        isPaid,
        Boolean(normalized.paidPayment),
      );
      const result = await this.prisma.$transaction(async (tx) => {
        if (usedRedis && capacityDeltas.length > 0) {
          await this.inventory.syncReserveToPostgres(tx, capacityDeltas, reserveMode);
        }

        // Unpaid online checkout still needs a TicketHold for payment-timeout expiry.
        // Paid bookings do not — inventory sold tracking already ran when capacity is limited.
        const hold = !isPaid
          ? await tx.ticketHold.create({
              data: {
                customerId: customer.id,
                eventId: event.id,
                eventSessionId: session.id,
                idempotencyKey: normalized.idempotencyKey,
                status: 'active',
                releaseTokenHash: holdReleaseTokenHash,
                expiresAt: new Date(now.getTime() + HOLD_TTL_MS),
                items: {
                  create: sortedItems.map((item) => ({
                    inventoryItemId: item.inventoryItemId,
                    itemType: item.inventoryItemType,
                    itemId: item.itemId,
                    quantity: item.quantity,
                    unitPrice: item.unitPrice,
                    currency: item.currency,
                  })),
                },
              },
            })
          : null;

        const eventDate = event.dates.find((d) => d.id === session.eventDateId);
        const eventTitle =
          event.translations?.find((t) => t.locale === 'en')?.title ??
          event.translations?.[0]?.title ??
          event.slug;
        const enricherLines = sortedItems.flatMap((item) => [
          {
            itemType: item.itemType,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            lineTotal: this.roundMoney(item.unitPrice * item.quantity),
            admitCount: item.admitCount,
            thirdPartyVendorId: item.thirdPartyVendorId,
            ticketIsCafe: item.ticketIsCafe,
            ticketIsPosOnly: item.ticketIsPosOnly,
            ticketHideFromOnline: item.ticketHideFromOnline,
          },
          ...item.customizations.map((option) => ({
            itemType: OrderItemType.customization,
            quantity: option.quantity,
            unitPrice: option.unitPrice,
            lineTotal: this.roundMoney(option.unitPrice * option.quantity),
            admitCount: 0,
            thirdPartyVendorId: item.thirdPartyVendorId,
            ticketIsCafe: false,
            ticketIsPosOnly: false,
            ticketHideFromOnline: false,
          })),
        ]);
        const header = this.enricher.buildHeader(enricherLines, {
          organizationId: event.organizationId,
          venueId: event.venueId,
          eventSlug: event.slug,
          eventTitle,
          eventStartDate: eventDate?.date ?? null,
          eventStartTime: session.displayTime,
          isSummerCamp: event.eventType === 'summer_camp',
          customerName: customer.name,
          customerEmail: customer.email,
          customerPhone: customer.phone,
          source: normalized.metadata.source,
          hasPromo: Boolean(promo && discountAmount > 0),
          isPaid,
          paymentMethodId: normalized.paymentMethod,
          offlinePaymentMode: normalized.offlinePayment?.mode ?? null,
        });

        const commonOrder = this.generateCommonOrder();
        const usedTicketCodes = new Set<string>();
        const publicIdByTicketCode = new Map<string, string>();
        const order = await tx.order.create({
          data: {
            commonOrder,
            idempotencyKey: normalized.idempotencyKey,
            customerId: customer.id,
            eventId: event.id,
            eventSessionId: session.id,
            holdId: hold?.id ?? null,
            status: isPaid ? 'paid' : 'pending_payment',
            paymentStatus: isPaid ? PaymentStatus.paid : PaymentStatus.pending,
            currency,
            subtotalAmount: subtotal,
            discountAmount,
            taxAmount,
            totalAmount,
            promoCodeId: promo?.id ?? null,
            promoCode: promo?.code ?? normalized.promoCode?.code?.trim().toUpperCase() ?? null,
            source: normalized.metadata.source,
            locale: normalized.metadata.locale,
            waiverAccepted: Boolean(normalized.waiver.accepted),
            waiverSignedBy: normalized.waiver.signed_by ?? null,
            waiverAcceptedAt: normalized.waiver.accepted_at
              ? new Date(normalized.waiver.accepted_at)
              : null,
            metadata: {
              success_url: normalized.successUrl,
              failed_url: normalized.failedUrl,
              base_domain: normalized.baseDomain,
              client_reported_totals: normalized.totals,
              totals_source: 'server',
              offline_payment: normalized.offlinePayment,
              time_extensions: appliedTimeExtensions,
            },
            paidAt: isPaid ? now : null,
            organizationId: header.organizationId,
            venueId: header.venueId,
            eventSlug: header.eventSlug,
            eventTitle: header.eventTitle,
            eventStartDate: header.eventStartDate,
            eventStartTime: header.eventStartTime,
            customerName: header.customerName,
            customerEmail: header.customerEmail,
            customerPhone: header.customerPhone,
            customerAgeGroup: header.customerAgeGroup,
            customerGeographicRegion: header.customerGeographicRegion,
            customerGender: header.customerGender,
            paymentMode: header.paymentMode,
            paymentMethodLabel: header.paymentMethodLabel,
            cashAmount: tender.cashAmount,
            cardAmount: tender.cardAmount,
            onlineAmount: tender.onlineAmount,
            compAmount: tender.compAmount,
            bookedByAgentId,
            ticketsNet: header.ticketsNet,
            addonsNet: header.addonsNet,
            extensionsNet: header.extensionsNet,
            totalQuantity: header.totalQuantity,
            totalAdmits: header.totalAdmits,
            isSummerCamp: header.isSummerCamp,
            reportVersion: 1,
            reportSyncPending: false,
          },
        });

        for (const item of sortedItems) {
          const lineSubtotal = this.roundMoney(item.unitPrice * item.quantity);
          const lineSnap = this.enricher.classifyLine(
            {
              itemType: item.itemType,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              lineTotal: lineSubtotal,
              admitCount: item.admitCount,
              thirdPartyVendorId: item.thirdPartyVendorId,
              ticketIsCafe: item.ticketIsCafe,
              ticketIsPosOnly: item.ticketIsPosOnly,
              ticketHideFromOnline: item.ticketHideFromOnline,
            },
            {
              hasPromo: Boolean(promo && discountAmount > 0),
              source: normalized.metadata.source,
              offlinePaymentMode: normalized.offlinePayment?.mode ?? null,
            },
          );
          const ticketCode = this.generateTicketOrderNumber(commonOrder, usedTicketCodes);
          publicIdByTicketCode.set(ticketCode, item.publicItemId);
          const parentItem = await tx.orderItem.create({
            data: {
              orderId: order.id,
              eventId: event.id,
              eventSessionId: session.id,
              inventoryItemId: item.inventoryItemId,
              itemType: item.itemType,
              itemId: item.itemId,
              displayName: item.displayName,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              subtotalAmount: lineSubtotal,
              discountAmount: 0,
              taxAmount: 0,
              totalAmount: lineSubtotal,
              currency: item.currency,
              ticketCode,
              rfidCodes: item.rfidCodes,
              visitorType: lineSnap.visitorType,
              thirdPartyVendorId: lineSnap.thirdPartyVendorId,
              admitCount: lineSnap.admitCount,
              ticketIsCafe: lineSnap.ticketIsCafe,
              ticketIsPosOnly: lineSnap.ticketIsPosOnly,
              ticketHideFromOnline: lineSnap.ticketHideFromOnline,
              bookedByAgentId,
            },
          });

          if (item.customizations.length > 0) {
            await tx.orderItem.createMany({
              data: item.customizations.map((option) => {
                const optionSubtotal = this.roundMoney(option.unitPrice * option.quantity);
                return {
                  orderId: order.id,
                  eventId: event.id,
                  eventSessionId: session.id,
                  inventoryItemId: null,
                  itemType: OrderItemType.customization,
                  itemId: option.itemId,
                  parentOrderItemId: parentItem.id,
                  displayName: option.displayName,
                  quantity: option.quantity,
                  unitPrice: option.unitPrice,
                  subtotalAmount: optionSubtotal,
                  discountAmount: 0,
                  taxAmount: 0,
                  totalAmount: optionSubtotal,
                  currency: option.currency,
                  ticketCode: null,
                  visitorType: 'paid' as const,
                  thirdPartyVendorId: lineSnap.thirdPartyVendorId,
                  admitCount: 0,
                  ticketIsCafe: false,
                  ticketIsPosOnly: false,
                  ticketHideFromOnline: false,
                  bookedByAgentId,
                };
              }),
            });
          }
        }

        const orderWithItems = await tx.order.findUniqueOrThrow({
          where: { id: order.id },
          include: { items: true },
        });

        if (promo && discountAmount > 0) {
          await assertPromoRedemptionCapacity(tx, {
            promoCodeId: promo.id,
            customerId: customer.id,
            maxRedemptions: promo.maxRedemptions,
            maxRedemptionsPerCustomer: promo.maxRedemptionsPerCustomer,
          });
          await tx.promoCodeRedemption.create({
            data: {
              promoCodeId: promo.id,
              orderId: order.id,
              customerId: customer.id,
              discountAmount,
            },
          });
        }

        if (taxLines.length > 0) {
          await tx.orderTaxLine.createMany({
            data: taxLines.map(({ tax, amount }) => ({
              orderId: order.id,
              taxId: tax.id,
              title: tax.title,
              rateType: tax.rateType,
              rate: tax.rate,
              taxType: tax.taxType,
              taxableAmount,
              taxAmount: amount,
            })),
          });
        }

        if (isPaid) {
          await createOfflinePaymentLegs(tx, {
            orderId: order.id,
            offline: normalized.offlinePayment,
            onlinePaid: normalized.paidPayment
              ? {
                  provider: normalized.paidPayment.provider,
                  amount: normalized.paidPayment.amount,
                  currency: normalized.paidPayment.currency,
                  paymentMethod: normalized.paymentMethod,
                  providerResponse: normalized.paidPayment.providerResponse,
                }
              : null,
            totalAmount,
            currency,
            defaultLegType: header.paymentLegType,
            collectedByUserId: bookedByAgentId,
            now,
          });
        }

        return {
          order: orderWithItems,
          holdId: hold?.id ?? null,
          publicIdByTicketCode: Object.fromEntries(publicIdByTicketCode),
        };
      });

      if (!isPaid && result.holdId) {
        // Inventory release only applies to capacity-limited deltas; empty is fine for unlimited.
        await this.jobs.scheduleHoldExpiry(result.holdId, capacityDeltas, HOLD_TTL_MS);
      } else if (result.holdId) {
        await this.jobs.cancelHoldExpiry(result.holdId);
      }

      await this.jobs.enqueueReportSync({
        orderId: result.order.id,
        action: isPaid ? 'paid' : 'hold',
      });

      if (!normalized.offlinePayment) {
        await this.attachHostedSessionsToOrder(result.order);
      }

      let response = this.toSuccessResponse(
        result.order,
        normalized,
        this.mapTicketOrderItems(result.order.items, result.publicIdByTicketCode),
        holdReleaseToken,
      );

      let hostedSessionId: string | null = null;

      // Hosted gateways: create pending order/hold first, then return redirect URL.
      if (
        !isPaid &&
        !normalized.offlinePayment &&
        (normalized.paymentMethod === 7 || normalized.paymentMethod === 8)
      ) {
        const eventTitle =
          event.translations?.find((t) => t.locale === 'en')?.title ??
          event.translations?.[0]?.title ??
          event.slug;
        const hosted =
          normalized.paymentMethod === 7
            ? await this.qpay.createHostedCheckout({
                commonOrder: result.order.commonOrder,
                orderId: result.order.id,
                amount: Number(result.order.totalAmount),
                currency: result.order.currency,
                description: eventTitle,
                successUrl: normalized.successUrl,
                failedUrl: normalized.failedUrl,
                baseDomain: normalized.baseDomain,
              })
            : await this.mpgs.createHostedCheckout({
                commonOrder: result.order.commonOrder,
                orderId: result.order.id,
                amount: Number(result.order.totalAmount),
                currency: result.order.currency,
                description: eventTitle,
                successUrl: normalized.successUrl,
                failedUrl: normalized.failedUrl,
                baseDomain: normalized.baseDomain,
              });

        hostedSessionId =
          (hosted as { mpgs_session_id?: string; qpay_sid?: string }).mpgs_session_id ??
          (hosted as { qpay_sid?: string }).qpay_sid ??
          null;

        response = {
          ...response,
          data: {
            ...response.data,
            redirect_required: hosted.redirect_required,
            payment_flow: hosted.payment_flow,
            payment_method: hosted.payment_method,
            url: hosted.url,
            ...(normalized.paymentMethod === 7
              ? {
                  qpay_sid: (hosted as { qpay_sid?: string }).qpay_sid ?? null,
                  qpay_token: (hosted as { qpay_token?: string }).qpay_token ?? null,
                  qpay_exp: (hosted as { qpay_exp?: number }).qpay_exp ?? null,
                }
              : {}),
          },
        };
      }

      if (
        !isPaid &&
        this.paymentRecovery.isCustomerOnlineSource(
          normalized.metadata.source,
          Boolean(normalized.offlinePayment),
        )
      ) {
        await this.openCustomerCheckoutRecovery({
          order: result.order,
          normalized,
          providerSessionId: hostedSessionId,
        });
      }

      if (
        isPaid &&
        this.paymentRecovery.isCustomerOnlineSource(
          normalized.metadata.source,
          Boolean(normalized.offlinePayment),
        )
      ) {
        await this.paymentRecovery.resolve({
          commonOrder: result.order.commonOrder,
          orderId: result.order.id,
          idempotencyKey: normalized.idempotencyKey,
          providerSessionId: normalized.paidPayment?.providerResponse?.sessionId ?? null,
        });
      }

      if (isPaid) {
        const notifyChannel =
          isPosSource || Boolean(normalized.offlinePayment) ? 'offline' : 'online';
        this.mailService.queueBookingConfirmationEmail(
          result.order.commonOrder,
          notifyChannel,
        );
        this.smsService.queueBookingConfirmationSms(
          result.order.commonOrder,
          notifyChannel,
        );
      }

      await this.cacheIdempotentResponse(normalized.idempotencyKey, response, {
        customerId: customer.id,
        releaseTokenHash: holdReleaseTokenHash,
      });
      return response;
    } catch (error) {
      if (usedRedis) {
        await this.inventory.releaseRedisOnly(capacityDeltas);
      } else {
        await this.inventory.release(capacityDeltas);
      }
      if (promoSlotTaken && promo) {
        await this.releasePromoSlot(promo.id);
      }

      if (
        isPaid &&
        this.paymentRecovery.isCustomerOnlineSource(
          normalized.metadata.source,
          Boolean(normalized.offlinePayment),
        )
      ) {
        const gateway =
          this.paymentRecovery.gatewayFromPaymentMethod(normalized.paymentMethod) ??
          'myfatoorah';
        await this.paymentRecovery.upsertOpen({
          customerId: customer?.id ?? null,
          customerEmail: customer?.email ?? normalized.customer.email ?? null,
          eventId: event?.id ?? null,
          eventSlug: normalized.eventSlug,
          gateway,
          reason: CustomerPaymentRecoveryReason.payment_ok_booking_failed,
          amount: totalAmount,
          currency,
          idempotencyKey: normalized.idempotencyKey,
          providerSessionId: normalized.paidPayment?.providerResponse?.sessionId ?? null,
          providerInvoiceId:
            normalized.paidPayment?.providerResponse?.invoiceId != null
              ? String(normalized.paidPayment.providerResponse.invoiceId)
              : null,
          providerPaymentId: normalized.paidPayment?.providerResponse?.paymentId ?? null,
          failureMessage:
            error instanceof Error ? error.message : 'Booking failed after payment.',
          checkoutSnapshot: {
            idempotency_key: normalized.idempotencyKey,
            event_slug: normalized.eventSlug,
            schedule: {
              date: normalized.scheduleDate,
              time: normalized.scheduleTime,
            },
            tickets: normalized.tickets,
            addons: normalized.addons,
            customer: normalized.customer,
            payment_method: normalized.paymentMethod,
            provider_response: normalized.paidPayment?.providerResponse ?? null,
          },
        });
      }

      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const concurrentOrder = await this.findConcurrentIdempotentOrder(normalized.idempotencyKey);
        if (concurrentOrder) {
          const response = this.toSuccessResponse(
            concurrentOrder,
            normalized,
            await this.mapTicketOrderItemsAsync(concurrentOrder.items),
          );
          await this.cacheIdempotentResponse(normalized.idempotencyKey, response, {
            customerId: concurrentOrder.customerId,
          });
          return this.redactBookingSecretsIfNeeded(
            response,
            this.shouldReturnBookingSecrets(
              concurrentOrder.customerId,
              {
                offlinePayment: normalized.offlinePayment,
                holdReleaseToken: input.release_token?.trim() || undefined,
              },
              authenticatedUserId,
            ),
          );
        }
      }
      throw error;
    }
  }

  async confirmPayment(
    input: ConfirmPaymentDto,
    options?: ConfirmPaymentOptions,
  ) {
    const order = input.common_order
      ? await this.prisma.order.findUnique({
          where: { commonOrder: input.common_order },
          include: { items: true, hold: { include: { items: true } } },
        })
      : input.idempotency_key
        ? await this.prisma.order.findUnique({
            where: { idempotencyKey: input.idempotency_key },
            include: { items: true, hold: { include: { items: true } } },
          })
        : null;

    if (!order) throw new NotFoundException('Order not found.');
    if (order.status === 'paid') {
      return {
        success: true,
        message: 'Payment already confirmed.',
        data: { common_order: order.commonOrder, status: order.status },
      };
    }
    if (order.status !== 'pending_payment' && order.status !== 'expired') {
      throw new BadRequestException(
        `Order cannot be confirmed (status: ${order.status}).`,
      );
    }

    const hosted = await this.findHostedCheckoutForOrder(
      order,
      input.providerResponse?.sessionId,
    );
    const hostedRefs = refsFromHostedParams(
      (hosted?.paramsJson as Record<string, unknown>) ?? null,
      hosted?.sid,
    );
    const clientPaymentId = input.providerResponse?.paymentId?.trim() || null;
    const hostedPaymentId = hostedRefs.paymentId?.trim() || null;
    if (
      hostedPaymentId &&
      clientPaymentId &&
      hostedPaymentId !== clientPaymentId
    ) {
      throw paymentNotVerified(
        'Payment does not match the checkout session for this order.',
      );
    }

    let mergedRefs = mergeProviderRefs(hostedRefs, {
      gateway: hosted?.gateway,
      sessionId: hosted?.sid ?? hostedRefs.sessionId,
      paymentId: hostedPaymentId || clientPaymentId,
      invoiceId: hostedRefs.invoiceId,
      resultIndicator:
        hostedRefs.resultIndicator ||
        input.providerResponse?.resultIndicator ||
        null,
    });
    if (!mergedRefs.gateway) {
      mergedRefs.gateway =
        hosted?.gateway ||
        this.paymentRecovery.gatewayFromPaymentMethod(
          onlinePaymentMethodIdFromLabel(order.paymentMethodLabel),
        ) ||
        null;
    }

    if (!options?.skipGatewayVerification) {
      mergedRefs = await this.verifyGatewaySettlement(order, hosted, mergedRefs);
    }

    await this.assertProviderPaymentNotReused(
      paymentProviderFromGateway(mergedRefs.gateway ?? hosted?.gateway),
      mergedRefs.paymentId,
      order.id,
    );

    const deltas =
      order.hold?.items.map((item) => ({
        inventoryItemId: item.inventoryItemId,
        quantity: item.quantity,
      })) ??
      order.items
        .filter((item) => item.inventoryItemId)
        .map((item) => ({
          inventoryItemId: item.inventoryItemId!,
          quantity: item.quantity,
        }));

    const now = new Date();
    const providerAsMethodId = Number(input.provider);
    const gatewayHint =
      mergedRefs.gateway === 'qpay' ||
      mergedRefs.gateway === 'mastercard' ||
      mergedRefs.gateway === 'myfatoorah'
        ? mergedRefs.gateway
        : hosted?.gateway ?? null;
    const methodIdFromGateway = methodIdForGateway(gatewayHint);
    const methodId =
      Number.isFinite(providerAsMethodId) && providerAsMethodId > 0
        ? providerAsMethodId
        : methodIdFromGateway ??
          onlinePaymentMethodIdFromLabel(order.paymentMethodLabel);
    const paymentLabel =
      normalizePaymentMethodLabel(order.paymentMethodLabel, methodId) ||
      resolveOnlinePaymentMethodLabel(methodId ?? 12);
    const paymentProvider = paymentProviderFromGateway(
      gatewayHint ??
        (methodId === 7 ? 'qpay' : methodId === 8 ? 'mastercard' : 'myfatoorah'),
    );
    const methodKey = methodKeyForGateway(
      gatewayHint ??
        (methodId === 7 ? 'qpay' : methodId === 8 ? 'mastercard' : 'myfatoorah'),
      methodId,
    );
    const providerResponseJson = buildProviderResponseJson(
      {
        ...mergedRefs,
        gateway: gatewayHint ?? paymentProvider,
      },
      { confirmedAt: now.toISOString() },
    );

    let settled = false;
    await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ status: string }>>(
        Prisma.sql`SELECT status::text AS status FROM "orders" WHERE id = ${order.id}::uuid FOR UPDATE`,
      );
      const lockedStatus = locked[0]?.status;
      if (lockedStatus === 'paid') {
        return;
      }
      if (lockedStatus !== 'pending_payment' && lockedStatus !== 'expired') {
        throw new BadRequestException(
          `Order cannot be confirmed (status: ${lockedStatus}).`,
        );
      }

      // Expired holds already released inventory — reserve as sold again.
      // Active pending holds still have inventory in "held"; convert hold → sold.
      if (lockedStatus === 'expired') {
        try {
          await this.inventory.reserve(deltas, 'sold');
        } catch (error) {
          const message =
            error instanceof Error
              ? `Payment succeeded but inventory is no longer available: ${error.message}`
              : 'Payment succeeded but inventory is no longer available.';
          if (order.source !== 'pos') {
            await this.paymentRecovery.upsertOpen({
              commonOrder: order.commonOrder,
              orderId: order.id,
              customerId: order.customerId,
              customerEmail: order.customerEmail,
              eventId: order.eventId,
              eventSlug: order.eventSlug,
              gateway:
                this.paymentRecovery.gatewayFromPaymentMethod(
                  onlinePaymentMethodIdFromLabel(order.paymentMethodLabel),
                ) ??
                (mergedRefs.gateway === 'qpay'
                  ? 'qpay'
                  : mergedRefs.gateway === 'mastercard'
                    ? 'mastercard'
                    : 'mastercard'),
              reason: CustomerPaymentRecoveryReason.inventory_unavailable,
              amount: Number(order.totalAmount),
              currency: order.currency,
              idempotencyKey: order.idempotencyKey,
              providerSessionId: mergedRefs.sessionId ?? null,
              providerInvoiceId: mergedRefs.invoiceId
                ? String(mergedRefs.invoiceId)
                : null,
              providerPaymentId: mergedRefs.paymentId ?? null,
              failureMessage: message,
              checkoutSnapshot: {
                common_order: order.commonOrder,
                idempotency_key: order.idempotencyKey,
                provider_response: buildProviderResponseJson(mergedRefs),
              },
            });
          }
          throw new BadRequestException(message);
        }
      } else {
        await this.inventory.convert(deltas);
      }
      if (order.holdId) await this.jobs.cancelHoldExpiry(order.holdId);

      await tx.order.update({
        where: { id: order.id },
        data: {
          status: 'paid',
          paymentStatus: PaymentStatus.paid,
          paidAt: now,
          paymentMode: 'online',
          paymentMethodLabel: paymentLabel,
          onlineAmount: order.totalAmount,
          cashAmount: 0,
          cardAmount: 0,
          reportVersion: { increment: 1 },
        },
      });
      if (order.holdId) {
        await tx.ticketHold.updateMany({
          where: { id: order.holdId, status: { in: ['active', 'expired'] } },
          data: { status: 'converted' },
        });
      }

      const pendingPayment = await tx.payment.findFirst({
        where: {
          orderId: order.id,
          status: PaymentTransactionStatus.pending,
        },
        orderBy: { createdAt: 'desc' },
      });

      const paymentData = {
        provider: paymentProvider,
        providerPaymentMethodId: methodId,
        methodKey,
        legType: PaymentLegType.online_gateway,
        status: PaymentTransactionStatus.paid,
        amount: order.totalAmount,
        currency: order.currency,
        providerInvoiceId: mergedRefs.invoiceId
          ? String(mergedRefs.invoiceId)
          : order.commonOrder,
        providerPaymentId: mergedRefs.paymentId ?? null,
        providerSessionId: mergedRefs.sessionId ?? null,
        providerResponse: providerResponseJson,
        paidAt: now,
        failedAt: null,
        failureCode: null,
        failureMessage: null,
      };

      try {
        if (pendingPayment) {
          await tx.payment.update({
            where: { id: pendingPayment.id },
            data: paymentData,
          });
        } else {
          await tx.payment.create({
            data: {
              orderId: order.id,
              ...paymentData,
            },
          });
        }
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw paymentNotVerified(
            'This payment has already been applied to another order.',
          );
        }
        throw error;
      }

      if (hosted) {
        const params = (hosted.paramsJson as Record<string, unknown>) ?? {};
        await tx.hostedCheckoutSession.update({
          where: { id: hosted.id },
          data: {
            status: 'paid',
            orderId: hosted.orderId ?? order.id,
            commonOrder: hosted.commonOrder ?? order.commonOrder,
            paramsJson: {
              ...params,
              providerResponse: providerResponseJson,
              confirmed_at: now.toISOString(),
            } as Prisma.InputJsonValue,
          },
        });
      }
      settled = true;
    });

    if (!settled) {
      return {
        success: true,
        message: 'Payment already confirmed.',
        data: { common_order: order.commonOrder, status: 'paid' },
      };
    }

    await this.jobs.enqueueReportSync({ orderId: order.id, action: 'paid' });

    if (order.source !== 'pos') {
      await this.paymentRecovery.resolve({
        commonOrder: order.commonOrder,
        orderId: order.id,
        idempotencyKey: order.idempotencyKey,
        providerSessionId: mergedRefs.sessionId ?? null,
      });
    }

    const notifyChannel = order.source === 'pos' ? 'offline' : 'online';
    this.mailService.queueBookingConfirmationEmail(order.commonOrder, notifyChannel);
    this.smsService.queueBookingConfirmationSms(order.commonOrder, notifyChannel);

    return {
      success: true,
      message: 'Payment confirmed.',
      data: { common_order: order.commonOrder, status: 'paid' },
    };
  }

  private async verifyGatewaySettlement(
    order: {
      id: string;
      commonOrder: string;
      idempotencyKey: string;
      totalAmount: Prisma.Decimal | number;
      currency: string;
    },
    hosted: {
      sid: string;
      gateway: string;
      status: string;
      amount: Prisma.Decimal | number;
      currency: string;
      checkoutRef?: string | null;
      commonOrder?: string | null;
      orderId?: string | null;
      paramsJson?: Prisma.JsonValue | null;
    } | null,
    refs: HostedProviderRefs,
  ): Promise<HostedProviderRefs> {
    const expectedAmount =
      typeof order.totalAmount === 'number'
        ? order.totalAmount
        : order.totalAmount.toNumber();
    const expectedCurrency = order.currency || 'QAR';
    const gateway = String(hosted?.gateway || refs.gateway || '')
      .trim()
      .toLowerCase();

    if (hosted) {
      assertAmountAndCurrencyMatch({
        expectedAmount,
        expectedCurrency,
        actualAmount: Number(hosted.amount),
        actualCurrency: hosted.currency,
        source: 'hosted checkout session',
      });
    }

    if (gateway === 'myfatoorah') {
      const hostedInvoiceId = (() => {
        const fromRefs = hosted
          ? refsFromHostedParams(
              (hosted.paramsJson as Record<string, unknown>) ?? null,
              hosted.sid,
            ).invoiceId
          : null;
        return fromRefs && fromRefs !== order.commonOrder ? String(fromRefs) : undefined;
      })();
      const invoiceId =
        hostedInvoiceId ||
        (refs.invoiceId && refs.invoiceId !== order.commonOrder
          ? String(refs.invoiceId)
          : undefined);
      if (!refs.paymentId && !invoiceId && !refs.sessionId) {
        throw paymentNotVerified(
          'MyFatoorah payment has not been verified with the gateway.',
        );
      }
      let result: Awaited<ReturnType<MyFatoorahService['resolvePaymentStatus']>>;
      try {
        result = await this.myFatoorah.resolvePaymentStatus({
          payment_id: refs.paymentId ?? undefined,
          invoice_id: invoiceId,
          session_id: refs.sessionId ?? undefined,
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'MyFatoorah payment has not been verified with the gateway.';
        throw paymentNotVerified(message);
      }
      if (!result.paid) {
        throw paymentNotVerified(
          result.message || 'MyFatoorah has not captured this payment.',
        );
      }
      if (result.data.amount != null) {
        assertAmountAndCurrencyMatch({
          expectedAmount,
          expectedCurrency,
          actualAmount: result.data.amount,
          actualCurrency: result.data.currency ?? expectedCurrency,
          source: 'MyFatoorah',
        });
      } else if (!hosted) {
        throw paymentNotVerified(
          'MyFatoorah did not return a payable amount for this order.',
        );
      }
      const hostedInvoiceFromSession = hostedInvoiceId ?? null;
      const expectedTokens = expectedMyFatoorahBindTokens({
        commonOrder: order.commonOrder,
        idempotencyKey: order.idempotencyKey,
        hostedSid: hosted?.sid ?? null,
        hostedCheckoutRef: hosted?.checkoutRef,
        hostedInvoiceId: hostedInvoiceFromSession,
      });
      const presentedTokens = [
        ...extractMyFatoorahBindTokens(
          (result.data.payment as Record<string, unknown> | null) ?? null,
        ),
        result.data.sessionId,
        result.data.invoiceId != null ? String(result.data.invoiceId) : null,
      ];
      const storedHostedPaymentId = hosted
        ? (
            refsFromHostedParams(
              (hosted.paramsJson as Record<string, unknown>) ?? null,
              hosted.sid,
            ).paymentId || ''
          ).trim()
        : '';
      const resolvedPaymentId = String(result.data.paymentId ?? '').trim();
      const storedOnThisHosted =
        Boolean(storedHostedPaymentId && resolvedPaymentId) &&
        storedHostedPaymentId === resolvedPaymentId;
      if (
        !storedOnThisHosted &&
        !myFatoorahSettlementMatchesOrder(presentedTokens, expectedTokens)
      ) {
        throw paymentNotVerified(
          'MyFatoorah payment does not belong to this order.',
        );
      }
      return mergeProviderRefs(refs, {
        gateway: 'myfatoorah',
        sessionId: result.data.sessionId || hosted?.sid || refs.sessionId,
        paymentId: result.data.paymentId,
        invoiceId:
          result.data.invoiceId != null ? String(result.data.invoiceId) : null,
      });
    }

    if (gateway === 'mastercard') {
      let result: Awaited<ReturnType<MpgsCheckoutService['retrieveOrderStatus']>>;
      try {
        result = await this.mpgs.retrieveOrderStatus(order.commonOrder);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Mastercard has not captured this payment.';
        throw paymentNotVerified(message);
      }
      if (!result.paid) {
        throw paymentNotVerified(
          result.message || 'Mastercard has not captured this payment.',
        );
      }
      if (result.data.amount != null) {
        assertAmountAndCurrencyMatch({
          expectedAmount,
          expectedCurrency,
          actualAmount: result.data.amount,
          actualCurrency: result.data.currency ?? expectedCurrency,
          source: 'Mastercard',
        });
      } else if (!hosted) {
        throw paymentNotVerified(
          'Mastercard did not return a payable amount for this order.',
        );
      }
      return mergeProviderRefs(refs, {
        gateway: 'mastercard',
        paymentId: result.data.paymentId,
        invoiceId: result.data.invoiceId,
      });
    }

    if (gateway === 'qpay') {
      const params =
        hosted?.paramsJson &&
        typeof hosted.paramsJson === 'object' &&
        !Array.isArray(hosted.paramsJson)
          ? (hosted.paramsJson as Record<string, unknown>)
          : {};
      if (!hosted || hosted.status !== 'paid' || params.qpay_verified !== true) {
        throw paymentNotVerified(
          'QPay payment has not been confirmed by a verified bank callback.',
        );
      }
      return mergeProviderRefs(refs, { gateway: 'qpay' });
    }

    throw paymentNotVerified(
      'Unable to verify payment with a payment provider.',
    );
  }

  private async findHostedCheckoutForOrder(
    order: { id: string; commonOrder: string; idempotencyKey: string },
    clientSessionId?: string | null,
  ) {
    const clientSid = clientSessionId?.trim() || '';
    const checkoutRefs = myFatoorahCheckoutRefsForKey(order.idempotencyKey);
    const or: Prisma.HostedCheckoutSessionWhereInput[] = [
      { orderId: order.id },
      { commonOrder: order.commonOrder },
    ];
    if (order.idempotencyKey) {
      or.push({ checkoutRef: order.idempotencyKey });
      or.push({ checkoutRef: { startsWith: `${order.idempotencyKey}_` } });
    }
    if (checkoutRefs.length > 0) {
      or.push({ checkoutRef: { in: checkoutRefs } });
    }
    if (clientSid) {
      or.push({ sid: clientSid });
    }

    const sessions = await this.prisma.hostedCheckoutSession.findMany({
      where: { OR: or },
      orderBy: { createdAt: 'desc' },
      take: 40,
    });

    if (clientSid) {
      const claimed = sessions.find((row) => row.sid === clientSid);
      if (claimed && !this.hostedSessionBelongsToOrder(claimed, order)) {
        throw paymentNotVerified(
          'Payment session does not belong to this order.',
        );
      }
    }

    return (
      sessions.find((row) => this.hostedSessionBelongsToOrder(row, order)) ??
      null
    );
  }

  private hostedSessionBelongsToOrder(
    hosted: {
      sid: string;
      orderId: string | null;
      commonOrder: string | null;
      checkoutRef: string | null;
    },
    order: { id: string; commonOrder: string; idempotencyKey: string },
  ) {
    if (hosted.orderId && hosted.orderId === order.id) return true;
    if (hosted.commonOrder && hosted.commonOrder === order.commonOrder) {
      return true;
    }
    const expected = expectedMyFatoorahBindTokens({
      commonOrder: order.commonOrder,
      idempotencyKey: order.idempotencyKey,
    });
    return myFatoorahSettlementMatchesOrder(
      [hosted.checkoutRef, hosted.commonOrder],
      expected,
    );
  }

  private async attachHostedSessionsToOrder(order: {
    id: string;
    commonOrder: string;
    idempotencyKey: string;
  }) {
    const checkoutRefs = myFatoorahCheckoutRefsForKey(order.idempotencyKey);
    const or: Prisma.HostedCheckoutSessionWhereInput[] = [];
    if (order.idempotencyKey) {
      or.push({ checkoutRef: order.idempotencyKey });
      or.push({ checkoutRef: { startsWith: `${order.idempotencyKey}_` } });
    }
    if (checkoutRefs.length > 0) {
      or.push({ checkoutRef: { in: checkoutRefs } });
    }
    if (or.length === 0) return;

    await this.prisma.hostedCheckoutSession.updateMany({
      where: {
        gateway: 'myfatoorah',
        AND: [
          { OR: or },
          {
            OR: [{ orderId: null }, { orderId: order.id }],
          },
          {
            OR: [{ commonOrder: null }, { commonOrder: order.commonOrder }],
          },
        ],
      },
      data: {
        orderId: order.id,
        commonOrder: order.commonOrder,
      },
    });
  }

  private async assertProviderPaymentNotReused(
    provider: PaymentProvider,
    paymentId: string | null | undefined,
    orderId: string,
  ) {
    const id = paymentId?.trim();
    if (!id) return;
    const existing = await this.prisma.payment.findFirst({
      where: {
        provider,
        providerPaymentId: id,
        status: PaymentTransactionStatus.paid,
        NOT: { orderId },
      },
      select: { id: true },
    });
    if (existing) {
      throw paymentNotVerified(
        'This payment has already been applied to another order.',
      );
    }
  }

  async releaseHold(
    holdId: string,
    options?: { actorId?: string; releaseToken?: string },
  ) {
    const hold = await this.prisma.ticketHold.findUnique({
      where: { id: holdId },
      include: { items: true, orders: true },
    });
    if (!hold) throw new NotFoundException('Hold not found.');
    if (hold.status !== 'active') {
      return { success: true, message: 'Hold already released.', data: { hold_id: holdId } };
    }

    const actorOwns = Boolean(options?.actorId) && options!.actorId === hold.customerId;
    const presented = (options?.releaseToken || '').trim();
    const tokenOk =
      Boolean(hold.releaseTokenHash && presented) &&
      this.releaseTokenMatches(hold.releaseTokenHash!, presented);
    if (!actorOwns && !tokenOk) {
      throw new ForbiddenException('Hold release is not authorized.');
    }

    const deltas = hold.items.map((item) => ({
      inventoryItemId: item.inventoryItemId,
      quantity: item.quantity,
    }));
    await this.inventory.release(deltas);
    await this.jobs.cancelHoldExpiry(holdId);

    const pendingOrderIds = hold.orders
      .filter((order) => order.status === 'pending_payment')
      .map((order) => order.id);

    await this.prisma.$transaction(async (tx) => {
      await tx.ticketHold.update({
        where: { id: holdId },
        data: { status: 'released' },
      });
      await tx.order.updateMany({
        where: { holdId, status: 'pending_payment' },
        data: { status: 'cancelled', cancelledAt: new Date() },
      });
    });

    if (pendingOrderIds.length) {
      await this.paymentRecovery.markConfirmNeverCalled(pendingOrderIds);
    }

    for (const order of hold.orders) {
      await this.jobs.enqueueReportSync({ orderId: order.id, action: 'expire' });
    }

    return { success: true, message: 'Hold released.', data: { hold_id: holdId } };
  }

  private async openCustomerCheckoutRecovery(input: {
    order: {
      id: string;
      commonOrder: string;
      customerId: string | null;
      customerEmail: string | null;
      eventId: string | null;
      eventSlug: string | null;
      totalAmount: Prisma.Decimal | number;
      currency: string;
    };
    normalized: NormalizedBookTicketInput;
    providerSessionId?: string | null;
  }) {
    const gateway =
      this.paymentRecovery.gatewayFromPaymentMethod(input.normalized.paymentMethod) ??
      'myfatoorah';
    await this.paymentRecovery.upsertOpen({
      commonOrder: input.order.commonOrder,
      orderId: input.order.id,
      customerId: input.order.customerId,
      customerEmail: input.order.customerEmail,
      eventId: input.order.eventId,
      eventSlug: input.order.eventSlug,
      gateway,
      reason: CustomerPaymentRecoveryReason.awaiting_confirm,
      amount: Number(input.order.totalAmount),
      currency: input.order.currency,
      idempotencyKey: input.normalized.idempotencyKey,
      providerSessionId: input.providerSessionId ?? null,
      checkoutSnapshot: {
        idempotency_key: input.normalized.idempotencyKey,
        event_slug: input.normalized.eventSlug,
        schedule: {
          date: input.normalized.scheduleDate,
          time: input.normalized.scheduleTime,
        },
        tickets: input.normalized.tickets,
        addons: input.normalized.addons,
        customer: input.normalized.customer,
        payment_method: input.normalized.paymentMethod,
      },
    });
  }

  private async claimPromoSlot(promoId: string, maxRedemptions: number) {
    const client = this.redis.getClient();
    if (!client) {
      // Without Redis the booking transaction locks the promo row before insert.
      return;
    }

    const key = promoRedeemedKey(promoId);
    const exists = await client.exists(key);
    if (!exists) {
      const count = await this.prisma.promoCodeRedemption.count({
        where: { promoCodeId: promoId },
      });
      await client.set(key, String(count), 'EX', 86_400, 'NX');
    }
    const next = await client.incr(key);
    if (next > maxRedemptions) {
      await client.decr(key);
      throw new BadRequestException('Promo code is invalid or no longer available.');
    }
  }

  private async releasePromoSlot(promoId: string) {
    const client = this.redis.getClient();
    if (!client) return;
    const key = promoRedeemedKey(promoId);
    const value = await client.get(key);
    if (value !== null && Number(value) > 0) await client.decr(key);
  }

  private async getIdempotentResponse(key: string): Promise<{
    customerId: string | null;
    releaseTokenHash: string | null;
    response: Record<string, unknown>;
  } | null> {
    const client = this.redis.getClient();
    if (!client) return null;
    const raw = await client.get(idempotencyKey(key));
    return raw ? this.parseIdempotentCache(raw) : null;
  }

  private parseIdempotentCache(raw: string): {
    customerId: string | null;
    releaseTokenHash: string | null;
    response: Record<string, unknown>;
  } | null {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (
        parsed &&
        parsed.v === 2 &&
        parsed.response &&
        typeof parsed.response === 'object'
      ) {
        return {
          customerId: typeof parsed.customerId === 'string' ? parsed.customerId : null,
          releaseTokenHash:
            typeof parsed.releaseTokenHash === 'string' ? parsed.releaseTokenHash : null,
          response: parsed.response as Record<string, unknown>,
        };
      }
      if (parsed && typeof parsed.success === 'boolean') {
        return {
          customerId: null,
          releaseTokenHash: null,
          response: parsed,
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  private async cacheIdempotentResponse(
    key: string,
    response: Record<string, unknown>,
    meta?: { customerId?: string | null; releaseTokenHash?: string | null },
  ) {
    const client = this.redis.getClient();
    if (!client) return;
    const envelope = {
      v: 2 as const,
      customerId: meta?.customerId ?? null,
      releaseTokenHash: meta?.releaseTokenHash ?? null,
      response,
    };
    await client.set(idempotencyKey(key), JSON.stringify(envelope), 'EX', IDEMPOTENCY_TTL_SECONDS);
  }

  private normalizeInput(
    input: BookTicketRequestDto,
    lang: string,
    authenticatedUserId?: string,
    options?: BookTicketOptions,
  ): NormalizedBookTicketInput {
    const orderDetail = input.orderDetailPayload;
    const totals = orderDetail?.totals ?? input.totals ?? {};
    const currency = totals.currency ?? input.paymentDetailPayload?.currency ?? 'QAR';
    const eventSlug = input.event_slug ?? orderDetail?.eventSlug;
    const scheduleDate = (
      input.schedule?.date ?? orderDetail?.schedule?.bookingDate?.start_date ?? ''
    ).trim();
    const scheduleTime = (
      input.schedule?.time ?? orderDetail?.schedule?.timingSlot ?? ''
    ).trim();
    const idempotencyKeyValue = input.idempotency_key?.trim();

    if (!eventSlug) {
      throw new BadRequestException('Event is required.');
    }
    if (!idempotencyKeyValue) {
      throw new BadRequestException('Idempotency key is required.');
    }

    const offlinePayment = options?.allowOfflinePayment
      ? normalizeOfflinePayment(
          input.offline_payment
            ? {
                ...input.offline_payment,
                agent_id:
                  (input as { agent_id?: string }).agent_id?.trim() ||
                  input.offline_payment.agent_id ||
                  input.offline_payment.booked_by_agent_id,
              }
            : undefined,
          authenticatedUserId ?? null,
        )
      : null;
    const requestedSource = orderDetail?.metadata?.source ?? input.metadata?.source ?? 'web';
    const source =
      offlinePayment != null
        ? 'pos'
        : options?.allowOfflinePayment
          ? requestedSource
          : requestedSource === 'pos'
            ? 'web'
            : requestedSource;
    const isPosSource = Boolean(offlinePayment) || source === 'pos';
    const hasSchedule = Boolean(scheduleDate && scheduleTime);
    if (!hasSchedule && !isPosSource) {
      throw new BadRequestException('Booking date and time are required.');
    }
    if ((scheduleDate && !scheduleTime) || (!scheduleDate && scheduleTime)) {
      throw new BadRequestException('Booking date and time are both required when schedule is sent.');
    }

    return {
      eventSlug,
      scheduleDate: hasSchedule ? scheduleDate : '',
      scheduleTime: hasSchedule ? scheduleTime : '',
      autoSchedule: !hasSchedule && isPosSource,
      tickets: orderDetail?.tickets ?? input.tickets ?? [],
      addons: orderDetail?.addons ?? input.addons ?? [],
      timeExtensions: input.time_extensions ?? [],
      promoCode: orderDetail?.promocode ?? input.promo_code ?? null,
      paymentMethod: input.payment_method ?? null,
      totals: {
        subtotal: Number(totals.subtotal) || 0,
        discount_amount: Number(totals.discount_amount) || 0,
        total: Number(totals.total) || 0,
        currency,
      },
      waiver: orderDetail?.waiver ?? input.waiver ?? {},
      customer: {
        user_id:
          input.customer?.user_id ?? orderDetail?.customer?.id ?? null,
        name:
          input.customer?.name?.trim() ||
          orderDetail?.customer?.name?.trim() ||
          null,
        email:
          input.customer?.email?.trim() ||
          orderDetail?.customer?.email?.trim() ||
          null,
        phone:
          input.customer?.phone?.trim() ||
          orderDetail?.customer?.phone?.trim() ||
          null,
      },
      metadata: {
        source,
        locale:
          orderDetail?.metadata?.locale ?? input.metadata?.locale ?? this.normalizeLocale(lang),
      },
      successUrl: input.success_url ?? null,
      failedUrl: input.failed_url ?? null,
      baseDomain: input.base_domain ?? null,
      idempotencyKey: idempotencyKeyValue,
      paidPayment:
        options?.allowVerifiedPaid &&
        !offlinePayment &&
        input.paymentDetailPayload?.status === 'paid'
          ? {
              provider: input.paymentDetailPayload.provider?.trim().toLowerCase() || 'myfatoorah',
              amount: Number(input.paymentDetailPayload.amount) || Number(totals.total) || 0,
              currency,
              providerResponse: input.paymentDetailPayload.providerResponse,
            }
          : null,
      offlinePayment,
    };
  }

  private async applyVerifiedMyFatoorahPayment(
    normalized: NormalizedBookTicketInput,
    input: BookTicketRequestDto,
  ) {
    if (normalized.paidPayment || normalized.offlinePayment) {
      return;
    }

    const detail = input.paymentDetailPayload;
    const provider = (detail?.provider || '').trim().toLowerCase();
    const sessionId = (detail?.providerResponse?.sessionId || '').trim();
    if (provider !== 'myfatoorah' || !sessionId) {
      return;
    }

    const hosted = await this.prisma.hostedCheckoutSession.findUnique({
      where: { sid: sessionId },
    });
    const checkoutRef = hosted?.checkoutRef?.trim() || '';
    const belongsToCheckout =
      checkoutRef === normalized.idempotencyKey ||
      checkoutRef.startsWith(`${normalized.idempotencyKey}_`);
    if (
      !hosted ||
      hosted.gateway !== 'myfatoorah' ||
      hosted.status !== 'paid' ||
      !belongsToCheckout
    ) {
      throw paymentNotVerified(
        'MyFatoorah payment has not been verified for this checkout.',
      );
    }

    const params = (hosted.paramsJson as Record<string, unknown> | null) ?? {};
    const storedResponse =
      (params.providerResponse as Record<string, unknown> | null) ?? {};
    const paymentId =
      (typeof storedResponse.paymentId === 'string' && storedResponse.paymentId) ||
      detail?.providerResponse?.paymentId ||
      undefined;
    const invoiceIdRaw =
      storedResponse.invoiceId ?? detail?.providerResponse?.invoiceId;
    const invoiceId =
      invoiceIdRaw != null && String(invoiceIdRaw).trim()
        ? String(invoiceIdRaw)
        : undefined;

    normalized.paidPayment = {
      provider: 'myfatoorah',
      amount: Number(hosted.amount),
      currency: hosted.currency || normalized.totals.currency,
      providerResponse: {
        sessionId: hosted.sid,
        paymentId,
        invoiceId,
      },
    };
  }

  private qatarDateKey(value: Date = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Qatar',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(value);
  }

  private findSession(event: CheckoutEventRecord, date: string, time: string) {
    const selectedDate = new Date(`${date}T00:00:00.000Z`);
    if (Number.isNaN(selectedDate.getTime())) {
      throw new BadRequestException('Invalid booking date.');
    }

    const todayKey = this.qatarDateKey();
    const dateKey = selectedDate.toISOString().slice(0, 10);
    if (dateKey < todayKey) {
      throw new BadRequestException('Selected date is in the past.');
    }

    const eventDate = event.dates.find(
      (item) => item.date.toISOString().slice(0, 10) === dateKey,
    );
    const session = event.sessions.find(
      (item) => item.eventDateId === eventDate?.id && item.displayTime === time,
    );

    if (!eventDate || !session || session.status !== 'active') {
      throw new NotFoundException('Selected event session not found.');
    }

    if (session.startsAt < new Date()) {
      throw new BadRequestException('Selected time slot is in the past.');
    }

    return session;
  }

  /**
   * POS walk-in: prefer today's ongoing session, else today's next slot,
   * else the earliest upcoming active session on a later date (Asia/Qatar).
   */
  private findCurrentOrNextSession(event: CheckoutEventRecord) {
    const now = new Date();
    const todayKey = this.qatarDateKey(now);
    const activeSessions = event.sessions
      .filter((item) => item.status === 'active')
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

    if (!activeSessions.length) {
      throw new BadRequestException('No active sessions available for this event.');
    }

    const todaysSessions = activeSessions.filter((item) => {
      const eventDate = event.dates.find((date) => date.id === item.eventDateId);
      return eventDate
        ? eventDate.date.toISOString().slice(0, 10) === todayKey
        : this.qatarDateKey(item.startsAt) === todayKey;
    });

    const currentToday = todaysSessions.find(
      (item) =>
        item.startsAt.getTime() <= now.getTime() &&
        (item.endsAt == null || item.endsAt.getTime() > now.getTime()),
    );
    if (currentToday) return currentToday;

    const nextToday = todaysSessions.find((item) => item.startsAt.getTime() >= now.getTime());
    if (nextToday) return nextToday;

    const nextUpcoming = activeSessions.find((item) => item.startsAt.getTime() >= now.getTime());
    if (nextUpcoming) return nextUpcoming;

    throw new BadRequestException('No current or upcoming session available for this event.');
  }

  private normalizeTicketLines(lines: BookTicketLineItemDto[]) {
    return lines.filter(
      (line) =>
        line.ticket_id && Number.isFinite(Number(line.quantity)) && Number(line.quantity) > 0,
    );
  }

  private normalizeAddonLines(lines: BookAddonLineItemDto[]) {
    return lines.filter(
      (line) =>
        line.addon_id && Number.isFinite(Number(line.quantity)) && Number(line.quantity) > 0,
    );
  }

  private normalizeRfids(values: string[] | undefined): string[] {
    if (!Array.isArray(values)) return [];
    return values.map((value) => String(value).replace(/\s+/g, '').trim()).filter(Boolean);
  }

  private isOpenRfidEvent(raw: Prisma.JsonValue | null | undefined): boolean {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
    const config = raw as Record<string, unknown>;
    if (!config.entry_access || typeof config.entry_access !== 'object' || Array.isArray(config.entry_access)) {
      return false;
    }
    return (config.entry_access as Record<string, unknown>).pass_type === 'other';
  }

  private async assertOpenRfidAssignments(eventId: string, items: ResolvedLineItem[]) {
    const tickets = items.filter(
      (item) =>
        item.itemType === OrderItemType.ticket_type ||
        item.itemType === OrderItemType.ticket_variant,
    );
    const allRfids: string[] = [];
    for (const ticket of tickets) {
      if (ticket.rfidCodes.length !== ticket.quantity) {
        throw new BadRequestException(
          `${ticket.displayName} requires ${ticket.quantity} RFID${ticket.quantity === 1 ? '' : 's'}.`,
        );
      }
      allRfids.push(...ticket.rfidCodes);
    }
    const normalized = allRfids.map((code) => code.toLowerCase());
    if (new Set(normalized).size !== normalized.length) {
      throw new BadRequestException('Each ticket must use a different RFID.');
    }
    if (!allRfids.length) return;
    const existing = await this.prisma.orderItem.findFirst({
      where: { eventId, rfidCodes: { hasSome: allRfids } },
      select: { rfidCodes: true },
    });
    if (existing) {
      const used = existing.rfidCodes.find((code) =>
        normalized.includes(code.toLowerCase()),
      );
      throw new BadRequestException(
        used ? `RFID ${used} has already been assigned for this event.` : 'An RFID has already been assigned for this event.',
      );
    }
  }

  private resolveTimeExtensionLines(
    event: CheckoutEventRecord,
    lines: BookTimeExtensionLineItemDto[],
  ): ResolvedTimeExtension[] {
    const requested = (lines ?? []).filter(
      (line) =>
        line.id && Number.isFinite(Number(line.quantity)) && Number(line.quantity) > 0,
    );
    if (!requested.length) return [];

    const packs = this.parseEventTimeExtensions(event.moreOpsConfig);
    if (!packs.length) {
      throw new BadRequestException('No time extensions are configured for this event.');
    }

    const currency = event.currency || 'QAR';
    return requested.map((line) => {
      const pack = packs.find((item) => item.id === line.id);
      if (!pack) {
        throw new BadRequestException(`Time extension ${line.id} is not available.`);
      }
      const quantity = Math.floor(Number(line.quantity));
      if (!Number.isFinite(quantity) || quantity < 1) {
        throw new BadRequestException(`Invalid quantity for time extension ${line.id}.`);
      }
      const targetTicketId = line.ticket_id?.trim() || null;
      const targetRfid = line.rfid?.replace(/\s+/g, '').trim() || null;
      if (
        pack.scope === 'ticket' &&
        targetTicketId &&
        pack.ticketIds.length > 0 &&
        !pack.ticketIds.includes(targetTicketId)
      ) {
        throw new BadRequestException(
          `Time extension ${line.id} is not available for ticket ${targetTicketId}.`,
        );
      }
      return {
        publicOptionId: pack.id,
        itemId: timeExtensionOrderItemId(pack.id),
        displayName: pack.title,
        quantity,
        // Extension prices are always authoritative on the server.
        unitPrice: pack.price,
        currency,
        scope: pack.scope,
        minutes: pack.minutes,
        targetTicketId: pack.scope === 'order' ? null : targetTicketId,
        targetRfid: pack.scope === 'order' ? null : targetRfid,
        eligibleTicketIds: pack.ticketIds,
      };
    });
  }

  private parseEventTimeExtensions(raw: Prisma.JsonValue | null | undefined): Array<{
    id: string;
    title: string;
    minutes: number;
    price: number;
    scope: 'ticket' | 'order';
    ticketIds: string[];
  }> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    const config = raw as Record<string, unknown>;
    if (!Array.isArray(config.time_extensions)) return [];
    return config.time_extensions.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const row = item as Record<string, unknown>;
      if (typeof row.title !== 'string' || !row.title.trim()) return [];
      if (typeof row.id !== 'string' || !row.id.trim()) return [];
      return [
        {
          id: row.id.trim(),
          title: row.title.trim(),
          minutes:
            typeof row.minutes === 'number'
              ? row.minutes
              : typeof row.duration === 'number'
                ? row.duration
                : 30,
          price: typeof row.price === 'number' ? row.price : 0,
          scope: row.scope === 'order' ? 'order' : 'ticket',
          ticketIds: row.scope === 'order'
            ? []
            : Array.isArray(row.ticket_ids)
            ? row.ticket_ids.flatMap((ticketId) => {
                const value = typeof ticketId === 'string' || typeof ticketId === 'number'
                  ? String(ticketId).trim()
                  : '';
                return value ? [value] : [];
              })
            : [],
        },
      ];
    });
  }

  private attachTimeExtensionsToTickets(
    items: ResolvedLineItem[],
    extensions: ResolvedTimeExtension[],
    openRfidEvent = false,
  ): AppliedTimeExtension[] {
    if (!extensions.length) return [];
    const applied: AppliedTimeExtension[] = [];
    for (const extension of extensions) {
      if (openRfidEvent && extension.scope === 'ticket' && !extension.targetRfid) {
        throw new BadRequestException(
          `Time extension ${extension.publicOptionId} requires the RFID of the ticket to extend.`,
        );
      }
      const eligibleTickets = items.filter(
        (item) =>
          (item.itemType === OrderItemType.ticket_type ||
            item.itemType === OrderItemType.ticket_variant) &&
          (extension.scope === 'order' ||
            (extension.targetRfid
              ? item.rfidCodes.includes(extension.targetRfid)
              : !extension.targetTicketId || item.publicItemId === extension.targetTicketId)) &&
          (extension.eligibleTicketIds.length === 0 ||
            extension.eligibleTicketIds.includes(item.publicItemId)),
      );
      const ticket = eligibleTickets[0];
      if (!ticket) {
        throw new BadRequestException(
          extension.targetRfid
            ? `RFID ${extension.targetRfid} does not belong to a ticket eligible for time extension ${extension.publicOptionId}.`
            : extension.targetTicketId
            ? `Ticket ${extension.targetTicketId} is not eligible for time extension ${extension.publicOptionId}.`
            : `Time extension ${extension.publicOptionId} requires an eligible ticket on the order.`,
        );
      }
      const line: ResolvedCustomization = {
        publicOptionId: extension.publicOptionId,
        itemId: extension.itemId,
        displayName: extension.displayName,
        quantity: extension.quantity,
        unitPrice: extension.unitPrice,
        currency: extension.currency,
      };
      // Order-scoped extensions are represented by one customization line so a
      // paid pack is charged exactly once and named sales reports count one sale.
      // The structured order metadata below records every affected ticket line.
      ticket.customizations.push(line);
      applied.push({
        id: extension.publicOptionId,
        title: extension.displayName,
        scope: extension.scope,
        minutes: extension.minutes,
        price: extension.unitPrice,
        quantity: extension.quantity,
        targetTicketId: extension.scope === 'order' ? null : ticket.publicItemId,
        targetRfid: extension.targetRfid,
        appliedTicketIds: [...new Set(eligibleTickets.map((item) => item.publicItemId))],
        appliedTicketCount: extension.targetRfid
          ? 1
          : eligibleTickets.reduce(
              (sum, item) => sum + (Number.isFinite(Number(item.quantity)) ? Number(item.quantity) : 0),
              0,
            ),
      });
    }
    return applied;
  }

  private async resolveTicketLines(
    event: CheckoutEventRecord,
    session: CheckoutEventRecord['sessions'][number],
    lines: BookTicketLineItemDto[],
  ): Promise<ResolvedLineItem[]> {
    const resolved: ResolvedLineItem[] = [];
    for (const line of lines) {
      const ticketType = event.ticketTypes.find((ticket) => ticket.externalKey === line.ticket_id);
      if (!ticketType || ticketType.status !== 'active') {
        throw new BadRequestException(`Ticket ${line.ticket_id} is not available.`);
      }
      const now = new Date();
      if (
        (ticketType.salesStartAt && ticketType.salesStartAt > now) ||
        (ticketType.salesEndAt && ticketType.salesEndAt < now)
      ) {
        throw new BadRequestException(`Ticket ${line.ticket_id} is outside its sales window.`);
      }

      if (line.variant_id) {
        if ((line.customization_options?.length ?? 0) > 0) {
          throw new BadRequestException(
            `Ticket variant ${line.variant_id} cannot use ticket customizations.`,
          );
        }
        const variant = ticketType.variants.find((item) => item.externalKey === line.variant_id);
        if (!variant || variant.status !== 'active') {
          throw new BadRequestException(`Ticket variant ${line.variant_id} is not available.`);
        }
        const inventory = await this.findInventory(
          event,
          session,
          InventoryItemType.ticket_variant,
          variant.id,
        );
        resolved.push({
          publicItemId: line.ticket_id,
          publicVariantId: line.variant_id,
          itemType: OrderItemType.ticket_variant,
          inventoryItemType: InventoryItemType.ticket_variant,
          itemId: variant.id,
          inventoryItemId: inventory.id,
          displayName: `${ticketType.title} - ${variant.name}`,
          quantity: Number(line.quantity),
          unitPrice: variant.basePrice.toNumber(),
          currency: variant.currency,
          admitCount: ticketType.admitCount ?? 1,
          thirdPartyVendorId: ticketType.thirdPartyVendorId ?? null,
          ticketIsCafe: Boolean(ticketType.thirdPartyVendor?.isCafe),
          ticketIsPosOnly: Boolean(ticketType.hideFromOnline && !ticketType.hideFromPos),
          ticketHideFromOnline: Boolean(ticketType.hideFromOnline),
          customizations: [],
          rfidCodes: this.normalizeRfids(line.rfids),
        });
        continue;
      }

      const inventory = await this.findInventory(
        event,
        session,
        InventoryItemType.ticket_type,
        ticketType.id,
      );
      const customizations = this.resolveCustomizationLines(ticketType, line);
      resolved.push({
        publicItemId: line.ticket_id,
        publicVariantId: null,
        itemType: OrderItemType.ticket_type,
        inventoryItemType: InventoryItemType.ticket_type,
        itemId: ticketType.id,
        inventoryItemId: inventory.id,
        displayName: ticketType.title,
        quantity: Number(line.quantity),
        // Customizable tickets are containers; their selected options carry the price.
        unitPrice: ticketType.isCustomizable ? 0 : (ticketType.basePrice?.toNumber() ?? 0),
        currency: ticketType.currency,
        admitCount: ticketType.admitCount ?? 1,
        thirdPartyVendorId: ticketType.thirdPartyVendorId ?? null,
        ticketIsCafe: Boolean(ticketType.thirdPartyVendor?.isCafe),
        ticketIsPosOnly: Boolean(ticketType.hideFromOnline && !ticketType.hideFromPos),
        ticketHideFromOnline: Boolean(ticketType.hideFromOnline),
        customizations,
        rfidCodes: this.normalizeRfids(line.rfids),
      });
    }
    return resolved;
  }

  private async resolveAddonLines(
    event: CheckoutEventRecord,
    session: CheckoutEventRecord['sessions'][number],
    lines: BookAddonLineItemDto[],
    isPosSource = false,
  ): Promise<ResolvedLineItem[]> {
    const resolved: ResolvedLineItem[] = [];
    for (const line of lines) {
      const addon = event.addons.find((item) => item.externalKey === line.addon_id);
      if (!addon || addon.status !== 'active') {
        throw new BadRequestException(`Addon ${line.addon_id} is not available.`);
      }
      if (addon.hideFromOnline && !isPosSource) {
        throw new BadRequestException(`Addon ${line.addon_id} is not available online.`);
      }

      if (line.variant_id) {
        const variant = addon.variants.find((item) => item.externalKey === line.variant_id);
        if (!variant || variant.status !== 'active') {
          throw new BadRequestException(`Addon variant ${line.variant_id} is not available.`);
        }
        const inventory = await this.findInventory(
          event,
          session,
          InventoryItemType.addon_variant,
          variant.id,
        );
        resolved.push({
          publicItemId: line.addon_id,
          publicVariantId: line.variant_id,
          itemType: OrderItemType.addon_variant,
          inventoryItemType: InventoryItemType.addon_variant,
          itemId: variant.id,
          inventoryItemId: inventory.id,
          displayName: `${addon.title} - ${variant.name}`,
          quantity: Number(line.quantity),
          unitPrice: variant.basePrice.toNumber(),
          currency: variant.currency,
          admitCount: 0,
          thirdPartyVendorId: null,
          ticketIsCafe: Boolean(addon.forCafeOnly),
          ticketIsPosOnly: false,
          ticketHideFromOnline: Boolean(addon.hideFromOnline),
          customizations: [],
          rfidCodes: [],
        });
        continue;
      }

      const inventory = await this.findInventory(event, session, InventoryItemType.addon, addon.id);
      resolved.push({
        publicItemId: line.addon_id,
        publicVariantId: null,
        itemType: OrderItemType.addon,
        inventoryItemType: InventoryItemType.addon,
        itemId: addon.id,
        inventoryItemId: inventory.id,
        displayName: addon.title,
        quantity: Number(line.quantity),
        unitPrice: addon.basePrice?.toNumber() ?? 0,
        currency: addon.currency,
        admitCount: 0,
        thirdPartyVendorId: null,
        ticketIsCafe: Boolean(addon.forCafeOnly),
        ticketIsPosOnly: false,
        ticketHideFromOnline: Boolean(addon.hideFromOnline),
        customizations: [],
        rfidCodes: [],
      });
    }
    return resolved;
  }

  /**
   * Stamp addon lines with a vendor at write time so reporting rollups stay accurate
   * without post-hoc joins. Prefer ticket vendor on the same order; else POS staff assignment.
   */
  private async assignAddonVendors(
    items: ResolvedLineItem[],
    opts: { eventId: string; agentUserId: string | null },
  ): Promise<void> {
    const needsVendor = items.some(
      (item) =>
        (item.itemType === OrderItemType.addon ||
          item.itemType === OrderItemType.addon_variant) &&
        !item.thirdPartyVendorId,
    );
    if (!needsVendor) return;

    const hasTicketLines = items.some(
      (item) =>
        item.itemType === OrderItemType.ticket_type ||
        item.itemType === OrderItemType.ticket_variant,
    );

    const ticketVendorId =
      items.find(
        (item) =>
          (item.itemType === OrderItemType.ticket_type ||
            item.itemType === OrderItemType.ticket_variant) &&
          item.thirdPartyVendorId,
      )?.thirdPartyVendorId ?? null;

    let vendorId = ticketVendorId;
    // Addon-only carts: inherit the POS agent's shareholder vendor.
    // Event-owner ticket carts (null ticket vendor) must leave addons
    // unattributed — otherwise shareholder POS stamps create bogus
    // "Separate Addons" rows while tickets never enter vendor-product rollups.
    if (!vendorId && !hasTicketLines && opts.agentUserId) {
      const assignment = await this.prisma.staffAssignment.findFirst({
        where: {
          userId: opts.agentUserId,
          eventId: opts.eventId,
          status: StaffAssignmentStatus.active,
        },
        select: { thirdPartyVendorId: true, thirdPartyVendorIds: true },
      });
      vendorId =
        assignment?.thirdPartyVendorId ??
        assignment?.thirdPartyVendorIds?.[0] ??
        null;
    }
    if (!vendorId) return;

    for (const item of items) {
      if (
        (item.itemType === OrderItemType.addon ||
          item.itemType === OrderItemType.addon_variant) &&
        !item.thirdPartyVendorId
      ) {
        item.thirdPartyVendorId = vendorId;
      }
    }
  }

  private async findInventory(
    event: CheckoutEventRecord,
    session: CheckoutEventRecord['sessions'][number],
    itemType: InventoryItemType,
    itemId: string,
  ) {
    const existing = session.inventoryItems.find(
      (item) => item.itemType === itemType && item.itemId === itemId,
    );

    if (existing) {
      if (existing.status !== 'active') {
        throw new BadRequestException('Selected inventory is not available.');
      }
      return existing;
    }

    // Sessions with inventory tracking off often have no rows — create unlimited inventory
    // so holds/sales can still attach to a concrete inventory_item_id.
    try {
      const created = await this.prisma.inventoryItem.create({
        data: {
          eventId: event.id,
          eventSessionId: session.id,
          itemType,
          itemId,
          totalQuantity: session.capacity,
          status: 'active',
        },
      });
      session.inventoryItems.push(created);
      await this.catalog.invalidateEvent(event.slug).catch(() => undefined);
      return created;
    } catch {
      const recovered = await this.prisma.inventoryItem.findUnique({
        where: {
          eventSessionId_itemType_itemId: {
            eventSessionId: session.id,
            itemType,
            itemId,
          },
        },
      });
      if (!recovered || recovered.status !== 'active') {
        throw new BadRequestException('Selected inventory is not available.');
      }
      session.inventoryItems.push(recovered);
      return recovered;
    }
  }

  private assertSingleCurrency(items: ResolvedLineItem[]) {
    const currencies = new Set(
      items.flatMap((item) => [
        item.currency,
        ...item.customizations.map((option) => option.currency),
      ]),
    );
    if (currencies.size > 1) {
      throw new BadRequestException('All checkout items must use the same currency.');
    }
  }

  private resolveCustomizationLines(
    ticketType: CheckoutEventRecord['ticketTypes'][number],
    line: BookTicketLineItemDto,
  ): ResolvedCustomization[] {
    const requested = line.customization_options ?? [];
    if (!Array.isArray(requested)) {
      throw new BadRequestException('Customization options must be an array.');
    }
    if (requested.length === 0) return [];
    if (!ticketType.isCustomizable) {
      throw new BadRequestException(`Ticket ${line.ticket_id} cannot be customized.`);
    }

    const seen = new Set<string>();
    return requested.map((selection) => {
      const optionId = typeof selection.id === 'string' ? selection.id.trim() : '';
      if (!optionId || seen.has(optionId)) {
        throw new BadRequestException('Customization options must be unique.');
      }
      seen.add(optionId);

      const quantity = Number(selection.qty);
      if (!Number.isInteger(quantity) || quantity <= 0) {
        throw new BadRequestException(`Invalid quantity for customization ${optionId}.`);
      }
      const option = ticketType.customizationOptions.find(
        (candidate) => candidate.externalKey === optionId && candidate.status === 'active',
      );
      if (!option) {
        throw new BadRequestException(`Customization ${optionId} is not available.`);
      }
      const maximum =
        option.maxQtyPerTicket === null ? null : option.maxQtyPerTicket * Number(line.quantity);
      if (maximum !== null && quantity > maximum) {
        throw new BadRequestException(
          `Customization ${optionId} exceeds the maximum quantity of ${maximum}.`,
        );
      }

      return {
        publicOptionId: option.externalKey,
        itemId: option.id,
        displayName: option.name,
        quantity,
        unitPrice: option.price.toNumber(),
        currency: option.currency,
      };
    });
  }

  private async findConcurrentIdempotentOrder(idempotencyKeyValue: string) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const order = await this.prisma.order.findUnique({
        where: { idempotencyKey: idempotencyKeyValue },
        include: { items: true },
      });
      if (order) return order;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return null;
  }

  private async calculatePromoDiscount(
    promo: PromoRecord | null,
    eventId: string,
    eventOrganizationId: string,
    customerId: string,
    items: ResolvedLineItem[],
  ) {
    if (!promo) return 0;
    const now = new Date();
    if (
      promo.status !== 'active' ||
      (promo.startsAt && promo.startsAt > now) ||
      (promo.endsAt && promo.endsAt < now) ||
      (promo.maxRedemptionsPerCustomer !== null &&
        promo.redemptions.filter((item) => item.customerId === customerId).length >=
          promo.maxRedemptionsPerCustomer)
    ) {
      throw new BadRequestException('Promo code is invalid or no longer available.');
    }

    if (promo.organizationId !== eventOrganizationId) {
      throw new BadRequestException('Promo code is not valid for this event.');
    }

    const eventTargets = promo.targets.filter((target) => target.targetType === 'event');
    if (eventTargets.length > 0 && !eventTargets.some((target) => target.targetId === eventId)) {
      throw new BadRequestException('Promo code is not valid for this event.');
    }
    const customerTargets = promo.targets.filter((target) => target.targetType === 'customer');
    if (
      customerTargets.length > 0 &&
      !customerTargets.some((target) => target.targetId === customerId)
    ) {
      throw new BadRequestException('Promo code is not valid for this customer.');
    }
    const itemTargets = promo.targets.filter(
      (target) => target.targetType === 'ticket_type' || target.targetType === 'ticket_variant',
    );
    const eligible = items.filter((item) =>
      itemTargets.length === 0
        ? item.itemType === 'ticket_type' || item.itemType === 'ticket_variant'
        : itemTargets.some((target) => target.targetId === item.itemId),
    );
    if (eligible.length === 0) {
      throw new BadRequestException('Promo code is not valid for the selected tickets.');
    }
    const lineSubtotal = (item: ResolvedLineItem) =>
      item.unitPrice * item.quantity +
      item.customizations.reduce((sum, option) => sum + option.unitPrice * option.quantity, 0);
    if (promo.discountApplication === 'order_total') {
      const eligibleSubtotal = eligible.reduce((sum, item) => sum + lineSubtotal(item), 0);
      const value = promo.discountValue.toNumber();
      return this.roundMoney(
        Math.min(
          eligibleSubtotal,
          promo.discountType === 'percent' ? eligibleSubtotal * (value / 100) : value,
        ),
      );
    }
    return this.roundMoney(
      eligible.reduce((sum, item) => {
        const itemSubtotal = lineSubtotal(item);
        if (promo.discountType === 'percent') {
          return sum + itemSubtotal * (promo.discountValue.toNumber() / 100);
        }
        return sum + Math.min(itemSubtotal, promo.discountValue.toNumber() * item.quantity);
      }, 0),
    );
  }

  private async findOrCreateCustomer(
    customer: CheckoutCustomerDto,
    idempotencyKeyValue: string,
    authenticatedUserId?: string,
  ) {
    const name = customer.name?.trim() || 'Guest Customer';

    if (authenticatedUserId) {
      const existing = await this.prisma.user.findUnique({
        where: { id: authenticatedUserId },
      });
      if (!existing || existing.status !== 'active') {
        throw new UnauthorizedException('Invalid or expired session.');
      }
      return existing;
    }

    const guestEmail = `guest-${idempotencyKeyValue.toLowerCase()}@bookingqube.local`;
    const email = customer.email?.trim().toLowerCase();

    try {
      const existingGuest = await this.prisma.user.findUnique({
        where: { email: guestEmail },
      });
      if (existingGuest) {
        return existingGuest;
      }

      if (email) {
        const existing = await this.prisma.user.findUnique({ where: { email } });
        if (existing) {
          return this.prisma.user.create({
            data: { email: guestEmail, name },
          });
        }
        return this.prisma.user.create({
          data: { email, name: customer.name?.trim() || email },
        });
      }

      return this.prisma.user.create({
        data: { email: guestEmail, name },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new BadRequestException(
          'A customer with this email or phone already exists. Sign in to continue.',
        );
      }
      throw error;
    }
  }

  private shouldReturnBookingSecrets(
    orderCustomerId: string | null | undefined,
    input: { offlinePayment?: unknown; holdReleaseToken?: string | null },
    authenticatedUserId?: string,
    releaseTokenHash?: string | null,
  ) {
    if (input.offlinePayment) {
      return true;
    }
    const presented = input.holdReleaseToken?.trim();
    if (presented && releaseTokenHash && this.releaseTokenMatches(releaseTokenHash, presented)) {
      return true;
    }
    return Boolean(authenticatedUserId && orderCustomerId === authenticatedUserId);
  }

  private redactBookingSecretsIfNeeded(
    response: Record<string, unknown>,
    canSeeSecrets: boolean,
  ) {
    if (canSeeSecrets) {
      return response;
    }
    const data = response.data as Record<string, unknown> | undefined;
    if (!data) return response;
    return {
      ...response,
      data: {
        ...data,
        ticket_orders: [],
        hold_release_token: null,
        qpay_token: null,
      },
    };
  }

  private releaseTokenMatches(storedHash: string, presented: string) {
    const digest = createHash('sha256').update(presented).digest('hex');
    try {
      const a = Buffer.from(storedHash, 'utf8');
      const b = Buffer.from(digest, 'utf8');
      return a.length === b.length && timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  private toSuccessResponse(
    order: {
      commonOrder: string;
      idempotencyKey: string;
      totalAmount: Prisma.Decimal | number;
      currency: string;
      status: string;
      holdId?: string | null;
    },
    input: NormalizedBookTicketInput,
    items: Array<{
      ticketCode: string | null;
      displayName: string;
      publicItemId?: string | null;
    }>,
    holdReleaseToken?: string | null,
  ) {
    const paymentFlow = input.offlinePayment
      ? 'pos_offline'
      : input.paidPayment
        ? 'embedded'
        : 'local_pending';

    return {
      success: true,
      message: 'Booking created successfully.',
      data: {
        redirect_required: false,
        payment_flow: paymentFlow,
        payment_method: input.paymentMethod,
        offline_payment_mode: input.offlinePayment?.mode ?? null,
        is_advance_payment: false,
        url: null as string | null,
        common_order: order.commonOrder,
        order_no: order.commonOrder,
        ticket_orders: items
          .filter((item) => item.ticketCode)
          .map((item) => ({
            order_number: item.ticketCode!,
            ticket_title: item.displayName,
            ticket_id: item.publicItemId ?? null,
          })),
        total:
          typeof order.totalAmount === 'number' ? order.totalAmount : order.totalAmount.toNumber(),
        currency: order.currency,
        temp_order_id: order.idempotencyKey,
        hold_id: order.holdId ?? null,
        hold_release_token: holdReleaseToken ?? null,
        success_url: input.successUrl,
        failed_url: input.failedUrl,
        base_domain: input.baseDomain,
        status: order.status,
      },
    };
  }

  private mapTicketOrderItems(
    items: Array<{ ticketCode: string | null; displayName: string }>,
    publicIdByTicketCode: Record<string, string>,
  ) {
    return items.map((item) => ({
      ticketCode: item.ticketCode,
      displayName: item.displayName,
      publicItemId: item.ticketCode ? publicIdByTicketCode[item.ticketCode] ?? null : null,
    }));
  }

  private async mapTicketOrderItemsAsync(
    items: Array<{
      ticketCode: string | null;
      displayName: string;
      itemType: OrderItemType;
      itemId: string;
    }>,
  ) {
    const ticketed = items.filter((item) => item.ticketCode);
    if (!ticketed.length) {
      return items.map((item) => ({
        ticketCode: item.ticketCode,
        displayName: item.displayName,
        publicItemId: null as string | null,
      }));
    }

    const ticketTypeIds = ticketed
      .filter((item) => item.itemType === OrderItemType.ticket_type)
      .map((item) => item.itemId);
    const ticketVariantIds = ticketed
      .filter((item) => item.itemType === OrderItemType.ticket_variant)
      .map((item) => item.itemId);
    const addonIds = ticketed
      .filter((item) => item.itemType === OrderItemType.addon)
      .map((item) => item.itemId);
    const addonVariantIds = ticketed
      .filter((item) => item.itemType === OrderItemType.addon_variant)
      .map((item) => item.itemId);

    const [ticketTypes, ticketVariants, addons, addonVariants] = await Promise.all([
      ticketTypeIds.length
        ? this.prisma.ticketType.findMany({
            where: { id: { in: ticketTypeIds } },
            select: { id: true, externalKey: true },
          })
        : Promise.resolve([]),
      ticketVariantIds.length
        ? this.prisma.ticketVariant.findMany({
            where: { id: { in: ticketVariantIds } },
            select: { id: true, ticketType: { select: { externalKey: true } } },
          })
        : Promise.resolve([]),
      addonIds.length
        ? this.prisma.addon.findMany({
            where: { id: { in: addonIds } },
            select: { id: true, externalKey: true },
          })
        : Promise.resolve([]),
      addonVariantIds.length
        ? this.prisma.addonVariant.findMany({
            where: { id: { in: addonVariantIds } },
            select: { id: true, addon: { select: { externalKey: true } } },
          })
        : Promise.resolve([]),
    ]);

    const byId = new Map<string, string>();
    for (const row of ticketTypes) byId.set(`${OrderItemType.ticket_type}:${row.id}`, row.externalKey);
    for (const row of ticketVariants) {
      byId.set(`${OrderItemType.ticket_variant}:${row.id}`, row.ticketType.externalKey);
    }
    for (const row of addons) byId.set(`${OrderItemType.addon}:${row.id}`, row.externalKey);
    for (const row of addonVariants) {
      byId.set(`${OrderItemType.addon_variant}:${row.id}`, row.addon.externalKey);
    }

    return items.map((item) => ({
      ticketCode: item.ticketCode,
      displayName: item.displayName,
      publicItemId: byId.get(`${item.itemType}:${item.itemId}`) ?? null,
    }));
  }

  private toAdvanceSuccessResponse(advance: {
    commonOrder: string;
    totalAmount: Prisma.Decimal | number;
    advanceAmount: Prisma.Decimal | number;
    remainingAmount: Prisma.Decimal | number;
    currency: string;
    status: string;
    holdId?: string | null;
  }) {
    const total =
      typeof advance.totalAmount === 'number'
        ? advance.totalAmount
        : advance.totalAmount.toNumber();
    const advanceAmount =
      typeof advance.advanceAmount === 'number'
        ? advance.advanceAmount
        : advance.advanceAmount.toNumber();
    const remainingAmount =
      typeof advance.remainingAmount === 'number'
        ? advance.remainingAmount
        : advance.remainingAmount.toNumber();

    return {
      success: true,
      message: 'Advance payment recorded. Complete remaining payment to finalize booking.',
      data: {
        redirect_required: false,
        payment_flow: 'pos_advance',
        is_advance_payment: true,
        common_order: advance.commonOrder,
        order_no: advance.commonOrder,
        total,
        advance_amount: advanceAmount,
        remaining_amount: remainingAmount,
        currency: advance.currency,
        hold_id: advance.holdId ?? null,
        status: advance.status,
      },
    };
  }

  private async persistAdvancePayment(args: {
    event: CheckoutEventRecord;
    session: { id: string; eventDateId: string; displayTime: string };
    customer: { id: string; name: string; email: string; phone: string | null };
    sortedItems: ResolvedLineItem[];
    normalized: NormalizedBookTicketInput;
    deltas: InventoryDelta[];
    usesCapacityInventory: boolean;
    usedRedis: boolean;
    subtotal: number;
    discountAmount: number;
    taxAmount: number;
    totalAmount: number;
    currency: string;
    bookedByAgentId: string | null;
    appliedTimeExtensions: AppliedTimeExtension[];
    now: Date;
  }) {
    const {
      event,
      session,
      customer,
      sortedItems,
      normalized,
      usedRedis,
      deltas,
      usesCapacityInventory,
      subtotal,
      discountAmount,
      taxAmount,
      totalAmount,
      currency,
      bookedByAgentId,
      appliedTimeExtensions,
      now,
    } = args;
    const offline = normalized.offlinePayment!;
    const initiatorId = bookedByAgentId ?? customer.id;

    const commonOrder = this.generateCommonOrder();
    const remainingAmount = this.roundMoney(totalAmount - offline.advanceAmount);

    return this.prisma.$transaction(async (tx) => {
      // Capacity-limited schedules only: sync held inventory + TicketHold.
      // Unlimited schedules store advance without inventory hold.
      if (usedRedis && usesCapacityInventory && deltas.length > 0) {
        await this.inventory.syncReserveToPostgres(tx, deltas, 'hold');
      }

      const hold =
        usesCapacityInventory
          ? await tx.ticketHold.create({
              data: {
                customerId: customer.id,
                eventId: event.id,
                eventSessionId: session.id,
                idempotencyKey: normalized.idempotencyKey,
                status: 'active',
                // Far-future placeholder — advance holds are not auto-expired.
                expiresAt: new Date(now.getTime() + ADVANCE_HOLD_TTL_MS),
                items: {
                  create: sortedItems.map((item) => ({
                    inventoryItemId: item.inventoryItemId,
                    itemType: item.inventoryItemType,
                    itemId: item.itemId,
                    quantity: item.quantity,
                    unitPrice: item.unitPrice,
                    currency: item.currency,
                  })),
                },
              },
            })
          : null;

      const bookingData = {
        idempotency_key: normalized.idempotencyKey,
        event_slug: normalized.eventSlug,
        schedule: { date: normalized.scheduleDate, time: normalized.scheduleTime },
        tickets: normalized.tickets,
        addons: normalized.addons,
        promo_code: normalized.promoCode,
        customer: normalized.customer,
        metadata: normalized.metadata,
        time_extensions: appliedTimeExtensions,
        waiver: normalized.waiver,
        totals: {
          subtotal,
          discount_amount: discountAmount,
          tax_amount: taxAmount,
          total: totalAmount,
          currency,
        },
        resolved_items: sortedItems.map((item) => ({
          itemType: item.itemType,
          itemId: item.itemId,
          inventoryItemId: item.inventoryItemId,
          inventoryItemType: item.inventoryItemType,
          displayName: item.displayName,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          currency: item.currency,
          admitCount: item.admitCount,
          thirdPartyVendorId: item.thirdPartyVendorId,
          ticketIsCafe: item.ticketIsCafe,
          ticketIsPosOnly: item.ticketIsPosOnly,
          ticketHideFromOnline: item.ticketHideFromOnline,
          rfidCodes: item.rfidCodes,
          customizations: item.customizations,
          publicItemId: item.publicItemId,
          publicVariantId: item.publicVariantId,
        })),
      } as unknown as Prisma.InputJsonValue;

      const advance = await tx.advancePayment.create({
        data: {
          commonOrder,
          eventId: event.id,
          organizationId: event.organizationId,
          venueId: event.venueId,
          holdId: hold?.id ?? null,
          customerId: customer.id,
          customerName: customer.name,
          customerEmail: customer.email,
          customerPhone: customer.phone,
          bookingData,
          currency,
          totalAmount,
          advanceAmount: offline.advanceAmount,
          remainingAmount,
          advanceLegType:
            offline.advanceType === 'card' ? PaymentLegType.card : PaymentLegType.cash,
          initiatedByUserId: initiatorId,
          status: AdvancePaymentStatus.PENDING,
        },
      });

      return { advance, holdId: hold?.id ?? null };
    });
  }

  async listPendingAdvancePayments(search: string, eventId?: string) {
    const q = search.trim();
    if (!q) {
      throw new BadRequestException('search is required.');
    }
    if (!eventId?.trim()) {
      throw new BadRequestException('event_id is required.');
    }
    const rows = await this.prisma.advancePayment.findMany({
      where: {
        status: AdvancePaymentStatus.PENDING,
        eventId,
        OR: [
          { commonOrder: { contains: q, mode: 'insensitive' } },
          { customerName: { contains: q, mode: 'insensitive' } },
          { customerEmail: { contains: q, mode: 'insensitive' } },
          ...(q.replace(/\D/g, '').length >= 4
            ? [{ customerPhone: { contains: q.replace(/\D/g, '') } }]
            : []),
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return {
      success: true,
      data: rows.map((row) => ({
        id: row.id,
        common_order: row.commonOrder,
        customer_name: row.customerName,
        customer_email: row.customerEmail,
        customer_phone: row.customerPhone,
        total_amount: row.totalAmount.toNumber(),
        advance_amount: row.advanceAmount.toNumber(),
        remaining_amount: row.remainingAmount.toNumber(),
        advance_type: row.advanceLegType === PaymentLegType.card ? 'card' : 'cash',
        currency: row.currency,
        event_id: row.eventId,
        status: row.status,
        created_at: row.createdAt,
      })),
    };
  }

  async completeAdvancePayment(
    input: {
      common_order: string;
      remaining_payment: 'cash' | 'card';
    },
    authenticatedUserId?: string,
    scopedEventId?: string,
  ) {
    const remainingPayment = input.remaining_payment;
    if (remainingPayment !== 'cash' && remainingPayment !== 'card') {
      throw new BadRequestException('remaining_payment must be cash or card.');
    }

    const advance = await this.prisma.advancePayment.findUnique({
      where: { commonOrder: input.common_order },
      include: { hold: { include: { items: true } } },
    });
    if (!advance) throw new NotFoundException('Advance payment not found.');
    if (scopedEventId && advance.eventId !== scopedEventId) {
      throw new NotFoundException('Advance payment not found.');
    }
    if (advance.status !== AdvancePaymentStatus.PENDING) {
      throw new BadRequestException(`Advance payment is ${advance.status}.`);
    }

    const bookingData = advance.bookingData as Record<string, unknown>;
    const resolvedItems = (bookingData.resolved_items ?? []) as Array<{
      itemType: OrderItemType;
      itemId: string;
      inventoryItemId: string;
      inventoryItemType: InventoryItemType;
      displayName: string;
      quantity: number;
      unitPrice: number;
      currency: string;
      admitCount: number;
      thirdPartyVendorId: string | null;
      ticketIsCafe: boolean;
      ticketIsPosOnly: boolean;
      ticketHideFromOnline: boolean;
      rfidCodes: string[];
      customizations: ResolvedCustomization[];
      publicItemId: string;
      publicVariantId: string | null;
    }>;
    if (resolvedItems.length === 0) {
      throw new BadRequestException('Advance booking data is incomplete.');
    }

    const completedBy = authenticatedUserId ?? advance.initiatedByUserId;
    const holdItems = advance.hold?.items ?? [];
    const deltas = this.inventory.sortDeltas(
      (holdItems.length > 0 ? holdItems : resolvedItems).map((item) => ({
        inventoryItemId: item.inventoryItemId,
        quantity: item.quantity,
      })),
    );

    // Prefer convert when a capacity hold is still active. Unlimited schedules have
    // no inventory hold — reserve/convert are no-ops after capacity filtering.
    // If an older short TTL already expired a limited hold, re-claim as sold.
    const holdIsActive = advance.hold?.status === 'active';
    if (holdIsActive) {
      await this.inventory.convert(deltas);
      if (advance.holdId) {
        await this.jobs.cancelHoldExpiry(advance.holdId);
      }
    } else if (deltas.length > 0) {
      await this.inventory.reserve(deltas, 'sold');
    }

    const now = new Date();
    const totalAmount = advance.totalAmount.toNumber();
    const advanceAmount = advance.advanceAmount.toNumber();
    const remainingAmount = advance.remainingAmount.toNumber();
    const advanceType = advance.advanceLegType === PaymentLegType.card ? 'card' : 'cash';
    const tender = tenderFromAdvanceLegs(
      advanceAmount,
      advanceType,
      remainingAmount,
      remainingPayment,
    );

    const event = await this.catalog.getPublishedEventBySlug(
      String((bookingData.event_slug as string) ?? ''),
    );
    const schedule = bookingData.schedule as { date?: string; time?: string } | undefined;
    const session = this.findSession(
      event,
      String(schedule?.date ?? ''),
      String(schedule?.time ?? ''),
    );
    const eventDate = event.dates.find((d) => d.id === session.eventDateId);
    const eventTitle =
      event.translations?.find((t) => t.locale === 'en')?.title ??
      event.translations?.[0]?.title ??
      event.slug;

    const enricherLines = resolvedItems.flatMap((item) => [
      {
        itemType: item.itemType,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        lineTotal: this.roundMoney(item.unitPrice * item.quantity),
        admitCount: item.admitCount,
        thirdPartyVendorId: item.thirdPartyVendorId,
        ticketIsCafe: item.ticketIsCafe,
        ticketIsPosOnly: item.ticketIsPosOnly,
        ticketHideFromOnline: item.ticketHideFromOnline,
      },
      ...(item.customizations ?? []).map((option) => ({
        itemType: OrderItemType.customization,
        quantity: option.quantity,
        unitPrice: option.unitPrice,
        lineTotal: this.roundMoney(option.unitPrice * option.quantity),
        admitCount: 0,
        thirdPartyVendorId: item.thirdPartyVendorId,
        ticketIsCafe: false,
        ticketIsPosOnly: false,
        ticketHideFromOnline: false,
      })),
    ]);
    const header = this.enricher.buildHeader(enricherLines, {
      organizationId: event.organizationId,
      venueId: event.venueId,
      eventSlug: event.slug,
      eventTitle,
      eventStartDate: eventDate?.date ?? null,
      eventStartTime: session.displayTime,
      isSummerCamp: event.eventType === 'summer_camp',
      customerName: advance.customerName,
      customerEmail: advance.customerEmail,
      customerPhone: advance.customerPhone,
      source: 'pos',
      hasPromo: false,
      isPaid: true,
      offlinePaymentMode: 'advance',
    });

    const idempotencyKeyValue = String(
      (bookingData.idempotency_key as string) ?? `advance-complete-${advance.id}`,
    );

    const orderResult = await this.prisma.$transaction(async (tx) => {
      if (!holdIsActive && this.inventory.usesRedis()) {
        await this.inventory.syncReserveToPostgres(tx, deltas, 'sold');
      }

      const order = await tx.order.create({
        data: {
          commonOrder: advance.commonOrder,
          idempotencyKey: `${idempotencyKeyValue}-complete`,
          customerId: advance.customerId ?? (await this.ensureAdvanceCustomer(advance)).id,
          eventId: advance.eventId,
          eventSessionId: session.id,
          holdId: advance.holdId,
          status: 'paid',
          paymentStatus: PaymentStatus.paid,
          currency: advance.currency,
          subtotalAmount: totalAmount,
          discountAmount: 0,
          taxAmount: 0,
          totalAmount,
          source: 'pos',
          locale: 'en',
          metadata: {
            advance_payment_id: advance.id,
            completed_from_advance: true,
            time_extensions: bookingData.time_extensions ?? [],
          },
          paidAt: now,
          organizationId: header.organizationId,
          venueId: header.venueId,
          eventSlug: header.eventSlug,
          eventTitle: header.eventTitle,
          eventStartDate: header.eventStartDate,
          eventStartTime: header.eventStartTime,
          customerName: header.customerName,
          customerEmail: header.customerEmail,
          customerPhone: header.customerPhone,
          paymentMode: ReportPaymentMode.advance,
          paymentMethodLabel: 'Advance',
          cashAmount: tender.cashAmount,
          cardAmount: tender.cardAmount,
          onlineAmount: 0,
          compAmount: 0,
          bookedByAgentId: advance.initiatedByUserId,
          ticketsNet: header.ticketsNet,
          addonsNet: header.addonsNet,
          extensionsNet: header.extensionsNet,
          totalQuantity: header.totalQuantity,
          totalAdmits: header.totalAdmits,
          isSummerCamp: header.isSummerCamp,
          reportVersion: 1,
          reportSyncPending: false,
        },
      });

      const usedTicketCodes = new Set<string>();
      for (const item of resolvedItems) {
        const lineSubtotal = this.roundMoney(item.unitPrice * item.quantity);
        const lineSnap = this.enricher.classifyLine(
          {
            itemType: item.itemType,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            lineTotal: lineSubtotal,
            admitCount: item.admitCount,
            thirdPartyVendorId: item.thirdPartyVendorId,
            ticketIsCafe: item.ticketIsCafe,
            ticketIsPosOnly: item.ticketIsPosOnly,
            ticketHideFromOnline: item.ticketHideFromOnline,
          },
          { hasPromo: false, source: 'pos', offlinePaymentMode: 'advance' },
        );
        const parentItem = await tx.orderItem.create({
          data: {
            orderId: order.id,
            eventId: advance.eventId,
            eventSessionId: session.id,
            inventoryItemId: item.inventoryItemId,
            itemType: item.itemType,
            itemId: item.itemId,
            displayName: item.displayName,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            subtotalAmount: lineSubtotal,
            discountAmount: 0,
            taxAmount: 0,
            totalAmount: lineSubtotal,
            currency: item.currency,
            ticketCode: this.generateTicketOrderNumber(advance.commonOrder, usedTicketCodes),
            rfidCodes: Array.isArray(item.rfidCodes) ? item.rfidCodes : [],
            visitorType: lineSnap.visitorType,
            thirdPartyVendorId: lineSnap.thirdPartyVendorId,
            admitCount: lineSnap.admitCount,
            ticketIsCafe: lineSnap.ticketIsCafe,
            ticketIsPosOnly: lineSnap.ticketIsPosOnly,
            ticketHideFromOnline: lineSnap.ticketHideFromOnline,
            bookedByAgentId: advance.initiatedByUserId,
          },
        });
        if (item.customizations?.length) {
          await tx.orderItem.createMany({
            data: item.customizations.map((option) => {
              const optionSubtotal = this.roundMoney(option.unitPrice * option.quantity);
              return {
                orderId: order.id,
                eventId: advance.eventId,
                eventSessionId: session.id,
                inventoryItemId: null,
                itemType: OrderItemType.customization,
                itemId: option.itemId,
                parentOrderItemId: parentItem.id,
                displayName: option.displayName,
                quantity: option.quantity,
                unitPrice: option.unitPrice,
                subtotalAmount: optionSubtotal,
                discountAmount: 0,
                taxAmount: 0,
                totalAmount: optionSubtotal,
                currency: option.currency,
                visitorType: 'paid' as const,
                thirdPartyVendorId: lineSnap.thirdPartyVendorId,
                admitCount: 0,
                ticketIsCafe: false,
                ticketIsPosOnly: false,
                ticketHideFromOnline: false,
                bookedByAgentId: advance.initiatedByUserId,
              };
            }),
          });
        }
      }

      await createOfflinePaymentLegs(tx, {
        orderId: order.id,
        offline: null,
        totalAmount,
        currency: advance.currency,
        defaultLegType: PaymentLegType.other,
        collectedByUserId: completedBy,
        now,
        extraLegs: [
          {
            legType: advance.advanceLegType,
            amount: advanceAmount,
            methodKey: `pos-advance-${advanceType}`,
          },
          {
            legType: remainingPayment === 'card' ? PaymentLegType.card : PaymentLegType.cash,
            amount: remainingAmount,
            methodKey: `pos-advance-remaining-${remainingPayment}`,
          },
        ].filter((leg) => leg.amount > 0),
      });

      if (advance.holdId) {
        await tx.ticketHold.update({
          where: { id: advance.holdId },
          data: { status: 'converted' },
        });
      }

      await tx.advancePayment.update({
        where: { id: advance.id },
        data: {
          status: AdvancePaymentStatus.COMPLETED,
          completedByUserId: completedBy,
          completedLegType:
            remainingPayment === 'card' ? PaymentLegType.card : PaymentLegType.cash,
          completedAt: now,
          orderId: order.id,
        },
      });

      return tx.order.findUniqueOrThrow({
        where: { id: order.id },
        include: { items: true },
      });
    });

    await this.jobs.enqueueReportSync({ orderId: orderResult.id, action: 'paid' });

    this.mailService.queueBookingConfirmationEmail(orderResult.commonOrder, 'offline');
    this.smsService.queueBookingConfirmationSms(orderResult.commonOrder, 'offline');

    return {
      success: true,
      message: 'Advance booking completed.',
      data: {
        is_advance_payment: true,
        common_order: orderResult.commonOrder,
        status: orderResult.status,
        total: orderResult.totalAmount.toNumber(),
        currency: orderResult.currency,
        cash_amount: tender.cashAmount,
        card_amount: tender.cardAmount,
      },
    };
  }

  private async ensureAdvanceCustomer(advance: {
    customerId: string | null;
    customerName: string;
    customerEmail: string;
    customerPhone: string | null;
  }) {
    if (advance.customerId) {
      const existing = await this.prisma.user.findUnique({ where: { id: advance.customerId } });
      if (existing) return existing;
    }
    return this.prisma.user.upsert({
      where: { email: advance.customerEmail },
      update: {
        name: advance.customerName,
        phone: advance.customerPhone ?? undefined,
      },
      create: {
        email: advance.customerEmail,
        name: advance.customerName,
        phone: advance.customerPhone ?? undefined,
      },
    });
  }

  private generateCommonOrder() {
    // Compact: BQ- + 10 hex chars (not a full millisecond timestamp).
    return `BQ-${randomBytes(5).toString('hex').toUpperCase()}`;
  }

  /** Per-line ticket order number: commonOrder + short random suffix (not sequential -01/-02). */
  private generateTicketOrderNumber(commonOrder: string, used: Set<string>): string {
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const suffix = randomBytes(2).toString('hex').toUpperCase();
      const code = `${commonOrder}-${suffix}`;
      if (!used.has(code)) {
        used.add(code);
        return code;
      }
    }
    throw new BadRequestException('Unable to allocate ticket order numbers.');
  }

  private normalizeLocale(locale: string) {
    return locale.trim().toLowerCase() === 'ar' ? 'ar' : 'en';
  }

  private roundMoney(value: number) {
    return Math.round((value + Number.EPSILON) * 1000) / 1000;
  }
}
