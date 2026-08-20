import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PosAuthGuard } from '../pos/guards/pos-auth.guard';
import { AuthenticatedPosAgent } from '../pos/strategies/pos-jwt.strategy';
import { PromoApplyRequestDto } from '../promocodes/dto/promo-apply.dto';
import { PromocodesService } from '../promocodes/promocodes.service';
import { PrismaService } from '../../database/prisma.service';
import { qatarDateKey } from '../admin-daily-closings/daily-closing-totals.service';
import { PosBookTicketRequestDto } from './dto/book-ticket.dto';
import { CheckoutService } from './checkout.service';

@Controller('pos')
@UseGuards(PosAuthGuard)
export class PosCheckoutController {
  constructor(
    private readonly checkoutService: CheckoutService,
    private readonly prisma: PrismaService,
    private readonly promocodesService: PromocodesService,
  ) {}

  /**
   * List POS agents assigned to the logged-in agent's event.
   * GET /api/v2/pos/agents
   */
  @Get('agents')
  async listAgents(
    @CurrentUser() agent: AuthenticatedPosAgent,
    @Query('event_slug') eventSlug?: string,
    @Query('event_id') eventId?: string,
  ) {
    const event = await this.resolveEvent(agent, eventSlug, eventId);

    const assignments = await this.prisma.staffAssignment.findMany({
      where: {
        eventId: event.id,
        status: 'active',
        role: { name: 'pos' },
        user: { status: 'active' },
      },
      include: {
        user: {
          select: { id: true, name: true, email: true, username: true },
        },
      },
      orderBy: { user: { name: 'asc' } },
      take: 200,
    });

    return {
      success: true,
      data: {
        event_id: event.id,
        event_slug: event.slug,
        organization_id: event.organizationId,
        agents: assignments.map((row) => ({
          id: row.user.id,
          name: row.user.name,
          email: row.user.email,
          username: row.user.username,
          assignment_id: row.id,
        })),
      },
    };
  }

  /**
   * Validate a promocode for the POS cart (same rules as customer
   * `POST /promocodes/apply`). `event_slug` is optional; the assigned event is used.
   * POST /api/v2/pos/promocodes/apply
   */
  @Post('promocodes/apply')
  @HttpCode(200)
  async applyPromocode(
    @CurrentUser() agent: AuthenticatedPosAgent,
    @Body() body: PromoApplyRequestDto,
    @Query('lang') lang = 'en',
  ) {
    const event = await this.resolveEvent(agent, body.event_slug?.trim());

    return this.promocodesService.applyPromocode(
      {
        ...body,
        event_slug: event.slug,
        selected_tickets: body.selected_tickets ?? body.tickets,
      },
      lang,
    );
  }

  /**
   * Dedicated POS sell API. Requires a POS JWT; the logged-in agent is the seller.
   * POST /api/v2/pos/book-ticket
   */
  @Post('book-ticket')
  @HttpCode(200)
  async bookTicket(
    @CurrentUser() agent: AuthenticatedPosAgent,
    @Body() body: PosBookTicketRequestDto,
    @Query('lang') lang = 'en',
  ) {
    if (body.agent_id?.trim() && body.agent_id.trim() !== agent.id) {
      throw new BadRequestException(
        'agent_id does not match the logged-in POS agent.',
      );
    }

    if (!body.offline_payment?.mode) {
      throw new BadRequestException('offline_payment.mode is required for POS checkout.');
    }

    const event = await this.resolveEvent(agent, body.event_slug?.trim());

    const assignment = await this.prisma.staffAssignment.findFirst({
      where: {
        eventId: event.id,
        userId: agent.id,
        status: 'active',
        role: { name: 'pos' },
      },
      select: { id: true },
    });
    if (!assignment) {
      throw new BadRequestException(
        'Logged-in agent is not assigned as POS staff for this event.',
      );
    }

    const today = qatarDateKey();
    const closedShift = await this.prisma.dailyClosing.findFirst({
      where: {
        agentId: agent.id,
        eventId: event.id,
        closingForDate: new Date(`${today}T00:00:00.000Z`),
        deletedAt: null,
      },
      select: { closingCode: true },
    });
    if (closedShift) {
      throw new ConflictException(
        `Your shift for ${today} is closed. No more sales can be recorded today.`,
      );
    }

    const posBody: PosBookTicketRequestDto = {
      ...body,
      agent_id: agent.id,
      event_slug: event.slug,
      metadata: {
        ...body.metadata,
        source: 'pos',
        locale: body.metadata?.locale ?? lang,
      },
      offline_payment: {
        ...body.offline_payment,
        agent_id: agent.id,
        booked_by_agent_id: agent.id,
      },
    };

    return this.checkoutService.bookTicket(
      posBody,
      lang,
      agent.id,
      { allowOfflinePayment: true },
    );
  }

  @Post('advance-payments/pending')
  @HttpCode(200)
  async listPendingAdvance(
    @CurrentUser() agent: AuthenticatedPosAgent,
    @Body() body: { search?: string; event_id?: string; event_slug?: string },
  ) {
    const event = await this.resolveEvent(agent, body.event_slug, body.event_id);
    return this.checkoutService.listPendingAdvancePayments(
      body.search ?? '',
      event.id,
    );
  }

  @Post('advance-payments/complete')
  @HttpCode(200)
  async completeAdvance(
    @CurrentUser() agent: AuthenticatedPosAgent,
    @Body() body: {
      common_order?: string;
      remaining_payment?: 'cash' | 'card';
      agent_id?: string;
    },
  ) {
    if (!body.common_order) {
      throw new BadRequestException('common_order is required.');
    }
    if (body.agent_id?.trim() && body.agent_id.trim() !== agent.id) {
      throw new BadRequestException(
        'agent_id does not match the logged-in POS agent.',
      );
    }
    return this.checkoutService.completeAdvancePayment(
      {
        common_order: body.common_order,
        remaining_payment: body.remaining_payment ?? 'cash',
      },
      agent.id,
      agent.eventId,
    );
  }

  private async resolveEvent(
    agent: AuthenticatedPosAgent,
    eventSlug?: string,
    eventId?: string,
  ) {
    const slug = eventSlug?.trim();
    const id = eventId?.trim();

    if (id && id !== agent.eventId) {
      throw new ForbiddenException(
        'Logged-in POS agent is not assigned to this event.',
      );
    }
    const event = await this.prisma.event.findFirst({
      where: { id: agent.eventId },
      select: { id: true, slug: true, organizationId: true },
    });
    if (!event) {
      throw new BadRequestException('Assigned event not found.');
    }
    if (slug && event.slug !== slug) {
      throw new ForbiddenException(
        'Logged-in POS agent is not assigned to this event.',
      );
    }
    return event;
  }
}
