import { Body, Controller, HttpCode, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import {
  PromoApplyFailureDto,
  PromoApplyRequestDto,
  PromoApplyResponseDto,
} from './dto/promo-apply.dto';
import { PromocodesService } from './promocodes.service';

@ApiTags('promocodes')
@Controller('promocodes')
export class PromocodesController {
  constructor(private readonly promocodesService: PromocodesService) {}

  @Post('apply')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiQuery({ name: 'lang', required: false, example: 'en' })
  @ApiOkResponse({ description: 'Frontend-compatible promo apply response' })
  async applyPromocode(
    @Body() body: PromoApplyRequestDto,
    @Query('lang') lang = 'en',
  ): Promise<PromoApplyResponseDto | PromoApplyFailureDto> {
    return this.promocodesService.applyPromocode(body, lang);
  }
}
