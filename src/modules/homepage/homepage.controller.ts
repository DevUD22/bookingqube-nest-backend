import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';

import {
  HomepageFeedsApiResponseDto,
  HomepageFooterApiResponseDto,
  HomepageHeroAndCategoryApiResponseDto,
  HomepageQuickBookApiResponseDto,
  HomepageSectionsApiResponseDto,
  HomepageVenuesApiResponseDto,
  OfferDetailApiResponseDto,
} from './dto/homepage-layout.dto';
import { HomepageService } from './homepage.service';

@ApiTags('homepage')
@Controller('homepage')
export class HomepageController {
  constructor(private readonly homepageService: HomepageService) {}

  @Get('hero-and-category-section')
  @ApiQuery({ name: 'lang', required: false, example: 'en' })
  @ApiOkResponse({ description: 'Frontend-compatible homepage hero and category response' })
  async getHeroAndCategorySection(
    @Query('lang') lang = 'en',
  ): Promise<HomepageHeroAndCategoryApiResponseDto> {
    return {
      success: true,
      data: await this.homepageService.getHeroAndCategorySection(lang),
    };
  }

  @Get('sections')
  @ApiQuery({ name: 'lang', required: false, example: 'en' })
  @ApiOkResponse({
    description:
      'Frontend-compatible homepage sections response (top events, venues, events today, categories)',
  })
  async getSections(@Query('lang') lang = 'en'): Promise<HomepageSectionsApiResponseDto> {
    return {
      success: true,
      data: await this.homepageService.getSections(lang),
    };
  }

  @Get('venues-section')
  @ApiQuery({ name: 'lang', required: false, example: 'en' })
  @ApiOkResponse({ description: 'Frontend-compatible homepage venues response' })
  async getVenuesSection(@Query('lang') lang = 'en'): Promise<HomepageVenuesApiResponseDto> {
    return {
      success: true,
      data: await this.homepageService.getVenuesSection(lang),
    };
  }

  @Get('feeds')
  @ApiQuery({ name: 'lang', required: false, example: 'en' })
  @ApiOkResponse({ description: 'Frontend-compatible homepage feeds response' })
  async getFeeds(@Query('lang') lang = 'en'): Promise<HomepageFeedsApiResponseDto> {
    return {
      success: true,
      data: await this.homepageService.getFeeds(lang),
    };
  }

  @Get('quick-book-section')
  @ApiQuery({ name: 'lang', required: false, example: 'en' })
  @ApiOkResponse({ description: 'Frontend-compatible quick book response' })
  async getQuickBookSection(
    @Query('lang') lang = 'en',
  ): Promise<HomepageQuickBookApiResponseDto> {
    return {
      success: true,
      data: await this.homepageService.getQuickBookSection(lang),
    };
  }

  @Get('offers-detail/:slug')
  @ApiQuery({ name: 'lang', required: false, example: 'en' })
  @ApiOkResponse({ description: 'Frontend-compatible offer detail response' })
  @ApiNotFoundResponse({ description: 'Offer was not found or is not published' })
  async getOfferDetail(
    @Param('slug') slug: string,
    @Query('lang') lang = 'en',
  ): Promise<OfferDetailApiResponseDto> {
    return {
      success: true,
      data: await this.homepageService.getOfferDetail(slug, lang),
    };
  }
}

@ApiTags('footer')
@Controller('footer')
export class FooterController {
  constructor(private readonly homepageService: HomepageService) {}

  @Get()
  @ApiQuery({ name: 'lang', required: false, example: 'en' })
  @ApiOkResponse({ description: 'Frontend-compatible footer response' })
  async getFooter(@Query('lang') lang = 'en'): Promise<HomepageFooterApiResponseDto> {
    return {
      success: true,
      data: await this.homepageService.getFooter(lang),
    };
  }
}
