import { Process, Processor, OnQueueFailed } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import axios from 'axios';
import { QueueService } from '../queue.service';
import { GeoService } from '../../itinerary/geo.service';

// ─── JOB DATA ────────────────────────────────────────────────────────────

export interface TransportMonitoringJob {
  tripId: string;
  userId: string;
  destination: string;
  startDate: string;
  endDate: string;
  /** Activity location names to check routes between */
  activities: string[];
}

interface RouteDelayResult {
  origin: string;
  destination: string;
  typicalMinutes: number;
  liveMinutes: number;
  delayMinutes: number;
  delayPercent: number;
  severity: 'minor' | 'moderate' | 'severe';
}

// ─── PROCESSOR ───────────────────────────────────────────────────────────

@Processor('transport-delay-monitor')
export class TransportDelayMonitorProcessor {
  private readonly logger = new Logger(TransportDelayMonitorProcessor.name);

  constructor(
    private readonly queueService: QueueService,
    private readonly geoService: GeoService,
  ) {}

  @Process('check-transport')
  async handleTransportCheck(job: Job<TransportMonitoringJob>): Promise<any> {
    const { tripId, userId, destination, activities, startDate, endDate } = job.data;

    // Only run during the active trip window
    const today = new Date().toISOString().split('T')[0];
    if (today < startDate || today > endDate) {
      return { action: 'skipped', reason: 'trip_not_active' };
    }

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      this.logger.debug('Google Maps API key not set — transport delay check skipped');
      return { action: 'skipped', reason: 'no_api_key' };
    }

    this.logger.log(`🚦 Checking transport delays for trip ${tripId} — ${destination}`);

    try {
      const delayedRoutes: RouteDelayResult[] = [];

      // Check routes between consecutive activities (first 4 pairs max)
      const locations = activities.slice(0, 5);
      for (let i = 0; i < locations.length - 1; i++) {
        try {
          const result = await this.checkRoute(locations[i], locations[i + 1], destination, apiKey);
          if (result && result.delayPercent > 30) {
            delayedRoutes.push(result);
          }
        } catch {
          // Skip individual route errors
        }
      }

      if (delayedRoutes.length === 0) {
        this.logger.log(`✅ No significant traffic delays for trip ${tripId}`);
        return { action: 'no_delays', routesChecked: locations.length - 1 };
      }

      this.logger.warn(
        `🚨 Traffic delay detected for trip ${tripId}: ` +
        delayedRoutes.map(r => `${r.origin}→${r.destination} (+${r.delayPercent}%)`).join(', '),
      );

      const worstRoute = delayedRoutes.sort((a, b) => b.delayPercent - a.delayPercent)[0];
      const riskLevel = worstRoute.delayPercent > 60 ? 'HIGH' : 'MEDIUM';

      // Store update in Supabase and send PLAN_UPDATE_AVAILABLE
      await this.queueService.createTripUpdate({
        tripId,
        userId,
        day: 0,
        reason: 'transport_delay',
        riskLevel,
        affectedActivities: delayedRoutes.map(r => `${r.origin} → ${r.destination}`),
        suggestedChanges: delayedRoutes.map(r => ({
          origin: r.origin,
          destination: r.destination,
          delayMinutes: r.delayMinutes,
          delayPercent: r.delayPercent,
          severity: r.severity,
          suggestion: `Allow extra ${r.delayMinutes} minutes for this leg`,
        })),
        summary:
          `Heavy traffic on ${delayedRoutes.length} route(s). ` +
          `"${worstRoute.origin} → ${worstRoute.destination}" is running ` +
          `~${worstRoute.delayMinutes} min late (${worstRoute.delayPercent}% slower than usual).`,
        context: {
          trigger: 'transport_delay',
          destination,
          delayedRoutes,
          worstRoute,
        },
      });

      return { action: 'update_created', delayedRoutes };
    } catch (err) {
      this.logger.error(`Transport delay check failed for trip ${tripId}: ${err.message}`);
      return { action: 'error', error: err.message };
    }
  }

  // ─── HELPERS ───────────────────────────────────────────────────────────

  private async checkRoute(
    origin: string,
    destination: string,
    context: string,
    apiKey: string,
  ): Promise<RouteDelayResult | null> {
    const [originGeo, destGeo] = await Promise.all([
      this.geoService.geocode(origin, context),
      this.geoService.geocode(destination, context),
    ]);

    if (!originGeo || !destGeo) return null;

    const response = await axios.get(
      'https://maps.googleapis.com/maps/api/directions/json',
      {
        params: {
          origin: `${originGeo.lat},${originGeo.lng}`,
          destination: `${destGeo.lat},${destGeo.lng}`,
          mode: 'driving',
          departure_time: 'now',    // Enables live traffic data
          traffic_model: 'best_guess',
          key: apiKey,
        },
        timeout: 8000,
      },
    );

    const leg = response.data?.routes?.[0]?.legs?.[0];
    if (!leg) return null;

    const typicalSeconds = leg.duration?.value ?? 0;
    const liveSeconds = leg.duration_in_traffic?.value ?? typicalSeconds;

    if (typicalSeconds === 0) return null;

    const typicalMinutes = Math.round(typicalSeconds / 60);
    const liveMinutes = Math.round(liveSeconds / 60);
    const delayMinutes = Math.max(0, liveMinutes - typicalMinutes);
    const delayPercent = Math.round((delayMinutes / typicalMinutes) * 100);

    const severity: RouteDelayResult['severity'] =
      delayPercent > 60 ? 'severe' : delayPercent > 40 ? 'moderate' : 'minor';

    return { origin, destination, typicalMinutes, liveMinutes, delayMinutes, delayPercent, severity };
  }

  @OnQueueFailed()
  onFailed(job: Job<TransportMonitoringJob>, err: Error): void {
    this.logger.error(`Transport delay monitor job failed for trip ${job.data.tripId}: ${err.message}`);
  }
}
