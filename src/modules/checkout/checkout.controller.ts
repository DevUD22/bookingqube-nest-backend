import {
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { BookTicketRequestDto, ConfirmPaymentDto, ReleaseHoldDto } from './dto/book-ticket.dto';
import { CheckoutService } from './checkout.service';

@Controller()
export class CheckoutController {
  constructor(
    private readonly checkoutService: CheckoutService,
    private readonly config: ConfigService,
  ) {}

  private actorId(user: AuthenticatedUser | undefined): string | undefined {
    return user?.id;
  }

  @Post(['book-tickets', 'book-ticket'])
  @HttpCode(200)
  @UseGuards(OptionalJwtAuthGuard)
  bookTicket(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Body() body: BookTicketRequestDto,
    @Query('lang') lang = 'en',
  ) {
    return this.checkoutService.bookTicket(body, lang, this.actorId(user));
  }

  @Post('payments/mock-checkout')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  mockCheckout(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: BookTicketRequestDto,
    @Query('lang') lang = 'en',
  ) {
    if (this.config.get<string>('ENABLE_MOCK_PAYMENTS') !== 'true') {
      throw new NotFoundException('Mock checkout is not enabled.');
    }

    const totals = body.orderDetailPayload?.totals ?? body.totals;
    return this.checkoutService.bookTicket(
      {
        ...body,
        payment_method: 0,
        paymentDetailPayload: {
          provider: 'mock',
          status: 'paid',
          amount: Number(totals?.total) || 0,
          currency: totals?.currency ?? 'QAR',
          providerResponse: {
            paymentId: `mock-${body.idempotency_key ?? Date.now()}`,
          },
        },
      },
      lang,
      user.id,
      { allowVerifiedPaid: true },
    );
  }

  @Post('holds')
  @HttpCode(200)
  @UseGuards(OptionalJwtAuthGuard)
  createHold(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Body() body: BookTicketRequestDto,
    @Query('lang') lang = 'en',
  ) {
    // Hold-only: force unpaid path by stripping paid payment payload.
    const holdBody: BookTicketRequestDto = {
      ...body,
      paymentDetailPayload: body.paymentDetailPayload
        ? { ...body.paymentDetailPayload, status: 'pending' }
        : undefined,
    };
    return this.checkoutService.bookTicket(holdBody, lang, this.actorId(user));
  }

  @Post('holds/:id/release')
  @HttpCode(200)
  @UseGuards(OptionalJwtAuthGuard)
  releaseHold(
    @Param('id') id: string,
    @Body() body: ReleaseHoldDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    return this.checkoutService.releaseHold(id, {
      actorId: this.actorId(user),
      releaseToken: body.release_token,
    });
  }

  @Post('payments/confirm')
  @HttpCode(200)
  confirmPayment(@Body() body: ConfirmPaymentDto) {
    return this.checkoutService.confirmPayment(body);
  }
}
