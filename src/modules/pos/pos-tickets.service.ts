import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';

import { PrismaService } from '../../database/prisma.service';
import { AuthenticatedPosAgent } from './strategies/pos-jwt.strategy';

type TimeExtensionRow = {
  id: string;
  title: string;
  title_ar: string;
  minutes: number;
  price: number;
  scope: 'ticket' | 'order';
  ticket_ids: string[];
};

type EntryAccessRow = {
  pass_type: 'rfid' | 'barcode' | 'other' | null;
  other_label: string;
  scan_length: number;
};

@Injectable()
export class PosTicketsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lean POS catalog for the agent's assigned event.
   * - Always excludes hideFromPos=true ("hide to offline").
   * - If agent has third-party shareholder(s): only those vendors' tickets.
   * - If no shareholder: all offline tickets for the event.
   * - Optional ticketTypeIds further narrows the list when set.
   * - Also returns POS addons and time extensions.
   */
  async listTickets(agent: AuthenticatedPosAgent) {
    // PK lookup — confirms assignment still active without heavy joins.
    const assignment = await this.prisma.staffAssignment.findFirst({
      where: {
        id: agent.assignmentId,
        userId: agent.id,
        status: 'active',
        role: { name: 'pos' },
      },
      select: {
        eventId: true,
        ticketTypeIds: true,
        thirdPartyVendorId: true,
        thirdPartyVendorIds: true,
        event: {
          select: {
            id: true,
            moreOpsConfig: true,
          },
        },
      },
    });

    if (!assignment?.eventId || !assignment.event) {
      throw new UnauthorizedException('Invalid or expired POS session.');
    }

    const now = new Date();
    const ticketTypeIds = assignment.ticketTypeIds;
    // Prefer multi-vendor list; fall back to legacy single shareholder id.
    const vendorIds = [
      ...new Set(
        [
          ...assignment.thirdPartyVendorIds,
          assignment.thirdPartyVendorId,
        ].filter((id): id is string => Boolean(id)),
      ),
    ];

    const ticketWhere: Prisma.TicketTypeWhereInput = {
      eventId: assignment.eventId,
      status: 'active',
      hideFromPos: false,
      AND: [
        {
          OR: [{ salesStartAt: null }, { salesStartAt: { lte: now } }],
        },
        {
          OR: [{ salesEndAt: null }, { salesEndAt: { gte: now } }],
        },
        // Shareholder-scoped agent → only that vendor's tickets.
        // No shareholder → all offline tickets for the event.
        ...(vendorIds.length
          ? [{ thirdPartyVendorId: { in: vendorIds } }]
          : []),
        ...(ticketTypeIds.length
          ? [{ id: { in: ticketTypeIds } }]
          : []),
      ],
    };

    const [tickets, addons] = await Promise.all([
      this.prisma.ticketType.findMany({
        where: ticketWhere,
        select: {
          id: true,
          externalKey: true,
          title: true,
          subtitle: true,
          basePrice: true,
          currency: true,
          admitCount: true,
          maxQtyPerOrder: true,
          hasVariants: true,
          isCustomizable: true,
          hasDuration: true,
          durationMinutes: true,
          sortOrder: true,
          isThirdPartyPlatformTicket: true,
          thirdPartyPlatform: {
            select: {
              id: true,
              name: true,
              badgeColor: true,
            },
          },
          variants: {
            where: { status: 'active' },
            select: {
              id: true,
              externalKey: true,
              name: true,
              description: true,
              basePrice: true,
              currency: true,
              durationMinutes: true,
              maxQtyPerOrder: true,
              sortOrder: true,
            },
            orderBy: { sortOrder: 'asc' },
          },
          customizationOptions: {
            where: { status: 'active' },
            select: {
              id: true,
              externalKey: true,
              name: true,
              description: true,
              price: true,
              currency: true,
              maxQtyPerTicket: true,
              sortOrder: true,
            },
            orderBy: { sortOrder: 'asc' },
          },
        },
        orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
      }),
      this.prisma.addon.findMany({
        where: {
          eventId: assignment.eventId,
          status: 'active',
          hideFromPos: false,
          forCafeOnly: false,
        },
        select: {
          id: true,
          externalKey: true,
          title: true,
          titleAr: true,
          subtitle: true,
          subtitleAr: true,
          iconType: true,
          thumbnailUrl: true,
          basePrice: true,
          currency: true,
          maxQtyPerOrder: true,
          hasVariants: true,
          sortOrder: true,
          variants: {
            where: { status: 'active' },
            select: {
              id: true,
              externalKey: true,
              name: true,
              description: true,
              basePrice: true,
              currency: true,
              badge: true,
              maxQtyPerOrder: true,
              sortOrder: true,
            },
            orderBy: { sortOrder: 'asc' },
          },
        },
        orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
      }),
    ]);

    const timeExtensions = await this.parseTimeExtensions(
      assignment.event.id,
      assignment.event.moreOpsConfig,
    );
    const entryAccess = this.parseEntryAccess(assignment.event.moreOpsConfig);

    return {
      success: true,
      data: {
        tickets: tickets.map((ticket) => ({
          id: ticket.id,
          ticket_id: ticket.externalKey,
          title: ticket.title,
          subtitle: ticket.subtitle ?? '',
          price: ticket.basePrice?.toNumber() ?? null,
          currency: ticket.currency,
          admits: ticket.admitCount,
          max_qty_per_order: ticket.maxQtyPerOrder,
          has_variants: ticket.hasVariants,
          is_customizable: ticket.isCustomizable,
          has_duration: ticket.hasDuration,
          duration_minutes: ticket.durationMinutes,
          is_third_party_platform_ticket: ticket.isThirdPartyPlatformTicket,
          third_party_platform: ticket.thirdPartyPlatform
            ? {
                id: ticket.thirdPartyPlatform.id,
                name: ticket.thirdPartyPlatform.name,
                badge_color: ticket.thirdPartyPlatform.badgeColor,
              }
            : null,
          variants: ticket.variants.map((variant) => ({
            id: variant.id,
            variant_id: variant.externalKey,
            name: variant.name,
            description: variant.description,
            price: variant.basePrice.toNumber(),
            currency: variant.currency,
            duration_minutes: variant.durationMinutes,
            max_qty_per_order: variant.maxQtyPerOrder,
          })),
          customization_options: ticket.customizationOptions.map((option) => ({
            id: option.id,
            option_id: option.externalKey,
            name: option.name,
            description: option.description ?? '',
            price: option.price.toNumber(),
            currency: option.currency,
            max_qty: option.maxQtyPerTicket ?? 20,
          })),
        })),
        addons: addons.map((addon) => ({
          id: addon.id,
          addon_id: addon.externalKey,
          title: addon.title,
          title_ar: addon.titleAr ?? null,
          subtitle: addon.subtitle ?? '',
          subtitle_ar: addon.subtitleAr ?? null,
          icon_type: addon.iconType ?? 'addon',
          thumbnail_url: addon.thumbnailUrl,
          price: addon.basePrice?.toNumber() ?? null,
          currency: addon.currency,
          max_qty_per_order: addon.maxQtyPerOrder,
          has_variants: addon.hasVariants,
          variants: addon.variants.map((variant) => ({
            id: variant.id,
            variant_id: variant.externalKey,
            name: variant.name,
            description: variant.description,
            price: variant.basePrice.toNumber(),
            currency: variant.currency,
            badge: variant.badge,
            max_qty_per_order: variant.maxQtyPerOrder,
          })),
        })),
        time_extensions: timeExtensions,
        entry_access: entryAccess,
      },
    };
  }

  private parseEntryAccess(raw: Prisma.JsonValue | null): EntryAccessRow {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { pass_type: null, other_label: '', scan_length: 8 };
    }
    const config = raw as Record<string, unknown>;
    const entry =
      config.entry_access && typeof config.entry_access === 'object' && !Array.isArray(config.entry_access)
        ? (config.entry_access as Record<string, unknown>)
        : {};
    const passType = entry.pass_type;
    return {
      pass_type:
        passType === 'rfid' || passType === 'barcode' || passType === 'other'
          ? passType
          : null,
      other_label: typeof entry.other_label === 'string' ? entry.other_label : '',
      scan_length:
        typeof entry.scan_length === 'number' && Number.isFinite(entry.scan_length)
          ? Math.min(64, Math.max(4, Math.round(entry.scan_length)))
          : 8,
    };
  }

  private async parseTimeExtensions(
    eventId: string,
    raw: Prisma.JsonValue | null,
  ): Promise<TimeExtensionRow[]> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return [];
    }
    const config = raw as Record<string, unknown>;
    if (!Array.isArray(config.time_extensions)) {
      return [];
    }

    let missingId = false;
    const packs = config.time_extensions.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const row = item as Record<string, unknown>;
      if (typeof row.title !== 'string' || !row.title.trim()) return [];
      const id =
        typeof row.id === 'string' && row.id.trim() ? row.id.trim() : randomUUID();
      if (!(typeof row.id === 'string' && row.id.trim())) missingId = true;
      return [
        {
          id,
          title: row.title.trim(),
          title_ar: typeof row.title_ar === 'string' ? row.title_ar : '',
          minutes:
            typeof row.minutes === 'number'
              ? row.minutes
              : typeof row.duration === 'number'
                ? row.duration
                : 30,
          price: typeof row.price === 'number' ? row.price : 0,
          scope: row.scope === 'order' ? 'order' as const : 'ticket' as const,
          ticket_ids: Array.isArray(row.ticket_ids)
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

    if (missingId && packs.length) {
      await this.prisma.event.update({
        where: { id: eventId },
        data: {
          moreOpsConfig: {
            ...config,
            time_extensions: packs,
          } as Prisma.InputJsonValue,
        },
      });
    }

    return packs;
  }
}
