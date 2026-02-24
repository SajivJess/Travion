import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { join } from 'path';
import { existsSync } from 'fs';
import { ConfigModule } from '@nestjs/config';
import { ItineraryModule } from './itinerary/itinerary.module';
import { BillingModule } from './billing/billing.module';
import { AuthModule } from './auth/auth.module';
import { AuthMiddleware } from './middleware/auth.middleware';
import { QueueModule } from './queue/queue.module';
import { WebsocketModule } from './websocket/websocket.module';
import { AgentModule } from './agent/agent.module';
import { TeamModule } from './team/team.module';

const staticPath = join(__dirname, '..', '..', '..', 'build', 'web');
const hasStaticBuild = existsSync(staticPath);

// Only import ServeStaticModule when a production build exists
const optionalModules = [];
if (hasStaticBuild) {
  const { ServeStaticModule } = require('@nestjs/serve-static');
  optionalModules.push(
    ServeStaticModule.forRoot({
      rootPath: staticPath,
      exclude: ['/api{*splat}'],
    }),
  );
}

@Module({
  imports: [
    ...optionalModules,
    ConfigModule.forRoot({ isGlobal: true }),
    ItineraryModule,
    BillingModule,
    AuthModule,
    QueueModule,
    WebsocketModule,
    AgentModule,
    TeamModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AuthMiddleware)
      .forRoutes('itinerary'); // Apply auth to all itinerary routes
  }
}
