import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { DiscoveryCacheService } from '../supabase/discovery-cache.service';

// ─── AVIATIONSTACK RESPONSE SHAPES ─────────────────────────────────────────

export interface FlightStatusResult {
  flightIata: string;
  flightNumber: string;
  airline: string;
  status: 'scheduled' | 'active' | 'landed' | 'cancelled' | 'incident' | 'diverted' | 'delayed' | 'unknown';
  departureAirport: string;
  arrivalAirport: string;
  scheduledDeparture: string | null;
  estimatedDeparture: string | null;
  actualDeparture: string | null;
  scheduledArrival: string | null;
  estimatedArrival: string | null;
  actualArrival: string | null;
  departureDelay: number;   // minutes, positive = late
  arrivalDelay: number;     // minutes, positive = late
  isSignificantDelay: boolean;  // true if arrivalDelay > 60 OR cancelled/diverted
  delayCategory: 'none' | 'minor' | 'moderate' | 'severe' | 'cancelled' | 'diverted';
  fetchedAt: string;
}

export interface FlightMonitorResult {
  tripId: string;
  flightsChecked: number;
  significantDelays: FlightStatusResult[];
  hasSignificantDelay: boolean;
}

// ─── SERVICE ───────────────────────────────────────────────────────────────

@Injectable()
export class AviationStackService {
  private readonly logger = new Logger(AviationStackService.name);
  private readonly baseUrl = 'https://api.aviationstack.com/v1/flights';
  private readonly CACHE_TTL_SECONDS = 5 * 60; // 5-minute cache for live flight data

  constructor(
    private readonly configService: ConfigService,
    private readonly cacheService: DiscoveryCacheService,
  ) {
    const key = this.configService.get<string>('AVIATION_STACK_API_KEY');
    if (!key) {
      this.logger.warn('⚠️ AVIATION_STACK_API_KEY not configured — flight delay monitoring disabled');
    } else {
      this.logger.log('✈️ AviationStack Service initialized');
    }
  }

  // ─── CORE FETCH ──────────────────────────────────────────────────────────

  /**
   * Check the live status of a specific flight by IATA code.
   * Results are cached for 5 minutes to avoid hammering the free-tier limit.
   */
  async checkFlightStatus(
    flightIata: string,
    flightDate?: string,
  ): Promise<FlightStatusResult | null> {
    const apiKey = this.configService.get<string>('AVIATION_STACK_API_KEY');
    if (!apiKey) return null;

    const normalised = flightIata.toUpperCase().trim();
    const cacheKey = `flight-status:${normalised}:${flightDate ?? 'today'}`;

    // Try cache first
    const cached = await this.cacheService.get('weather', cacheKey) as FlightStatusResult | null;
    if (cached) {
      this.logger.debug(`✅ Flight status cache hit: ${normalised}`);
      return cached;
    }

    try {
      const params: Record<string, string> = {
        access_key: apiKey,
        flight_iata: normalised,
        limit: '1',
      };
      if (flightDate) {
        params.flight_date = flightDate; // YYYY-MM-DD
      }

      const response = await axios.get(this.baseUrl, {
        params,
        timeout: 10_000,
      });

      const flights = response.data?.data as any[];
      if (!flights || flights.length === 0) {
        this.logger.warn(`No flight data returned for ${normalised}`);
        return null;
      }

      const result = this.parseFlightData(flights[0]);

      // Cache for 5 min (reuse 'weather' slot type since it shares short TTL)
      await this.cacheService.set('weather', cacheKey, result as any);
      return result;
    } catch (err) {
      const status = err?.response?.status;
      if (status === 429) {
        this.logger.warn(`⚠️ AviationStack rate limit hit for ${normalised}`);
      } else {
        this.logger.error(`❌ AviationStack API error for ${normalised}: ${err.message}`);
      }
      return null;
    }
  }

  /**
   * Check all flights on a route (dep_iata → arr_iata) on a given date.
   * Returns a summary for the trip monitor job.
   */
  async checkRouteFlights(
    tripId: string,
    depIata: string,
    arrIata: string,
    flightDate: string,
    flightIataCodes?: string[], // specific flight numbers if known
  ): Promise<FlightMonitorResult> {
    const apiKey = this.configService.get<string>('AVIATION_STACK_API_KEY');
    const result: FlightMonitorResult = {
      tripId,
      flightsChecked: 0,
      significantDelays: [],
      hasSignificantDelay: false,
    };

    if (!apiKey) return result;

    const significantDelays: FlightStatusResult[] = [];

    if (flightIataCodes && flightIataCodes.length > 0) {
      // Check specific flights
      for (const iata of flightIataCodes) {
        const status = await this.checkFlightStatus(iata, flightDate);
        if (status) {
          result.flightsChecked++;
          if (status.isSignificantDelay) {
            significantDelays.push(status);
          }
        }
      }
    } else {
      // No flight numbers known — query by route
      try {
        const response = await axios.get(this.baseUrl, {
          params: {
            access_key: apiKey,
            dep_iata: depIata.toUpperCase(),
            arr_iata: arrIata.toUpperCase(),
            flight_date: flightDate,
            limit: '10',
          },
          timeout: 10_000,
        });

        const flights = response.data?.data as any[] | undefined;
        if (flights && flights.length > 0) {
          for (const f of flights) {
            const status = this.parseFlightData(f);
            result.flightsChecked++;
            if (status.isSignificantDelay) {
              significantDelays.push(status);
            }
          }
        }
      } catch (err) {
        this.logger.error(`❌ Route check failed (${depIata}→${arrIata}): ${err.message}`);
      }
    }

    result.significantDelays = significantDelays;
    result.hasSignificantDelay = significantDelays.length > 0;

    if (result.hasSignificantDelay) {
      this.logger.warn(
        `✈️ Significant delays detected for trip ${tripId}: ` +
        significantDelays.map(f => `${f.flightIata} +${f.arrivalDelay}min`).join(', '),
      );
    }

    return result;
  }

  // ─── PARSING ─────────────────────────────────────────────────────────────

  private parseFlightData(raw: any): FlightStatusResult {
    const depDelay = this.toMinutes(raw.departure?.delay);
    const arrDelay = this.toMinutes(raw.arrival?.delay);
    const rawStatus: string = (raw.flight_status ?? 'unknown').toLowerCase();

    const isCancelled = rawStatus === 'cancelled';
    const isDiverted = rawStatus === 'diverted';
    const isSignificantDelay =
      isCancelled || isDiverted || arrDelay > 60 || depDelay > 90;

    let delayCategory: FlightStatusResult['delayCategory'] = 'none';
    if (isCancelled) delayCategory = 'cancelled';
    else if (isDiverted) delayCategory = 'diverted';
    else if (arrDelay > 180) delayCategory = 'severe';
    else if (arrDelay > 60) delayCategory = 'moderate';
    else if (arrDelay > 20) delayCategory = 'minor';

    return {
      flightIata: raw.flight?.iata ?? '',
      flightNumber: raw.flight?.number ?? '',
      airline: raw.airline?.name ?? 'Unknown Airline',
      status: rawStatus as FlightStatusResult['status'],
      departureAirport: raw.departure?.airport ?? raw.departure?.iata ?? '',
      arrivalAirport: raw.arrival?.airport ?? raw.arrival?.iata ?? '',
      scheduledDeparture: raw.departure?.scheduled ?? null,
      estimatedDeparture: raw.departure?.estimated ?? null,
      actualDeparture: raw.departure?.actual ?? null,
      scheduledArrival: raw.arrival?.scheduled ?? null,
      estimatedArrival: raw.arrival?.estimated ?? null,
      actualArrival: raw.arrival?.actual ?? null,
      departureDelay: depDelay,
      arrivalDelay: arrDelay,
      isSignificantDelay,
      delayCategory,
      fetchedAt: new Date().toISOString(),
    };
  }

  private toMinutes(raw: any): number {
    if (raw == null) return 0;
    const n = Number(raw);
    return isNaN(n) ? 0 : Math.max(0, n);
  }

  // ─── HUMAN-READABLE REPLAN CONTEXT ───────────────────────────────────────

  buildReplanContext(delays: FlightStatusResult[]): string {
    if (delays.length === 0) return '';
    return delays
      .map(f => {
        if (f.delayCategory === 'cancelled') {
          return `Flight ${f.flightIata} (${f.airline}) has been CANCELLED. Traveller needs alternative transport or rebooking.`;
        }
        if (f.delayCategory === 'diverted') {
          return `Flight ${f.flightIata} (${f.airline}) has been DIVERTED. Arrival airport may have changed.`;
        }
        return (
          `Flight ${f.flightIata} (${f.airline}) is delayed by ${f.arrivalDelay} minutes. ` +
          `Estimated arrival: ${f.estimatedArrival ?? 'unknown'}. ` +
          `First-day activities may need to be pushed back.`
        );
      })
      .join('\n');
  }
}
