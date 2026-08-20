import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { PosLoginDto } from './dto/pos-auth.dto';
import { PosAuthService } from './pos-auth.service';

@ApiTags('pos-auth')
@Controller('pos/auth')
export class PosAuthController {
  constructor(private readonly posAuth: PosAuthService) {}

  /**
   * Dedicated POS agent login.
   * Agent must have an active StaffAssignment with role `pos` on an event.
   * POST /api/v1/pos/auth/login
   */
  @Post('login')
  @HttpCode(200)
  login(@Body() body: PosLoginDto) {
    return this.posAuth.login(body);
  }
}
