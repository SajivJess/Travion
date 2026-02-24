import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { WeatherMonitorProcessor } from './processors/weather-monitor.processor';
import { CrowdMonitorProcessor } from './processors/crowd-monitor.processor';
import { ReplanProcessor } from './processors/replan.processor';
import { TripPlanningProcessor } from './processors/trip-planning.processor';
import { FlightDelayMonitorProcessor } from './processors/flight-delay-monitor.processor';
import { TransportDelayMonitorProcessor } from './processors/transport-delay-monitor.processor';
import { PoiMonitorProcessor } from './processors/poi-monitor.processor';
import { AgentLoopProcessor } from './processors/agent-loop.processor';
import { QueueService } from './queue.service';
import { ItineraryModule } from '../itinerary/itinerary.module';
import { DiscoveryCacheService } from '../supabase/discovery-cache.service';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        redis: {
          host: configService.get('REDIS_HOST') || 'localhost',
          port: configService.get('REDIS_PORT') || 6379,
          password: configService.get('REDIS_PASSWORD') || undefined,
        },
        defaultJobOptions: {
          removeOnComplete: 100, // Keep last 100 completed jobs so we can fetch results
          removeOnFail: false,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
        },
      }),
      inject: [ConfigService],
    }),
    // Register queues
    BullModule.registerQueue(
      { name: 'trip-planning' },
      { name: 'weather-monitor' },
      { name: 'crowd-monitor' },
      { name: 'replan' },
      { name: 'notifications' },
      { name: 'flight-delay-monitor' },
      { name: 'transport-delay-monitor' },
      { name: 'poi-monitor' },
      { name: 'agent-loop' },
    ),
    forwardRef(() => ItineraryModule),
  ],
  providers: [
    TripPlanningProcessor,
    WeatherMonitorProcessor,
    CrowdMonitorProcessor,
    ReplanProcessor,
    FlightDelayMonitorProcessor,
    TransportDelayMonitorProcessor,
    PoiMonitorProcessor,
    AgentLoopProcessor,
    QueueService,
    DiscoveryCacheService,
  ],
  exports: [BullModule, QueueService, DiscoveryCacheService],
})
export class QueueModule {}
