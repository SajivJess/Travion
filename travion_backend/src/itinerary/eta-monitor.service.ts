import { Injectable, Logger } from '@nestjs/common';
import { AgentToolsService } from './agent-tools.service';
import { TripTrackerService } from './trip-tracker.service';
import { QueueService } from '../queue/queue.service';
import { supabase } from '../supabase/client';

export interface EtaCheckResult {
  tripJobId: string;
  fromActivity: string;
  toActivity: string;
  scheduledTimeMins: number;     // planned start time of next activity
  currentTimeMins: number;       // now
  estimatedArrivalMins: number;  // currentTime + eta
  delayMins: number;             // positive = late
  riskLevel: 'on_time' | 'at_risk' | 'late';
  recommendation: string;
  replanTriggered: boolean;
}

/**
 * EtaMonitorService — Live arrival estimation for in-trip activities.
 *
 * Called when the user checks in to an activity.
 * If the traveller will be late for the NEXT activity by > threshold,
 * triggers an agent-loop replan automatically.
 *
 * Thresholds:
 *   > 20 min late → at_risk (warn user)
 *   > 45 min late → late (trigger replan)
 */
@Injectable()
export class EtaMonitorService {
  private readonly logger = new Logger(EtaMonitorService.name);

  // Lateness thresholds
  private readonly AT_RISK_THRESHOLD_MINS = 20;
  private readonly LATE_THRESHOLD_MINS = 45;

  constructor(
    private readonly agentTools: AgentToolsService,
    private readonly tracker: TripTrackerService,
    private readonly queueService: QueueService,
  ) {}

  /**
   * Called after a user checks in to an activity.
   * Checks if they can make it to the NEXT activity on time.
   */
  async checkEtaAfterCheckin(
    tripJobId: string,
    userId: string,
    dayIndex: number,
    currentActivity: { name: string; location?: string },
    nextActivity: { name: string; time: string; location?: string } | null,
    destination: string,
  ): Promise<EtaCheckResult | null> {
    if (!nextActivity) return null;

    const nowDate = new Date();
    const nowMins = nowDate.getHours() * 60 + nowDate.getMinutes();
    const scheduledMins = this.parseTimeMins(nextActivity.time);

    // Calculate travel ETA between current and next activity
    let travelMins = 30; // default assumption
    try {
      const etaResult = await this.agentTools.executeTool({
        name: 'calculate_eta',
        args: {
          origin: currentActivity.location || `${currentActivity.name}, ${destination}`,
          destination: nextActivity.location || `${nextActivity.name}, ${destination}`,
          mode: 'driving',
        },
      });

      if (etaResult.result?.durationInTrafficMinutes) {
        travelMins = etaResult.result.durationInTrafficMinutes;
      } else if (etaResult.result?.durationMinutes) {
        travelMins = etaResult.result.durationMinutes;
      }
    } catch (err: any) {
      this.logger.warn(`ETA calc failed: ${err.message} — using 30-min default`);
    }

    const estimatedArrival = nowMins + travelMins;
    const delayMins = estimatedArrival - scheduledMins;

    let riskLevel: EtaCheckResult['riskLevel'] = 'on_time';
    let recommendation = `On track — arriving with ${Math.max(0, scheduledMins - estimatedArrival)} min buffer.`;
    let replanTriggered = false;

    if (delayMins >= this.LATE_THRESHOLD_MINS) {
      riskLevel = 'late';
      recommendation = `Running ~${delayMins} min late for ${nextActivity.name}. Itinerary adjusted automatically.`;

      // Trigger agent-loop replan
      replanTriggered = true;
      await this.queueService.queueAgentLoop({
        tripId: tripJobId,
        userId,
        reason: 'user_flag',
        affectedDays: [dayIndex],
        destination,
        context: {
          trigger: 'eta_monitor',
          userMessage: `Running ${delayMins} minutes late — currently at ${currentActivity.name}`,
          parsedIssue: {
            issueType: 'delay',
            affectedActivity: nextActivity.name,
            impact: `Will arrive ${delayMins}min late`,
            suggestion: `Shift ${nextActivity.name} by ${delayMins} minutes`,
            urgency: 'high',
            shouldReplan: true,
            shiftHours: Math.ceil(delayMins / 60),
          },
          affectedActivity: nextActivity.name,
          shiftHours: Math.ceil(delayMins / 60),
          delayMins,
        },
      });

      this.logger.warn(`🚨 ETA alert: ${delayMins}min late for ${nextActivity.name} — replan queued`);

    } else if (delayMins >= this.AT_RISK_THRESHOLD_MINS) {
      riskLevel = 'at_risk';
      recommendation = `⚠️ May arrive ${delayMins} min late for ${nextActivity.name}. Consider leaving now.`;

      // Store a soft warning (no replan)
      await this.queueService.queueNotification(userId, 'ETA_AT_RISK', {
        tripId: tripJobId,
        fromActivity: currentActivity.name,
        toActivity: nextActivity.name,
        delayMins,
        recommendation,
      });

      this.logger.log(`⚠️ ETA at-risk: ${delayMins}min potential delay for ${nextActivity.name}`);
    }

    // Persist ETA check result to Supabase for dashboard
    await this.persistEtaCheck(tripJobId, userId, dayIndex, currentActivity.name, nextActivity.name, delayMins, riskLevel);

    return {
      tripJobId,
      fromActivity: currentActivity.name,
      toActivity: nextActivity.name,
      scheduledTimeMins: scheduledMins,
      currentTimeMins: nowMins,
      estimatedArrivalMins: estimatedArrival,
      delayMins,
      riskLevel,
      recommendation,
      replanTriggered,
    };
  }

  private async persistEtaCheck(
    tripJobId: string,
    userId: string,
    dayIndex: number,
    fromActivity: string,
    toActivity: string,
    delayMins: number,
    riskLevel: string,
  ): Promise<void> {
    if (!supabase) return;
    try {
      await supabase.from('trip_eta_checks').insert({
        trip_job_id: tripJobId,
        user_id: userId,
        day_index: dayIndex,
        from_activity: fromActivity,
        to_activity: toActivity,
        delay_mins: delayMins,
        risk_level: riskLevel,
        checked_at: new Date().toISOString(),
      });
    } catch { /* non-critical */ }
  }

  private parseTimeMins(time: string): number {
    if (!time) return 0;
    const t = time.trim().toUpperCase();
    const m = t.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/);
    if (!m) return 0;
    let h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    if (m[3] === 'PM' && h < 12) h += 12;
    if (m[3] === 'AM' && h === 12) h = 0;
    return h * 60 + min;
  }
}
