import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '../admin-auth/decorators/permissions.decorator';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard';
import { AdminPermissionsGuard } from '../admin-auth/guards/admin-permissions.guard';
import { AdminFooterMenusService } from './admin-footer-menus.service';
import {
  ReorderFooterMenusDto,
  UpsertFooterMenuItemDto,
} from './dto/admin-footer-menu.dto';

@ApiTags('admin-cms-footer')
@ApiBearerAuth()
@Controller('admin/cms/footer-menus')
@UseGuards(AdminAuthGuard, AdminPermissionsGuard)
@RequirePermissions('cms.footer.read')
export class AdminFooterMenusController {
  constructor(private readonly footerMenus: AdminFooterMenusService) {}

  @Get()
  list() {
    return this.footerMenus.list();
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.footerMenus.get(id);
  }

  @Post()
  @RequirePermissions('cms.footer.write')
  create(@Body() body: UpsertFooterMenuItemDto) {
    return this.footerMenus.create(body);
  }

  @Put('reorder')
  @RequirePermissions('cms.footer.write')
  reorder(@Body() body: ReorderFooterMenusDto) {
    return this.footerMenus.reorder(body);
  }

  @Put(':id')
  @RequirePermissions('cms.footer.write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpsertFooterMenuItemDto) {
    return this.footerMenus.update(id, body);
  }

  @Delete(':id')
  @RequirePermissions('cms.footer.write')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.footerMenus.remove(id);
  }
}
