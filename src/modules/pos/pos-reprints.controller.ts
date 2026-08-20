import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PosAuthGuard } from './guards/pos-auth.guard';
import { PosReprintsService } from './pos-reprints.service';
import { AuthenticatedPosAgent } from './strategies/pos-jwt.strategy';

@Controller('pos/reprint-orders')
@UseGuards(PosAuthGuard)
export class PosReprintsController {
  constructor(private readonly reprints: PosReprintsService) {}

  @Get()
  list(
    @CurrentUser() agent: AuthenticatedPosAgent,
    @Query('date') date?: string,
    @Query('search') search?: string,
  ) {
    return this.reprints.list(agent, date, search);
  }
}
