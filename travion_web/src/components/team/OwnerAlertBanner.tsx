import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, Check, X, Loader, ChevronDown, ChevronUp } from 'lucide-react';

const BACKEND_URL = 'http://localhost:3000';

export interface TripSuggestion {
  id: string;
  tripJobId: string;
  userId: string;
  originalText: string;
  parsedActivity?: string;
  parsedIssue?: string;
  parsedSuggestion?: string;
  status: 'pending' | 'applied' | 'ignored';
  createdAt: string;
}

interface Props {
  suggestions: TripSuggestion[];
  tripJobId: string;
  token?: string;
  onApply?: (suggestion: TripSuggestion) => void;
  onRefresh?: () => void;
}

const OwnerAlertBanner: React.FC<Props> = ({
  suggestions, token: authToken, onApply, onRefresh,
}) => {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [actedOn, setActedOn] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);

  const pending = suggestions.filter((s) => s.status === 'pending' && !actedOn.has(s.id));

  // Group by activity for the "N members flagged X" summary
  const byActivity = pending.reduce<Record<string, TripSuggestion[]>>((acc, s) => {
    const key = s.parsedActivity || 'General';
    (acc[key] = acc[key] || []).push(s);
    return acc;
  }, {});

  const act = useCallback(
    async (id: string, status: 'applied' | 'ignored') => {
      setLoadingId(id);
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
        await fetch(`${BACKEND_URL}/api/team/suggestion/${id}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ status }),
        });
        setActedOn((prev) => new Set([...prev, id]));
        if (status === 'applied') {
          const suggestion = suggestions.find((s) => s.id === id);
          if (suggestion) onApply?.(suggestion);
        }
        onRefresh?.();
      } catch { /* ignore */ }
      setLoadingId(null);
    },
    [authToken, suggestions, onApply, onRefresh],
  );

  if (pending.length === 0) return null;

  return (
    <div className="space-y-2 mb-4">
      {Object.entries(byActivity).map(([activity, group]) => (
        <motion.div
          key={activity}
          initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
          className="bg-amber-500/10 border border-amber-500/25 rounded-xl overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-start gap-3 px-4 py-3">
            <Bell size={14} className="text-amber-400 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-amber-400 mb-0.5">
                {group.length} member{group.length > 1 ? 's' : ''} flagged: {activity}
              </p>
              <ul className="space-y-0.5">
                {group.map((s) => (
                  <li key={s.id} className="text-[11px] text-gray-300">
                    <span className="text-gray-500">Issue:</span> {s.parsedIssue}
                    {s.parsedSuggestion && (
                      <> · <span className="text-brand-primary">{s.parsedSuggestion}</span></>
                    )}
                  </li>
                ))}
              </ul>
            </div>
            <button
              onClick={() => setExpanded(expanded === activity ? null : activity)}
              className="text-gray-500 hover:text-gray-300 transition-colors flex-shrink-0"
            >
              {expanded === activity ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
          </div>

          {/* Expanded: individual suggestion cards */}
          <AnimatePresence>
            {expanded === activity && (
              <motion.div
                initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden border-t border-amber-500/15"
              >
                <div className="px-4 py-3 space-y-2">
                  {group.map((s) => (
                    <div key={s.id} className="bg-white/5 rounded-lg p-2.5 text-xs space-y-1 border border-white/5">
                      <p className="text-gray-400 italic">"{s.originalText}"</p>
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          onClick={() => act(s.id, 'applied')}
                          disabled={loadingId === s.id}
                          className="flex items-center gap-1 text-[11px] text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 px-2 py-1 rounded-lg transition-all"
                        >
                          {loadingId === s.id
                            ? <Loader size={9} className="animate-spin" />
                            : <Check size={9} />}
                          Apply Change
                        </button>
                        <button
                          onClick={() => act(s.id, 'ignored')}
                          disabled={loadingId === s.id}
                          className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-300 bg-white/5 hover:bg-white/10 px-2 py-1 rounded-lg transition-all"
                        >
                          <X size={9} /> Ignore
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      ))}
    </div>
  );
};

export default OwnerAlertBanner;
