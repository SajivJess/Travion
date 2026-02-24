import { Injectable } from '@nestjs/common';
import { supabase } from '../supabase/client';

export type FeedbackType =
  | 'looks_good'
  | 'not_ideal'
  | 'too_rushed'
  | 'too_expensive'
  | 'too_crowded'
  | 'need_rest';

export const FEEDBACK_META: Record<FeedbackType, { emoji: string; label: string }> = {
  looks_good:    { emoji: '👍', label: 'Looks Good' },
  not_ideal:     { emoji: '👎', label: 'Not Ideal' },
  too_rushed:    { emoji: '⏱',  label: 'Too Rushed' },
  too_expensive: { emoji: '💸', label: 'Too Expensive' },
  too_crowded:   { emoji: '🧍', label: 'Too Crowded' },
  need_rest:     { emoji: '💤', label: 'Need Rest' },
};

export interface ActivityFeedbackRecord {
  id: string;
  tripJobId: string;
  activityName: string;
  dayIndex: number;
  userId: string;
  feedbackType: FeedbackType;
  comment?: string;
  createdAt: string;
}

export interface AggregatedFeedback {
  activityName: string;
  dayIndex: number;
  counts: Record<FeedbackType, number>;
  total: number;
  topReaction: FeedbackType | null;
  hasSuggestion: boolean;       // true if any trip_suggestion row references this activity
}

@Injectable()
export class FeedbackService {
  // ─────────────────────────────────────────────────────────────
  // Submit / upsert feedback for an activity
  // ─────────────────────────────────────────────────────────────
  async submitFeedback(
    tripJobId: string,
    activityName: string,
    dayIndex: number,
    userId: string,
    feedbackType: FeedbackType,
    comment?: string,
  ): Promise<ActivityFeedbackRecord> {
    if (!supabase) {
      // fallback if db not configured
      return {
        id: 'local',
        tripJobId, activityName, dayIndex, userId, feedbackType,
        comment, createdAt: new Date().toISOString(),
      };
    }

    const { data, error } = await supabase
      .from('activity_feedback')
      .upsert(
        {
          trip_job_id: tripJobId,
          activity_name: activityName,
          day_index: dayIndex,
          user_id: userId,
          feedback_type: feedbackType,
          comment: comment ?? null,
        },
        { onConflict: 'trip_job_id,activity_name,user_id' },
      )
      .select()
      .single();

    if (error) throw new Error(`Feedback upsert failed: ${error.message}`);

    return {
      id: data.id,
      tripJobId: data.trip_job_id,
      activityName: data.activity_name,
      dayIndex: data.day_index,
      userId: data.user_id,
      feedbackType: data.feedback_type,
      comment: data.comment,
      createdAt: data.created_at,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Get all raw feedback rows for a trip
  // ─────────────────────────────────────────────────────────────
  async getRawFeedback(tripJobId: string): Promise<ActivityFeedbackRecord[]> {
    if (!supabase) return [];

    const { data } = await supabase
      .from('activity_feedback')
      .select('*')
      .eq('trip_job_id', tripJobId)
      .order('created_at', { ascending: true });

    return (data || []).map((r: any) => ({
      id: r.id,
      tripJobId: r.trip_job_id,
      activityName: r.activity_name,
      dayIndex: r.day_index,
      userId: r.user_id,
      feedbackType: r.feedback_type,
      comment: r.comment,
      createdAt: r.created_at,
    }));
  }

  // ─────────────────────────────────────────────────────────────
  // Aggregate feedback by activity for display
  // ─────────────────────────────────────────────────────────────
  async getAggregatedFeedback(tripJobId: string): Promise<AggregatedFeedback[]> {
    const raw = await this.getRawFeedback(tripJobId);

    const map = new Map<string, AggregatedFeedback>();

    for (const row of raw) {
      const key = `${row.dayIndex}::${row.activityName}`;
      if (!map.has(key)) {
        map.set(key, {
          activityName: row.activityName,
          dayIndex: row.dayIndex,
          counts: {
            looks_good: 0, not_ideal: 0, too_rushed: 0,
            too_expensive: 0, too_crowded: 0, need_rest: 0,
          },
          total: 0,
          topReaction: null,
          hasSuggestion: false,
        });
      }
      const agg = map.get(key)!;
      agg.counts[row.feedbackType] = (agg.counts[row.feedbackType] || 0) + 1;
      agg.total += 1;
    }

    // Determine top reaction per activity
    for (const agg of map.values()) {
      let max = 0;
      for (const [type, cnt] of Object.entries(agg.counts) as [FeedbackType, number][]) {
        if (cnt > max) { max = cnt; agg.topReaction = type; }
      }
    }

    return Array.from(map.values());
  }

  // ─────────────────────────────────────────────────────────────
  // Get feedback for a single activity (used in activity card)
  // ─────────────────────────────────────────────────────────────
  async getActivityFeedback(
    tripJobId: string,
    activityName: string,
  ): Promise<{ counts: Record<FeedbackType, number>; myVote: FeedbackType | null; total: number }> {
    const raw = await this.getRawFeedback(tripJobId);
    const relevant = raw.filter(
      (r) => r.activityName.toLowerCase() === activityName.toLowerCase(),
    );

    const counts: Record<FeedbackType, number> = {
      looks_good: 0, not_ideal: 0, too_rushed: 0,
      too_expensive: 0, too_crowded: 0, need_rest: 0,
    };

    for (const r of relevant) {
      counts[r.feedbackType] = (counts[r.feedbackType] || 0) + 1;
    }

    return { counts, myVote: null, total: relevant.length };
  }
}
