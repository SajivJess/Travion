import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { SubscriptionService } from './subscription.service';

@Module({
  controllers: [BillingController],
  providers: [SubscriptionService],
  exports: [SubscriptionService],
})
export class BillingModule {}
