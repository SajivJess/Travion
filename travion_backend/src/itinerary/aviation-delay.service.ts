import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

export interface FlightDelayStatus {
  flightIata: string;
  flightStatus: string;               // 'scheduled' | 'active' | 'landed' | 'cancelled' | 'incident' | 'diverted'
  departureDelay: number | null;      // minutes, null if not reported yet
  arrivalDelay: number | null;        // minutes, null if not reported yet
  estimatedArrival: string | null;    // ISO 8601
  actualArrival: string | null;       // ISO 8601 if already landed
  isSignificantDelay: boolean;        // true when arrivalDelay > 60 or status is cancelled/diverted
  airline: string | null;
  departure: { iata: string; scheduled: string | null; estimated: string | null };
  arrival:   { iata: string; scheduled: string | null; estimated: string | null };
  checkedAt: string;                  // ISO 8601
}

@Injectable()
export class AviationDelayService {
  private readonly logger    = new Logger(AviationDelayService.name);
  private readonly BASE_URL  = 'https://api.aviationstack.com/v1/flights';
  private readonly DELAY_THRESHOLD_MINUTES = 60;

  private get apiKey(): string {
    const key = process.env.AVIATIONSTACK_API_KEY;
    if (!key) throw new Error('AVIATIONSTACK_API_KEY is not configured');
    return key;
  }

  /**
   * Fetch the current delay status for a specific IATA flight number.
   * Returns null if the flight is not found or the API is not configured.
   *
   * @param flightIata  e.g. "AI302", "6E501"
   */
  async getFlightDelayStatus(flightIata: string): Promise<FlightDelayStatus | null> {
    const flightUpper = flightIata.toUpperCase().trim();
    this.logger.log(`✈️ Checking delay status for flight ${flightUpper}`);

    let apiKey: string;
    try {
      apiKey = this.apiKey;
    } catch {
      this.logger.warn('AviationStack API key not set — skipping flight delay check');
      return null;
    }

    try {
      const response = await axios.get(this.BASE_URL, {
        params: {
          access_key:    apiKey,
          flight_iata:   flightUpper,
          // Don't filter by flight_status so we catch scheduled/active/landed/cancelled etc.
          limit:         1,
        },
        timeout: 10_000,
      });

      const data: any[] = response.data?.data ?? [];
      if (!data || data.length === 0) {
        this.logger.warn(`No flight data returned for ${flightUpper}`);
        return null;
      }

      return this.parseFlightData(data[0]);
    } catch (err: any) {
      this.logger.error(`AviationStack request failed for ${flightUpper}: ${err.message}`);
      return null;
    }
  }

  /**
   * Check multiple flights in sequence (free tier has no bulk endpoint).
   * Returns a map of flightIata → FlightDelayStatus (only those found).
   */
  async checkMultipleFlights(
    flightIatas: string[],
  ): Promise<Map<string, FlightDelayStatus>> {
    const results = new Map<string, FlightDelayStatus>();

    for (const iata of flightIatas) {
      try {
        const status = await this.getFlightDelayStatus(iata);
        if (status) {
          results.set(iata.toUpperCase(), status);
        }
        // Rate-limit friendly pause between requests
        await new Promise(r => setTimeout(r, 300));
      } catch (err: any) {
        this.logger.warn(`Skipping ${iata}: ${err.message}`);
      }
    }

    return results;
  }

  /**
   * Convenience helper: returns true when a flight should trigger a replan.
   * Conditions: arrivalDelay > 60 min  OR  status is cancelled/diverted/incident.
   */
  shouldTriggerReplan(status: FlightDelayStatus): boolean {
    const disruptiveStatuses = new Set(['cancelled', 'diverted', 'incident']);

    if (disruptiveStatuses.has(status.flightStatus)) {
      return true;
    }

    if (status.arrivalDelay !== null && status.arrivalDelay > this.DELAY_THRESHOLD_MINUTES) {
      return true;
    }

    // Also consider departure delay > 90 min as highly likely to cascade
    if (status.departureDelay !== null && status.departureDelay > 90) {
      return true;
    }

    return false;
  }

  /**
   * Build a human-readable summary of the disruption for the replan context.
   */
  buildReplanContext(status: FlightDelayStatus): Record<string, any> {
    const disruption =
      status.flightStatus === 'cancelled'
        ? 'Flight cancelled'
        : status.flightStatus === 'diverted'
        ? 'Flight diverted'
        : status.arrivalDelay !== null
        ? `Arrival delayed by ${status.arrivalDelay} minutes`
        : status.departureDelay !== null
        ? `Departure delayed by ${status.departureDelay} minutes`
        : 'Flight disruption detected';

    return {
      flightIata:       status.flightIata,
      flightStatus:     status.flightStatus,
      disruption,
      arrivalDelay:     status.arrivalDelay,
      departureDelay:   status.departureDelay,
      estimatedArrival: status.estimatedArrival,
      departure:        status.departure,
      arrival:          status.arrival,
      checkedAt:        status.checkedAt,
      suggestedAction:
        status.flightStatus === 'cancelled'
          ? 'Rebook flight and reschedule all day-1 activities'
          : `Shift day-1 activities by ${Math.ceil((status.arrivalDelay ?? 90) / 60)} hour(s)`,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private parseFlightData(raw: any): FlightDelayStatus {
    const dep = raw.departure ?? {};
    const arr = raw.arrival   ?? {};
    const flight = raw.flight ?? {};
    const airline = raw.airline ?? {};

    const departureDelay: number | null = dep.delay ?? null;
    const arrivalDelay:   number | null = arr.delay ?? null;
    const flightStatus: string          = (raw.flight_status ?? 'unknown').toLowerCase();

    const disruptive = new Set(['cancelled', 'diverted', 'incident']);
    const isSignificantDelay =
      disruptive.has(flightStatus) ||
      (arrivalDelay   !== null && arrivalDelay   > this.DELAY_THRESHOLD_MINUTES) ||
      (departureDelay !== null && departureDelay  > 90);

    return {
      flightIata:       (flight.iata ?? '').toUpperCase(),
      flightStatus,
      departureDelay,
      arrivalDelay,
      estimatedArrival: arr.estimated  ?? arr.estimated_runway ?? null,
      actualArrival:    arr.actual     ?? arr.actual_runway     ?? null,
      isSignificantDelay,
      airline:          airline.name ?? null,
      departure: {
        iata:       dep.iata      ?? '',
        scheduled:  dep.scheduled ?? null,
        estimated:  dep.estimated ?? null,
      },
      arrival: {
        iata:       arr.iata      ?? '',
        scheduled:  arr.scheduled ?? null,
        estimated:  arr.estimated ?? null,
      },
      checkedAt: new Date().toISOString(),
    };
  }
}
