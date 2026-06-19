import { Module } from '@nestjs/common';
import { OutboxModule } from '../outbox/outbox.module';
import { InventoryService } from './inventory.service';
import { ReservationSweeperService } from './reservation-sweeper.service';

@Module({
  imports: [OutboxModule], // for OutboxService
  providers: [InventoryService, ReservationSweeperService],
  exports: [InventoryService],
})
export class InventoryModule {}
