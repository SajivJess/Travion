import { Process, Processor, OnQueueFailed } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { QueueService } from '../queue.service';
import { AviationStackService, FlightStatusResult } from '../../itinerary/aviation-stack.service';

// ─── JOB DATA ────────────────────────────────────────────────────────────

export interface FlightMonitoringJob {
  tripId: string;
  userId: string;
  destination: string;
  /** Departure airport IATA (e.g. "DEL") */
  depIata: string;
  /** Arrival airport IATA (e.g. "COK") */
  arrIata: string;
  /** Flight date in YYYY-MM-DD format */
  flightDate: string;
  /** Optional: specific flight IATA codes to watch (e.g. ["AI508", "6E421"]) */
  flightIataCodes?: string[];
}

// ─── PROCESSOR ───────────────────────────────────────────────────────────

@Processor('flight-delay-monitor')
export class FlightDelayMonitorProcessor {
  private readonly logger = new Logger(FlightDelayMonitorProcessor.name);

  constructor(
    private readonly queueService: QueueService,
    private readonly aviationStackService: AviationStackService,
  ) {}

  @Process('check-flight-delay')
  async handleFlightCheck(job: Job<FlightMonitoringJob>): Promise<any> {
    const { tripId, userId, destination, depIata, arrIata, flightDate, flightIataCodes } = job.data;

    this.logger.log(
      `✈️ Checking flight delays for trip ${tripId} ` +
      `(${depIata} → ${arrIata} on ${flightDate})`,
    );

    try {
      const monitorResult = await this.aviationStackService.checkRouteFlights(
        tripId,
        depIata,
        arrIata,
        flightDate,
        flightIataCodes,
      );

      if (!monitorResult.hasSignificantDelay) {
        this.logger.log(
          `✅ No significant delays for trip ${tripId} ` +
          `(${monitorResult.flightsChecked} flights checked)`,
        );
        return { action: 'no_action', flightsChecked: monitorResult.flightsChecked };
      }

      // ── Determine which days are affected ──────────────────────────────
      // Flight delays hit day 1 (index 0) of the trip
      const affectedDays = this.getAffectedDays(monitorResult.significantDelays);

      // ── Build replan context ───────────────────────────────────────────
      const replanContext = this.aviationStackService.buildReplanContext(
        monitorResult.significantDelays,
      );

      this.logger.warn(
        `🚨 Flight delay detected for trip ${tripId} — ` +
        `${monitorResult.significantDelays.length} delayed/cancelled flight(s). ` +
        `Affected days: [${affectedDays.join(', ')}]`,
      );

      // Store update in Supabase and send PLAN_UPDATE_AVAILABLE
      await this.queueService.createTripUpdate({
        tripId,
        userId,
        day: affectedDays[0] ?? 0,
        reason: 'flight_delay',
        riskLevel: monitorResult.significantDelays.some(
          f => f.delayCategory === 'cancelled' || f.delayCategory === 'diverted'
        ) ? 'HIGH' : 'MEDIUM',
        affectedActivities: [`Day ${(affectedDays[0] ?? 0) + 1} arrival activities`],
        suggestedChanges: monitorResult.significantDelays.map(f => ({
          flightIata: f.flightIata,
          airline: f.airline,
          delayCategory: f.delayCategory,
          arrivalDelay: f.arrivalDelay,
          estimatedArrival: f.estimatedArrival,
        })),
        summary: this.buildUserMessage(monitorResult.significantDelays),
        context: {
          trigger: 'flight_delay',
          destination,
          depIata,
          arrIata,
          flightDate,
          delayDetails: replanContext,
          flights: monitorResult.significantDelays,
          affectedDays,
        },
      });

      return {
        action: 'update_created',
        flightsChecked: monitorResult.flightsChecked,
        significantDelays: monitorResult.significantDelays.length,
        affectedDays,
      };
    } catch (err) {
      this.logger.error(`❌ Flight delay check failed for trip ${tripId}: ${err.message}`);
      throw err; // Let BullMQ handle retry
    }
  }

  @OnQueueFailed()
  onFailed(job: Job<FlightMonitoringJob>, err: Error): void {
    this.logger.error(
      `❌ Flight delay monitor job failed for trip ${job.data.tripId}: ${err.message}`,
    );
  }

  // ─── HELPERS ───────────────────────────────────────────────────────────

  /**
   * Maps delay severity to affected itinerary day indices.
   * Cancelled/diverted flights affect all days; delays affect day 1 only.
   */
  private getAffectedDays(delays: FlightStatusResult[]): number[] {
    const hasCritical = delays.some(
      f => f.delayCategory === 'cancelled' || f.delayCategory === 'diverted',
    );

    if (hasCritical) {
      // Can't predict new routing — flag first 3 days
      return [0, 1, 2];
    }

    // Delay pushes day 1 start time; flag day 0 only
    return [0];
  }

  /**
   * Builds a user-facing notification message for the WebSocket push.
   */
  private buildUserMessage(delays: FlightStatusResult[]): string {
    const parts: string[] = [];

    for (const f of delays) {
      if (f.delayCategory === 'cancelled') {
        parts.push(`Flight ${f.flightIata} (${f.airline}) has been cancelled.`);
      } else if (f.delayCategory === 'diverted') {
        parts.push(`Flight ${f.flightIata} (${f.airline}) has been diverted.`);
      } else if (f.delayCategory === 'severe') {
        parts.push(
          `Flight ${f.flightIata} is severely delayed by ${f.arrivalDelay} minutes.`,
        );
      } else {
        parts.push(
          `Flight ${f.flightIata} is delayed by ${f.arrivalDelay} minutes.`,
        );
      }
    }

    parts.push('Your itinerary may need adjustment. Click "Update Plan" to replan.');
    return parts.join(' ');
  }
}
