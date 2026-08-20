import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator';
import { RequirePermissions } from '../admin-auth/decorators/permissions.decorator';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard';
import { AdminPermissionsGuard } from '../admin-auth/guards/admin-permissions.guard';
import { AuthenticatedAdmin } from '../admin-auth/strategies/admin-jwt.strategy';
import { AdminEventsService } from '../admin-events/admin-events.service';
import { CreateAdminEventVenueDto } from '../admin-events/dto/create-admin-event-option.dto';

class CmsVenuesListQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;
}

@ApiTags('admin-cms-venues')
@ApiBearerAuth()
@Controller('admin/cms/venues')
@UseGuards(AdminAuthGuard, AdminPermissionsGuard)
@RequirePermissions('cms.venues.read')
export class AdminCmsVenuesController {
  constructor(private readonly events: AdminEventsService) {}

  @Get()
  list(@Query() query: CmsVenuesListQueryDto) {
    return this.events.listVenues(query.q);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.events.getVenue(id);
  }

  @Post()
  @RequirePermissions('cms.venues.write')
  create(@Body() body: CreateAdminEventVenueDto, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return this.events.createVenue(body, admin.id);
  }

  @Put(':id')
  @RequirePermissions('cms.venues.write')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CreateAdminEventVenueDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    return this.events.updateVenue(id, body, admin.id);
  }
}
