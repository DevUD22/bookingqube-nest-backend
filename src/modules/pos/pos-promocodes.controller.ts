import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentPosAgent } from './decorators/current-pos-agent.decorator';
import { PosAuthGuard } from './guards/pos-auth.guard';
import { PosPromocodesService } from './pos-promocodes.service';
import { AuthenticatedPosAgent } from './strategies/pos-jwt.strategy';

@ApiTags('pos-promocodes')
@ApiBearerAuth()
@Controller('pos/promocodes')
@UseGuards(PosAuthGuard)
export class PosPromocodesController {
  constructor(private readonly promocodes: PosPromocodesService) {}

  @Get('offers')
  offers(
    @CurrentPosAgent() agent: AuthenticatedPosAgent,
    @Query('lang') lang = 'en',
  ) {
    return this.promocodes.listOffers(agent, lang);
  }
}
