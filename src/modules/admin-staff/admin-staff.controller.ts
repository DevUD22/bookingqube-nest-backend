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

import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator';
import { RequirePermissions } from '../admin-auth/decorators/permissions.decorator';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard';
import { AdminPermissionsGuard } from '../admin-auth/guards/admin-permissions.guard';
import { AuthenticatedAdmin } from '../admin-auth/strategies/admin-jwt.strategy';
import { AdminStaffService } from './admin-staff.service';
import {
  CreateStaffAssignmentDto,
  CreateStaffUserDto,
  UpdateStaffAssignmentDto,
  UpdateStaffUserDto,
} from './dto/admin-staff.dto';

@ApiTags('admin-staff')
@ApiBearerAuth()
@Controller('admin/settings/staff')
@UseGuards(AdminAuthGuard, AdminPermissionsGuard)
export class AdminStaffController {
  constructor(private readonly staff: AdminStaffService) {}

  @Get()
  @RequirePermissions('users.read')
  list(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Query('organization_id') organizationId?: string,
    @Query('role') role?: string,
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('sort') sort?: string,
    @Query('page') page?: string,
    @Query('per_page') perPage?: string,
  ) {
    return this.staff.list(
      {
        organization_id: organizationId,
        role,
        q,
        status,
        sort,
        page,
        per_page: perPage,
      },
      admin,
    );
  }

  @Get('event-tree')
  @RequirePermissions('users.read')
  listEventTree(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Query('organization_id') organizationId?: string,
    @Query('event_id') eventId?: string,
    @Query('q') q?: string,
  ) {
    return this.staff.listEventTree(
      {
        organization_id: organizationId,
        event_id: eventId,
        q,
      },
      admin,
    );
  }

  /** @deprecated Prefer event-tree; kept for compatibility. */
  @Get('tree')
  @RequirePermissions('users.read')
  listTree(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Query('organization_id') organizationId?: string,
    @Query('q') q?: string,
  ) {
    return this.staff.listEventTree(
      {
        organization_id: organizationId,
        q,
      },
      admin,
    );
  }

  @Get('available-pos')
  @RequirePermissions('users.read')
  listAvailablePos(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Query('organization_id') organizationId: string,
    @Query('event_id') eventId?: string,
  ) {
    return this.staff.listAvailablePos(
      {
        organization_id: organizationId,
        event_id: eventId,
      },
      admin,
    );
  }

  @Get('creatable-roles')
  @RequirePermissions('users.read')
  creatableRoles(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Query('managed_by_user_id') managedByUserId?: string,
  ) {
    return this.staff.creatableRoles(managedByUserId, admin);
  }

  @Get('assignments')
  @RequirePermissions('users.read')
  listAssignments(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Query('organization_id') organizationId?: string,
    @Query('event_id') eventId?: string,
  ) {
    return this.staff.listAssignments(
      {
        organization_id: organizationId,
        event_id: eventId,
      },
      admin,
    );
  }

  @Post()
  @RequirePermissions('users.write')
  createUser(
    @Body() body: CreateStaffUserDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    return this.staff.createUser(body, admin.id, admin);
  }

  @Put(':id')
  @RequirePermissions('users.write')
  updateUser(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateStaffUserDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    return this.staff.updateUser(id, body, admin);
  }

  @Post('assignments')
  @RequirePermissions('users.write')
  createAssignment(
    @Body() body: CreateStaffAssignmentDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    return this.staff.createAssignment(body, admin.id, admin);
  }

  @Put('assignments/:id')
  @RequirePermissions('users.write')
  updateAssignment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateStaffAssignmentDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    return this.staff.updateAssignment(id, body, admin);
  }

  @Delete('assignments/:id')
  @RequirePermissions('users.write')
  removeAssignment(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    return this.staff.removeAssignment(id, admin);
  }
}
