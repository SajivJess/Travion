import { Module } from '@nestjs/common';
import { AgentGateway } from './agent.gateway';
import { NotificationService } from './notification.service';

@Module({
  providers: [AgentGateway, NotificationService],
  exports: [AgentGateway, NotificationService],
})
export class WebsocketModule {}
