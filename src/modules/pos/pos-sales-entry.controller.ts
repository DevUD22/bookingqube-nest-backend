import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PosSalesEntryQueryDto, SavePosSalesEntryDto } from './dto/pos-sales-entry.dto';
import { PosAuthGuard } from './guards/pos-auth.guard';
import { PosSalesEntryService } from './pos-sales-entry.service';
import { AuthenticatedPosAgent } from './strategies/pos-jwt.strategy';

@ApiTags('pos-sales-entry')
@ApiBearerAuth()
@UseGuards(PosAuthGuard)
@Controller('pos/sales-entry')
export class PosSalesEntryController {
  constructor(private readonly salesEntry: PosSalesEntryService) {}

  @Get()
  get(
    @CurrentUser() agent: AuthenticatedPosAgent,
    @Query() query: PosSalesEntryQueryDto,
  ) {
    return this.salesEntry.get(agent, query.date);
  }

  @Post()
  save(
    @CurrentUser() agent: AuthenticatedPosAgent,
    @Body() body: SavePosSalesEntryDto,
  ) {
    return this.salesEntry.save(agent, body);
  }
}
