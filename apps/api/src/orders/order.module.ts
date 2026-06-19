import { Module } from '@nestjs/common';
import { OutboxModule } from '../outbox/outbox.module';
import { VendorScopedRepository } from '../common/vendor-scoped.repository';
import { OrderService } from './order.service';
import { OrderController } from './order.controller';

@Module({
  imports: [OutboxModule],
  controllers: [OrderController],
  providers: [OrderService, VendorScopedRepository],
  exports: [OrderService],
})
export class OrderModule {}
