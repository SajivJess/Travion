import { Injectable, Logger } from '@nestjs/common';
import { supabase } from '../supabase/client';

export interface ConsensusScore {
  tripJobId: string;
  totalVotes: number;
  agreeVotes: number;
  disagreeVotes: number;
  neutralVotes: number;
  score: number;               // 0–100: percentage agree
  quorum: boolean;             // >= 2 voters
  recommendation: 'apply' | 'skip' | 'discuss' | 'insufficient';
  topSuggestion: TopSuggestion | null;
  summary: string;
}

export interface TopSuggestion {
  id: string;
  activityName: string;
  proposedChange: string;
  agreeCount: number;
  totalCount: number;
  score: number;
}

/**
 * ConsensusService — Team voting and group planning intelligence.
 *
 * Collects votes from trip_suggestion_votes (or activity_feedback rows),
 * computes a consensus score per trip, and recommends whether to apply,
 * skip, or discuss a proposed change.
 *
 * Score thresholds:
 *   >= 66%  → 'apply'      (strong consensus)
 *   >= 40%  → 'discuss'    (mixed opinions)
 *   < 40%   → 'skip'       (rejected)
 *   < 2 voters → 'insufficient'
 */
@Injectable()
export class ConsensusService {
  private readonly logger = new Logger(ConsensusService.name);

  async getConsensusScore(tripJobId: string): Promise<ConsensusScore> {
    const empty: ConsensusScore = {
      tripJobId,
      totalVotes: 0,
      agreeVotes: 0,
      disagreeVotes: 0,
      neutralVotes: 0,
      score: 0,
      quorum: false,
      recommendation: 'insufficient',
      topSuggestion: null,
      summary: 'No votes recorded for this trip yet.',
    };

    if (!supabase) return empty;

    try {
      // Get all activity_feedback rows linked to this trip
      const { data: feedbackRows, error: fbErr } = await supabase
        .from('activity_feedback')
        .select('id, activity_name, feedback_type, suggestion_text, user_id')
        .eq('trip_job_id', tripJobId);

      if (fbErr || !feedbackRows || feedbackRows.length === 0) {
        return empty;
      }

      // Count votes
      let agree = 0;
      let disagree = 0;
      let neutral = 0;

      for (const row of feedbackRows) {
        if (row.feedback_type === 'looks_good') agree++;
        else if (
          row.feedback_type === 'not_ideal' ||
          row.feedback_type === 'too_expensive' ||
          row.feedback_type === 'too_crowded' ||
          row.feedback_type === 'too_rushed'
        ) disagree++;
        else neutral++; // need_rest = neutral
      }

      const total = agree + disagree + neutral;
      const score = total === 0 ? 0 : Math.round((agree / total) * 100);
      const quorum = total >= 2;

      let recommendation: ConsensusScore['recommendation'];
      let summary: string;

      if (!quorum) {
        recommendation = 'insufficient';
        summary = `Only ${total} vote(s) — need at least 2 for quorum.`;
      } else if (score >= 66) {
        recommendation = 'apply';
        summary = `Strong consensus (${score}% agree) — suggest applying the proposed change.`;
      } else if (score >= 40) {
        recommendation = 'discuss';
        summary = `Mixed opinions (${score}% agree) — group discussion recommended.`;
      } else {
        recommendation = 'skip';
        summary = `Low consensus (${score}% agree) — proposed change not supported.`;
      }

      // Find top suggestion (activity with most feedback activity)
      const activityCounts: Record<string, { agree: number; total: number; suggestion: string }> = {};
      for (const row of feedbackRows) {
        const key = row.activity_name;
        if (!activityCounts[key]) {
          activityCounts[key] = { agree: 0, total: 0, suggestion: row.suggestion_text || '' };
        }
        activityCounts[key].total++;
        if (row.feedback_type === 'like' || row.feedback_type === 'agree') {
          activityCounts[key].agree++;
        }
        if (row.suggestion_text && !activityCounts[key].suggestion) {
          activityCounts[key].suggestion = row.suggestion_text;
        }
      }

      let topSuggestion: TopSuggestion | null = null;
      let maxActivity = '';
      let maxTotal = 0;

      for (const [name, counts] of Object.entries(activityCounts)) {
        if (counts.total > maxTotal) {
          maxTotal = counts.total;
          maxActivity = name;
        }
      }

      if (maxActivity) {
        const ac = activityCounts[maxActivity];
        topSuggestion = {
          id: tripJobId + '-' + maxActivity,
          activityName: maxActivity,
          proposedChange: ac.suggestion || 'Modify schedule',
          agreeCount: ac.agree,
          totalCount: ac.total,
          score: ac.total === 0 ? 0 : Math.round((ac.agree / ac.total) * 100),
        };
      }

      return {
        tripJobId,
        totalVotes: total,
        agreeVotes: agree,
        disagreeVotes: disagree,
        neutralVotes: neutral,
        score,
        quorum,
        recommendation,
        topSuggestion,
        summary,
      };
    } catch (err: any) {
      this.logger.error('ConsensusService.getConsensusScore failed', err.message);
      return empty;
    }
  }

  /**
   * Submit a team member's vote on a proposed change.
   * voteType: 'agree' | 'disagree' | 'neutral'
   */
  async submitVote(
    tripJobId: string,
    userId: string,
    activityName: string,
    voteType: 'agree' | 'disagree' | 'neutral',
    suggestionText?: string,
  ): Promise<{ success: boolean; message: string }> {
    if (!supabase) return { success: false, message: 'Supabase not configured' };

    // Map consensus vote types to the DB feedback_type constraint
    const feedbackType =
      voteType === 'agree' ? 'looks_good' :
      voteType === 'disagree' ? 'not_ideal' :
      'need_rest'; // neutral

    try {
      const { error } = await supabase
        .from('activity_feedback')
        .upsert(
          {
            trip_job_id: tripJobId,
            user_id: userId,
            activity_name: activityName,
            feedback_type: feedbackType,
            suggestion_text: suggestionText || null,
            updated_at: new Date().toISOString(),
          },
          {
            onConflict: 'trip_job_id,user_id,activity_name',
          },
        );

      if (error) {
        this.logger.error(`submitVote error: ${error.message}`);
        return { success: false, message: error.message };
      }

      return { success: true, message: `Vote '${voteType}' recorded for ${activityName}` };
    } catch (err: any) {
      this.logger.error('submitVote failed', err.message);
      return { success: false, message: err.message };
    }
  }

  /**
   * Get per-activity breakdown for a trip — for the Consensus panel UI.
   */
  async getActivityBreakdown(
    tripJobId: string,
  ): Promise<Array<{ activity: string; agree: number; disagree: number; neutral: number; score: number }>> {
    if (!supabase) return [];

    const { data, error } = await supabase
      .from('activity_feedback')
      .select('activity_name, feedback_type')
      .eq('trip_job_id', tripJobId);

    if (error || !data) return [];

    const map: Record<string, { agree: number; disagree: number; neutral: number }> = {};
    for (const row of data) {
      if (!map[row.activity_name]) map[row.activity_name] = { agree: 0, disagree: 0, neutral: 0 };
      if (row.feedback_type === 'like' || row.feedback_type === 'agree') map[row.activity_name].agree++;
      else if (row.feedback_type === 'dislike' || row.feedback_type === 'disagree') map[row.activity_name].disagree++;
      else map[row.activity_name].neutral++;
    }

    return Object.entries(map).map(([activity, counts]) => {
      const total = counts.agree + counts.disagree + counts.neutral;
      return {
        activity,
        agree: counts.agree,
        disagree: counts.disagree,
        neutral: counts.neutral,
        score: total === 0 ? 0 : Math.round((counts.agree / total) * 100),
      };
    });
  }
}
