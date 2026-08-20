import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PosOnlineTicketSearchDto, UsePosOnlineTicketDto } from './dto/pos-online-tickets.dto';
import { PosAuthGuard } from './guards/pos-auth.guard';
import { PosOnlineTicketsService } from './pos-online-tickets.service';
import { AuthenticatedPosAgent } from './strategies/pos-jwt.strategy';

@Controller('pos/online-tickets')
@UseGuards(PosAuthGuard)
export class PosOnlineTicketsController {
  constructor(private readonly onlineTickets: PosOnlineTicketsService) {}

  @Get('search')
  search(
    @CurrentUser() agent: AuthenticatedPosAgent,
    @Query() query: PosOnlineTicketSearchDto,
  ) {
    return this.onlineTickets.search(agent, query.q);
  }

  @Post(':id/use')
  use(
    @CurrentUser() agent: AuthenticatedPosAgent,
    @Param('id') id: string,
    @Body() body: UsePosOnlineTicketDto,
  ) {
    return this.onlineTickets.use(agent, id, body.rfids);
  }
}
