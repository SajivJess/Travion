import { Module, forwardRef } from '@nestjs/common';
import { ItineraryService } from './itinerary.service';
import { ItineraryController } from './itinerary.controller';
import { FlightService } from './flight.service';
import { AirportService } from './airport.service';
import { SerpService } from './serp.service';
import { WeatherService } from './weather.service';
import { GeoService } from './geo.service';
import { TransportService } from './transport.service';
import { EasemytripService } from './easemytrip.service';
import { ImageService } from './image.service';
import { TourismAdvisoryService } from './tourism-advisory.service';
import { TourismPoiService } from './tourism-poi.service';
import { AviationStackService } from './aviation-stack.service';
import { UserFlagService } from './user-flag.service';
import { OpenRouterService } from './openrouter.service';
import { ChatbotService } from './chatbot.service';
import { DiscoveryCacheService } from '../supabase/discovery-cache.service';
import { QueueModule } from '../queue/queue.module';
import { InstagramService } from './instagram.service';
import { YoutubeDiscoveryService } from './youtube-discovery.service';
import { ImpactEngineService } from './impact-engine.service';
import { AgentToolsService } from './agent-tools.service';
import { TripTrackerService } from './trip-tracker.service';
import { EtaMonitorService } from './eta-monitor.service';

@Module({
  imports: [forwardRef(() => QueueModule)],
  controllers: [ItineraryController],
  providers: [ItineraryService, AirportService, FlightService, SerpService, WeatherService, GeoService, TransportService, EasemytripService, ImageService, TourismAdvisoryService, TourismPoiService, AviationStackService, UserFlagService, OpenRouterService, ChatbotService, DiscoveryCacheService, InstagramService, YoutubeDiscoveryService, ImpactEngineService, AgentToolsService, TripTrackerService, EtaMonitorService],
  exports: [ItineraryService, AirportService, FlightService, SerpService, WeatherService, GeoService, TransportService, EasemytripService, ImageService, TourismAdvisoryService, TourismPoiService, AviationStackService, UserFlagService, OpenRouterService, ChatbotService, InstagramService, YoutubeDiscoveryService, ImpactEngineService, AgentToolsService, TripTrackerService, EtaMonitorService],
})
export class ItineraryModule {}
