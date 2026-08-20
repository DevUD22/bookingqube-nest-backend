import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CreatePosRebookDto } from './dto/pos-rebook.dto';
import { PosAuthGuard } from './guards/pos-auth.guard';
import { PosRebooksService } from './pos-rebooks.service';
import { AuthenticatedPosAgent } from './strategies/pos-jwt.strategy';

@Controller('pos/rebook')
@UseGuards(PosAuthGuard)
export class PosRebooksController {
  constructor(private readonly rebooks: PosRebooksService) {}

  @Get('config')
  config(@CurrentUser() agent: AuthenticatedPosAgent) {
    return this.rebooks.config(agent);
  }

  @Get('lookup')
  lookup(
    @CurrentUser() agent: AuthenticatedPosAgent,
    @Query('code') code?: string,
    @Query('search') search?: string,
    @Query('ticket_item_id') ticketItemId?: string,
  ) {
    return this.rebooks.lookup(agent, { code, search, ticketItemId });
  }

  @Post()
  create(
    @CurrentUser() agent: AuthenticatedPosAgent,
    @Body() body: CreatePosRebookDto,
  ) {
    return this.rebooks.create(agent, body);
  }
}
