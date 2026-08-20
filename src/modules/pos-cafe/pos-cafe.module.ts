import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';

import { DatabaseModule } from '../../database/database.module';
import { AdminDailyClosingsModule } from '../admin-daily-closings/admin-daily-closings.module';
import { AuthModule } from '../auth/auth.module';
import { QueuesModule } from '../queues/queues.module';
import { CafePosAuthGuard } from './guards/cafe-pos-auth.guard';
import { PosCafeAuthService } from './pos-cafe-auth.service';
import { PosCafeController } from './pos-cafe.controller';
import { PosCafeService } from './pos-cafe.service';
import { CafePosJwtStrategy } from './strategies/cafe-pos-jwt.strategy';

@Module({
  imports: [
    DatabaseModule,
    QueuesModule,
    AuthModule,
    PassportModule,
    AdminDailyClosingsModule,
  ],
  controllers: [PosCafeController],
  providers: [
    PosCafeService,
    PosCafeAuthService,
    CafePosJwtStrategy,
    CafePosAuthGuard,
  ],
  exports: [PosCafeService, CafePosAuthGuard],
})
export class PosCafeModule {}
