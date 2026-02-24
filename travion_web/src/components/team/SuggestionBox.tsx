import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Loader, Sparkles } from 'lucide-react';

const BACKEND_URL = 'http://localhost:3000';

interface ParsedSuggestion {
  activity: string;
  issue: string;
  suggestion: string;
}

interface Props {
  tripJobId: string;
  userId: string;
  token?: string;
  onSubmitted?: (parsed: ParsedSuggestion) => void;
}

const SuggestionBox: React.FC<Props> = ({ tripJobId, userId, token: authToken, onSubmitted }) => {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [parsed, setParsed] = useState<ParsedSuggestion | null>(null);

  const prompts = [
    'Beach in evening may be too crowded',
    'Border check takes longer than expected',
    'Market visit feels too rushed — need more time',
    'Hotel checkout conflicts with morning activity',
  ];

  const handleSubmit = async () => {
    if (!text.trim()) return;
    setSubmitting(true);
    setParsed(null);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
      const res = await fetch(`${BACKEND_URL}/api/team/suggestion`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ tripJobId, userId, text: text.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        const p: ParsedSuggestion = {
          activity: data.parsedActivity || 'Unknown',
          issue: data.parsedIssue || text,
          suggestion: data.parsedSuggestion || 'Review manually',
        };
        setParsed(p);
        onSubmitted?.(p);
        setText('');
      }
    } catch { /* ignore */ }
    setSubmitting(false);
  };

  return (
    <div className="glass-card rounded-xl p-4 space-y-3">
      <p className="text-xs font-semibold text-gray-300 flex items-center gap-2">
        <Sparkles size={12} className="text-brand-primary" /> Suggest a Change
      </p>

      <AnimatePresence mode="wait">
        {parsed ? (
          <motion.div
            key="result"
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 space-y-1.5"
          >
            <p className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5">
              ✓ Suggestion sent to owner
            </p>
            <div className="text-[11px] text-gray-300 space-y-0.5">
              <p><span className="text-gray-500">Activity:</span> {parsed.activity}</p>
              <p><span className="text-gray-500">Issue:</span> {parsed.issue}</p>
              <p><span className="text-gray-500">Suggestion:</span> <span className="text-brand-primary">{parsed.suggestion}</span></p>
            </div>
            <button
              onClick={() => setParsed(null)}
              className="text-[10px] text-gray-500 hover:text-gray-300 underline mt-1"
            >
              Add another suggestion
            </button>
          </motion.div>
        ) : (
          <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={2}
              placeholder="e.g. Beach in evening may be too crowded"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white placeholder-gray-600 resize-none focus:outline-none focus:border-brand-primary/50"
            />
            <div className="flex flex-wrap gap-1.5">
              {prompts.map((p) => (
                <button
                  key={p}
                  onClick={() => setText(p)}
                  className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-gray-500 hover:text-gray-300 hover:bg-white/10 border border-white/5 transition-all"
                >
                  {p}
                </button>
              ))}
            </div>
            <button
              onClick={handleSubmit}
              disabled={!text.trim() || submitting}
              className="flex items-center justify-center gap-1.5 w-full gradient-primary text-white text-xs font-semibold py-2 rounded-xl disabled:opacity-40 transition-all"
            >
              {submitting ? <Loader size={12} className="animate-spin" /> : <Send size={12} />}
              {submitting ? 'Analysing with Gemini…' : 'Send Suggestion'}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default SuggestionBox;
