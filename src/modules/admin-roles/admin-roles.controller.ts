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
import { AdminRolesService } from './admin-roles.service';
import { CreateAdminRoleDto, UpdateAdminRoleDto } from './dto/admin-roles.dto';

@ApiTags('admin-roles')
@ApiBearerAuth()
@Controller('admin/settings/roles')
@UseGuards(AdminAuthGuard, AdminPermissionsGuard)
@RequirePermissions('roles.manage')
export class AdminRolesController {
  constructor(private readonly roles: AdminRolesService) {}

  @Get('permissions')
  listPermissions() {
    return this.roles.listPermissions();
  }

  @Get()
  list() {
    return this.roles.list();
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.roles.get(id);
  }

  @Post()
  create(@Body() body: CreateAdminRoleDto) {
    return this.roles.create(body);
  }

  @Put(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateAdminRoleDto) {
    return this.roles.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.roles.remove(id);
  }
}
