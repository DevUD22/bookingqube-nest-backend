import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';

import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { AdminDailyClosingsModule } from '../admin-daily-closings/admin-daily-closings.module';
import { InventoryModule } from '../inventory/inventory.module';
import { ReportingModule } from '../reporting/reporting.module';
import { PosAuthController } from './pos-auth.controller';
import { PosAuthService } from './pos-auth.service';
import { PosCustomersController } from './pos-customers.controller';
import { PosCustomersService } from './pos-customers.service';
import { PosPromocodesController } from './pos-promocodes.controller';
import { PosPromocodesService } from './pos-promocodes.service';
import { PosTicketsController } from './pos.controller';
import { PosTicketsService } from './pos-tickets.service';
import { PosShiftsController } from './pos-shifts.controller';
import { PosShiftsService } from './pos-shifts.service';
import { PosOnlineTicketsController } from './pos-online-tickets.controller';
import { PosOnlineTicketsService } from './pos-online-tickets.service';
import { PosReprintsController } from './pos-reprints.controller';
import { PosReprintsService } from './pos-reprints.service';
import { PosRebooksController } from './pos-rebooks.controller';
import { PosRebooksService } from './pos-rebooks.service';
import { PosRefundsController } from './pos-refunds.controller';
import { PosRefundsService } from './pos-refunds.service';
import { PosSalesEntryController } from './pos-sales-entry.controller';
import { PosSalesEntryService } from './pos-sales-entry.service';
import { PosAuthGuard } from './guards/pos-auth.guard';
import { OptionalPosAuthGuard } from './guards/optional-pos-auth.guard';
import { PosJwtStrategy } from './strategies/pos-jwt.strategy';

@Module({
  imports: [DatabaseModule, AuthModule, AdminDailyClosingsModule, InventoryModule, ReportingModule, PassportModule],
  controllers: [
    PosAuthController,
    PosTicketsController,
    PosCustomersController,
    PosPromocodesController,
    PosShiftsController,
    PosOnlineTicketsController,
    PosReprintsController,
    PosRebooksController,
    PosRefundsController,
    PosSalesEntryController,
  ],
  providers: [
    PosAuthService,
    PosTicketsService,
    PosCustomersService,
    PosPromocodesService,
    PosShiftsService,
    PosOnlineTicketsService,
    PosReprintsService,
    PosRebooksService,
    PosRefundsService,
    PosSalesEntryService,
    PosJwtStrategy,
    PosAuthGuard,
    OptionalPosAuthGuard,
  ],
  exports: [
    PosAuthGuard,
    OptionalPosAuthGuard,
    PosAuthService,
    PosTicketsService,
    PosCustomersService,
    PosJwtStrategy,
  ],
})
export class PosModule {}
