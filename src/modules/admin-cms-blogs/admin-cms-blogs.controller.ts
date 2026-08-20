import {
  Body,
  Controller,
  Delete,
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
import { AdminCmsBlogsService } from './admin-cms-blogs.service';
import { UpsertAdminCmsBlogDto } from './dto/admin-cms-blog.dto';

class CmsBlogsListQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;
}

@ApiTags('admin-cms-blogs')
@ApiBearerAuth()
@Controller('admin/cms/blogs')
@UseGuards(AdminAuthGuard, AdminPermissionsGuard)
@RequirePermissions('cms.blogs.read')
export class AdminCmsBlogsController {
  constructor(private readonly blogs: AdminCmsBlogsService) {}

  @Get()
  list(@Query() query: CmsBlogsListQueryDto) {
    return this.blogs.list(query.q);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.blogs.get(id);
  }

  @Post()
  @RequirePermissions('cms.blogs.write')
  create(@Body() body: UpsertAdminCmsBlogDto, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return this.blogs.create(body, admin.id);
  }

  @Put(':id')
  @RequirePermissions('cms.blogs.write')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpsertAdminCmsBlogDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    return this.blogs.update(id, body, admin.id);
  }

  @Delete(':id')
  @RequirePermissions('cms.blogs.write')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.blogs.remove(id);
  }
}
