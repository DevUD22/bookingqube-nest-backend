import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';

import { EventDetailApiResponseDto } from './dto/event-detail.dto';
import {
  EventListingApiResponseDto,
  EventSearchApiResponseDto,
} from './dto/event-listing.dto';
import { EventScheduleApiResponseDto } from './dto/event-schedule.dto';
import { EventTicketsApiResponseDto } from './dto/event-tickets.dto';
import { EventsService } from './events.service';
import {
  PRIVATE_EVENT_ACCESS_HEADER,
  PRIVATE_EVENT_ACCESS_QUERY,
  PRIVATE_EVENT_PASSWORD_HEADER,
} from './private-event-access';

@ApiTags('events')
@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get('search')
  @ApiQuery({ name: 'q', required: true, example: 'family' })
  @ApiQuery({ name: 'lang', required: false, example: 'en' })
  @ApiQuery({ name: 'limit', required: false, example: '10' })
  @ApiOkResponse({ description: 'Frontend-compatible event search response' })
  async searchEvents(
    @Query('q') q = '',
    @Query('lang') lang = 'en',
    @Query('limit') limit?: string,
  ): Promise<EventSearchApiResponseDto> {
    const data = await this.eventsService.searchEvents(q, { lang, limit });

    return {
      success: true,
      data,
      items: data.events,
      total: data.events.length,
    };
  }

  @Get(':slug/detail')
  @ApiQuery({ name: 'lang', required: false, example: 'en' })
  @ApiOkResponse({ description: 'Frontend-compatible event detail response' })
  @ApiNotFoundResponse({ description: 'Event was not found or is not published' })
  async getEventDetail(
    @Param('slug') slug: string,
    @Query('lang') lang = 'en',
    @Query(PRIVATE_EVENT_ACCESS_QUERY) accessTokenQuery?: string,
    @Headers(PRIVATE_EVENT_ACCESS_HEADER) accessTokenHeader?: string,
    @Headers(PRIVATE_EVENT_PASSWORD_HEADER) passwordHeader?: string,
  ): Promise<EventDetailApiResponseDto> {
    return {
      success: true,
      data: await this.eventsService.getEventDetail(slug, lang, {
        accessToken: accessTokenHeader || accessTokenQuery || null,
        passwordHeader: passwordHeader || null,
      }),
    };
  }

  @Post(':slug/verify-password')
  @HttpCode(200)
  async verifyPassword(
    @Param('slug') slug: string,
    @Body() body: { event_password?: string },
  ) {
    return this.eventsService.verifyEventPassword(
      slug,
      typeof body?.event_password === 'string' ? body.event_password : '',
    );
  }

  @Get(':slug/schedule')
  @ApiQuery({ name: 'month', required: false, example: '2026-08' })
  @ApiQuery({ name: 'page', required: false, example: '1' })
  @ApiQuery({ name: 'lang', required: false, example: 'en' })
  @ApiOkResponse({ description: 'Frontend-compatible event schedule response' })
  @ApiNotFoundResponse({ description: 'Event was not found or is not published' })
  async getEventSchedule(
    @Param('slug') slug: string,
    @Query('month') month?: string,
    @Query('page') page?: string,
    @Query(PRIVATE_EVENT_ACCESS_QUERY) accessTokenQuery?: string,
    @Headers(PRIVATE_EVENT_ACCESS_HEADER) accessTokenHeader?: string,
    @Headers(PRIVATE_EVENT_PASSWORD_HEADER) passwordHeader?: string,
  ): Promise<EventScheduleApiResponseDto> {
    return {
      success: true,
      data: await this.eventsService.getEventSchedule(
        slug,
        { month, page },
        {
          accessToken: accessTokenHeader || accessTokenQuery || null,
          passwordHeader: passwordHeader || null,
        },
      ),
    };
  }

  @Get(':slug/tickets')
  @ApiQuery({ name: 'date', required: true, example: '2026-08-15' })
  @ApiQuery({ name: 'time', required: true, example: '10:00 AM' })
  @ApiQuery({ name: 'lang', required: false, example: 'en' })
  @ApiOkResponse({ description: 'Frontend-compatible event tickets response' })
  @ApiNotFoundResponse({ description: 'Event or selected session was not found' })
  async getEventTickets(
    @Param('slug') slug: string,
    @Query('date') date?: string,
    @Query('time') time?: string,
    @Query(PRIVATE_EVENT_ACCESS_QUERY) accessTokenQuery?: string,
    @Headers(PRIVATE_EVENT_ACCESS_HEADER) accessTokenHeader?: string,
    @Headers(PRIVATE_EVENT_PASSWORD_HEADER) passwordHeader?: string,
  ): Promise<EventTicketsApiResponseDto> {
    if (!date || !time) {
      throw new BadRequestException('Both date and time are required.');
    }

    return {
      success: true,
      data: await this.eventsService.getEventTickets(
        slug,
        { date, time },
        {
          accessToken: accessTokenHeader || accessTokenQuery || null,
          passwordHeader: passwordHeader || null,
        },
      ),
    };
  }
}

@ApiTags('event-listing')
@Controller('event-listing')
export class EventListingController {
  constructor(private readonly eventsService: EventsService) {}

  @Get()
  @ApiQuery({ name: 'lang', required: false, example: 'en' })
  @ApiOkResponse({ description: 'Frontend-compatible event listing response' })
  async getEventListing(@Query('lang') lang = 'en'): Promise<EventListingApiResponseDto> {
    return {
      success: true,
      data: await this.eventsService.getEventListing(lang),
    };
  }
}
