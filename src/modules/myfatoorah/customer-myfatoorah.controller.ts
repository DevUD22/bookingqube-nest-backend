import {
  Body,
  Controller,
  HttpCode,
  Post,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import {
  ConfirmMyFatoorahPaymentDto,
  InitiateEmbeddedSessionsDto,
} from './dto/customer-myfatoorah.dto';
import { MyFatoorahService } from './myfatoorah.service';

@ApiTags('customer-myfatoorah')
@ApiBearerAuth()
@Controller('myfatoorah')
@UseGuards(JwtAuthGuard)
export class CustomerMyFatoorahController {
  constructor(private readonly myFatoorah: MyFatoorahService) {}

  @Post('initiate-embedded-sessions')
  @HttpCode(200)
  async initiateEmbeddedSessions(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: InitiateEmbeddedSessionsDto,
  ) {
    const result = await this.myFatoorah.createBatchEmbeddedSessions(body, {
      id: user.id,
      name: user.name,
      email: user.email,
    });
    if (!result.success) {
      throw new UnprocessableEntityException(result);
    }
    return result;
  }

  @Post('confirm-payment')
  @HttpCode(200)
  async confirmPayment(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ConfirmMyFatoorahPaymentDto,
  ) {
    const result = await this.myFatoorah.confirmCustomerPayment(body, {
      id: user.id,
      name: user.name,
      email: user.email,
    });
    if (!result.paid) {
      throw new UnprocessableEntityException(result);
    }
    return result;
  }
}
