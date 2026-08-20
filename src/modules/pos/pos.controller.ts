import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentPosAgent } from './decorators/current-pos-agent.decorator';
import { PosAuthGuard } from './guards/pos-auth.guard';
import { PosTicketsService } from './pos-tickets.service';
import { AuthenticatedPosAgent } from './strategies/pos-jwt.strategy';

@ApiTags('pos-tickets')
@Controller('pos')
export class PosTicketsController {
  constructor(private readonly posTickets: PosTicketsService) {}

  /**
   * Tickets for the logged-in POS agent's assigned event.
   * Hides tickets with hide_from_pos = true ("hide to offline").
   * GET /api/v1/pos/tickets
   */
  @Get('tickets')
  @ApiBearerAuth()
  @UseGuards(PosAuthGuard)
  listTickets(@CurrentPosAgent() agent: AuthenticatedPosAgent) {
    return this.posTickets.listTickets(agent);
  }
}
