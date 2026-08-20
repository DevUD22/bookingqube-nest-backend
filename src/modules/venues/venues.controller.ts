import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';

import { VenueDetailApiResponseDto } from './dto/venue-detail.dto';
import { VenuesService } from './venues.service';

@ApiTags('venues')
@Controller('venue-detail')
export class VenuesController {
  constructor(private readonly venuesService: VenuesService) {}

  @Get(':slug')
  @ApiQuery({ name: 'lang', required: false, example: 'en' })
  @ApiOkResponse({ description: 'Frontend-compatible venue detail response' })
  @ApiNotFoundResponse({ description: 'Venue was not found or is not published' })
  async getVenueDetail(
    @Param('slug') slug: string,
    @Query('lang') lang = 'en',
  ): Promise<VenueDetailApiResponseDto> {
    return {
      success: true,
      data: await this.venuesService.getVenueDetail(slug, lang),
    };
  }
}
