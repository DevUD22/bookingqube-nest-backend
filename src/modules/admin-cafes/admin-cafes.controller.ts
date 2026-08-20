import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
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
import { AdminStaffService } from '../admin-staff/admin-staff.service';
import { AdminCafesService } from './admin-cafes.service';
import {
  AdminCafeListQueryDto,
  AssignCafeEventDto,
  CreateAdminCafeDto,
  CreateCafePosAgentDto,
  UpdateAdminCafeDto,
  UpdateAdminCafeStatusDto,
  UpdateCafePosAgentStatusDto,
  UpsertCafeMenuCategoryDto,
  UpsertCafeMenuItemDto,
  UpsertCafeMenuSubcategoryDto,
} from './dto/admin-cafe.dto';

@ApiTags('admin-cafes')
@ApiBearerAuth()
@Controller('admin/cafes')
@UseGuards(AdminAuthGuard, AdminPermissionsGuard)
@RequirePermissions('cafe.read')
export class AdminCafesController {
  constructor(
    private readonly cafes: AdminCafesService,
    private readonly staff: AdminStaffService,
  ) {}

  private scopedEventIds(admin: AuthenticatedAdmin) {
    return this.staff.resolveReportEventIds(admin.id, admin.role);
  }

  private async assertCafeAccess(admin: AuthenticatedAdmin, cafeId: string) {
    const eventIds = await this.scopedEventIds(admin);
    await this.cafes.assertCafeAccess(cafeId, eventIds);
  }

  private async assertEventAccess(admin: AuthenticatedAdmin, eventId: string) {
    const eventIds = await this.scopedEventIds(admin);
    if (eventIds && !eventIds.includes(eventId)) {
      throw new ForbiddenException('You do not have access to this event.');
    }
  }

  @Get()
  async list(
    @Query() query: AdminCafeListQueryDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    return this.cafes.list(query, await this.scopedEventIds(admin));
  }

  @Get(':id')
  async get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    return this.cafes.get(id, await this.scopedEventIds(admin));
  }

  @Post()
  @RequirePermissions('cafe.write', 'cafe.update.basics')
  async create(
    @Body() body: CreateAdminCafeDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    return this.cafes.create(body, await this.scopedEventIds(admin));
  }

  @Put(':id')
  @RequirePermissions('cafe.write', 'cafe.update.basics')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateAdminCafeDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    return this.cafes.update(id, body, await this.scopedEventIds(admin));
  }

  @Post(':id/status')
  @RequirePermissions('cafe.publish')
  async setStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateAdminCafeStatusDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    return this.cafes.setStatus(id, body.status, await this.scopedEventIds(admin));
  }

  @Get(':id/menu/categories')
  async listCategories(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    await this.assertCafeAccess(admin, id);
    return this.cafes.listCategories(id);
  }

  @Post(':id/menu/categories')
  @RequirePermissions('cafe.write', 'cafe.update.menu')
  async createCategory(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpsertCafeMenuCategoryDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    await this.assertCafeAccess(admin, id);
    return this.cafes.createCategory(id, body);
  }

  @Put(':id/menu/categories/:categoryId')
  @RequirePermissions('cafe.write', 'cafe.update.menu')
  async updateCategory(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Body() body: UpsertCafeMenuCategoryDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    await this.assertCafeAccess(admin, id);
    return this.cafes.updateCategory(id, categoryId, body);
  }

  @Delete(':id/menu/categories/:categoryId')
  @RequirePermissions('cafe.write', 'cafe.update.menu')
  async deleteCategory(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    await this.assertCafeAccess(admin, id);
    return this.cafes.deleteCategory(id, categoryId);
  }

  @Post(':id/menu/categories/:categoryId/subcategories')
  @RequirePermissions('cafe.write', 'cafe.update.menu')
  async createSubcategory(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Body() body: UpsertCafeMenuSubcategoryDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    await this.assertCafeAccess(admin, id);
    return this.cafes.createSubcategory(id, categoryId, body);
  }

  @Put(':id/menu/categories/:categoryId/subcategories/:subcategoryId')
  @RequirePermissions('cafe.write', 'cafe.update.menu')
  async updateSubcategory(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Param('subcategoryId', ParseUUIDPipe) subcategoryId: string,
    @Body() body: UpsertCafeMenuSubcategoryDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    await this.assertCafeAccess(admin, id);
    return this.cafes.updateSubcategory(id, categoryId, subcategoryId, body);
  }

  @Delete(':id/menu/categories/:categoryId/subcategories/:subcategoryId')
  @RequirePermissions('cafe.write', 'cafe.update.menu')
  async deleteSubcategory(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Param('subcategoryId', ParseUUIDPipe) subcategoryId: string,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    await this.assertCafeAccess(admin, id);
    return this.cafes.deleteSubcategory(id, categoryId, subcategoryId);
  }

  @Post(':id/menu/categories/:categoryId/items')
  @RequirePermissions('cafe.write', 'cafe.update.menu')
  async createItemUnderCategory(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Body() body: UpsertCafeMenuItemDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    await this.assertCafeAccess(admin, id);
    return this.cafes.createItemUnderCategory(id, categoryId, body);
  }

  @Post(':id/menu/subcategories/:subcategoryId/items')
  @RequirePermissions('cafe.write', 'cafe.update.menu')
  async createItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('subcategoryId', ParseUUIDPipe) subcategoryId: string,
    @Body() body: UpsertCafeMenuItemDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    await this.assertCafeAccess(admin, id);
    return this.cafes.createItem(id, subcategoryId, body);
  }

  @Put(':id/menu/subcategories/:subcategoryId/items/:itemId')
  @RequirePermissions('cafe.write', 'cafe.update.menu')
  async updateItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('subcategoryId', ParseUUIDPipe) subcategoryId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() body: UpsertCafeMenuItemDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    await this.assertCafeAccess(admin, id);
    return this.cafes.updateItem(id, subcategoryId, itemId, body);
  }

  @Delete(':id/menu/subcategories/:subcategoryId/items/:itemId')
  @RequirePermissions('cafe.write', 'cafe.update.menu')
  async deleteItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('subcategoryId', ParseUUIDPipe) subcategoryId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    await this.assertCafeAccess(admin, id);
    return this.cafes.deleteItem(id, subcategoryId, itemId);
  }

  @Get(':id/agents')
  async listAgents(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    await this.assertCafeAccess(admin, id);
    return this.cafes.listAgents(id);
  }

  @Post(':id/agents')
  @RequirePermissions('cafe.write', 'cafe.update.agents')
  async addAgent(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CreateCafePosAgentDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    await this.assertCafeAccess(admin, id);
    return this.cafes.addAgent(id, body, admin.id);
  }

  @Post(':id/agents/:agentId/status')
  @RequirePermissions('cafe.write', 'cafe.update.agents')
  async updateAgentStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @Body() body: UpdateCafePosAgentStatusDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    await this.assertCafeAccess(admin, id);
    return this.cafes.updateAgentStatus(id, agentId, body.status, admin.id);
  }

  @Delete(':id/agents/:agentId')
  @RequirePermissions('cafe.write', 'cafe.update.agents')
  async removeAgent(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    await this.assertCafeAccess(admin, id);
    return this.cafes.removeAgent(id, agentId);
  }

  @Post(':id/assign-event')
  @RequirePermissions('cafe.write', 'cafe.update.event')
  async assignEvent(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AssignCafeEventDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    await this.assertCafeAccess(admin, id);
    await this.assertEventAccess(admin, body.event_id);
    return this.cafes.assignEvent(id, body, admin.id);
  }

  @Post(':id/unassign-event')
  @RequirePermissions('cafe.write', 'cafe.update.event')
  async unassignEvent(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    await this.assertCafeAccess(admin, id);
    return this.cafes.unassignEvent(id);
  }
}
