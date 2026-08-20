import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentCafePosAgent } from './decorators/current-cafe-pos-agent.decorator';
import {
  ApplyCafePromocodeDto,
  BookCafeTableDto,
  CafeCustomerSearchQueryDto,
  CafePosDailyClosingNoteDto,
  CafePosDailyClosingQueryDto,
  CafePosLoginDto,
  CafePosReportDto,
  ClearCafeTableDto,
  CreateCafePosCategoryDto,
  CreateCafePosDailyClosingDto,
  CreateCafePosMenuItemDto,
  CreateCafePosSubcategoryDto,
  InstantCafeOrderDto,
  SaveCafePosSalesEntryDto,
} from './dto/pos-cafe.dto';
import { CafePosAuthGuard } from './guards/cafe-pos-auth.guard';
import { PosCafeAuthService } from './pos-cafe-auth.service';
import { PosCafeService } from './pos-cafe.service';
import { AuthenticatedCafePosAgent } from './strategies/cafe-pos-jwt.strategy';

@ApiTags('pos-cafe')
@Controller('pos/cafe')
export class PosCafeController {
  constructor(
    private readonly cafePos: PosCafeService,
    private readonly cafePosAuth: PosCafeAuthService,
  ) {}

  /**
   * Dedicated cafe POS agent login.
   * Agent must have an active CafePosAgent row.
   * POST /api/v1/pos/cafe/auth/login
   */
  @Post('auth/login')
  @HttpCode(200)
  login(@Body() body: CafePosLoginDto) {
    return this.cafePosAuth.login(body);
  }

  @Get('me')
  @UseGuards(CafePosAuthGuard)
  @ApiBearerAuth()
  me(@CurrentCafePosAgent() agent: AuthenticatedCafePosAgent) {
    return this.cafePosAuth.me(agent.id, agent.cafeId);
  }

  @Get('context')
  @UseGuards(CafePosAuthGuard)
  @ApiBearerAuth()
  getContext(@CurrentCafePosAgent() agent: AuthenticatedCafePosAgent) {
    return this.cafePos.getContext(agent);
  }

  @Get('menu')
  @UseGuards(CafePosAuthGuard)
  @ApiBearerAuth()
  getMenu(@CurrentCafePosAgent() agent: AuthenticatedCafePosAgent) {
    return this.cafePos.getMenu(agent);
  }

  @Post('menu/categories')
  @HttpCode(200)
  @UseGuards(CafePosAuthGuard)
  @ApiBearerAuth()
  createCategory(
    @CurrentCafePosAgent() agent: AuthenticatedCafePosAgent,
    @Body() body: CreateCafePosCategoryDto,
  ) {
    return this.cafePos.createCategory(agent, body);
  }

  @Post('menu/subcategories')
  @HttpCode(200)
  @UseGuards(CafePosAuthGuard)
  @ApiBearerAuth()
  createSubcategory(
    @CurrentCafePosAgent() agent: AuthenticatedCafePosAgent,
    @Body() body: CreateCafePosSubcategoryDto,
  ) {
    return this.cafePos.createSubcategory(agent, body);
  }

  @Post('menu/items')
  @HttpCode(200)
  @UseGuards(CafePosAuthGuard)
  @ApiBearerAuth()
  createItem(
    @CurrentCafePosAgent() agent: AuthenticatedCafePosAgent,
    @Body() body: CreateCafePosMenuItemDto,
  ) {
    return this.cafePos.createMenuItem(agent, body);
  }

  @Get('tables')
  @UseGuards(CafePosAuthGuard)
  @ApiBearerAuth()
  getTables(@CurrentCafePosAgent() agent: AuthenticatedCafePosAgent) {
    return this.cafePos.getTables(agent);
  }

  @Post('promocodes/apply')
  @HttpCode(200)
  @UseGuards(CafePosAuthGuard)
  @ApiBearerAuth()
  applyPromocode(
    @CurrentCafePosAgent() agent: AuthenticatedCafePosAgent,
    @Body() body: ApplyCafePromocodeDto,
    @Query('lang') lang = 'en',
  ) {
    return this.cafePos.applyPromocode(agent, body, lang);
  }

  @Get('customers/search')
  @UseGuards(CafePosAuthGuard)
  @ApiBearerAuth()
  searchCustomers(
    @CurrentCafePosAgent() agent: AuthenticatedCafePosAgent,
    @Query() query: CafeCustomerSearchQueryDto,
  ) {
    return this.cafePos.searchCustomers(agent, query);
  }

  @Post('orders')
  @HttpCode(200)
  @UseGuards(CafePosAuthGuard)
  @ApiBearerAuth()
  checkoutOrder(
    @CurrentCafePosAgent() agent: AuthenticatedCafePosAgent,
    @Body() body: InstantCafeOrderDto,
  ) {
    return this.cafePos.checkoutInstant(agent, body);
  }

  @Post('tables/book')
  @HttpCode(200)
  @UseGuards(CafePosAuthGuard)
  @ApiBearerAuth()
  book(
    @CurrentCafePosAgent() agent: AuthenticatedCafePosAgent,
    @Body() body: BookCafeTableDto,
  ) {
    return this.cafePos.bookToTable(agent, body);
  }

  @Post('tables/clear')
  @HttpCode(200)
  @UseGuards(CafePosAuthGuard)
  @ApiBearerAuth()
  clear(
    @CurrentCafePosAgent() agent: AuthenticatedCafePosAgent,
    @Body() body: ClearCafeTableDto,
  ) {
    return this.cafePos.clearTable(agent, body);
  }

  @Post('report')
  @HttpCode(200)
  @UseGuards(CafePosAuthGuard)
  @ApiBearerAuth()
  report(
    @CurrentCafePosAgent() agent: AuthenticatedCafePosAgent,
    @Body() body: CafePosReportDto,
  ) {
    return this.cafePos.getReport(agent, body);
  }

  @Get('sales-entry')
  @UseGuards(CafePosAuthGuard)
  @ApiBearerAuth()
  getSalesEntry(
    @CurrentCafePosAgent() agent: AuthenticatedCafePosAgent,
    @Query('date') date?: string,
  ) {
    return this.cafePos.getSalesEntry(agent, date);
  }

  @Post('sales-entry')
  @HttpCode(200)
  @UseGuards(CafePosAuthGuard)
  @ApiBearerAuth()
  saveSalesEntry(
    @CurrentCafePosAgent() agent: AuthenticatedCafePosAgent,
    @Body() body: SaveCafePosSalesEntryDto,
  ) {
    return this.cafePos.saveSalesEntry(agent, body);
  }

  @Get('daily-closings')
  @UseGuards(CafePosAuthGuard)
  @ApiBearerAuth()
  listDailyClosings(
    @CurrentCafePosAgent() agent: AuthenticatedCafePosAgent,
    @Query() query: CafePosDailyClosingQueryDto,
  ) {
    return this.cafePos.listDailyClosings(agent, query.closing_for_date);
  }

  @Post('daily-closings')
  @HttpCode(200)
  @UseGuards(CafePosAuthGuard)
  @ApiBearerAuth()
  createDailyClosing(
    @CurrentCafePosAgent() agent: AuthenticatedCafePosAgent,
    @Body() body: CreateCafePosDailyClosingDto,
  ) {
    return this.cafePos.createDailyClosing(agent, body);
  }

  @Post('daily-closings/:id/note')
  @HttpCode(200)
  @UseGuards(CafePosAuthGuard)
  @ApiBearerAuth()
  addDailyClosingNote(
    @CurrentCafePosAgent() agent: AuthenticatedCafePosAgent,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CafePosDailyClosingNoteDto,
  ) {
    return this.cafePos.addDailyClosingNote(agent, id, body.note);
  }
}
