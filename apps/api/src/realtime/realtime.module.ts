import { Module } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';
import { NotificationsConsumer } from './notifications.consumer';

/**
 * Realtime fan-out + async side effects, both fed by the same Redis Pub/Sub
 * domain-event stream:
 *   - RealtimeGateway   -> Socket.IO rooms (live UI updates)
 *   - NotificationsConsumer -> BullMQ jobs (Telegram/email push)
 */
@Module({
  providers: [RealtimeGateway, NotificationsConsumer],
})
export class RealtimeModule {}
