import { Module } from '@nestjs/common';
import { OutboxService } from './outbox.service';
import { OutboxRelayService } from './outbox-relay.service';

/**
 * OutboxService is exported so domain modules (orders, inventory, cart) can
 * emit events inside their transactions. OutboxRelayService runs the polling
 * publisher on @Interval.
 */
@Module({
  providers: [OutboxService, OutboxRelayService],
  exports: [OutboxService],
})
export class OutboxModule {}
