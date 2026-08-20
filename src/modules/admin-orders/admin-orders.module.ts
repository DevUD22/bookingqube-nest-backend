import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AdminStaffModule } from '../admin-staff/admin-staff.module';
import { InventoryModule } from '../inventory/inventory.module';
import { QueuesModule } from '../queues/queues.module';
import { AdminOrdersController } from './admin-orders.controller';
import { AdminOrdersService } from './admin-orders.service';

@Module({
  imports: [DatabaseModule, AdminAuthModule, AdminStaffModule, InventoryModule, QueuesModule],
  controllers: [AdminOrdersController],
  providers: [AdminOrdersService],
  exports: [AdminOrdersService],
})
export class AdminOrdersModule {}
