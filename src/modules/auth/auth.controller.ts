import { Body, Controller, Headers, HttpCode, Ip, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { AuthService } from './auth.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SocialLoginDto } from './dto/social-login.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';

@Throttle({ default: { limit: 10, ttl: 60_000 } })
@Controller()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @HttpCode(200)
  register(@Body() body: RegisterDto) {
    return this.authService.register(body);
  }

  @Post('login')
  @HttpCode(200)
  login(
    @Body() body: LoginDto,
    @Headers('user-agent') userAgent?: string,
    @Ip() ipAddress?: string,
  ) {
    return this.authService.login(body, { userAgent, ipAddress });
  }

  @Post('social_login')
  @HttpCode(200)
  socialLogin(
    @Body() body: SocialLoginDto,
    @Headers('user-agent') userAgent?: string,
    @Ip() ipAddress?: string,
  ) {
    return this.authService.socialLogin(body, { userAgent, ipAddress });
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(
    @Body() body: RefreshTokenDto,
    @Headers('user-agent') userAgent?: string,
    @Ip() ipAddress?: string,
  ) {
    return this.authService.refresh(body.refresh_token, { userAgent, ipAddress });
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Body() body: RefreshTokenDto) {
    return this.authService.logout(body.refresh_token);
  }

  @Post('password/forgot')
  @HttpCode(200)
  forgotPassword(@Body() body: ForgotPasswordDto) {
    return this.authService.forgotPassword(body);
  }

  @Post('password/verify-otp')
  @HttpCode(200)
  verifyOtp(@Body() body: VerifyOtpDto) {
    return this.authService.verifyOtp(body);
  }

  @Post('password/reset')
  @HttpCode(200)
  resetPassword(@Body() body: ResetPasswordDto) {
    return this.authService.resetPassword(body);
  }
}
