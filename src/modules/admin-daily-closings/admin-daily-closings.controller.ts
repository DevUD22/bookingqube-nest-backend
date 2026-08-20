import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator';
import { RequirePermissions } from '../admin-auth/decorators/permissions.decorator';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard';
import { AdminPermissionsGuard } from '../admin-auth/guards/admin-permissions.guard';
import { AuthenticatedAdmin } from '../admin-auth/strategies/admin-jwt.strategy';
import { AdminDailyClosingsService } from './admin-daily-closings.service';
import { AdminSettlementsService } from './admin-settlements.service';
import {
  AddDailyClosingNoteDto,
  ApproveDailyClosingDto,
  CreateDailyClosingDto,
  CreateSettlementDto,
  DailyClosingExpectedQueryDto,
  DailyClosingListQueryDto,
  SettlementListQueryDto,
  UpdateDailyClosingDto,
} from './dto/admin-daily-closing.dto';

@ApiTags('admin-daily-closings')
@ApiBearerAuth()
@Controller('admin/daily-closings')
@UseGuards(AdminAuthGuard, AdminPermissionsGuard)
@RequirePermissions('closings.read')
export class AdminDailyClosingsController {
  constructor(private readonly closings: AdminDailyClosingsService) {}

  @Get()
  list(@Query() query: DailyClosingListQueryDto, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return this.closings.list(query, admin);
  }

  @Get('expected')
  expected(
    @Query() query: DailyClosingExpectedQueryDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    return this.closings.expected(query, admin);
  }

  @Post()
  @RequirePermissions('closings.write')
  create(@Body() body: CreateDailyClosingDto, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return this.closings.create(body, admin);
  }

  @Put(':id')
  @RequirePermissions('closings.write')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateDailyClosingDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    return this.closings.update(id, body, admin);
  }

  @Post(':id/note')
  @RequirePermissions('closings.write')
  addNote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AddDailyClosingNoteDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    return this.closings.addNote(id, body, admin);
  }

  @Post(':id/approve')
  @RequirePermissions('closings.approve')
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ApproveDailyClosingDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    return this.closings.approve(id, body, admin);
  }

  @Get(':id/history')
  history(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    return this.closings.history(id, admin);
  }

  @Get(':id/pdf')
  pdf(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    return this.closings.pdf(id, admin);
  }

  @Delete(':id')
  @RequirePermissions('closings.write')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    return this.closings.remove(id, admin);
  }
}

@ApiTags('admin-settlements')
@ApiBearerAuth()
@Controller('admin/settlements')
@UseGuards(AdminAuthGuard, AdminPermissionsGuard)
@RequirePermissions('settlements.read')
export class AdminSettlementsController {
  constructor(private readonly settlements: AdminSettlementsService) {}

  @Get()
  list(@Query() query: SettlementListQueryDto, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return this.settlements.list(query, admin);
  }

  @Post()
  @RequirePermissions('settlements.write')
  create(@Body() body: CreateSettlementDto, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return this.settlements.create(body, admin);
  }
}
