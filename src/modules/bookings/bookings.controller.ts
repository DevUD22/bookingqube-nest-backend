import {
  Controller,
  Get,
  Param,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { BookingsService } from './bookings.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Get('customer/bookings')
  getCustomerBookings(
    @CurrentUser() user: AuthenticatedUser,
    @Query('from_date') fromDate?: string,
    @Query('to_date') toDate?: string,
    @Query('page') page = '1',
    @Query('per_page') perPage = '6',
    @Query('lang') lang = 'en',
  ) {
    return this.bookingsService.getCustomerBookings({
      customerId: user.id,
      fromDate,
      toDate,
      page,
      perPage,
      lang,
    });
  }

  @Get('bookings/:order/tickets')
  async getBookingTickets(
    @CurrentUser() user: AuthenticatedUser,
    @Param('order') order: string,
    @Query('format') format = 'card',
  ) {
    const { buffer, filename } = await this.bookingsService.buildBookingTicketsPdf(
      order,
      format,
      user.id,
    );

    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `attachment; filename="${filename}"`,
    });
  }
}
