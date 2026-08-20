import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator';
import { RequirePermissions } from '../admin-auth/decorators/permissions.decorator';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard';
import { AdminPermissionsGuard } from '../admin-auth/guards/admin-permissions.guard';
import { AuthenticatedAdmin } from '../admin-auth/strategies/admin-jwt.strategy';
import { AdminBlogsService } from './admin-blogs.service';
import { AdminBlogsListQueryDto, UpsertAdminBlogDto } from './dto/admin-blog.dto';

@ApiTags('admin-cms-blogs')
@ApiBearerAuth()
@Controller('admin/cms/blogs')
@UseGuards(AdminAuthGuard, AdminPermissionsGuard)
@RequirePermissions('cms.blogs.read')
export class AdminBlogsController {
  constructor(private readonly blogs: AdminBlogsService) {}
  @Get() list(@Query() query: AdminBlogsListQueryDto) { return this.blogs.list(query); }
  @Get(':id') get(@Param('id', ParseUUIDPipe) id: string) { return this.blogs.get(id); }
  @Post() @RequirePermissions('cms.blogs.write') create(@Body() body: UpsertAdminBlogDto, @CurrentAdmin() admin: AuthenticatedAdmin) { return this.blogs.create(body, admin.id); }
  @Put(':id') @RequirePermissions('cms.blogs.write') update(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpsertAdminBlogDto, @CurrentAdmin() admin: AuthenticatedAdmin) { return this.blogs.update(id, body, admin.id); }
  @Delete(':id') @RequirePermissions('cms.blogs.write') archive(@Param('id', ParseUUIDPipe) id: string) { return this.blogs.archive(id); }
}
