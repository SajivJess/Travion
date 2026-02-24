import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Map, Plus, Calendar, DollarSign, Users, MapPin, Clock,
  ChevronDown, ChevronUp, X, Loader, AlertCircle, CheckCircle,
  RefreshCw, Hotel, Utensils, Trash2, ExternalLink,
  AlertTriangle, ThumbsUp, ThumbsDown, Eye, Send, Bell,
  Edit2, Check, GripVertical, IndianRupee, MessageCircle,
  LogIn, LogOut, SkipForward,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import LiveDestinationFeed from '../components/planning/LiveDestinationFeed';
import PoiVideoPreview, { type PoiVideo } from '../components/planning/PoiVideoPreview';
import InvitePanel from '../components/team/InvitePanel';
import ActivityFeedback from '../components/team/ActivityFeedback';
import SuggestionBox from '../components/team/SuggestionBox';
import OwnerAlertBanner, { type TripSuggestion } from '../components/team/OwnerAlertBanner';
import { useNavigate } from 'react-router-dom';
import { useTripStore, type SavedTrip } from '../store/tripStore';
import { useAuthStore } from '../store/authStore';
import { usePlanningStore } from '../store/planningStore';

const BACKEND_URL = 'http://localhost:3000';

type FilterTab = 'All' | 'Upcoming' | 'Completed' | 'Failed';
const TABS: FilterTab[] = ['All', 'Upcoming', 'Completed', 'Failed'];

interface TripStatus {
  jobId: string;
  status: string;
  progress?: number;
  itinerary_data?: Record<string, unknown> | null;
  error_message?: string;
}

interface ProposedReplan {
  proposalId: string;
  tripId: string;
  reason: string;
  affectedDays: number[];
  proposedChanges: Array<{
    day: number;
    originalActivity: string;
    newActivity: string;
    reason: string;
    time?: string;
    duration?: string;
    estimatedCost?: number;
  }>;
  summary: string;
  createdAt: string;
}

interface TripUpdate {
  id: string;
  tripId: string;
  day: number;
  reason: 'weather' | 'crowd' | 'flight_delay' | 'transport_delay' | 'poi_closed' | 'user_flag';
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  affectedActivities: string[];
  summary: string;
  status: 'pending' | 'applied' | 'dismissed';
  createdAt: string;
}

// ─── Report Issue Modal ───────────────────────────────────────────────────────

interface ReportIssueModalProps {
  tripId: string;
  tripDestination: string;
  activityName?: string;
  dayIndex?: number;
  token?: string;
  onClose: () => void;
  onSubmit: (result: { parsed: any; proposalQueued: boolean }) => void;
}

const ReportIssueModal: React.FC<ReportIssueModalProps> = ({
  tripId, tripDestination, activityName, dayIndex, token, onClose, onSubmit,
}) => {
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [parsed, setParsed] = useState<any>(null);

  const suggestions = [
    'Bus got cancelled',
    'Reached late due to traffic',
    'Museum is closed today',
    'Feeling too tired for next activity',
    'It is raining heavily',
  ];

  const handleSubmit = async () => {
    if (!message.trim()) return;
    setSubmitting(true);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${BACKEND_URL}/api/itinerary/report-issue`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ tripId, message, dayIndex: dayIndex ?? 0, activityName, destination: tripDestination }),
      });
      const data = await res.json();
      setParsed(data.parsed);
      setSubmitted(true);
      onSubmit?.(data);
    } catch {
      // ignore
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="relative z-10 w-full max-w-md bg-[#0d1120] border border-white/10 rounded-2xl shadow-2xl p-6"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-display font-bold text-white flex items-center gap-2">
            <AlertTriangle size={18} className="text-amber-400" />
            Report Issue
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>

        {activityName && (
          <div className="text-xs text-gray-500 bg-white/5 rounded-lg px-3 py-2 mb-4 flex items-center gap-2">
            <Clock size={11} className="text-brand-primary/60" />
            Reporting issue for: <span className="text-gray-300 font-medium">{activityName}</span>
          </div>
        )}

        {!submitted ? (
          <>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="What's the issue? e.g. 'Bus got cancelled', 'Museum is closed', 'Feeling tired'…"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 resize-none focus:outline-none focus:border-brand-primary/50 mb-3"
              rows={3}
            />
            <div className="flex flex-wrap gap-2 mb-4">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => setMessage(s)}
                  className="text-xs px-2.5 py-1 rounded-full bg-white/5 text-gray-400 hover:bg-brand-primary/10 hover:text-brand-primary border border-white/5 transition-all"
                >
                  {s}
                </button>
              ))}
            </div>
            <button
              onClick={handleSubmit}
              disabled={!message.trim() || submitting}
              className="w-full flex items-center justify-center gap-2 gradient-primary text-white font-semibold py-2.5 rounded-xl disabled:opacity-40 transition-all"
            >
              {submitting ? <Loader size={14} className="animate-spin" /> : <Send size={14} />}
              {submitting ? 'Analysing…' : 'Submit & Auto-Fix'}
            </button>
          </>
        ) : (
          <div className="space-y-3">
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4">
              <p className="text-sm font-semibold text-emerald-400 flex items-center gap-2 mb-2">
                <CheckCircle size={14} /> Issue Analysed
              </p>
              {parsed && (
                <div className="space-y-1.5 text-xs text-gray-300">
                  <p><span className="text-gray-500">Type:</span> <span className="capitalize">{parsed.issueType?.replace('_', ' ')}</span></p>
                  <p><span className="text-gray-500">Impact:</span> {parsed.impact}</p>
                  <p><span className="text-gray-500">Suggestion:</span> <span className="text-brand-primary">{parsed.suggestion}</span></p>
                  {parsed.shouldReplan && (
                    <p className="text-amber-400 flex items-center gap-1 mt-2">
                      <Bell size={10} /> Replan proposal sent — check the consent banner below
                    </p>
                  )}
                </div>
              )}
            </div>
            <button
              onClick={onClose}
              className="w-full text-sm font-medium text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 py-2 rounded-xl transition-all"
            >
              Close
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
};

// ─── Trip Update Banner (system-detected: weather/crowd/flight/POI) ──────────

interface TripUpdateBannerProps {
  updates: TripUpdate[];
  token?: string;
  userId?: string;
  onUpdatesChange: (updates: TripUpdate[]) => void;
  onReplanStarted: () => void;
}

const reasonMeta: Record<string, { label: string; icon: string; color: string }> = {
  weather:          { label: 'Weather Alert',    icon: '🌧️', color: 'blue' },
  crowd:            { label: 'Crowd Alert',      icon: '👥', color: 'orange' },
  flight_delay:     { label: 'Flight Delay',     icon: '✈️', color: 'red' },
  transport_delay:  { label: 'Traffic Delay',    icon: '🚦', color: 'yellow' },
  poi_closed:       { label: 'Attraction Closed',icon: '🏛️', color: 'purple' },
  user_flag:        { label: 'Reported Issue',   icon: '⚠️', color: 'amber' },
};

const TripUpdateBanner: React.FC<TripUpdateBannerProps> = ({
  updates, token, userId, onUpdatesChange, onReplanStarted,
}) => {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [startedId, setStartedId] = useState<string | null>(null);

  const visible = updates.filter(u => u.status === 'pending');
  if (visible.length === 0) return null;

  const colorMap: Record<string, string> = {
    blue:   'bg-blue-500/10 border-blue-500/25 text-blue-400',
    orange: 'bg-orange-500/10 border-orange-500/25 text-orange-400',
    red:    'bg-red-500/10 border-red-500/25 text-red-400',
    yellow: 'bg-yellow-500/10 border-yellow-500/25 text-yellow-400',
    purple: 'bg-purple-500/10 border-purple-500/25 text-purple-400',
    amber:  'bg-amber-500/10 border-amber-500/25 text-amber-400',
  };

  const applyUpdate = async (updateId: string) => {
    setLoadingId(updateId);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`${BACKEND_URL}/api/itinerary/apply-update/${updateId}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ userId: userId || 'anon' }),
      });
      if (res.ok) {
        setStartedId(updateId);
        onUpdatesChange(updates.map(u => u.id === updateId ? { ...u, status: 'applied' } : u));
        onReplanStarted();
        // Auto-hide "started" message after 4s
        setTimeout(() => setStartedId(null), 4000);
      }
    } catch { /* ignore */ }
    finally { setLoadingId(null); }
  };

  const dismissUpdate = async (updateId: string) => {
    setLoadingId(updateId);
    try {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      await fetch(`${BACKEND_URL}/api/itinerary/dismiss-update/${updateId}`, {
        method: 'POST', headers,
      });
      onUpdatesChange(updates.map(u => u.id === updateId ? { ...u, status: 'dismissed' } : u));
    } catch { /* ignore */ }
    finally { setLoadingId(null); }
  };

  return (
    <div className="mx-0 mb-4 space-y-2">
      {visible.map((update) => {
        const meta = reasonMeta[update.reason] ?? { label: 'System Alert', icon: '🔔', color: 'amber' };
        const colors = colorMap[meta.color] ?? colorMap.amber;
        const isStarted = startedId === update.id;
        const isLoading = loadingId === update.id;

        return (
          <motion.div
            key={update.id}
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
            className={`border rounded-xl overflow-hidden ${colors}`}
          >
            <div className="flex items-start gap-3 px-4 py-3">
              <span className="text-lg leading-none">{meta.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="text-xs font-semibold">{meta.label}</p>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                    update.riskLevel === 'HIGH' ? 'bg-red-500/20 text-red-400' :
                    update.riskLevel === 'MEDIUM' ? 'bg-amber-500/20 text-amber-400' :
                    'bg-emerald-500/20 text-emerald-400'
                  }`}>
                    {update.riskLevel}
                  </span>
                </div>
                <p className="text-xs text-gray-300 leading-relaxed">{update.summary}</p>
                {update.affectedActivities?.length > 0 && (
                  <p className="text-[10px] text-gray-500 mt-1">
                    Affected: {update.affectedActivities.slice(0, 3).join(', ')}
                    {update.affectedActivities.length > 3 ? ` +${update.affectedActivities.length - 3} more` : ''}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 px-4 pb-3">
              {isStarted ? (
                <div className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1.5 rounded-lg">
                  <CheckCircle size={10} /> Replan started — check consent banner
                </div>
              ) : (
                <button
                  onClick={() => applyUpdate(update.id)}
                  disabled={isLoading}
                  className="flex items-center gap-1.5 text-xs font-semibold text-white bg-brand-primary/80 hover:bg-brand-primary px-2.5 py-1.5 rounded-lg transition-all disabled:opacity-50"
                >
                  {isLoading ? <Loader size={10} className="animate-spin" /> : <RefreshCw size={10} />}
                  Review &amp; Update
                </button>
              )}
              <button
                onClick={() => dismissUpdate(update.id)}
                disabled={isLoading}
                className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 bg-white/5 hover:bg-white/10 px-2.5 py-1.5 rounded-lg transition-all"
              >
                <X size={10} /> Dismiss
              </button>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
};

// ─── Consent Banner ───────────────────────────────────────────────────────────

interface ConsentBannerProps {
  proposals: ProposedReplan[];
  token?: string;
  onDismissAll: () => void;
}

const ConsentBanner: React.FC<ConsentBannerProps> = ({ proposals, token, onDismissAll }) => {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [actedOn, setActedOn] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<string | null>(null);

  const pending = proposals.filter(p => !actedOn.has(p.proposalId));
  if (pending.length === 0) return null;

  const act = async (proposalId: string, action: 'accept' | 'reject') => {
    setLoading(proposalId);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      await fetch(`${BACKEND_URL}/api/itinerary/replan-consent/${proposalId}`, {
        method: 'POST', headers,
        body: JSON.stringify({ action }),
      });
      setActedOn(prev => new Set([...prev, proposalId]));
      if (actedOn.size + 1 >= proposals.length) onDismissAll();
    } catch {
      // ignore
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="mx-0 mb-4 space-y-2">
      {pending.map((proposal) => {
        const reasonLabel: Record<string, string> = {
          weather: '🌧️ Weather Alert',
          crowd: '👥 Crowd Alert',
          flight_delay: '✈️ Flight Delay',
          transport_delay: '🚦 Traffic Delay',
          user_flag: '⚠️ Reported Issue',
          availability: '🚫 Unavailable',
        };
        return (
          <motion.div
            key={proposal.proposalId}
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
            className="bg-amber-500/10 border border-amber-500/25 rounded-xl overflow-hidden"
          >
            <div className="flex items-start gap-3 px-4 py-3">
              <Bell size={14} className="text-amber-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-amber-400 mb-0.5">
                  {reasonLabel[proposal.reason] || '🔄 Replan Suggested'}
                </p>
                <p className="text-xs text-gray-300 leading-relaxed">{proposal.summary}</p>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2 px-4 pb-3">
              <button
                onClick={() => setExpanded(expanded === proposal.proposalId ? null : proposal.proposalId)}
                className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 px-2.5 py-1.5 rounded-lg transition-all"
              >
                <Eye size={11} /> Preview
              </button>
              <button
                onClick={() => act(proposal.proposalId, 'accept')}
                disabled={loading === proposal.proposalId}
                className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 px-2.5 py-1.5 rounded-lg transition-all disabled:opacity-50"
              >
                {loading === proposal.proposalId ? <Loader size={10} className="animate-spin" /> : <ThumbsUp size={10} />}
                Update
              </button>
              <button
                onClick={() => act(proposal.proposalId, 'reject')}
                disabled={loading === proposal.proposalId}
                className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-red-400 bg-white/5 hover:bg-red-500/10 px-2.5 py-1.5 rounded-lg transition-all"
              >
                <ThumbsDown size={10} /> Ignore
              </button>
            </div>

            {/* Preview expansion */}
            <AnimatePresence>
              {expanded === proposal.proposalId && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden border-t border-amber-500/15"
                >
                  <div className="px-4 py-3 space-y-2">
                    {proposal.proposedChanges.map((change, i) => (
                      <div key={i} className="text-xs bg-white/5 rounded-lg p-2.5 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-red-400/70 line-through">{change.originalActivity}</span>
                          <span className="text-gray-600">→</span>
                          <span className="text-emerald-400 font-medium">{change.newActivity}</span>
                        </div>
                        <p className="text-gray-500">{change.reason}</p>
                        {change.time && <p className="text-brand-primary/70">New time: {change.time} · {change.duration}</p>}
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        );
      })}
    </div>
  );
};

const statusColor: Record<string, string> = {
  completed: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  failed: 'bg-red-500/15 text-red-400 border-red-500/30',
  queued: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  planning: 'bg-brand-primary/15 text-brand-primary border-brand-primary/30',
  discovering: 'bg-brand-primary/15 text-brand-primary border-brand-primary/30',
  geocoding: 'bg-brand-primary/15 text-brand-primary border-brand-primary/30',
  clustering: 'bg-brand-primary/15 text-brand-primary border-brand-primary/30',
  validating: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
};

const statusLabel: Record<string, string> = {
  completed: 'Completed',
  failed: 'Failed',
  queued: 'Queued',
  planning: 'Planning…',
  discovering: 'Discovering…',
  geocoding: 'Geocoding…',
  clustering: 'Clustering…',
  validating: 'Validating…',
};

function formatDateRange(start: string, end: string) {
  const s = new Date(start);
  const e = new Date(end);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  return `${s.toLocaleDateString('en-IN', opts)} – ${e.toLocaleDateString('en-IN', { ...opts, year: 'numeric' })}`;
}

function daysBetween(start: string, end: string) {
  return Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86400000) + 1;
}

// ─── Itinerary Detail Modal ───────────────────────────────────────────────────

interface ItineraryModalProps {
  trip: SavedTrip;
  itinerary: Record<string, unknown>;
  token?: string;
  onClose: () => void;
}

const ItineraryModal: React.FC<ItineraryModalProps> = ({ trip, itinerary, token, onClose }) => {
  const [openDay, setOpenDay] = useState<number>(0);
  const [reportTarget, setReportTarget] = useState<{ activityName: string; dayIndex: number } | null>(null);
  const [proposals, setProposals] = useState<ProposedReplan[]>([]);
  const [tripUpdates, setTripUpdates] = useState<TripUpdate[]>([]);
  const [reportSubmitted, setReportSubmitted] = useState(false);

  const [activeTab, setActiveTab] = useState<'itinerary' | 'analytics' | 'weather' | 'vibe' | 'team'>('itinerary');
  const [localDays, setLocalDays] = useState<any[]>([]);
  const [dragSrc, setDragSrc] = useState<{ day: number; act: number } | null>(null);
  const [dragTarget, setDragTarget] = useState<{ day: number; act: number } | null>(null);
  const [editTarget, setEditTarget] = useState<{ day: number; act: number } | null>(null);
  const [editForm, setEditForm] = useState<{ name: string; time: string; duration: string; estimatedCost: string; description: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [poiVideos, setPoiVideos] = useState<Record<string, PoiVideo>>({});
  const [suggestions, setSuggestions] = useState<TripSuggestion[]>([]);
  const [feedbackMap, setFeedbackMap] = useState<Record<string, any>>({});

  // Trip tracking state — check-in / check-out / skip
  const [checkinMap, setCheckinMap] = useState<Record<string, 'checked_in' | 'checked_out' | 'skipped'>>({});
  const [etaWarning, setEtaWarning] = useState<{ toActivity: string; delayMins: number; recommendation: string } | null>(null);
  const [trackerLoading, setTrackerLoading] = useState<string | null>(null); // key = `${dayIndex}-${activityName}`

  const trackKey = (dayIndex: number, activityName: string) => `${dayIndex}::${activityName}`;

  const handleCheckin = async (dayIndex: number, act: any, nextAct: any | null) => {
    const key = trackKey(dayIndex, act.name);
    setTrackerLoading(key);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      await fetch(`${BACKEND_URL}/api/itinerary/checkin`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          tripJobId: trip.jobId,
          userId: trip.userId,
          dayIndex,
          activityName: act.name,
          plannedTime: act.time || '09:00',
        }),
      });
      setCheckinMap(prev => ({ ...prev, [key]: 'checked_in' }));

      // ETA check for next activity
      if (nextAct) {
        const etaRes = await fetch(`${BACKEND_URL}/api/itinerary/eta-check`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            tripJobId: trip.jobId,
            userId: trip.userId,
            dayIndex,
            currentActivity: { name: act.name, location: act.location },
            nextActivity: { name: nextAct.name, time: nextAct.time, location: nextAct.location },
            destination: trip.destination,
          }),
        });
        if (etaRes.ok) {
          const eta = await etaRes.json();
          if (eta && (eta.riskLevel === 'at_risk' || eta.riskLevel === 'late')) {
            setEtaWarning({ toActivity: eta.toActivity, delayMins: eta.delayMins, recommendation: eta.recommendation });
          }
        }
      }
    } catch { /* non-critical */ } finally {
      setTrackerLoading(null);
    }
  };

  const handleCheckout = async (dayIndex: number, act: any) => {
    const key = trackKey(dayIndex, act.name);
    setTrackerLoading(key);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      await fetch(`${BACKEND_URL}/api/itinerary/checkout`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ tripJobId: trip.jobId, userId: trip.userId, dayIndex, activityName: act.name }),
      });
      setCheckinMap(prev => ({ ...prev, [key]: 'checked_out' }));
    } catch { /* non-critical */ } finally {
      setTrackerLoading(null);
    }
  };

  const handleSkip = async (dayIndex: number, act: any) => {
    const key = trackKey(dayIndex, act.name);
    setTrackerLoading(key);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      await fetch(`${BACKEND_URL}/api/itinerary/skip-activity`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ tripJobId: trip.jobId, userId: trip.userId, dayIndex, activityName: act.name }),
      });
      setCheckinMap(prev => ({ ...prev, [key]: 'skipped' }));
    } catch { /* non-critical */ } finally {
      setTrackerLoading(null);
    }
  };

  // Chatbot state — "Ask about this place"
  const [chatTarget, setChatTarget] = useState<{ activityName: string; destination: string } | null>(null);
  const [chatQuestion, setChatQuestion] = useState('');
  const [chatAnswer, setChatAnswer] = useState('');
  const [chatSource, setChatSource] = useState('');
  const [chatLoading, setChatLoading] = useState(false);

  const sendChatMessage = async () => {
    if (!chatTarget || !chatQuestion.trim()) return;
    setChatLoading(true);
    setChatAnswer('');
    setChatSource('');
    try {
      const res = await fetch(`${BACKEND_URL}/api/itinerary/chatbot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          place: chatTarget.activityName,
          destination: chatTarget.destination,
          question: chatQuestion.trim(),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setChatAnswer(data.answer || 'No answer returned.');
        if (data.source) setChatSource(data.source);
      } else {
        setChatAnswer('Server error — please try again.');
      }
    } catch {
      setChatAnswer('Network error — please check the backend is running.');
    } finally {
      setChatLoading(false);
    }
  };

  const { session, user } = useAuthStore();
  const effectiveToken = token || session?.access_token || undefined;
  const userId = user?.id;

  // Poll for system-detected trip updates every 60 seconds
  useEffect(() => {
    const fetchTripUpdates = async () => {
      try {
        const headers: Record<string, string> = {};
        if (effectiveToken) headers['Authorization'] = `Bearer ${effectiveToken}`;
        const res = await fetch(`${BACKEND_URL}/api/itinerary/trip-updates/${trip.jobId}`, { headers });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) setTripUpdates(data);
        }
      } catch { /* ignore */ }
    };
    fetchTripUpdates();
    const interval = setInterval(fetchTripUpdates, 60_000);
    return () => clearInterval(interval);
  }, [trip.jobId, effectiveToken]);

  // Poll for pending replan proposals every 30 seconds
  useEffect(() => {
    const fetchProposals = async () => {
      try {
        const headers: Record<string, string> = {};
        if (effectiveToken) headers['Authorization'] = `Bearer ${effectiveToken}`;
        const res = await fetch(`${BACKEND_URL}/api/itinerary/proposals/${trip.jobId}`, { headers });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0) setProposals(data);
        }
      } catch { /* ignore */ }
    };

    fetchProposals();
    const interval = setInterval(fetchProposals, 30_000);
    return () => clearInterval(interval);
  }, [trip.jobId, effectiveToken, reportSubmitted]);

  // Initialise local editable days from itinerary
  useEffect(() => {
    const d = (itinerary.days as any[]) || [];
    setLocalDays(d.map((day: any) => {
      const activities = [...(day.activities || [])];
      const computedCost = activities.reduce((s: number, a: any) => s + (Number(a.estimatedCost) || 0), 0);
      return {
        ...day,
        activities,
        // Recalculate totalCost from activities in case stored value is 0/null
        totalCost: computedCost > 0 ? computedCost : (day.totalCost || 0),
      };
    }));
  }, [itinerary]);

  // Lazy-fetch POI videos once on mount (itinerary tab context)
  useEffect(() => {
    const fetchPoiVideos = async () => {
      try {
        const days: any[] = (itinerary.days as any[]) || [];
        const poiNames: string[] = [];
        days.forEach((day: any) => {
          (day.activities || []).forEach((act: any) => {
            if (act.name && !poiNames.includes(act.name)) poiNames.push(act.name);
          });
        });
        if (!poiNames.length || !trip.destination) return;
        const headers: Record<string, string> = {};
        if (effectiveToken) headers['Authorization'] = `Bearer ${effectiveToken}`;
        const res = await fetch(
          `${BACKEND_URL}/api/itinerary/poi-videos/${encodeURIComponent(trip.destination)}?pois=${encodeURIComponent(poiNames.join(','))}`,
          { headers },
        );
        if (!res.ok) return;
        const data = await res.json();
        if (data?.videos && Array.isArray(data.videos)) {
          const map: Record<string, PoiVideo> = {};
          (data.videos as PoiVideo[]).forEach((v) => {
            if (v.poiName) map[v.poiName.toLowerCase()] = v;
          });
          setPoiVideos(map);
        }
      } catch { /* ignore */ }
    };
    fetchPoiVideos();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip.jobId]);

  // Fetch aggregated activity feedback for this trip
  useEffect(() => {
    const loadFeedback = async () => {
      try {
        const headers: Record<string, string> = {};
        if (effectiveToken) headers['Authorization'] = `Bearer ${effectiveToken}`;
        const res = await fetch(`${BACKEND_URL}/api/team/feedback/${trip.jobId}`, { headers });
        if (!res.ok) return;
        const agg = await res.json();
        if (Array.isArray(agg)) {
          const map: Record<string, any> = {};
          agg.forEach((a: any) => { if (a.activityName) map[a.activityName.toLowerCase()] = a; });
          setFeedbackMap(map);
        }
      } catch { /* ignore */ }
    };
    loadFeedback();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip.jobId]);

  // Fetch pending suggestions when team tab opens
  useEffect(() => {
    if (activeTab !== 'team') return;
    const loadSuggestions = async () => {
      try {
        const headers: Record<string, string> = {};
        if (effectiveToken) headers['Authorization'] = `Bearer ${effectiveToken}`;
        const res = await fetch(
          `${BACKEND_URL}/api/team/suggestions/${trip.jobId}?status=pending`,
          { headers },
        );
        if (res.ok) setSuggestions(await res.json());
      } catch { /* ignore */ }
    };
    loadSuggestions();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, trip.jobId]);

  // ─── Drag-and-drop handlers ───────────────────────────────────
  const handleDragStart = (dayIdx: number, actIdx: number) => setDragSrc({ day: dayIdx, act: actIdx });

  const handleDragOver = (e: React.DragEvent, dayIdx: number, actIdx: number) => {
    e.preventDefault();
    setDragTarget({ day: dayIdx, act: actIdx });
  };

  const handleDrop = (e: React.DragEvent, toDayIdx: number, toActIdx: number) => {
    e.preventDefault();
    if (!dragSrc) return;
    const newDays = localDays.map((d: any) => ({ ...d, activities: [...d.activities] }));
    const [moved] = newDays[dragSrc.day].activities.splice(dragSrc.act, 1);
    newDays[toDayIdx].activities.splice(toActIdx, 0, moved);
    [dragSrc.day, toDayIdx].forEach((idx) => {
      newDays[idx].totalCost = newDays[idx].activities.reduce((s: number, a: any) => s + (a.estimatedCost || 0), 0);
    });
    setLocalDays(newDays);
    setDragSrc(null);
    setDragTarget(null);
  };

  // ─── Inline-edit handlers ────────────────────────────────────
  const startEdit = (dayIdx: number, actIdx: number) => {
    const act = localDays[dayIdx].activities[actIdx];
    setEditTarget({ day: dayIdx, act: actIdx });
    setEditForm({
      name: act.name || '',
      time: act.time || '',
      duration: act.duration || '',
      estimatedCost: String(act.estimatedCost || 0),
      description: act.description || '',
    });
  };

  const saveEdit = () => {
    if (!editTarget || !editForm) return;
    const newDays = localDays.map((d: any) => ({ ...d, activities: [...d.activities] }));
    newDays[editTarget.day].activities[editTarget.act] = {
      ...newDays[editTarget.day].activities[editTarget.act],
      name: editForm.name,
      time: editForm.time,
      duration: editForm.duration,
      estimatedCost: Number(editForm.estimatedCost) || 0,
      description: editForm.description,
    };
    newDays[editTarget.day].totalCost = newDays[editTarget.day].activities.reduce(
      (s: number, a: any) => s + (a.estimatedCost || 0), 0,
    );
    setLocalDays(newDays);
    setEditTarget(null);
    setEditForm(null);
  };

  // ─── Persist changes to backend ──────────────────────────────
  const saveToBackend = async () => {
    setIsSaving(true);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (effectiveToken) headers['Authorization'] = `Bearer ${effectiveToken}`;
      await fetch(`${BACKEND_URL}/api/itinerary/update-days/${trip.jobId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ days: localDays }),
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch { /* ignore */ }
    setIsSaving(false);
  };

  const hotels = (itinerary.hotels as any[]) || [];
  const budget = (itinerary.budgetBreakdown as Record<string, number>) || {};
  const summary = (itinerary.summary as Record<string, unknown>) || {};
  const warnings = (itinerary.warnings as string[]) || [];
  const totalBudget = (budget.total as number) || (summary.totalBudget as number) || trip.budget;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end">
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />
      <motion.div
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="relative z-10 w-full max-w-2xl h-full bg-[#0b0f1a] border-l border-white/10 shadow-2xl overflow-y-auto"
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-white/10 bg-[#0b0f1a]/90 backdrop-blur-md">
          <div>
            <h2 className="text-xl font-display font-bold text-white flex items-center gap-2">
              <MapPin size={18} className="text-brand-primary" />
              {trip.destination}
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">{formatDateRange(trip.startDate, trip.endDate)}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-1 px-6 py-3 border-b border-white/5 bg-[#0b0f1a]/80">
          {(['itinerary', 'analytics', 'weather', 'vibe', 'team'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all ${
                activeTab === tab
                  ? 'bg-brand-primary/20 text-brand-primary'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {tab === 'itinerary' ? '📋 Itinerary'
                : tab === 'analytics' ? '📊 Analytics'
                : tab === 'weather'   ? '🌤️ Weather'
                : tab === 'vibe'      ? '📸 Vibe'
                :                      '👥 Team'}
            </button>
          ))}
          <button
            onClick={saveToBackend}
            disabled={isSaving}
            className="ml-auto flex items-center gap-1.5 text-xs font-semibold text-emerald-400 hover:text-emerald-300 transition-colors disabled:opacity-50"
          >
            {saveSuccess ? (
              <><Check size={11} /> Saved!</>
            ) : (
              <><RefreshCw size={11} className={isSaving ? 'animate-spin' : ''} /> Save Changes</>
            )}
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* System-detected trip updates (weather/crowd/flight/POI) */}
          <TripUpdateBanner
            updates={tripUpdates}
            token={effectiveToken}
            userId={userId}
            onUpdatesChange={setTripUpdates}
            onReplanStarted={() => {
              // After replan starts, start polling proposals immediately
              setTimeout(async () => {
                try {
                  const headers: Record<string, string> = {};
                  if (effectiveToken) headers['Authorization'] = `Bearer ${effectiveToken}`;
                  const res = await fetch(`${BACKEND_URL}/api/itinerary/proposals/${trip.jobId}`, { headers });
                  if (res.ok) {
                    const data = await res.json();
                    if (Array.isArray(data) && data.length > 0) setProposals(data);
                  }
                } catch { /* ignore */ }
              }, 3000);
            }}
          />

          {/* Consent Banner — shown when auto-detected replan proposals exist */}
          {proposals.length > 0 && (
            <ConsentBanner
              proposals={proposals}
              token={effectiveToken}
              onDismissAll={() => setProposals([])}
            />
          )}

          {/* Stats Row */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { icon: Calendar, label: 'Duration', value: `${daysBetween(trip.startDate, trip.endDate)} days` },
              { icon: Users, label: 'Travelers', value: `${trip.travelers} pax` },
              { icon: IndianRupee, label: 'Total', value: `₹${totalBudget.toLocaleString('en-IN')}` },
            ].map(({ icon: Icon, label, value }) => (
              <div key={label} className="glass-card rounded-xl p-3 text-center">
                <Icon size={16} className="text-brand-primary mx-auto mb-1" />
                <p className="text-white font-semibold text-sm">{value}</p>
                <p className="text-gray-500 text-xs">{label}</p>
              </div>
            ))}
          </div>

          {/* ─── ITINERARY TAB ─────────────────────────────────────────── */}
          {activeTab === 'itinerary' && (
            <div className="space-y-6">
              {/* ETA Warning Banner */}
              {etaWarning && (
                <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 px-4 py-3 flex items-start gap-3">
                  <AlertTriangle size={16} className="text-amber-400 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-amber-300">ETA Risk — {etaWarning.toActivity}</p>
                    <p className="text-xs text-amber-200/70 mt-0.5">{etaWarning.recommendation}</p>
                  </div>
                  <button onClick={() => setEtaWarning(null)} className="text-amber-400/60 hover:text-amber-300 transition-colors">
                    <X size={14} />
                  </button>
                </div>
              )}
              {/* Budget Breakdown */}
              {Object.keys(budget).length > 1 && (
                <div className="glass-card rounded-2xl p-4">
                  <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
                    <DollarSign size={14} className="text-brand-primary" /> Budget Breakdown
                  </h3>
                  <div className="space-y-2">
                    {(['accommodation', 'food', 'activities', 'transport', 'miscellaneous'] as const).map((key) => {
                      const val = budget[key] || 0;
                      const pct = totalBudget > 0 ? Math.round((val / totalBudget) * 100) : 0;
                      const displayPct = pct === 0 && val > 0 ? '<1' : String(pct);
                      const barPct = pct === 0 && val > 0 ? 1 : pct; // at least 1% bar if there's any value
                      const labels: Record<string, string> = {
                        accommodation: '🏨 Accommodation', food: '🍽️ Food',
                        activities: '🎯 Activities', transport: '✈️ Transport', miscellaneous: '🎁 Misc',
                      };
                      return (
                        <div key={key}>
                          <div className="flex justify-between text-xs text-gray-400 mb-1">
                            <span>{labels[key]}</span>
                            <span className="text-white">₹{val.toLocaleString('en-IN')} <span className="text-gray-500">({displayPct}%)</span></span>
                          </div>
                          <div className="h-1.5 bg-white/5 rounded-full">
                            <div className="h-full bg-brand-primary/70 rounded-full" style={{ width: `${barPct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Hotels */}
              {hotels.length > 0 && (
                <div className="glass-card rounded-2xl p-4">
                  <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
                    <Hotel size={14} className="text-brand-primary" /> Accommodation
                  </h3>
                  <div className="space-y-3">
                    {hotels.map((h: any, i: number) => (
                      <div key={i} className="flex items-start justify-between text-sm">
                        <div>
                          <p className="text-white font-medium">{h.name}</p>
                          <p className="text-gray-500 text-xs mt-0.5">{h.location || h.locality} · {h.nights} nights · {h.category}</p>
                        </div>
                        <p className="text-brand-primary text-xs font-medium whitespace-nowrap ml-4">
                          ₹{(h.costPerNight || 0).toLocaleString('en-IN')}/night
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Warnings */}
              {warnings.length > 0 && (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">
                  <p className="text-xs font-semibold text-amber-400 mb-1 flex items-center gap-1">
                    <AlertCircle size={12} /> AI Notes
                  </p>
                  {warnings.map((w, i) => <p key={i} className="text-xs text-amber-300/80 mt-1">• {w}</p>)}
                </div>
              )}

              {/* Day-by-Day — draggable + inline-editable */}
              <div>
                <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
                  <Calendar size={14} className="text-brand-primary" /> Day-by-Day Itinerary
                  <span className="ml-auto text-xs text-gray-600 font-normal">Drag ⠿ to reorder · ✏️ to edit</span>
                </h3>
                <div className="space-y-2">
                  {localDays.map((day: any, i: number) => (
                    <div key={i} className="glass-card rounded-xl overflow-hidden">
                      <button
                        onClick={() => setOpenDay(openDay === i ? -1 : i)}
                        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors"
                      >
                        <div className="flex items-center gap-3 text-left">
                          <span className="w-7 h-7 rounded-lg bg-brand-primary/20 text-brand-primary text-xs font-bold flex items-center justify-center flex-shrink-0">
                            {day.day}
                          </span>
                          <div>
                            <p className="text-sm font-medium text-white">{day.theme || `Day ${day.day}`}</p>
                            <p className="text-xs text-gray-500">{day.date} · ₹{(day.totalCost || 0).toLocaleString('en-IN')}</p>
                          </div>
                        </div>
                        {openDay === i ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                      </button>

                      <AnimatePresence>
                        {openDay === i && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}
                            className="overflow-hidden"
                          >
                            <div className="px-4 pb-4 space-y-2 border-t border-white/5 pt-3">
                              {/* Meals */}
                              {day.meals && (
                                <div className="flex gap-2 flex-wrap mb-3">
                                  {Object.entries(day.meals as Record<string, string>).map(([meal, val]) =>
                                    val ? (
                                      <span key={meal} className="text-xs bg-white/5 text-gray-400 px-2 py-1 rounded-lg flex items-center gap-1">
                                        <Utensils size={10} />
                                        <span className="capitalize font-medium text-gray-300">{meal}:</span> {String(val)}
                                      </span>
                                    ) : null,
                                  )}
                                </div>
                              )}
                              {/* Activities */}
                              {(day.activities as any[]).map((act: any, ai: number) => {
                                const isEditing = editTarget?.day === i && editTarget?.act === ai;
                                const isDragOver = dragTarget?.day === i && dragTarget?.act === ai;
                                return (
                                  <div
                                    key={ai}
                                    draggable
                                    onDragStart={() => handleDragStart(i, ai)}
                                    onDragOver={(e) => handleDragOver(e, i, ai)}
                                    onDrop={(e) => handleDrop(e, i, ai)}
                                    className={`flex gap-2 rounded-lg transition-colors ${isDragOver ? 'bg-brand-primary/10 ring-1 ring-brand-primary/30' : ''}`}
                                  >
                                    {/* Drag handle */}
                                    <div className="flex flex-col items-center pt-2 pb-2 cursor-grab active:cursor-grabbing">
                                      <GripVertical size={12} className="text-gray-600 hover:text-gray-400 transition-colors" />
                                    </div>
                                    {/* Timeline dot */}
                                    <div className="flex flex-col items-center pt-2">
                                      <Clock size={12} className="text-brand-primary flex-shrink-0" />
                                      {ai < (day.activities as any[]).length - 1 && (
                                        <div className="w-px flex-1 bg-brand-primary/20 my-1" />
                                      )}
                                    </div>
                                    <div className="pb-3 flex-1 min-w-0">
                                      {isEditing && editForm ? (
                                        /* ── Inline edit form ── */
                                        <div className="space-y-2 py-1">
                                          <input
                                            className="w-full text-sm bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-white placeholder-gray-600 focus:outline-none focus:border-brand-primary/50"
                                            value={editForm.name}
                                            onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                                            placeholder="Activity name"
                                          />
                                          <div className="grid grid-cols-3 gap-2">
                                            <input
                                              className="text-xs bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-white placeholder-gray-600 focus:outline-none focus:border-brand-primary/50"
                                              value={editForm.time}
                                              onChange={(e) => setEditForm({ ...editForm, time: e.target.value })}
                                              placeholder="Time"
                                            />
                                            <input
                                              className="text-xs bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-white placeholder-gray-600 focus:outline-none focus:border-brand-primary/50"
                                              value={editForm.duration}
                                              onChange={(e) => setEditForm({ ...editForm, duration: e.target.value })}
                                              placeholder="Duration"
                                            />
                                            <input
                                              type="number"
                                              className="text-xs bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-white placeholder-gray-600 focus:outline-none focus:border-brand-primary/50"
                                              value={editForm.estimatedCost}
                                              onChange={(e) => setEditForm({ ...editForm, estimatedCost: e.target.value })}
                                              placeholder="Cost ₹"
                                            />
                                          </div>
                                          <textarea
                                            rows={2}
                                            className="w-full text-xs bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-white placeholder-gray-600 focus:outline-none focus:border-brand-primary/50 resize-none"
                                            value={editForm.description}
                                            onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                                            placeholder="Description"
                                          />
                                          <div className="flex gap-2">
                                            <button onClick={saveEdit} className="flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 px-2 py-0.5 rounded bg-emerald-500/10 hover:bg-emerald-500/20 transition-colors">
                                              <Check size={10} /> Save
                                            </button>
                                            <button onClick={() => { setEditTarget(null); setEditForm(null); }} className="text-xs text-gray-500 hover:text-gray-300 px-2 py-0.5 rounded hover:bg-white/5 transition-colors">
                                              Cancel
                                            </button>
                                          </div>
                                        </div>
                                      ) : (
                                        /* ── Read-only view ── */
                                        <>
                                          <div className="flex items-center gap-2 flex-wrap">
                                            <span className="text-xs text-brand-primary font-medium">{act.time}</span>
                                            <span className="text-xs text-gray-600">·</span>
                                            <span className="text-xs text-gray-500">{act.duration}</span>
                                            {act.estimatedCost > 0 && (
                                              <span className="text-xs text-emerald-400 ml-auto">₹{Number(act.estimatedCost).toLocaleString('en-IN')}</span>
                                            )}
                                          </div>
                                          {/* Place thumbnail */}
                                          {(act.thumbnail || act.image || act.imageUrl) && (
                                            <div className="mt-1.5 mb-1 rounded-lg overflow-hidden h-24 bg-white/5">
                                              <img
                                                src={act.thumbnail || act.image || act.imageUrl}
                                                alt={act.name}
                                                className="w-full h-full object-cover"
                                                loading="lazy"
                                                onError={(e) => { (e.target as HTMLImageElement).parentElement!.style.display = 'none'; }}
                                              />
                                            </div>
                                          )}
                                          <div className="flex items-start justify-between gap-2 mt-0.5">
                                            <div className="flex-1 min-w-0">
                                              <p className="text-sm text-white font-medium">{act.name}</p>
                                              <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{act.description}</p>
                                              {act._replanned && (
                                                <span className="inline-block mt-1 text-xs text-emerald-400/70 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                                                  ✓ Updated
                                                </span>
                                              )}
                                              {poiVideos[act.name?.toLowerCase()] && (
                                                <PoiVideoPreview video={poiVideos[act.name.toLowerCase()]} />
                                              )}
                                              {userId && (
                                                <ActivityFeedback
                                                  tripJobId={trip.jobId}
                                                  activityName={act.name || ''}
                                                  dayIndex={i}
                                                  userId={userId}
                                                  token={effectiveToken}
                                                  initialCounts={feedbackMap[act.name?.toLowerCase()]?.counts}
                                                  hasSuggestion={feedbackMap[act.name?.toLowerCase()]?.hasSuggestion}
                                                />
                                              )}
                                            </div>
                                            <div className="flex items-center gap-0.5 flex-shrink-0 mt-0.5">
                                              <button
                                                onClick={() => startEdit(i, ai)}
                                                className="p-1 rounded hover:bg-brand-primary/15 text-gray-600 hover:text-brand-primary transition-colors"
                                                title="Edit activity"
                                              >
                                                <Edit2 size={11} />
                                              </button>
                                              <button
                                                onClick={() => setReportTarget({ activityName: act.name, dayIndex: i })}
                                                className="p-1 rounded hover:bg-amber-500/15 text-gray-600 hover:text-amber-400 transition-colors"
                                                title="Report an issue with this activity"
                                              >
                                                <AlertTriangle size={11} />
                                              </button>
                                              <button
                                                onClick={() => {
                                                  setChatTarget({ activityName: act.name, destination: trip.destination });
                                                  setChatQuestion('');
                                                  setChatAnswer('');
                                                  setChatSource('');
                                                }}
                                                className="p-1 rounded hover:bg-purple-500/15 text-gray-600 hover:text-purple-400 transition-colors"
                                                title="Ask about this place"
                                              >
                                                <MessageCircle size={11} />
                                              </button>
                                              {/* ── Check-in / Check-out / Skip ── */}
                                              {(() => {
                                                const ck = checkinMap[trackKey(i, act.name)];
                                                const loading = trackerLoading === trackKey(i, act.name);
                                                const nextAct = (day.activities as any[])[ai + 1] || null;
                                                if (loading) return <Loader size={11} className="animate-spin text-gray-400" />;
                                                if (!ck) return (
                                                  <>
                                                    <button
                                                      onClick={() => handleCheckin(i, act, nextAct)}
                                                      className="p-1 rounded hover:bg-emerald-500/15 text-gray-600 hover:text-emerald-400 transition-colors"
                                                      title="Check in"
                                                    >
                                                      <LogIn size={11} />
                                                    </button>
                                                    <button
                                                      onClick={() => handleSkip(i, act)}
                                                      className="p-1 rounded hover:bg-gray-500/15 text-gray-700 hover:text-gray-400 transition-colors"
                                                      title="Skip activity"
                                                    >
                                                      <SkipForward size={11} />
                                                    </button>
                                                  </>
                                                );
                                                if (ck === 'checked_in') return (
                                                  <button
                                                    onClick={() => handleCheckout(i, act)}
                                                    className="p-1 rounded hover:bg-blue-500/15 text-emerald-500 hover:text-blue-400 transition-colors"
                                                    title="Check out"
                                                  >
                                                    <LogOut size={11} />
                                                  </button>
                                                );
                                                if (ck === 'checked_out') return <CheckCircle size={11} className="text-emerald-500 mx-1" />;
                                                if (ck === 'skipped') return <span className="text-[10px] text-gray-500 mx-1">skipped</span>;
                                                return null;
                                              })()}
                                            </div>
                                          </div>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ─── ANALYTICS TAB ─────────────────────────────────────────── */}
          {activeTab === 'analytics' && (
            <div className="space-y-6">
              {/* Budget Breakdown Bar Chart */}
              {Object.keys(budget).length > 1 && (
                <div className="glass-card rounded-2xl p-4">
                  <h3 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
                    <DollarSign size={14} className="text-brand-primary" /> Budget Breakdown
                  </h3>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={[
                      { name: 'Stay', value: budget.accommodation || 0 },
                      { name: 'Food', value: budget.food || 0 },
                      { name: 'Activities', value: budget.activities || 0 },
                      { name: 'Transport', value: budget.transport || 0 },
                      { name: 'Misc', value: budget.miscellaneous || 0 },
                    ]} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
                      <XAxis dataKey="name" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => v === 0 ? '₹0' : v < 1000 ? `₹${v}` : `₹${(v / 1000).toFixed(0)}k`} />
                      <Tooltip formatter={(v: number | undefined) => [`₹${(v ?? 0).toLocaleString('en-IN')}`, 'Amount']} contentStyle={{ background: '#0d1120', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 }} />
                      <Bar dataKey="value" radius={[4, 4, 0, 0]} minPointSize={2}>
                        {['#6c63ff', '#a78bfa', '#34d399', '#fb923c', '#f472b6'].map((fill, idx) => (
                          <Cell key={idx} fill={fill} fillOpacity={0.85} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Daily Spending Chart */}
              {localDays.length > 0 && (
                <div className="glass-card rounded-2xl p-4">
                  <h3 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
                    <Calendar size={14} className="text-brand-primary" /> Daily Spending
                  </h3>
                  <ResponsiveContainer width="100%" height={160}>
                    <BarChart data={localDays.map((d: any) => ({ name: `D${d.day}`, cost: d.totalCost || 0 }))} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
                      <XAxis dataKey="name" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => v === 0 ? '₹0' : v < 1000 ? `₹${v}` : `₹${(v / 1000).toFixed(0)}k`} />
                      <Tooltip formatter={(v: number | undefined) => [`₹${(v ?? 0).toLocaleString('en-IN')}`, 'Cost']} contentStyle={{ background: '#0d1120', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 }} />
                      <Bar dataKey="cost" fill="#6c63ff" fillOpacity={0.8} radius={[4, 4, 0, 0]} minPointSize={2} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Key Stats */}
              <div className="grid grid-cols-2 gap-3">
                <div className="glass-card rounded-xl p-3 text-center">
                  <p className="text-brand-primary font-bold text-lg">
                    ₹{trip.travelers > 0 && localDays.length > 0
                      ? Math.round(totalBudget / trip.travelers / localDays.length).toLocaleString('en-IN')
                      : '—'}
                  </p>
                  <p className="text-gray-500 text-xs mt-0.5">per person / day</p>
                </div>
                <div className="glass-card rounded-xl p-3 text-center">
                  <p className="text-brand-primary font-bold text-lg">{localDays.filter((d: any) => (d.totalCost || 0) > 0).length}</p>
                  <p className="text-gray-500 text-xs mt-0.5">activity days</p>
                </div>
                <div className="glass-card rounded-xl p-3 text-center">
                  <p className="text-brand-primary font-bold text-lg">
                    ₹{Math.max(...localDays.map((d: any) => d.totalCost || 0), 0).toLocaleString('en-IN')}
                  </p>
                  <p className="text-gray-500 text-xs mt-0.5">busiest day spend</p>
                </div>
                <div className="glass-card rounded-xl p-3 text-center">
                  <p className="text-brand-primary font-bold text-lg">
                    {localDays.reduce((s: number, d: any) => s + (d.activities?.length || 0), 0)}
                  </p>
                  <p className="text-gray-500 text-xs mt-0.5">total activities</p>
                </div>
              </div>
            </div>
          )}

          {/* ─── WEATHER TAB ───────────────────────────────────────────── */}
          {activeTab === 'weather' && (() => {
            const weatherForecast = ((itinerary as any).weatherForecast as any[]) || [];
            return (
              <div className="space-y-3">
                {weatherForecast.length > 0 ? weatherForecast.map((w: any, idx: number) => (
                  <div key={idx} className="glass-card rounded-xl p-3 flex items-center gap-3">
                    <p className="text-xs text-gray-400 w-20 flex-shrink-0">{w.date}</p>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white capitalize">{w.condition}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {w.tempMin ?? w.low ?? '—'}–{w.tempMax ?? w.high ?? '—'}°C
                        {(w.rainChance ?? w.precipitation_probability) !== undefined
                          ? ` · 💧${w.rainChance ?? w.precipitation_probability}%`
                          : ''}
                      </p>
                    </div>
                    <div className="h-2 w-24 bg-white/5 rounded-full overflow-hidden flex-shrink-0">
                      <div
                        className="h-full bg-blue-500/50 rounded-full transition-all"
                        style={{ width: `${Math.min(100, (w.rainChance ?? w.precipitation_probability ?? 0))}%` }}
                      />
                    </div>
                  </div>
                )) : (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <p className="text-4xl mb-3">🌤️</p>
                    <p className="text-sm text-gray-400 font-medium">No weather data available</p>
                    <p className="text-xs text-gray-600 mt-1 max-w-xs">Plan a new trip to receive live weather forecasts for your destination.</p>
                  </div>
                )}
              </div>
            );
          })()}

          {/* ─── VIBE TAB ──────────────────────────────────────────────── */}
          {activeTab === 'vibe' && (
            <div className="space-y-6">
              <LiveDestinationFeed
                destination={trip.destination}
                token={effectiveToken}
                pois={(itinerary as any).officialPois?.slice(0, 5).map((p: any) => p.name) || []}
              />

              {/* YouTube fallback / enrichment — shown whenever POI videos exist */}
              {Object.keys(poiVideos).length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-300 mb-1 flex items-center gap-2">
                    📺 YouTube Highlights
                  </h3>
                  <p className="text-xs text-gray-500 mb-3">Video guides for the places in your itinerary</p>
                  <div className="space-y-2">
                    {Object.values(poiVideos).slice(0, 6).map((video) => (
                      <PoiVideoPreview key={video.poiName} video={video} />
                    ))}
                  </div>
                </div>
              )}

              {/* Static fallback when no social data */}
              {Object.keys(poiVideos).length === 0 && (
                <div className="glass-card rounded-xl p-4 text-center">
                  <p className="text-3xl mb-2">🎬</p>
                  <p className="text-sm text-gray-400 font-medium">Videos load with your itinerary</p>
                  <p className="text-xs text-gray-600 mt-1">YouTube guides for each place will appear here once the itinerary is generated.</p>
                </div>
              )}
            </div>
          )}

          {/* ─── TEAM TAB ──────────────────────────────────────────────── */}
          {activeTab === 'team' && (
            <div className="space-y-5">
              {/* Owner alert: pending member suggestions */}
              <OwnerAlertBanner
                suggestions={suggestions}
                tripJobId={trip.jobId}
                token={effectiveToken}
                onRefresh={() => {
                  const loadSuggestions = async () => {
                    try {
                      const headers: Record<string, string> = {};
                      if (effectiveToken) headers['Authorization'] = `Bearer ${effectiveToken}`;
                      const res = await fetch(
                        `${BACKEND_URL}/api/team/suggestions/${trip.jobId}?status=pending`,
                        { headers },
                      );
                      if (res.ok) setSuggestions(await res.json());
                    } catch { /* ignore */ }
                  };
                  loadSuggestions();
                }}
              />

              {/* Invite Panel */}
              <InvitePanel
                tripJobId={trip.jobId}
                maxTravelers={trip.travelers}
                userId={userId || ''}
                ownerDisplayName={(user as any)?.email || 'Owner'}
                token={effectiveToken}
              />

              {/* Member suggestion input */}
              <SuggestionBox
                tripJobId={trip.jobId}
                userId={userId || ''}
                token={effectiveToken}
              />
            </div>
          )}
        </div>
      </motion.div>

      {/* Report Issue overlay */}
      <AnimatePresence>
        {reportTarget && (
          <ReportIssueModal
            tripId={trip.jobId}
            tripDestination={trip.destination}
            activityName={reportTarget.activityName}
            dayIndex={reportTarget.dayIndex}
            token={token}
            onClose={() => setReportTarget(null)}
            onSubmit={(result) => {
              setReportTarget(null);
              if (result.proposalQueued) setReportSubmitted(s => !s);
            }}
          />
        )}

        {/* ── Chatbot Modal — "Ask about this place" ── */}
        {chatTarget && (
          <motion.div
            key="chatbot-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)' }}
            onClick={(e) => { if (e.target === e.currentTarget) setChatTarget(null); }}
          >
            <motion.div
              initial={{ scale: 0.95, y: 16 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 16 }}
              className="w-full max-w-md bg-[#0f1424] border border-white/10 rounded-2xl shadow-2xl p-6 flex flex-col gap-4"
            >
              {/* Header */}
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <MessageCircle size={16} className="text-purple-400" />
                    <h3 className="text-white font-display font-bold text-base">Ask about this place</h3>
                  </div>
                  <p className="text-xs text-gray-400">{chatTarget.activityName} · {chatTarget.destination}</p>
                </div>
                <button onClick={() => setChatTarget(null)} className="p-1.5 rounded-lg hover:bg-white/10 text-gray-500 hover:text-white transition-colors">
                  <X size={16} />
                </button>
              </div>

              {/* Input */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={chatQuestion}
                  onChange={(e) => setChatQuestion(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && sendChatMessage()}
                  placeholder="Best time to visit? Entry fee? Dress code?"
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-brand-primary/50"
                  autoFocus
                />
                <button
                  onClick={sendChatMessage}
                  disabled={chatLoading || !chatQuestion.trim()}
                  className="px-3 py-2 bg-purple-500/20 hover:bg-purple-500/30 disabled:opacity-40 border border-purple-500/30 rounded-lg text-purple-300 transition-all"
                >
                  {chatLoading ? <Loader size={14} className="animate-spin" /> : <Send size={14} />}
                </button>
              </div>

              {/* Answer */}
              {chatLoading && (
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <Loader size={12} className="animate-spin text-purple-400" />
                  Consulting official tourism data…
                </div>
              )}
              {chatAnswer && !chatLoading && (
                <div className="bg-white/5 border border-white/8 rounded-xl p-4">
                  <p className="text-sm text-gray-200 leading-relaxed whitespace-pre-wrap">{chatAnswer}</p>
                  {chatSource && (
                    <p className="text-xs text-gray-600 mt-2">Source: {chatSource}</p>
                  )}
                </div>
              )}

              {/* Suggested questions */}
              {!chatAnswer && !chatLoading && (
                <div className="flex flex-wrap gap-2">
                  {['Best time to visit?', 'Entry fee?', 'Timings?', 'Dress code?', 'How crowded?'].map((q) => (
                    <button
                      key={q}
                      onClick={() => setChatQuestion(q)}
                      className="text-xs text-gray-500 hover:text-white bg-white/5 hover:bg-white/10 border border-white/5 px-2 py-1 rounded-lg transition-all"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// ─── Trip Member Count Badge ──────────────────────────────────────────────────

interface TripMemberBadgeProps {
  tripJobId: string;
  maxTravelers: number;
}

const TripMemberBadge: React.FC<TripMemberBadgeProps> = ({ tripJobId, maxTravelers }) => {
  const [joined, setJoined] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${BACKEND_URL}/api/team/members/${tripJobId}`)
      .then((r) => r.json())
      .then((members: any[]) => {
        if (!cancelled && Array.isArray(members)) {
          setJoined(members.filter((m) => m.status === 'joined').length);
        }
      })
      .catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, [tripJobId]);

  if (joined === null) return null;
  const full = joined >= maxTravelers;
  return (
    <span className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
      full ? 'bg-emerald-500/15 text-emerald-400' : 'bg-brand-primary/10 text-brand-primary'
    }`}>
      👥 {joined}/{maxTravelers}
    </span>
  );
};

// ─── Trip Card ────────────────────────────────────────────────────────────────

interface TripCardProps {
  trip: SavedTrip;
  status: TripStatus | undefined;
  onView: () => void;
  onRemove: () => void;
}

const TripCard: React.FC<TripCardProps> = ({ trip, status, onView, onRemove }) => {
  const st = status?.status || 'queued';
  const isProcessing = !['completed', 'failed'].includes(st);
  const isFailed = st === 'failed';
  const days = daysBetween(trip.startDate, trip.endDate);
  const hotels = (status?.itinerary_data?.hotels as any[]) || [];
  const hotelName = hotels[0]?.name;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      className="glass-card rounded-2xl overflow-hidden border border-white/5 hover:border-brand-primary/20 transition-all group flex flex-col"
    >
      <div className="h-1 bg-gradient-to-r from-brand-primary to-purple-500" />
      <div className="p-5 flex flex-col flex-1">
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-brand-primary/15 flex items-center justify-center flex-shrink-0">
              <MapPin size={16} className="text-brand-primary" />
            </div>
            <div>
              <h3 className="text-base font-display font-bold text-white leading-tight">{trip.destination}</h3>
              <p className="text-xs text-gray-500">{trip.source} → {trip.destination}</p>
            </div>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-500/15 text-gray-600 hover:text-red-400 transition-all"
          >
            <Trash2 size={13} />
          </button>
        </div>

        {/* Meta */}
        <div className="space-y-1.5 mb-4">
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <Calendar size={11} className="text-brand-primary/60" />
            <span>{formatDateRange(trip.startDate, trip.endDate)}</span>
            <span className="text-gray-600">·</span>
            <span>{days} {days === 1 ? 'day' : 'days'}</span>
          </div>
          <div className="flex items-center gap-4 text-xs text-gray-400">
            <span className="flex items-center gap-1">
              <DollarSign size={11} className="text-brand-primary/60" />
              ₹{trip.budget.toLocaleString('en-IN')}
            </span>
            <span className="flex items-center gap-1">
              <Users size={11} className="text-brand-primary/60" />
              {trip.travelers} {trip.travelers === 1 ? 'traveler' : 'travelers'}
            </span>
            <TripMemberBadge tripJobId={trip.jobId} maxTravelers={trip.travelers} />
          </div>
          {hotelName && (
            <p className="text-xs text-gray-600 flex items-center gap-1 truncate">
              <Hotel size={10} className="text-brand-primary/30 flex-shrink-0" /> {hotelName}
            </p>
          )}
        </div>

        {/* Status + Action */}
        <div className="mt-auto flex items-center justify-between">
          <span className={`text-xs px-2.5 py-1 rounded-full border font-medium ${statusColor[st] || statusColor['queued']}`}>
            {isProcessing && <span className="inline-block w-1.5 h-1.5 rounded-full bg-current mr-1.5 animate-pulse" />}
            {statusLabel[st] || st}
          </span>
          {st === 'completed' ? (
            <div className="flex items-center gap-1.5">
              <button
                onClick={onView}
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-brand-primary bg-white/5 hover:bg-brand-primary/10 border border-white/5 hover:border-brand-primary/20 px-2 py-1.5 rounded-lg transition-all"
                title="Invite team member"
              >
                👥 Invite
              </button>
              <button
                onClick={onView}
                className="flex items-center gap-1.5 text-xs font-medium text-brand-primary hover:text-white bg-brand-primary/10 hover:bg-brand-primary/20 border border-brand-primary/20 px-3 py-1.5 rounded-lg transition-all"
              >
                View <ExternalLink size={11} />
              </button>
            </div>
          ) : isFailed ? (
            <span className="text-xs text-red-400/60">Planning failed</span>
          ) : (
            <span className="text-xs text-gray-600 flex items-center gap-1">
              <Loader size={10} className="animate-spin" /> {status?.progress ?? 0}%
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
};

// ─── Trips Page ───────────────────────────────────────────────────────────────

export const Trips: React.FC = () => {
  const navigate = useNavigate();
  const { savedTrips, removeTrip, addTrip } = useTripStore();
  const session = useAuthStore((s) => s.session);
  // Recover trips from planningStore (if user planned without this fix in place)
  const planningJobId = usePlanningStore((s) => s.jobId);
  const planningDest = usePlanningStore((s) => s.destination);
  const planningSource = usePlanningStore((s) => s.source);
  const planningStart = usePlanningStore((s) => s.startDate);
  const planningEnd = usePlanningStore((s) => s.endDate);
  const planningBudget = usePlanningStore((s) => s.budget);
  const planningTravelers = usePlanningStore((s) => s.travelers);

  // Auto-import job from planningStore if not already saved
  useEffect(() => {
    if (
      planningJobId &&
      planningDest &&
      !savedTrips.find((t) => t.jobId === planningJobId)
    ) {
      addTrip({
        jobId: planningJobId,
        destination: planningDest,
        source: planningSource || 'Unknown',
        startDate: planningStart,
        endDate: planningEnd,
        budget: planningBudget,
        travelers: planningTravelers,
        travelStyle: 'Mid-range',
        createdAt: new Date().toISOString(),
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planningJobId]);

  const [activeTab, setActiveTab] = useState<FilterTab>('All');
  const [tripStatuses, setTripStatuses] = useState<Record<string, TripStatus>>({});
  const [loading, setLoading] = useState(false);
  const [selectedTrip, setSelectedTrip] = useState<SavedTrip | null>(null);

  const fetchStatuses = useCallback(async () => {
    if (savedTrips.length === 0) return;
    const headers: Record<string, string> = {};
    if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;

    const results = await Promise.allSettled(
      savedTrips.map((t) =>
        fetch(`${BACKEND_URL}/api/itinerary/status/${t.jobId}`, { headers })
          .then((r) => r.json())
          .then((data): TripStatus => ({ jobId: t.jobId, ...data }))
          .catch((): TripStatus => ({ jobId: t.jobId, status: 'unknown' })),
      ),
    );

    const map: Record<string, TripStatus> = {};
    results.forEach((r) => {
      if (r.status === 'fulfilled') map[r.value.jobId] = r.value;
    });
    setTripStatuses(map);
  }, [savedTrips, session]);

  useEffect(() => {
    setLoading(true);
    fetchStatuses().finally(() => setLoading(false));
  }, [fetchStatuses]);

  // Auto-poll every 5s if any trip is still in progress
  useEffect(() => {
    const hasActive = savedTrips.some((t) => {
      const s = tripStatuses[t.jobId]?.status;
      return s && !['completed', 'failed', 'unknown'].includes(s);
    });
    if (!hasActive) return;
    const id = setInterval(fetchStatuses, 5000);
    return () => clearInterval(id);
  }, [savedTrips, tripStatuses, fetchStatuses]);

  const filtered = savedTrips.filter((t) => {
    const st = tripStatuses[t.jobId]?.status;
    const now = new Date();
    const startDate = new Date(t.startDate);
    switch (activeTab) {
      case 'Upcoming': return st === 'completed' && startDate >= now;
      case 'Completed': return st === 'completed' && startDate < now;
      case 'Failed': return st === 'failed';
      default: return true;
    }
  });

  return (
    <div className="relative min-h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-3xl font-display font-bold text-white">My Trips</h2>
          <p className="text-gray-400 mt-1">View and manage your generated itineraries</p>
        </div>
        <div className="flex items-center gap-3">
          {savedTrips.length > 0 && (
            <button
              onClick={() => { setLoading(true); fetchStatuses().finally(() => setLoading(false)); }}
              className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white border border-white/5 transition-colors"
              title="Refresh"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
          )}
          <motion.button
            whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
            onClick={() => navigate('/planning')}
            className="flex items-center gap-2 gradient-primary hover:opacity-90 text-white px-5 py-2.5 rounded-xl font-bold shadow-glow transition-all"
          >
            <Plus size={16} /> Plan a Trip
          </motion.button>
        </div>
      </div>

      {/* Tabs */}
      {savedTrips.length > 0 && (
        <div className="flex gap-2 mb-8">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab
                  ? 'bg-brand-primary/15 text-brand-primary border border-brand-primary/30 shadow-glow'
                  : 'bg-white/5 text-gray-400 border border-white/5 hover:bg-brand-primary/8 hover:text-gray-200'
              }`}
            >
              {tab}
              {tab === 'All' && (
                <span className="ml-1.5 text-xs text-gray-500">({savedTrips.length})</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Loading skeletons */}
      {loading && savedTrips.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {savedTrips.slice(0, 3).map((_, i) => (
            <div key={i} className="glass-card rounded-2xl h-52 animate-pulse" />
          ))}
        </div>
      )}

      {/* Cards grid */}
      {!loading && filtered.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((trip) => (
            <TripCard
              key={trip.jobId}
              trip={trip}
              status={tripStatuses[trip.jobId]}
              onView={() => setSelectedTrip(trip)}
              onRemove={() => removeTrip(trip.jobId)}
            />
          ))}
        </div>
      )}

      {/* Empty state — no trips at all */}
      {!loading && savedTrips.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="glass-card p-8 rounded-2xl max-w-md w-full text-center">
            <div className="w-16 h-16 rounded-2xl bg-brand-primary/15 flex items-center justify-center mx-auto mb-6">
              <Map className="w-8 h-8 text-brand-primary" />
            </div>
            <h3 className="text-xl font-display font-bold text-white mb-2">No trips yet</h3>
            <p className="text-gray-400 text-sm mb-6">
              Your AI-generated itineraries will appear here once you complete a planning session.
            </p>
            <div className="grid grid-cols-2 gap-3 mb-6">
              <div className="bg-white/5 rounded-xl p-3 text-center">
                <Calendar className="w-5 h-5 text-gray-500 mx-auto mb-1" />
                <span className="text-xs text-gray-500">No upcoming</span>
              </div>
              <div className="bg-white/5 rounded-xl p-3 text-center">
                <DollarSign className="w-5 h-5 text-gray-500 mx-auto mb-1" />
                <span className="text-xs text-gray-500">No spend data</span>
              </div>
            </div>
            <button
              onClick={() => navigate('/planning')}
              className="w-full gradient-primary text-white font-bold py-3 rounded-xl hover:opacity-90 transition-all shadow-glow"
            >
              Start Planning
            </button>
          </div>
        </div>
      )}

      {/* No results for active tab */}
      {!loading && savedTrips.length > 0 && filtered.length === 0 && (
        <div className="text-center py-16">
          <CheckCircle className="w-10 h-10 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-500">No trips in this category</p>
        </div>
      )}

      {/* Detail modal */}
      <AnimatePresence>
        {selectedTrip && tripStatuses[selectedTrip.jobId]?.itinerary_data && (
          <ItineraryModal
            trip={selectedTrip}
            itinerary={tripStatuses[selectedTrip.jobId].itinerary_data as Record<string, unknown>}
            token={session?.access_token}
            onClose={() => setSelectedTrip(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
};
