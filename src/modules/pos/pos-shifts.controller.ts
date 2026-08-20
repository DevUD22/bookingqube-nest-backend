import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ClosePosShiftDto, PosShiftQueryDto } from './dto/pos-shift.dto';
import { PosAuthGuard } from './guards/pos-auth.guard';
import { PosShiftsService } from './pos-shifts.service';
import { AuthenticatedPosAgent } from './strategies/pos-jwt.strategy';

@Controller('pos/shift')
@UseGuards(PosAuthGuard)
export class PosShiftsController {
  constructor(private readonly shifts: PosShiftsService) {}

  @Get()
  get(
    @CurrentUser() agent: AuthenticatedPosAgent,
    @Query() query: PosShiftQueryDto,
  ) {
    return this.shifts.get(agent, query.date);
  }

  @Post('close')
  close(
    @CurrentUser() agent: AuthenticatedPosAgent,
    @Body() body: ClosePosShiftDto,
  ) {
    return this.shifts.close(agent, body);
  }
}
