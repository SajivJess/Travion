import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, ArrowRight, ArrowLeft, Loader, CheckCircle, Flame, Moon, Smile,
  MapPin, Calendar as CalendarIcon, DollarSign, Activity, Plane, Bus, Train,
  Users, Utensils, AlertCircle,
} from 'lucide-react';
import clsx from 'clsx';
import { usePlanningStore } from '../../store/planningStore';
import type { TravelStyle, ArrivalEnergy, TransportMode, MealPreference } from '../../store/planningStore';
import { useTripStore } from '../../store/tripStore';
import { useAuthStore } from '../../store/authStore';

const BACKEND_URL = 'http://localhost:3000';

const containerVariants = {
  hidden: { x: '100%', opacity: 0 },
  visible: { x: 0, opacity: 1, transition: { type: 'spring' as const, stiffness: 300, damping: 30 } },
  exit: { x: '100%', opacity: 0 },
};

const travelStyleMeta: Record<TravelStyle, { emoji: string; desc: string }> = {
  Relaxed: { emoji: '🧘', desc: 'Easy pace, comfort first' },
  Cultural: { emoji: '🏛️', desc: 'Museums, history, local life' },
  Adventure: { emoji: '🏔️', desc: 'Thrills, treks, outdoor' },
  Spiritual: { emoji: '🕉️', desc: 'Temples, meditation, peace' },
  Party: { emoji: '🎉', desc: 'Nightlife, festivals, fun' },
  Nature: { emoji: '🌿', desc: 'Parks, wildlife, scenic' },
};

export const PlanningSessionPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const store = usePlanningStore();
  const {
    currentStep, setStep,
    source, setSource,
    destination, setDestination,
    startDate, setStartDate,
    endDate, setEndDate,
    travelStyle, setTravelStyle,
    budget, setBudget,
    arrivalEnergy, setArrivalEnergy,
    transportMode, setTransportMode,
    travelers, setTravelers,
    mealPreference, setMealPreference,
    jobId, setJobId,
    setJobStatus,
    jobError, setJobError,
    setItinerary,
  } = store;

  const { addTrip } = useTripStore();
  const user = useAuthStore((s) => s.user);
  const session = useAuthStore((s) => s.session);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const tripDays = (() => {
    if (!startDate || !endDate) return 0;
    const diff = new Date(endDate).getTime() - new Date(startDate).getTime();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)) + 1);
  })();

  const budgetLabel = (() => {
    if (budget <= 10000) return 'Budget-friendly';
    if (budget <= 30000) return 'Mid-range';
    if (budget <= 75000) return 'Comfortable';
    if (budget <= 200000) return 'Premium';
    return 'Luxury';
  })();

  const mapTravelStyleToBackend = (style: TravelStyle | null): string => {
    switch (style) {
      case 'Relaxed': return 'Comfort';
      case 'Cultural': return 'Mid-range';
      case 'Adventure': return 'Mid-range';
      case 'Spiritual': return 'Budget';
      case 'Party': return 'Mid-range';
      case 'Nature': return 'Mid-range';
      default: return 'Mid-range';
    }
  };

  const handleStartPlanning = async () => {
    setStep('generating');
    setJobError(null);

    try {
      const body = {
        source,
        destination,
        startDate,
        endDate,
        travellers: travelers,
        budget,
        travelStyle: mapTravelStyleToBackend(travelStyle),
        transportMode,
        mealPreference: mealPreference === 'Any' ? undefined : mealPreference.toLowerCase(),
        arrivalTime: '12:00',
      };

      const authHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
      if (session?.access_token) authHeaders['Authorization'] = `Bearer ${session.access_token}`;
      if (user?.id) authHeaders['x-user-id'] = user.id;

      const res = await fetch(`${BACKEND_URL}/api/itinerary`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Failed to submit planning job');
      }

      if (data.data) {
        setItinerary(data.data);
        setJobStatus('completed');
        setStep('itinerary');
        return;
      }

      if (data.jobId) {
        setJobId(data.jobId);
        setJobStatus('queued');
        // Persist trip metadata to localStorage so it appears on Trips page
        addTrip({
          jobId: data.jobId,
          destination,
          source,
          startDate,
          endDate,
          budget,
          travelers,
          travelStyle: mapTravelStyleToBackend(travelStyle),
          createdAt: new Date().toISOString(),
        });
        startPolling(data.jobId);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error';
      setJobError(message);
      setJobStatus('failed');
    }
  };

  const startPolling = (id: string) => {
    if (pollRef.current) clearInterval(pollRef.current);

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/itinerary/status/${id}`);
        const data = await res.json();

        setJobStatus(data.status);

        if (data.status === 'completed' && (data.result || data.itinerary_data)) {
          setItinerary(data.result || data.itinerary_data);
          setStep('itinerary');
          if (pollRef.current) clearInterval(pollRef.current);
        } else if (data.status === 'failed') {
          setJobError(data.error || data.error_message || 'Trip planning failed');
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch {
        // Keep polling on network hiccups
      }
    }, 3000);
  };

  const goBack = () => {
    const stepOrder: Array<typeof currentStep> = ['intro', 'dates', 'style', 'budget', 'energy', 'transport', 'review'];
    const idx = stepOrder.indexOf(currentStep);
    if (idx > 0) setStep(stepOrder[idx - 1]);
  };

  const renderStepIndicator = () => {
    const steps = [
      { key: 'intro', label: 'Details' },
      { key: 'dates', label: 'Dates' },
      { key: 'style', label: 'Style' },
      { key: 'budget', label: 'Budget' },
      { key: 'energy', label: 'Energy' },
      { key: 'transport', label: 'Transport' },
      { key: 'review', label: 'Review' },
    ];
    const currentIdx = steps.findIndex(s => s.key === currentStep);

    if (currentStep === 'generating' || currentStep === 'itinerary') return null;

    return (
      <div className="flex items-center gap-1 px-6 py-3 border-b border-brand-primary/8">
        {steps.map((step, i) => (
          <div key={step.key} className="flex items-center gap-1 flex-1">
            <div
              className={clsx(
                'w-2.5 h-2.5 rounded-full transition-all',
                i < currentIdx ? 'bg-brand-accent shadow-glow-accent' :
                i === currentIdx ? 'bg-brand-primary shadow-glow' :
                'bg-white/10'
              )}
            />
            {i < steps.length - 1 && (
              <div className={clsx('flex-1 h-px', i < currentIdx ? 'bg-brand-accent/40' : 'bg-white/5')} />
            )}
          </div>
        ))}
      </div>
    );
  };

  const renderCurrentStep = () => {
    switch (currentStep) {
      case 'intro':
      case 'intent':
        return (
          <div className="space-y-5">
            <h2 className="text-2xl font-display font-bold">Plan Your Journey</h2>

            <div>
              <label className="text-sm text-gray-400 mb-1.5 block">From (Your City)</label>
              <div className="bg-dashboard-surface border border-brand-primary/10 rounded-xl p-3.5 flex items-center gap-3 focus-within:border-brand-primary focus-within:shadow-glow transition-all">
                <MapPin className="text-gray-500 w-5 h-5 shrink-0" />
                <input
                  type="text"
                  placeholder="e.g., Bangalore, Mumbai, Delhi"
                  className="bg-transparent border-none outline-none text-base w-full placeholder-gray-600 text-white"
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  autoFocus
                />
              </div>
            </div>

            <div>
              <label className="text-sm text-gray-400 mb-1.5 block">To (Destination)</label>
              <div className="bg-dashboard-surface border border-brand-primary/10 rounded-xl p-3.5 flex items-center gap-3 focus-within:border-brand-primary focus-within:shadow-glow transition-all">
                <MapPin className="text-brand-accent w-5 h-5 shrink-0" />
                <input
                  type="text"
                  placeholder="e.g., Kochi, Goa, Manali"
                  className="bg-transparent border-none outline-none text-base w-full placeholder-gray-600 text-white"
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                />
              </div>
              <p className="text-xs text-gray-500 mt-1">Use a specific city for best results</p>
            </div>

            <div>
              <label className="text-sm text-gray-400 mb-1.5 block">Number of Travelers</label>
              <div className="bg-dashboard-surface border border-brand-primary/10 rounded-xl p-3.5 flex items-center gap-4">
                <Users className="text-gray-500 w-5 h-5 shrink-0" />
                <div className="flex items-center gap-3 flex-1">
                  <button
                    onClick={() => setTravelers(Math.max(1, travelers - 1))}
                    className="w-8 h-8 rounded-lg bg-brand-primary/10 hover:bg-brand-primary/20 flex items-center justify-center text-white font-bold transition-colors"
                  >
                    −
                  </button>
                  <span className="text-xl font-bold text-white w-12 text-center">{travelers}</span>
                  <button
                    onClick={() => setTravelers(Math.min(10, travelers + 1))}
                    className="w-8 h-8 rounded-lg bg-brand-primary/10 hover:bg-brand-primary/20 flex items-center justify-center text-white font-bold transition-colors"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>

            <div>
              <label className="text-sm text-gray-400 mb-1.5 block">Meal Preference</label>
              <div className="flex gap-2">
                {(['Any', 'Vegetarian', 'Vegan'] as MealPreference[]).map((pref) => (
                  <button
                    key={pref}
                    onClick={() => setMealPreference(pref)}
                    className={clsx(
                      'flex-1 py-2.5 rounded-xl text-sm font-medium border transition-all flex items-center justify-center gap-1.5',
                      mealPreference === pref
                        ? 'bg-brand-primary/20 border-brand-primary text-white'
                        : 'bg-dashboard-surface border-white/5 text-gray-400 hover:bg-white/5'
                    )}
                  >
                    <Utensils className="w-3.5 h-3.5" />
                    {pref}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={() => setStep('dates')}
              disabled={!destination.trim() || !source.trim()}
              className="w-full gradient-primary text-white font-bold py-3 rounded-xl disabled:opacity-30 disabled:cursor-not-allowed hover:opacity-90 transition-all flex items-center justify-center gap-2 mt-4 shadow-glow"
            >
              Next Step <ArrowRight size={18} />
            </button>
          </div>
        );

      case 'dates':
        return (
          <div className="space-y-5">
            <div className="flex items-center gap-2">
              <button onClick={goBack} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"><ArrowLeft size={18} className="text-gray-400" /></button>
              <h2 className="text-2xl font-display font-bold">Travel Dates</h2>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm text-gray-400 mb-1.5 block">Start Date</label>
                <div className="bg-dashboard-surface border border-brand-primary/10 rounded-xl p-3.5 flex items-center gap-2 focus-within:border-brand-primary transition-all">
                  <CalendarIcon className="w-4 h-4 text-gray-500 shrink-0" />
                  <input
                    type="date"
                    value={startDate}
                    min={new Date().toISOString().split('T')[0]}
                    onChange={(e) => {
                      setStartDate(e.target.value);
                      if (endDate && e.target.value > endDate) setEndDate(e.target.value);
                    }}
                    className="bg-transparent border-none outline-none text-sm w-full text-white [color-scheme:dark]"
                  />
                </div>
              </div>
              <div>
                <label className="text-sm text-gray-400 mb-1.5 block">End Date</label>
                <div className="bg-dashboard-surface border border-brand-primary/10 rounded-xl p-3.5 flex items-center gap-2 focus-within:border-brand-primary transition-all">
                  <CalendarIcon className="w-4 h-4 text-gray-500 shrink-0" />
                  <input
                    type="date"
                    value={endDate}
                    min={startDate || new Date().toISOString().split('T')[0]}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="bg-transparent border-none outline-none text-sm w-full text-white [color-scheme:dark]"
                  />
                </div>
              </div>
            </div>

            {tripDays > 0 && (
              <div className="bg-brand-primary/10 border border-brand-primary/20 rounded-xl p-3 text-center">
                <span className="text-brand-accent font-bold text-lg">{tripDays}</span>
                <span className="text-gray-300 text-sm ml-2">{tripDays === 1 ? 'day' : 'days'} trip</span>
              </div>
            )}

            <button
              onClick={() => setStep('style')}
              disabled={!startDate || !endDate || tripDays < 1}
              className="w-full gradient-primary text-white font-bold py-3 rounded-xl disabled:opacity-30 disabled:cursor-not-allowed hover:opacity-90 transition-all flex items-center justify-center gap-2 shadow-glow"
            >
              Continue <ArrowRight size={18} />
            </button>
          </div>
        );

      case 'style':
        return (
          <div className="space-y-5">
            <div className="flex items-center gap-2">
              <button onClick={goBack} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"><ArrowLeft size={18} className="text-gray-400" /></button>
              <h2 className="text-2xl font-display font-bold">Travel Style</h2>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {(Object.keys(travelStyleMeta) as TravelStyle[]).map((style) => (
                <button
                  key={style}
                  onClick={() => setTravelStyle(style)}
                  className={clsx(
                    'p-4 rounded-xl border transition-all text-left relative overflow-hidden',
                    travelStyle === style
                      ? 'bg-brand-primary/20 border-brand-primary shadow-glow'
                      : 'bg-dashboard-surface border-white/5 hover:bg-white/5'
                  )}
                >
                  <span className="text-xl mb-1 block">{travelStyleMeta[style].emoji}</span>
                  <span className="text-sm font-bold text-white block">{style}</span>
                  <span className="text-xs text-gray-400">{travelStyleMeta[style].desc}</span>
                  {travelStyle === style && <CheckCircle className="absolute top-2 right-2 w-4 h-4 text-brand-accent" />}
                </button>
              ))}
            </div>
            <button
              onClick={() => setStep('budget')}
              disabled={!travelStyle}
              className="w-full gradient-primary text-white font-bold py-3 rounded-xl hover:opacity-90 transition-all disabled:opacity-30 disabled:cursor-not-allowed mt-2 shadow-glow"
            >
              Continue <ArrowRight size={18} />
            </button>
          </div>
        );

      case 'budget':
        return (
          <div className="space-y-6">
            <div className="flex items-center gap-2">
              <button onClick={goBack} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"><ArrowLeft size={18} className="text-gray-400" /></button>
              <h2 className="text-2xl font-display font-bold">Total Budget</h2>
            </div>
            <div className="glass-card p-6 rounded-2xl flex flex-col gap-5">
              <div className="flex items-center justify-between">
                <span className="text-brand-accent font-mono text-2xl font-bold">₹{budget.toLocaleString('en-IN')}</span>
                <DollarSign className="w-6 h-6 opacity-50 text-gray-500" />
              </div>
              <input
                type="range"
                min="5000"
                max="500000"
                step="5000"
                value={budget}
                onChange={(e) => setBudget(Number(e.target.value))}
                className="w-full h-2 bg-dashboard-bg rounded-lg appearance-none cursor-pointer accent-brand-accent"
              />
              <div className="flex justify-between text-xs text-gray-500">
                <span>₹5,000</span>
                <span>₹5,00,000</span>
              </div>
              <p className="text-sm text-center text-brand-primary bg-brand-primary/10 py-1.5 rounded-full border border-brand-primary/20">
                {budgetLabel} planning mode
              </p>
              {travelers > 1 && (
                <p className="text-xs text-gray-400 text-center">
                  ≈ ₹{Math.round(budget / travelers).toLocaleString('en-IN')} per person
                </p>
              )}
            </div>
            <button
              onClick={() => setStep('energy')}
              className="w-full gradient-primary text-white font-bold py-3 rounded-xl hover:opacity-90 transition-all shadow-glow"
            >
              Set Budget <ArrowRight size={18} />
            </button>
          </div>
        );

      case 'energy':
        return (
          <div className="space-y-5">
            <div className="flex items-center gap-2">
              <button onClick={goBack} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"><ArrowLeft size={18} className="text-gray-400" /></button>
              <h2 className="text-2xl font-display font-bold">Arrival Energy</h2>
            </div>
            <p className="text-gray-400 text-sm">How energetic do you want your first day to be?</p>

            <div className="space-y-3">
              {[
                { type: 'Low' as ArrivalEnergy, icon: Moon, desc: 'Prefer rest and light walking', color: 'from-indigo-500/20' },
                { type: 'Normal' as ArrivalEnergy, icon: Smile, desc: 'Ready for standard sightseeing', color: 'from-green-500/20' },
                { type: 'Energetic' as ArrivalEnergy, icon: Flame, desc: 'Packed schedule from the start!', color: 'from-orange-500/20' },
              ].map((item) => (
                <button
                  key={item.type}
                  onClick={() => setArrivalEnergy(item.type)}
                  className={clsx(
                    'w-full p-4 rounded-xl border transition-all flex items-center gap-4 group',
                    arrivalEnergy === item.type
                      ? `bg-gradient-to-r ${item.color} to-transparent border-brand-primary`
                      : 'bg-dashboard-surface border-white/5 hover:border-white/20'
                  )}
                >
                  <div className={clsx(
                    'p-3 rounded-full',
                    arrivalEnergy === item.type ? 'bg-brand-primary text-white' : 'bg-white/5 text-gray-400 group-hover:text-white'
                  )}>
                    <item.icon size={20} />
                  </div>
                  <div className="text-left flex-1">
                    <h4 className="font-bold text-white">{item.type}</h4>
                    <p className="text-xs text-gray-400">{item.desc}</p>
                  </div>
                  {arrivalEnergy === item.type && <CheckCircle className="w-5 h-5 text-brand-accent" />}
                </button>
              ))}
            </div>

            <button
              onClick={() => setStep('transport')}
              disabled={!arrivalEnergy}
              className="w-full gradient-primary text-white font-bold py-3 rounded-xl disabled:opacity-30 disabled:cursor-not-allowed hover:opacity-90 transition-all mt-4 shadow-glow"
            >
              Continue <ArrowRight size={18} />
            </button>
          </div>
        );

      case 'transport':
        return (
          <div className="space-y-5">
            <div className="flex items-center gap-2">
              <button onClick={goBack} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"><ArrowLeft size={18} className="text-gray-400" /></button>
              <h2 className="text-2xl font-display font-bold">Transport Mode</h2>
            </div>
            <p className="text-gray-400 text-sm">
              Real-time pricing will be fetched to optimize your Day 1 schedule.
            </p>

            <div className="space-y-3">
              {[
                { type: 'Flight' as TransportMode, icon: Plane, desc: 'Fast arrival, search via Google Flights', color: 'from-blue-500/20' },
                { type: 'Train' as TransportMode, icon: Train, desc: 'Scenic journey, IRCTC pricing', color: 'from-green-500/20' },
                { type: 'Bus' as TransportMode, icon: Bus, desc: 'Budget-friendly, RedBus pricing', color: 'from-yellow-500/20' },
              ].map((item) => (
                <button
                  key={item.type}
                  onClick={() => setTransportMode(item.type)}
                  className={clsx(
                    'w-full p-4 rounded-xl border transition-all flex items-center gap-4 group',
                    transportMode === item.type
                      ? `bg-gradient-to-r ${item.color} to-transparent border-brand-primary`
                      : 'bg-dashboard-surface border-white/5 hover:border-white/20'
                  )}
                >
                  <div className={clsx(
                    'p-3 rounded-full',
                    transportMode === item.type ? 'bg-brand-primary text-white' : 'bg-white/5 text-gray-400 group-hover:text-white'
                  )}>
                    <item.icon size={20} />
                  </div>
                  <div className="text-left flex-1">
                    <h4 className="font-bold text-white">{item.type}</h4>
                    <p className="text-xs text-gray-400">{item.desc}</p>
                  </div>
                  {transportMode === item.type && <CheckCircle className="w-5 h-5 text-brand-accent" />}
                </button>
              ))}
            </div>

            <button
              onClick={() => setStep('review')}
              className="w-full gradient-primary text-white font-bold py-3 rounded-xl hover:opacity-90 transition-all flex items-center justify-center gap-2 shadow-glow"
            >
              Review Plan <ArrowRight size={18} />
            </button>
          </div>
        );

      case 'review':
        return (
          <div className="space-y-5">
            <div className="flex items-center gap-2">
              <button onClick={goBack} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"><ArrowLeft size={18} className="text-gray-400" /></button>
              <h2 className="text-2xl font-display font-bold">Review & Generate</h2>
            </div>

            <div className="glass-card rounded-xl p-4 space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-400">Route</span>
                <span className="text-sm text-white font-medium">{source} → {destination}</span>
              </div>
              <div className="border-t border-white/5" />
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-400">Dates</span>
                <span className="text-sm text-white font-medium">{startDate} to {endDate} ({tripDays}d)</span>
              </div>
              <div className="border-t border-white/5" />
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-400">Travelers</span>
                <span className="text-sm text-white font-medium">{travelers}</span>
              </div>
              <div className="border-t border-white/5" />
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-400">Style</span>
                <span className="text-sm text-white font-medium">{travelStyleMeta[travelStyle!]?.emoji} {travelStyle}</span>
              </div>
              <div className="border-t border-white/5" />
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-400">Budget</span>
                <span className="text-sm text-brand-accent font-bold">₹{budget.toLocaleString('en-IN')}</span>
              </div>
              <div className="border-t border-white/5" />
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-400">Energy</span>
                <span className="text-sm text-white font-medium">{arrivalEnergy}</span>
              </div>
              <div className="border-t border-white/5" />
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-400">Transport</span>
                <span className="text-sm text-white font-medium">{transportMode}</span>
              </div>
              <div className="border-t border-white/5" />
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-400">Meals</span>
                <span className="text-sm text-white font-medium">{mealPreference}</span>
              </div>
            </div>

            <div className="bg-brand-primary/10 border border-brand-primary/20 rounded-xl p-3 text-sm text-gray-300 flex items-start gap-2">
              <Activity className="w-4 h-4 text-brand-accent mt-0.5 shrink-0" />
              <span>
                AI will search real-time {transportMode.toLowerCase()} options, discover hotels & attractions, check weather,
                and generate an optimized {tripDays}-day itinerary.
              </span>
            </div>

            <button
              onClick={handleStartPlanning}
              className="w-full bg-gradient-to-r from-brand-primary via-purple-500 to-brand-accent text-white font-bold py-4 rounded-xl hover:shadow-glow transition-all flex items-center justify-center gap-2"
            >
              <Activity className="w-5 h-5" /> Generate Intelligent Plan
            </button>
          </div>
        );

      case 'generating':
        return (
          <div className="h-full flex flex-col justify-center items-center gap-6">
            <div className="relative w-20 h-20">
              <div className="absolute inset-0 border-4 border-brand-primary/20 rounded-full" />
              <div className="absolute inset-0 border-4 border-t-brand-accent border-r-transparent border-b-transparent border-l-transparent rounded-full animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center text-brand-accent">
                <Activity className="animate-pulse" size={28} />
              </div>
            </div>

            <div className="text-center">
              <h3 className="text-lg font-display font-bold text-white mb-1">Generating your plan</h3>
              <p className="text-sm text-gray-400">{source} → {destination}</p>
              {jobId && <p className="text-xs text-gray-600 font-mono mt-1">Job: {jobId}</p>}
            </div>

            <div className="w-full max-w-sm space-y-2 font-mono text-sm pl-6 border-l border-brand-primary/30 py-2">
              {[
                { label: 'Resolving destination...', delay: 0.3 },
                { label: transportMode === 'Flight' ? 'Searching flights...' : `Searching ${transportMode.toLowerCase()} options...`, delay: 1.2 },
                { label: 'Discovering hotels & attractions...', delay: 2.5 },
                { label: 'Fetching weather forecast...', delay: 3.5 },
                { label: 'AI generating itinerary...', delay: 5 },
              ].map((step, i) => (
                <motion.div key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: step.delay }} className="flex gap-2 items-center text-gray-400">
                  <Loader size={12} className="animate-spin text-brand-accent" />
                  {step.label}
                </motion.div>
              ))}
            </div>

            {jobError && (
              <div className="w-full bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm text-red-300 font-medium">Generation failed</p>
                  <p className="text-xs text-red-400/80 mt-0.5">{jobError}</p>
                  <button
                    onClick={() => { setJobError(null); setStep('review'); }}
                    className="text-xs text-brand-primary hover:underline mt-2 inline-block"
                  >
                    Go back and retry
                  </button>
                </div>
              </div>
            )}
          </div>
        );

      case 'itinerary':
        return (
          <div className="h-full flex flex-col justify-center items-center gap-6 text-center">
            <div className="w-16 h-16 rounded-full bg-status-success/20 flex items-center justify-center">
              <CheckCircle className="w-8 h-8 text-status-success" />
            </div>
            <h3 className="text-xl font-display font-bold text-white">Itinerary Generated!</h3>
            <p className="text-sm text-gray-400 max-w-sm">
              Your {tripDays}-day {destination} itinerary is ready. View it in the Trips page.
            </p>
            <button
              onClick={() => { onClose(); store.reset(); }}
              className="gradient-primary text-white font-bold py-3 px-8 rounded-xl hover:opacity-90 transition-all shadow-glow"
            >
              Close
            </button>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      className="fixed inset-y-0 right-0 w-[460px] glass-modal shadow-2xl z-50 flex flex-col"
    >
      <div className="flex items-center justify-between px-6 py-4 border-b border-brand-primary/10 bg-dashboard-surface/60 backdrop-blur-md shrink-0">
        <h3 className="text-lg font-display font-bold text-white flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-brand-accent shadow-glow-accent animate-pulse" />
          Planning Session
        </h3>
        <button onClick={onClose} className="hover:bg-brand-primary/15 p-2 rounded-full transition-colors text-gray-400 hover:text-white">
          <X size={18} />
        </button>
      </div>

      {renderStepIndicator()}

      <div className="flex-1 overflow-y-auto px-6 py-6 relative">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.15 }}
            className="h-full"
          >
            {renderCurrentStep()}
          </motion.div>
        </AnimatePresence>
      </div>

      {currentStep !== 'generating' && currentStep !== 'itinerary' && (
        <div className="px-6 py-3 border-t border-brand-primary/8 text-xs text-gray-500 text-center font-mono shrink-0">
          Powered by Travion AI Engine v2.5
        </div>
      )}
    </motion.div>
  );
};
