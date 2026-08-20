import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';

import { ArtistDetailApiResponseDto } from './dto/artist-detail.dto';
import { ArtistsService } from './artists.service';

@ApiTags('artists')
@Controller('artist')
export class ArtistsController {
  constructor(private readonly artistsService: ArtistsService) {}

  @Get(':slug')
  @ApiQuery({ name: 'lang', required: false, example: 'en' })
  @ApiOkResponse({ description: 'Frontend-compatible artist detail response' })
  @ApiNotFoundResponse({ description: 'Artist was not found or is not published' })
  async getArtistDetail(
    @Param('slug') slug: string,
    @Query('lang') lang = 'en',
  ): Promise<ArtistDetailApiResponseDto> {
    return {
      success: true,
      data: await this.artistsService.getArtistDetail(slug, lang),
    };
  }
}
