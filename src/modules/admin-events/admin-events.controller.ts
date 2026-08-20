import { Body, Controller, Delete, ForbiddenException, Get, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator';
import { RequirePermissions } from '../admin-auth/decorators/permissions.decorator';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard';
import { AdminPermissionsGuard } from '../admin-auth/guards/admin-permissions.guard';
import { AuthenticatedAdmin } from '../admin-auth/strategies/admin-jwt.strategy';
import { AdminStaffService } from '../admin-staff/admin-staff.service';
import { AdminEventsService } from './admin-events.service';
import { AssignAdminEventOrganizerDto } from './dto/assign-admin-event-organizer.dto';
import { AdminEventListQueryDto } from './dto/admin-event-list-query.dto';
import { CreateAdminEventDto } from './dto/create-admin-event.dto';
import { CreateAdminEventMediaDto } from './dto/create-admin-event-media.dto';
import {
  CreateAdminEventSessionDto,
  CreateAdminTicketTypeDto,
  ImportAdminTicketTypesDto,
  UpdateAdminTicketTypeDto,
} from './dto/create-admin-event-setup.dto';
import { ApplyAdminEventTimingDto } from './dto/apply-admin-event-timing.dto';
import { CreateAdminArtistDto } from './dto/create-admin-artist.dto';
import {
  CreateAdminEventCategoryDto,
  CreateAdminEventVenueDto,
} from './dto/create-admin-event-option.dto';
import {
  CreateAdminAddonDto,
  CreateAdminTaxDto,
  UpdateAdminEventMoreDto,
  UpsertAdminRegistrationFormDto,
} from './dto/update-admin-event-more.dto';
import { CreateThirdPartyVendorDto, ReplaceThirdPartyVendorsDto } from './dto/third-party-vendor.dto';
import { CreateThirdPartyPlatformDto } from './dto/third-party-platform.dto';
import { UpdateAdminEventStatusDto } from './dto/update-admin-event-status.dto';

@ApiTags('admin-events')
@ApiBearerAuth()
@Controller('admin/events')
@UseGuards(AdminAuthGuard, AdminPermissionsGuard)
@RequirePermissions('events.read')
export class AdminEventsController {
  constructor(
    private readonly events: AdminEventsService,
    private readonly staff: AdminStaffService,
  ) {}

  private async scopedEventIds(admin: AuthenticatedAdmin) {
    return this.staff.resolveReportEventIds(admin.id, admin.role);
  }

  private async assertEventAccess(admin: AuthenticatedAdmin, eventId: string) {
    const eventIds = await this.scopedEventIds(admin);
    if (eventIds && !eventIds.includes(eventId)) {
      throw new ForbiddenException('You do not have access to this event.');
    }
  }

  @Get()
  async list(
    @Query() query: AdminEventListQueryDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    const eventIds = await this.scopedEventIds(admin);
    return this.events.list(query, undefined, undefined, eventIds);
  }

  @Get('form-options')
  formOptions() {
    return this.events.formOptions();
  }

  @Post('form-options/categories')
  @RequirePermissions('events.write', 'events.update.basics')
  createCategory(@Body() body: CreateAdminEventCategoryDto) {
    return this.events.createCategory(body);
  }

  @Post('form-options/venues')
  @RequirePermissions('events.write', 'events.update.place_media')
  createVenue(
    @Body() body: CreateAdminEventVenueDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    return this.events.createVenue(body, admin.id);
  }

  @Post('form-options/artists')
  @RequirePermissions('events.write', 'events.update.more')
  createArtist(
    @Body() body: CreateAdminArtistDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    return this.events.createArtist(body, admin.id);
  }

  @Post()
  @RequirePermissions('events.write', 'events.update.basics')
  create(@Body() body: CreateAdminEventDto, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return this.events.create(body, admin.id);
  }

  @Put(':id')
  @RequirePermissions('events.write', 'events.update.basics')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CreateAdminEventDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    await this.assertEventAccess(admin, id);
    return this.events.update(id, body, admin.id);
  }

  @Put(':id/organizer')
  @RequirePermissions('events.write', 'events.update.basics')
  async assignOrganizer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AssignAdminEventOrganizerDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    await this.assertEventAccess(admin, id);
    return this.events.assignOrganizer(id, body.organizer_user_id ?? null, admin.id);
  }

  @Post(':id/status')
  @RequirePermissions('events.write', 'events.update.lifecycle')
  async setStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateAdminEventStatusDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    await this.assertEventAccess(admin, id);
    return this.events.setStatus(id, body.status, admin.id);
  }

  @Delete(':id')
  @RequirePermissions('events.write', 'events.update.lifecycle')
  async deleteEvent(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    await this.assertEventAccess(admin, id);
    return this.events.deleteEvent(id);
  }

  @Get(':id/setup')
  async setup(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    await this.assertEventAccess(admin, id);
    const scopedVendorId = await this.staff.resolveEventTicketVendorId(
      admin.id,
      admin.role,
      id,
    );
    return this.events.setup(id, scopedVendorId);
  }

  @Get(':id/more')
  async getMore(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    await this.assertEventAccess(admin, id);
    return this.events.getMore(id);
  }

  @Put(':id/more')
  @RequirePermissions('events.write', 'events.update.more')
  async updateMore(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateAdminEventMoreDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    await this.assertEventAccess(admin, id);
    return this.events.updateMore(id, body);
  }

  @Put(':id/third-party-vendors')
  @RequirePermissions('events.write', 'events.update.more')
  async replaceThirdPartyVendors(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ReplaceThirdPartyVendorsDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    await this.assertEventAccess(admin, id);
    return this.events.replaceThirdPartyVendors(id, body);
  }

  @Post(':id/third-party-vendors')
  @RequirePermissions('events.write', 'events.update.more')
  async createThirdPartyVendor(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CreateThirdPartyVendorDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    await this.assertEventAccess(admin, id);
    return this.events.createThirdPartyVendor(id, body);
  }

  @Post(':id/third-party-platforms')
  @RequirePermissions('events.write', 'events.update.tickets')
  async createThirdPartyPlatform(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CreateThirdPartyPlatformDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    await this.assertEventAccess(admin, id);
    return this.events.createThirdPartyPlatform(id, body);
  }

  @Post(':id/addons')
  @RequirePermissions('events.write', 'events.update.more')
  async createAddon(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CreateAdminAddonDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    await this.assertEventAccess(admin, id);
    return this.events.createAddon(id, body);
  }

  @Delete(':id/addons/:addonId')
  @RequirePermissions('events.write', 'events.update.more')
  async deleteAddon(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('addonId', ParseUUIDPipe) addonId: string,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    await this.assertEventAccess(admin, id);
    return this.events.deleteAddon(id, addonId);
  }

  @Post(':id/taxes')
  @RequirePermissions('events.write', 'events.update.more')
  async createTax(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CreateAdminTaxDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    await this.assertEventAccess(admin, id);
    return this.events.createTax(id, body);
  }

  @Delete(':id/taxes/:taxId')
  @RequirePermissions('events.write', 'events.update.more')
  async deleteTax(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('taxId', ParseUUIDPipe) taxId: string,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    await this.assertEventAccess(admin, id);
    return this.events.deleteTax(id, taxId);
  }

  @Put(':id/registration-form')
  @RequirePermissions('events.write', 'events.update.more')
  async upsertRegistrationForm(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpsertAdminRegistrationFormDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    await this.assertEventAccess(admin, id);
    return this.events.upsertRegistrationForm(id, body);
  }

  @Post(':id/sessions')
  @RequirePermissions('events.write', 'events.update.schedule')
  async createSession(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CreateAdminEventSessionDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    await this.assertEventAccess(admin, id);
    return this.events.createSession(id, body);
  }

  @Post(':id/timing')
  @RequirePermissions('events.write', 'events.update.schedule')
  async applyTiming(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ApplyAdminEventTimingDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    await this.assertEventAccess(admin, id);
    return this.events.applyTiming(id, body);
  }

  @Post(':id/ticket-types')
  @RequirePermissions('events.update.tickets')
  async createTicketType(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CreateAdminTicketTypeDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    await this.assertEventAccess(admin, id);
    const scopedVendorId = await this.staff.resolveEventTicketVendorId(
      admin.id,
      admin.role,
      id,
    );
    return this.events.createTicketType(id, body, scopedVendorId);
  }

  @Post(':id/ticket-types/import')
  @RequirePermissions('events.update.tickets')
  async importTicketTypes(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ImportAdminTicketTypesDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    await this.assertEventAccess(admin, id);
    const scopedVendorId = await this.staff.resolveEventTicketVendorId(
      admin.id,
      admin.role,
      id,
    );
    return this.events.importTicketTypes(id, body, scopedVendorId);
  }

  @Put(':id/ticket-types/:ticketTypeId')
  @RequirePermissions('events.update.tickets')
  async updateTicketType(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('ticketTypeId', ParseUUIDPipe) ticketTypeId: string,
    @Body() body: UpdateAdminTicketTypeDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    await this.assertEventAccess(admin, id);
    const scopedVendorId = await this.staff.resolveEventTicketVendorId(
      admin.id,
      admin.role,
      id,
    );
    return this.events.updateTicketType(id, ticketTypeId, body, scopedVendorId);
  }

  @Post(':id/media')
  @RequirePermissions('events.write', 'events.update.place_media')
  async createMedia(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CreateAdminEventMediaDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    await this.assertEventAccess(admin, id);
    return this.events.createMedia(id, body, admin.id);
  }

  @Delete(':id/media/:mediaId')
  @RequirePermissions('events.write', 'events.update.place_media')
  async deleteMedia(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    await this.assertEventAccess(admin, id);
    return this.events.deleteMedia(id, mediaId);
  }

  @Post(':id/submit-review')
  @RequirePermissions('events.write', 'events.update.review')
  async submitForReview(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    await this.assertEventAccess(admin, id);
    return this.events.submitForReview(id, admin.id);
  }

  @Post(':id/publish')
  @RequirePermissions('events.publish')
  async publishEvent(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    await this.assertEventAccess(admin, id);
    return this.events.publishEvent(id, admin.id);
  }
}
