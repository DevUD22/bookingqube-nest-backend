import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { AdminDashboardService } from '../admin-dashboard/admin-dashboard.service';
import { AdminDashboardQueryDto } from '../admin-dashboard/dto/admin-dashboard-query.dto';
import { AdminEventsService } from '../admin-events/admin-events.service';
import { PrismaService } from '../../database/prisma.service';
import { AdminEventListQueryDto } from '../admin-events/dto/admin-event-list-query.dto';
import { CurrentOrganizer } from './current-organizer.decorator';
import { OrganizerLoginDto, OrganizerLogoutDto, OrganizerRefreshDto } from './dto/organizer-auth.dto';
import { OrganizerAuthGuard } from './organizer-auth.guard';
import { OrganizerAuthService } from './organizer-auth.service';
import { AuthenticatedOrganizer } from './organizer-jwt.strategy';
import { UpdateOrganizerEventDto } from './dto/update-organizer-event.dto';

@ApiTags('organizer-auth')
@Controller('organizer/auth')
export class OrganizerAuthController {
  constructor(private readonly auth: OrganizerAuthService) {}
  @Post('login') @HttpCode(200) login(@Body() body: OrganizerLoginDto, @Headers('user-agent') userAgent?: string, @Ip() ipAddress?: string) { return this.auth.login(body, { userAgent, ipAddress }); }
  @Post('refresh') @HttpCode(200) refresh(@Body() body: OrganizerRefreshDto, @Headers('user-agent') userAgent?: string, @Ip() ipAddress?: string) { return this.auth.refresh(body.refresh_token, { userAgent, ipAddress }); }
  @Post('logout') @HttpCode(200) logout(@Body() body: OrganizerLogoutDto) { return this.auth.logout(body.refresh_token); }
  @Get('me') @ApiBearerAuth() @UseGuards(OrganizerAuthGuard) me(@CurrentOrganizer() organizer: AuthenticatedOrganizer) { return this.auth.me(organizer); }
}

@ApiTags('organizer-workspace')
@ApiBearerAuth()
@Controller('organizer')
@UseGuards(OrganizerAuthGuard)
export class OrganizerWorkspaceController {
  constructor(
    private readonly dashboard: AdminDashboardService,
    private readonly events: AdminEventsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('dashboard/overview')
  async dashboardOverview(
    @Query() query: AdminDashboardQueryDto,
    @CurrentOrganizer() organizer: AuthenticatedOrganizer,
  ) {
    const assigned = await this.prisma.event.findMany({
      where: { primaryOrganizerId: organizer.id },
      select: { id: true },
    });
    return this.dashboard.overview(
      query,
      undefined,
      assigned.map((event) => event.id),
    );
  }

  @Get('events')
  listEvents(
    @Query() query: AdminEventListQueryDto,
    @CurrentOrganizer() organizer: AuthenticatedOrganizer,
  ) {
    return this.events.list(query, undefined, organizer.id);
  }

  @Get('events/:id')
  eventDetails(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentOrganizer() organizer: AuthenticatedOrganizer,
  ) {
    return this.events.organizerDetails(id, organizer.id);
  }

  @Put('events/:id')
  updateEvent(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateOrganizerEventDto,
    @CurrentOrganizer() organizer: AuthenticatedOrganizer,
  ) {
    return this.events.updateOrganizerEvent(id, organizer.id, body);
  }
}
