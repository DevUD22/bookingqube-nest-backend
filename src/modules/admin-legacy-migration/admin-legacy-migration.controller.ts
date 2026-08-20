import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '../admin-auth/decorators/permissions.decorator';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard';
import { AdminPermissionsGuard } from '../admin-auth/guards/admin-permissions.guard';
import { AdminLegacyMigrationService } from './admin-legacy-migration.service';

@ApiTags('admin-legacy-migration')
@ApiBearerAuth()
@Controller('admin/legacy-migration')
@UseGuards(AdminAuthGuard, AdminPermissionsGuard)
@RequirePermissions('admin.access')
export class AdminLegacyMigrationController {
  constructor(private readonly migration: AdminLegacyMigrationService) {}

  @Get('sources')
  sources() {
    return { data: this.migration.sources() };
  }

  @Get('events')
  async events(@Query('source') source?: string) {
    const data = await this.migration.listEvents(source);
    return { data: data.events, meta: { source: data.source, connection: data.connection } };
  }

  @Get('events/:oldEvent/inspect')
  async inspect(
    @Param('oldEvent') oldEvent: string,
    @Query('source') source?: string,
  ) {
    const data = await this.migration.inspect(oldEvent, source);
    return { data };
  }

  @Post('migrate')
  async migrate(
    @Body()
    body: {
      oldEvent?: string;
      source?: string;
      newEventSlug?: string;
      createEvent?: boolean;
      organizationSlug?: string;
      dryRun?: boolean;
      force?: boolean;
      skipRollups?: boolean;
      includeAddons?: boolean;
      includeSeparateAddons?: boolean;
      includeCafeClosings?: boolean;
      includeE3?: boolean;
      includeTimeExtensions?: boolean;
      createMissingTickets?: boolean;
      ticketMap?: Record<string, string>;
    },
  ) {
    const data = await this.migration.migrate(body);
    return { data };
  }

  @Post('verify')
  async verify(
    @Body() body: { oldEvent?: string; newEventSlug?: string; source?: string },
  ) {
    const data = await this.migration.verify(body);
    return { data };
  }
}
