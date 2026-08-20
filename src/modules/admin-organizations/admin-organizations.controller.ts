import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../admin-auth/decorators/permissions.decorator';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard';
import { AdminPermissionsGuard } from '../admin-auth/guards/admin-permissions.guard';
import { AdminOrganizationsService } from './admin-organizations.service';
import { CreateAdminOrganizationDto } from './dto/create-admin-organization.dto';

@ApiTags('admin-organizations') @ApiBearerAuth() @Controller('admin/organizations') @UseGuards(AdminAuthGuard, AdminPermissionsGuard) @RequirePermissions('admin.access')
export class AdminOrganizationsController { constructor(private readonly organizations: AdminOrganizationsService) {} @Get() list() { return this.organizations.list(); } @Post() @RequirePermissions('events.write') create(@Body() body: CreateAdminOrganizationDto) { return this.organizations.create(body); } }
