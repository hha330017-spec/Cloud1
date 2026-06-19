import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './auth/auth.module';
import { OutboxModule } from './outbox/outbox.module';
import { RealtimeModule } from './realtime/realtime.module';
import { InventoryModule } from './inventory/inventory.module';
import { CheckoutModule } from './checkout/checkout.module';
import { OrderModule } from './orders/order.module';
import { PaymentModule } from './payments/payment.module';
import { loadConfig } from './config/configuration';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [loadConfig] }),
    ScheduleModule.forRoot(), // drives the outbox-relay poll + reservation sweeper
    DatabaseModule,
    RedisModule,
    AuthModule,
    OutboxModule,
    RealtimeModule,
    InventoryModule,
    CheckoutModule,
    OrderModule,
    PaymentModule,
  ],
})
export class AppModule {}
