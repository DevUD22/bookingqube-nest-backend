import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CreatePosRefundDto } from './dto/pos-refund.dto';
import { PosAuthGuard } from './guards/pos-auth.guard';
import { PosRefundsService } from './pos-refunds.service';
import { AuthenticatedPosAgent } from './strategies/pos-jwt.strategy';

@Controller('pos/refunds')
@UseGuards(PosAuthGuard)
export class PosRefundsController {
  constructor(private readonly refunds: PosRefundsService) {}

  @Get('lookup')
  lookup(@CurrentUser() agent: AuthenticatedPosAgent, @Query('search') search = '') {
    return this.refunds.lookup(agent, search);
  }

  @Post()
  create(@CurrentUser() agent: AuthenticatedPosAgent, @Body() body: CreatePosRefundDto) {
    return this.refunds.create(agent, body);
  }
}
