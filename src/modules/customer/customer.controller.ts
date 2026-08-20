import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CustomerService } from './customer.service';
import { AddCustomerFavoriteDto } from './dto/customer-favorite.dto';
import {
  ConfirmEmailChangeDto,
  UpdateCustomerPasswordDto,
  UpdateCustomerProfileDto,
} from './dto/customer-profile.dto';

@Controller('customer')
@UseGuards(JwtAuthGuard)
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  @Get('profile')
  getProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.customerService.getProfile(user.id);
  }

  @Post('profile')
  @HttpCode(200)
  updateProfile(@CurrentUser() user: AuthenticatedUser, @Body() body: UpdateCustomerProfileDto) {
    return this.customerService.updateProfile(user.id, body);
  }

  @Put('profile/password')
  updatePassword(@CurrentUser() user: AuthenticatedUser, @Body() body: UpdateCustomerPasswordDto) {
    return this.customerService.updatePassword(user.id, body);
  }

  @Post('profile/email/confirm')
  @HttpCode(200)
  confirmEmailChange(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ConfirmEmailChangeDto,
  ) {
    return this.customerService.confirmEmailChange(user.id, body);
  }

  @Post('profile/email/resend')
  @HttpCode(200)
  resendEmailChange(@CurrentUser() user: AuthenticatedUser) {
    return this.customerService.resendEmailChange(user.id);
  }

  @Post('profile/email/cancel')
  @HttpCode(200)
  cancelEmailChange(@CurrentUser() user: AuthenticatedUser) {
    return this.customerService.cancelEmailChange(user.id);
  }

  @Get('favorites')
  getFavorites(@CurrentUser() user: AuthenticatedUser, @Query('lang') lang = 'en') {
    return this.customerService.getFavorites(user.id, lang);
  }

  @Post('favorites')
  @HttpCode(200)
  addFavorite(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: AddCustomerFavoriteDto,
    @Query('lang') lang = 'en',
  ) {
    return this.customerService.addFavorite(user.id, body, lang);
  }

  @Delete('favorites/:eventId')
  removeFavorite(@CurrentUser() user: AuthenticatedUser, @Param('eventId') eventId: string) {
    return this.customerService.removeFavorite(user.id, eventId);
  }
}
