import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentPosAgent } from './decorators/current-pos-agent.decorator';
import {
  PosCustomerSearchQueryDto,
  ResolvePosCustomerDto,
} from './dto/pos-customer.dto';
import { PosAuthGuard } from './guards/pos-auth.guard';
import { PosCustomersService } from './pos-customers.service';
import { POS_AGE_GROUPS, POS_NATIONALITIES } from './pos-customer-options';
import { AuthenticatedPosAgent } from './strategies/pos-jwt.strategy';

@ApiTags('pos-customers')
@ApiBearerAuth()
@Controller('pos/customers')
@UseGuards(PosAuthGuard)
export class PosCustomersController {
  constructor(private readonly customers: PosCustomersService) {}

  @Get('options')
  options() {
    return {
      success: true,
      data: {
        age_groups: POS_AGE_GROUPS,
        nationalities: POS_NATIONALITIES,
        defaults: { age_group: null, nationality: 'Qatari' },
      },
    };
  }

  @Get('search')
  search(
    @CurrentPosAgent() agent: AuthenticatedPosAgent,
    @Query() query: PosCustomerSearchQueryDto,
  ) {
    return this.customers.search(agent, query);
  }

  @Post('resolve')
  @HttpCode(200)
  resolve(
    @CurrentPosAgent() agent: AuthenticatedPosAgent,
    @Body() body: ResolvePosCustomerDto,
  ) {
    return this.customers.resolve(agent, body);
  }
}
