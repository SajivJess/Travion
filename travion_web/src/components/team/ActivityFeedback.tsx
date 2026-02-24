import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader } from 'lucide-react';

const BACKEND_URL = 'http://localhost:3000';

export type FeedbackType =
  | 'looks_good'
  | 'not_ideal'
  | 'too_rushed'
  | 'too_expensive'
  | 'too_crowded'
  | 'need_rest';

export const FEEDBACK_OPTIONS: { type: FeedbackType; emoji: string; label: string }[] = [
  { type: 'looks_good',    emoji: '👍', label: 'Looks Good' },
  { type: 'not_ideal',     emoji: '👎', label: 'Not Ideal' },
  { type: 'too_rushed',    emoji: '⏱',  label: 'Too Rushed' },
  { type: 'too_expensive', emoji: '💸', label: 'Too Expensive' },
  { type: 'too_crowded',   emoji: '🧍', label: 'Too Crowded' },
  { type: 'need_rest',     emoji: '💤', label: 'Need Rest' },
];

export interface FeedbackCounts {
  looks_good: number;
  not_ideal: number;
  too_rushed: number;
  too_expensive: number;
  too_crowded: number;
  need_rest: number;
}

interface Props {
  tripJobId: string;
  activityName: string;
  dayIndex: number;
  userId: string;
  token?: string;
  /** Pre-fetched counts from the aggregated endpoint — optional; refreshed on vote */
  initialCounts?: Partial<FeedbackCounts>;
  hasSuggestion?: boolean;
}

const ActivityFeedback: React.FC<Props> = ({
  tripJobId,
  activityName,
  dayIndex,
  userId,
  token: authToken,
  initialCounts = {},
  hasSuggestion = false,
}) => {
  const [counts, setCounts] = useState<FeedbackCounts>({
    looks_good: 0, not_ideal: 0, too_rushed: 0,
    too_expensive: 0, too_crowded: 0, need_rest: 0,
    ...initialCounts,
  });
  const [myVote, setMyVote] = useState<FeedbackType | null>(null);
  const [loading, setLoading] = useState<FeedbackType | null>(null);
  const [showAll, setShowAll] = useState(false);

  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  const vote = useCallback(
    async (type: FeedbackType) => {
      // Optimistic UI
      const prev = myVote;
      const newCounts = { ...counts };
      if (prev) newCounts[prev] = Math.max(0, newCounts[prev] - 1);
      if (type !== prev) newCounts[type] = newCounts[type] + 1;
      setCounts(newCounts);
      setMyVote(type === prev ? null : type);

      setLoading(type);
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
        await fetch(`${BACKEND_URL}/api/team/feedback`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            tripJobId,
            activityName,
            dayIndex,
            userId,
            feedbackType: type === prev ? 'looks_good' : type, // default back to looks_good on deselect
          }),
        });
      } catch { /* ignore — optimistic update stays */ }
      setLoading(null);
    },
    [myVote, counts, tripJobId, activityName, dayIndex, userId, authToken],
  );

  // Derive which options to show
  const displayOptions = showAll
    ? FEEDBACK_OPTIONS
    : FEEDBACK_OPTIONS.filter((o) => counts[o.type] > 0 || myVote === o.type).slice(0, 6);

  if (total === 0 && !showAll) {
    // No votes yet — show compact row with "Quick review" label
    return (
      <div className="mt-2">
        <button
          onClick={() => setShowAll(true)}
          className="text-[10px] text-gray-600 hover:text-gray-400 transition-colors"
        >
          Quick review ›
        </button>
        <AnimatePresence>
          {showAll && <FeedbackButtons options={displayOptions} counts={counts} myVote={myVote} loading={loading} onVote={vote} />}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-1.5">
      <FeedbackButtons options={displayOptions} counts={counts} myVote={myVote} loading={loading} onVote={vote} />
      {hasSuggestion && (
        <p className="text-[10px] text-amber-400/70 flex items-center gap-1">
          💬 Suggested change available
        </p>
      )}
    </div>
  );
};

// ─── Internal helper ──────────────────────────────────────────

interface BtnProps {
  options: typeof FEEDBACK_OPTIONS;
  counts: FeedbackCounts;
  myVote: FeedbackType | null;
  loading: FeedbackType | null;
  onVote: (t: FeedbackType) => void;
}

const FeedbackButtons: React.FC<BtnProps> = ({ options, counts, myVote, loading, onVote }) => (
  <motion.div
    initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
    className="flex flex-wrap gap-1"
  >
    {options.map((o) => {
      const active = myVote === o.type;
      const cnt = counts[o.type];
      return (
        <button
          key={o.type}
          onClick={() => onVote(o.type)}
          disabled={loading !== null}
          title={o.label}
          className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] border transition-all ${
            active
              ? 'bg-brand-primary/20 border-brand-primary/40 text-white'
              : 'bg-white/5 border-white/8 text-gray-500 hover:border-white/20 hover:text-gray-300'
          }`}
        >
          {loading === o.type ? (
            <Loader size={8} className="animate-spin" />
          ) : (
            <span>{o.emoji}</span>
          )}
          {cnt > 0 && <span className={active ? 'text-white' : 'text-gray-500'}>{cnt}</span>}
        </button>
      );
    })}
  </motion.div>
);

export default ActivityFeedback;
