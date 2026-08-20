import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';

import {
  RegistrationFormApiResponseDto,
  RegistrationSubmitFailureDto,
  RegistrationSubmitSuccessDto,
} from './dto/registration-form.dto';
import { RegistrationService } from './registration.service';

@ApiTags('registration-form')
@Controller('registration-form')
export class RegistrationController {
  constructor(private readonly registrationService: RegistrationService) {}

  @Get(':slugOrId')
  @ApiQuery({ name: 'lang', required: false, example: 'en' })
  @ApiOkResponse({ description: 'Frontend-compatible registration form response' })
  @ApiNotFoundResponse({ description: 'Registration form was not found' })
  async getRegistrationForm(
    @Param('slugOrId') slugOrId: string,
    @Query('lang') lang = 'en',
  ): Promise<RegistrationFormApiResponseDto> {
    return {
      success: true,
      data: await this.registrationService.getRegistrationForm(slugOrId, lang),
    };
  }

  @Post('submit')
  @ApiOkResponse({ description: 'Registration submission response' })
  async submitRegistrationForm(
    @Body() body: unknown,
  ): Promise<RegistrationSubmitSuccessDto | RegistrationSubmitFailureDto> {
    return this.registrationService.submitRegistrationForm(body);
  }
}
