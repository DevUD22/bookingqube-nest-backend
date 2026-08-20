import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { UpsertBookingFeedbackDto, UpsertEventReviewDto } from './dto/review.dto';
import { ReviewsService } from './reviews.service';

@Controller()
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get('events/:slug/reviews')
  publicForEvent(@Param('slug') slug: string, @Query('page') page = '1', @Query('per_page') perPage = '6') {
    return this.reviews.publicForEvent(slug, Number(page) || 1, Number(perPage) || 6);
  }

  @Post('customer/reviews')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  upsertReview(@CurrentUser() user: AuthenticatedUser, @Body() body: UpsertEventReviewDto) {
    return this.reviews.upsertEventReview(user.id, body);
  }

  @Post('customer/booking-feedback')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  feedback(@CurrentUser() user: AuthenticatedUser, @Body() body: UpsertBookingFeedbackDto) {
    return this.reviews.upsertBookingFeedback(user.id, body);
  }
}
