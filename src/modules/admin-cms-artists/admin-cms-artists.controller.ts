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
import { CreateAdminArtistDto } from '../admin-events/dto/create-admin-artist.dto';

class CmsArtistsListQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;
}

@ApiTags('admin-cms-artists')
@ApiBearerAuth()
@Controller('admin/cms/artists')
@UseGuards(AdminAuthGuard, AdminPermissionsGuard)
@RequirePermissions('cms.artists.read')
export class AdminCmsArtistsController {
  constructor(private readonly events: AdminEventsService) {}

  @Get()
  list(@Query() query: CmsArtistsListQueryDto) {
    return this.events.listArtists(query.q);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.events.getArtist(id);
  }

  @Post()
  @RequirePermissions('cms.artists.write')
  create(@Body() body: CreateAdminArtistDto, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return this.events.createArtist(body, admin.id);
  }

  @Put(':id')
  @RequirePermissions('cms.artists.write')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CreateAdminArtistDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    return this.events.updateArtist(id, body, admin.id);
  }
}
