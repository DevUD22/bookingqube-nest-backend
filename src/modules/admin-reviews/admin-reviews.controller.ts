import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Query, UseGuards } from '@nestjs/common';

import { RequirePermissions } from '../admin-auth/decorators/permissions.decorator';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard';
import { AdminPermissionsGuard } from '../admin-auth/guards/admin-permissions.guard';
import { AdminReviewsService } from './admin-reviews.service';
import { AdminReviewsQueryDto, UpdateEventReviewSettingsDto, UpdateReviewSettingsDto, UpdateReviewStatusDto } from './dto/admin-review.dto';

@Controller('admin/reviews')
@UseGuards(AdminAuthGuard, AdminPermissionsGuard)
@RequirePermissions('reviews.read')
export class AdminReviewsController {
  constructor(private readonly reviews: AdminReviewsService) {}
  @Get() list(@Query() query: AdminReviewsQueryDto) { return this.reviews.list(query); }
  @Get('booking-feedback') bookingFeedback(@Query() query: AdminReviewsQueryDto) { return this.reviews.listBookingFeedback(query); }
  @Put(':id/status') @RequirePermissions('reviews.manage') status(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateReviewStatusDto) { return this.reviews.updateStatus(id, body); }
  @Get('settings') settings() { return this.reviews.getSettings(); }
  @Put('settings') @RequirePermissions('reviews.manage') updateSettings(@Body() body: UpdateReviewSettingsDto) { return this.reviews.updateSettings(body); }
  @Put('events/:id/settings') @RequirePermissions('reviews.manage') updateEvent(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateEventReviewSettingsDto) { return this.reviews.updateEventSettings(id, body); }
}
