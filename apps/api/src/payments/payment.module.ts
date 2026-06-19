import { Module } from '@nestjs/common';
import { OrderModule } from '../orders/order.module';
import { RedisLock } from '../common/redis-lock';
import { PaymentWebhookController } from './payment-webhook.controller';
import { PaymentWebhookService } from './payment-webhook.service';

@Module({
  imports: [OrderModule], // for OrderService (status transition)
  controllers: [PaymentWebhookController],
  providers: [PaymentWebhookService, RedisLock],
})
export class PaymentModule {}
