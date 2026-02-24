import { Injectable, Logger } from '@nestjs/common';
import { supabase } from '../supabase/client';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CheckInRecord {
  id?: string;
  tripJobId: string;
  userId: string;
  dayIndex: number;
  activityName: string;
  plannedTime: string;       // "HH:MM AM/PM" from itinerary
  actualTime: string;        // ISO timestamp when user checked in
  status: 'checked_in' | 'checked_out' | 'skipped';
  notes?: string;
}

export interface TripTrackingStatus {
  tripJobId: string;
  checkins: CheckInRecord[];
  currentDayIndex: number | null;
  lastActivityName: string | null;
  minutesBehindSchedule: number;
  atRisk: boolean;
}

/**
 * TripTrackerService — Runtime tracking of what a traveller actually does.
 *
 * Stores check-ins in Supabase `trip_checkins` table.
 * Powers:
 *   - ETA monitor (knows last actual location)
 *   - Agent loop (knows which activities were skipped)
 *   - Dashboard "on trip" mode
 */
@Injectable()
export class TripTrackerService {
  private readonly logger = new Logger(TripTrackerService.name);

  // ─── Check In ────────────────────────────────────────────────────────────

  async checkIn(
    tripJobId: string,
    userId: string,
    dayIndex: number,
    activityName: string,
    plannedTime: string,
    notes?: string,
  ): Promise<CheckInRecord> {
    const record: Omit<CheckInRecord, 'id'> = {
      tripJobId,
      userId,
      dayIndex,
      activityName,
      plannedTime,
      actualTime: new Date().toISOString(),
      status: 'checked_in',
      notes,
    };

    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('trip_checkins')
          .upsert({
            trip_job_id: tripJobId,
            user_id: userId,
            day_index: dayIndex,
            activity_name: activityName,
            planned_time: plannedTime,
            actual_time: record.actualTime,
            status: 'checked_in',
            notes: notes ?? null,
          }, { onConflict: 'trip_job_id,day_index,activity_name,user_id' })
          .select()
          .single();

        if (!error && data) {
          this.logger.log(`✅ Check-in recorded: ${activityName} day=${dayIndex} trip=${tripJobId}`);
          return this.mapRow(data);
        }
      } catch (err: any) {
        this.logger.warn(`CheckIn DB error: ${err.message}`);
      }
    }

    // In-memory fallback
    this.logger.log(`✅ Check-in (memory): ${activityName} day=${dayIndex}`);
    return { ...record, id: `local-${Date.now()}` };
  }

  // ─── Check Out ───────────────────────────────────────────────────────────

  async checkOut(
    tripJobId: string,
    userId: string,
    dayIndex: number,
    activityName: string,
  ): Promise<boolean> {
    if (!supabase) return false;
    try {
      await supabase
        .from('trip_checkins')
        .update({ status: 'checked_out', actual_time: new Date().toISOString() })
        .eq('trip_job_id', tripJobId)
        .eq('day_index', dayIndex)
        .eq('activity_name', activityName)
        .eq('user_id', userId);

      this.logger.log(`✅ Checked out: ${activityName}`);
      return true;
    } catch (err: any) {
      this.logger.warn(`CheckOut error: ${err.message}`);
      return false;
    }
  }

  // ─── Skip Activity ───────────────────────────────────────────────────────

  async skipActivity(
    tripJobId: string,
    userId: string,
    dayIndex: number,
    activityName: string,
    reason?: string,
  ): Promise<boolean> {
    if (!supabase) return false;
    try {
      await supabase.from('trip_checkins').upsert({
        trip_job_id: tripJobId,
        user_id: userId,
        day_index: dayIndex,
        activity_name: activityName,
        planned_time: null,
        actual_time: new Date().toISOString(),
        status: 'skipped',
        notes: reason ?? 'Skipped by user',
      }, { onConflict: 'trip_job_id,day_index,activity_name,user_id' });
      return true;
    } catch {
      return false;
    }
  }

  // ─── Get Tracking Status ─────────────────────────────────────────────────

  async getTrackingStatus(tripJobId: string, userId?: string): Promise<TripTrackingStatus> {
    const checkins: CheckInRecord[] = [];

    if (supabase) {
      try {
        let q = supabase
          .from('trip_checkins')
          .select('*')
          .eq('trip_job_id', tripJobId)
          .order('day_index', { ascending: true })
          .order('actual_time', { ascending: true });

        if (userId) q = q.eq('user_id', userId);

        const { data } = await q;
        if (data) checkins.push(...data.map((r: any) => this.mapRow(r)));
      } catch (err: any) {
        this.logger.warn(`getTrackingStatus error: ${err.message}`);
      }
    }

    // Compute delay: compare actualTime vs plannedTime for checked-in activities
    let totalDelayMins = 0;
    let count = 0;
    for (const c of checkins) {
      if (c.status !== 'checked_in' || !c.plannedTime) continue;
      const planned = this.parsePlannedTimeMins(c.plannedTime, c.actualTime);
      if (planned === null) continue;
      const actual = new Date(c.actualTime);
      const actualMins = actual.getHours() * 60 + actual.getMinutes();
      const diff = actualMins - planned;
      totalDelayMins += diff;
      count++;
    }

    const avgDelay = count > 0 ? Math.round(totalDelayMins / count) : 0;
    const last = checkins.filter(c => c.status === 'checked_in').slice(-1)[0];
    const currentDayIndex = last?.dayIndex ?? null;
    const lastActivityName = last?.activityName ?? null;

    return {
      tripJobId,
      checkins,
      currentDayIndex,
      lastActivityName,
      minutesBehindSchedule: avgDelay,
      atRisk: avgDelay > 45,
    };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private mapRow(r: any): CheckInRecord {
    return {
      id: r.id,
      tripJobId: r.trip_job_id,
      userId: r.user_id,
      dayIndex: r.day_index,
      activityName: r.activity_name,
      plannedTime: r.planned_time,
      actualTime: r.actual_time,
      status: r.status,
      notes: r.notes,
    };
  }

  private parsePlannedTimeMins(plannedTime: string, referenceIso: string): number | null {
    if (!plannedTime) return null;
    const t = plannedTime.trim().toUpperCase();
    const m = t.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/);
    if (!m) return null;
    let h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    const ampm = m[3];
    if (ampm === 'PM' && h < 12) h += 12;
    if (ampm === 'AM' && h === 12) h = 0;
    return h * 60 + min;
  }
}
