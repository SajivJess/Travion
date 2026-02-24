import { Process, Processor, OnQueueCompleted, OnQueueFailed } from '@nestjs/bull';
import { Logger, Inject, forwardRef } from '@nestjs/common';
import { Job } from 'bull';
import { ItineraryService } from '../../itinerary/itinerary.service';
import { SerpService } from '../../itinerary/serp.service';
import { WeatherService } from '../../itinerary/weather.service';
import { GeoService } from '../../itinerary/geo.service';
import { DiscoveryCacheService } from '../../supabase/discovery-cache.service';
import { QueueService } from '../queue.service';
import { supabase } from '../../supabase/client';

export interface TripPlanningJobData {
  jobId: string;
  userId: string;
  dto: {
    source: string;
    destination: string;
    startDate: string;
    endDate: string;
    travellers: number;
    budget: number;
    travelStyle: string;
    mealPreference?: string;
    averageAge?: number;
    includeNightlife?: boolean;
    transportMode?: string;
    arrivalTime?: string;
    specificPlaces?: string;
    foodPreferences?: string;
  };
}

/**
 * BullMQ Processor for the 6-step trip planning pipeline:
 * 
 * STEP 1: Validate inputs (already done by controller)
 * STEP 2: Parallel Discovery (SerpAPI → Hotels, Attractions, Restaurants)
 * STEP 3: Parallel Geo Context (Geocoding + Weather)
 * STEP 4: Proximity Clustering (Distance Matrix → Day groups)
 * STEP 5: Gemini Planning (Schedule + Budget + Weather adapt)
 * STEP 6: Store result + Start monitoring
 */
@Processor('trip-planning')
export class TripPlanningProcessor {
  private readonly logger = new Logger(TripPlanningProcessor.name);

  constructor(
    @Inject(forwardRef(() => ItineraryService))
    private readonly itineraryService: ItineraryService,
    private readonly serpService: SerpService,
    private readonly weatherService: WeatherService,
    private readonly geoService: GeoService,
    private readonly cacheService: DiscoveryCacheService,
    @Inject(forwardRef(() => QueueService))
    private readonly queueService: QueueService,
  ) {}

  @Process('plan-trip')
  async handleTripPlanning(job: Job<TripPlanningJobData>): Promise<any> {
    const { jobId, userId, dto } = job.data;
    const startTime = Date.now();

    this.logger.log(`\n🚀 [PIPELINE START] Trip: ${dto.source} → ${dto.destination}`);
    this.logger.log(`   Budget: ₹${dto.budget} | ${dto.travellers} travelers | Style: ${dto.travelStyle}`);

    try {
      // ═══════════════════════════════════════════════════
      // STEP 1.5: Transport & Validation
      // ═══════════════════════════════════════════════════
      await this.updateJobStatus(jobId, 'validating', 5);
      await job.progress(5);

      this.logger.log(`✈️ [STEP 1.5] Transport Estimation & Validation...`);
      
      // Fetch transport data with all required parameters
      const transportData = await (this.itineraryService as any).estimateTransportCostAndTime(
        dto.source,
        dto.destination,
        dto.startDate,
        dto.endDate,
        dto.travellers,
        dto.travelStyle,
        dto.budget,
        dto.transportMode || 'Flight'
      );

      // Log arrival time for debugging
      if (transportData.arrivalTime) {
        this.logger.log(`🕐 Transport arrival time: ${transportData.arrivalTime}`);
      }

      const validation = await (this.itineraryService as any).validateDestinationWithGoogleMaps(dto.destination);

      // ═══════════════════════════════════════════════════
      // STEP 2: Parallel Discovery (SerpAPI)
      // ═══════════════════════════════════════════════════
      await this.updateJobStatus(jobId, 'discovering', 10);
      await job.progress(10);

      this.logger.log(`🔍 [STEP 2] Parallel Discovery via SerpAPI...`);
      const discoveryStart = Date.now();

      // Check cache first
      const [cachedHotels, cachedAttractions, cachedRestaurants] = await Promise.all([
        this.cacheService.get('hotels', dto.destination, dto.travelStyle),
        this.cacheService.get('attractions', dto.destination),
        this.cacheService.get('restaurants', dto.destination, dto.mealPreference || ''),
      ]);

      // Discover only what's not cached
      const discoveryPromises: Promise<any>[] = [];
      
      const hotelsPromise = cachedHotels
        ? Promise.resolve(cachedHotels)
        : this.serpService.discoverHotels(dto.destination, dto.startDate, dto.endDate, dto.travelStyle, dto.travellers)
            .then(async (h) => { await this.cacheService.set('hotels', dto.destination, h, dto.travelStyle); return h; })
            .catch(err => { this.logger.warn(`⚠️ Hotel discovery failed: ${err.message}`); return []; });

      const attractionsPromise = cachedAttractions
        ? Promise.resolve(cachedAttractions)
        : this.serpService.discoverAttractions(dto.destination)
            .then(async (a) => { await this.cacheService.set('attractions', dto.destination, a); return a; })
            .catch(err => { this.logger.warn(`⚠️ Attraction discovery failed: ${err.message}`); return []; });

      const restaurantsPromise = cachedRestaurants
        ? Promise.resolve(cachedRestaurants)
        : this.serpService.discoverRestaurants(dto.destination, dto.mealPreference, dto.travelStyle)
            .then(async (r) => { await this.cacheService.set('restaurants', dto.destination, r, dto.mealPreference || ''); return r; })
            .catch(err => { this.logger.warn(`⚠️ Restaurant discovery failed: ${err.message}`); return []; });

      const [hotels, attractions, restaurants] = await Promise.all([
        hotelsPromise, attractionsPromise, restaurantsPromise,
      ]);

      const discoveryTime = ((Date.now() - discoveryStart) / 1000).toFixed(1);
      this.logger.log(`✅ [STEP 2] Discovery: ${(hotels as any[]).length} hotels, ${(attractions as any[]).length} attractions, ${(restaurants as any[]).length} restaurants (${discoveryTime}s)`);

      // ═══════════════════════════════════════════════════
      // STEP 3: Parallel Geo Context (Geocoding + Weather)
      // ═══════════════════════════════════════════════════
      await this.updateJobStatus(jobId, 'geocoding', 30);
      await job.progress(30);

      this.logger.log(`📍 [STEP 3] Parallel Geocoding + Weather...`);

      // Geocode destination
      const cachedGeo = await this.cacheService.get<any>('geocode', dto.destination);
      const destGeo = cachedGeo || await this.geoService.geocode(dto.destination)
        .then(async (g) => {
          if (g) await this.cacheService.set('geocode', dto.destination, g);
          return g;
        })
        .catch(() => null);

      const destLat = destGeo?.lat || 0;
      const destLng = destGeo?.lng || 0;

      // Weather forecast (parallel with geo)
      const cachedWeather = await this.cacheService.get('weather', dto.destination, dto.startDate);
      const weather = cachedWeather || await this.weatherService.getForecast(
        destLat, destLng, dto.destination, dto.startDate, dto.endDate,
      ).then(async (w) => {
        await this.cacheService.set('weather', dto.destination, w, dto.startDate);
        return w;
      }).catch(err => {
        this.logger.warn(`⚠️ Weather failed: ${err.message}`);
        return { destination: dto.destination, lat: destLat, lng: destLng, days: [], alerts: [] };
      });

      this.logger.log(`✅ [STEP 3] Geo: ${destLat},${destLng} | Weather: ${(weather as any).days?.length || 0} days`);

      // ═══════════════════════════════════════════════════
      // STEP 4: Proximity Clustering (GeoService)
      // ═══════════════════════════════════════════════════
      await this.updateJobStatus(jobId, 'clustering', 50);
      await job.progress(50);

      this.logger.log(`📊 [STEP 4] Proximity Clustering...`);

      const attractionsWithCoords = (attractions as any[])
        .filter(a => a.gpsCoordinates?.lat && a.gpsCoordinates?.lng)
        .map(a => ({ name: a.name, lat: a.gpsCoordinates.lat, lng: a.gpsCoordinates.lng }));

      let clusters: Array<Array<{ name: string; lat: number; lng: number }>> = [];
      if (attractionsWithCoords.length > 3) {
        clusters = await this.geoService.clusterByProximity(attractionsWithCoords, 10).catch(() => []);
        this.logger.log(`✅ [STEP 4] ${attractionsWithCoords.length} attractions → ${clusters.length} clusters`);
      } else {
        this.logger.log(`⚡ [STEP 4] Skipped clustering (only ${attractionsWithCoords.length} geocoded attractions)`);
      }

      // Store discovery data in Supabase for reference
      const discoveryData = {
        hotels, attractions, restaurants, weather, clusters,
        geocode: destGeo,
        discoveredAt: new Date().toISOString(),
      };

      await this.updateJobDiscovery(jobId, discoveryData);

      // ═══════════════════════════════════════════════════
      // STEP 5: Gemini Planning Layer
      // ═══════════════════════════════════════════════════
      await this.updateJobStatus(jobId, 'planning', 60);
      await job.progress(60);

      this.logger.log(`🧠 [STEP 5] Gemini Planning — feeding real data for scheduling...`);

      // Call the existing generateWithData() method which now uses the discovery pipeline
      const itinerary = await this.itineraryService.generateWithData(dto as any, {
        transportData,
        validation,
        hotels: hotels as any[],
        attractions: attractions as any[],
        restaurants: restaurants as any[],
        weather,
        clusters
      });

      // ═══════════════════════════════════════════════════
      // STEP 6: Store result + Start monitoring
      // ═══════════════════════════════════════════════════
      await this.updateJobStatus(jobId, 'completed', 100);
      await job.progress(100);

      // Store completed itinerary
      await this.updateJobItinerary(jobId, itinerary);

      // Save V1 snapshot immediately after storing
      await this.queueService.saveTripVersion(jobId, 'original').catch(err =>
        this.logger.warn(`⚠️ Could not save V1 trip version: ${err.message}`),
      );

      // Start dynamic monitoring (weather + crowd + poi)
      // Only start if we have valid geocode (skip for destinations that couldn't be geocoded)
      if (destLat !== 0 && destLng !== 0) {
        const allActivities = itinerary.days?.flatMap(d =>
          d.activities?.map(a => a.name) || []
        ) || [];

        await this.queueService.startWeatherMonitoring({
          tripId: jobId,
          userId,
          destination: dto.destination,
          startDate: dto.startDate,
          endDate: dto.endDate,
          activities: allActivities,
        });

        // Crowd monitoring (pre-trip, until trip starts)
        await this.queueService.startCrowdMonitoring({
          tripId: jobId,
          userId,
          destination: dto.destination,
          startDate: dto.startDate,
          endDate: dto.endDate,
          activities: allActivities,
        }).catch((err: any) => {
          this.logger.warn(`⚠️ Could not start crowd monitoring: ${err.message}`);
        });

        // POI monitoring (check if attractions are open/closed)
        if (allActivities.length > 0) {
          const dayActivities: Record<string, string[]> = {};
          itinerary.days?.forEach((d: any) => {
            const acts = (d.activities || []).map((a: any) => a.name).filter(Boolean);
            if (acts.length > 0) dayActivities[String(d.day ?? d.dayNumber ?? 1)] = acts;
          });

          await this.queueService.startPoiMonitoring({
            tripId: jobId,
            userId,
            destination: dto.destination,
            startDate: dto.startDate,
            endDate: dto.endDate,
            activities: allActivities,
            dayActivities,
          }).catch((err: any) => {
            this.logger.warn(`⚠️ Could not start POI monitoring: ${err.message}`);
          });
        }
      } else {
        this.logger.warn(`⚠️ Skipping weather/crowd/poi monitoring for "${dto.destination}" — geocoding returned invalid coordinates`);
      }

      // Start flight delay monitoring if flight info is available
      const flights: any[] = transportData.flights || [];
      if (flights.length > 0) {
        const firstFlight = flights[0];
        const depIata = firstFlight.departure?.iata || firstFlight.depIata;
        const arrIata = firstFlight.arrival?.iata || firstFlight.arrIata;
        const flightIataCodes = flights
          .map((f: any) => f.iata || f.flight?.iata || f.flight_iata)
          .filter(Boolean);

        if (depIata && arrIata) {
          await this.queueService.startFlightMonitoring({
            tripId: jobId,
            userId,
            destination: dto.destination,
            depIata,
            arrIata,
            flightDate: dto.startDate,
            flightIataCodes: flightIataCodes.length > 0 ? flightIataCodes : undefined,
          }).catch(err => {
            this.logger.warn(`⚠️ Could not start flight monitoring: ${err.message}`);
          });
          this.logger.log(`✈️ Flight monitoring started for ${flightIataCodes.length || '?'} flight(s) (${depIata} → ${arrIata})`);
        }
      }

      // Start transport delay monitoring (live traffic checks during active trip)
      if (destLat !== 0 && destLng !== 0) {
        const allActivities = itinerary.days?.flatMap(d =>
          d.activities?.map((a: any) => a.name) || []
        ) || [];
        if (allActivities.length > 0) {
          await this.queueService.startTransportMonitoring({
            tripId: jobId,
            userId,
            destination: dto.destination,
            startDate: dto.startDate,
            endDate: dto.endDate,
            activities: allActivities,
          }).catch((err: any) => {
            this.logger.warn(`⚠️ Could not start transport monitoring: ${err.message}`);
          });
        }
      }

      const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
      this.logger.log(`\n🏁 [PIPELINE COMPLETE] ${dto.destination} | ${totalTime}s total`);

      // Notify user via WebSocket
      await this.queueService.queueNotification(userId, 'TRIP_READY', {
        jobId,
        destination: dto.destination,
        message: `Your ${dto.destination} itinerary is ready!`,
      });

      return { success: true, jobId, itinerary };

    } catch (error) {
      this.logger.error(`❌ [PIPELINE FAILED] ${error.message}`);
      await this.updateJobStatus(jobId, 'failed', 0, error.message);

      // Notify user of failure
      await this.queueService.queueNotification(userId, 'TRIP_FAILED', {
        jobId,
        destination: dto.destination,
        error: error.message,
        message: `Failed to generate itinerary for ${dto.destination}. Please try again.`,
      });

      throw error;
    }
  }

  // ═══════════════════════════════════════════════════
  // Supabase job status helpers
  // ═══════════════════════════════════════════════════

  private async updateJobStatus(
    jobId: string,
    status: string,
    progress: number,
    errorMessage?: string,
  ): Promise<void> {
    if (!supabase) return;
    try {
      const update: any = { status, progress, updated_at: new Date().toISOString() };
      if (errorMessage) update.error_message = errorMessage;
      if (status === 'completed') update.completed_at = new Date().toISOString();

      await supabase.from('trip_planning_jobs').update(update).eq('job_id', jobId);
    } catch (err) {
      this.logger.warn(`Job status update failed: ${err.message}`);
    }
  }

  private async updateJobDiscovery(jobId: string, discoveryData: any): Promise<void> {
    if (!supabase) return;
    try {
      await supabase.from('trip_planning_jobs').update({
        discovery_data: discoveryData,
        updated_at: new Date().toISOString(),
      }).eq('job_id', jobId);
    } catch (err) {
      this.logger.warn(`Discovery data save failed: ${err.message}`);
    }
  }

  private async updateJobItinerary(jobId: string, itinerary: any): Promise<void> {
    if (!supabase) return;
    try {
      await supabase.from('trip_planning_jobs').update({
        itinerary_data: itinerary,
        updated_at: new Date().toISOString(),
      }).eq('job_id', jobId);
    } catch (err) {
      this.logger.warn(`Itinerary save failed: ${err.message}`);
    }
  }

  @OnQueueCompleted()
  onCompleted(job: Job, result: any) {
    this.logger.log(`✅ Job ${job.id} completed for ${job.data.dto.destination}`);
  }

  @OnQueueFailed()
  onFailed(job: Job, error: Error) {
    this.logger.error(`❌ Job ${job.id} failed: ${error.message}`);
  }
}
