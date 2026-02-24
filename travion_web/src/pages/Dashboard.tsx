import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Plus, Map, Calendar, Compass, Activity, ArrowRight, Layers, Zap, CreditCard, MapPin } from 'lucide-react';
import { PlanningSessionPanel } from '../components/planning/PlanningSessionPanel';
import { AuthModal } from '../components/auth/AuthModal';
import { usePlanningStore } from '../store/planningStore';
import { useAuthStore } from '../store/authStore';
import { useTripStore } from '../store/tripStore';

function daysBetween(start: string, end: string) {
  return Math.max(1, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86400000) + 1);
}

export const Dashboard: React.FC = () => {
  const [isPlanningOpen, setIsPlanningOpen] = useState(false);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const { reset } = usePlanningStore();
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const { savedTrips } = useTripStore();

  // Compute live stats from saved trips
  const totalTrips = savedTrips.length;
  const travelDays = savedTrips.reduce((sum, t) => sum + daysBetween(t.startDate, t.endDate), 0);
  const destinations = new Set(savedTrips.map((t) => t.destination.split(',')[0].trim())).size;
  const experiences = savedTrips.reduce((sum, t) => sum + daysBetween(t.startDate, t.endDate) * 3, 0);

  const statsData = [
    { title: 'Total Trips',   icon: Map,      gradient: 'from-purple-500/20 to-indigo-500/10',  value: totalTrips },
    { title: 'Travel Days',   icon: Calendar, gradient: 'from-amber-500/20 to-orange-500/10',   value: travelDays },
    { title: 'Destinations',  icon: Compass,  gradient: 'from-emerald-500/20 to-teal-500/10',   value: destinations },
    { title: 'Experiences',   icon: Activity, gradient: 'from-rose-500/20 to-pink-500/10',      value: experiences },
  ];

  // Recent trips to display in Activity Feed (up to 3)
  const recentTrips = savedTrips.slice(0, 3);

  const handleStartPlanning = () => {
    if (!user) {
      setIsAuthOpen(true);
      return;
    }
    reset();
    setIsPlanningOpen(true);
  };

  const handleAuthSuccess = () => {
    setIsAuthOpen(false);
    reset();
    setIsPlanningOpen(true);
  };

  return (
    <div className="relative min-h-full">
      {/* Hero Section */}
      <section className="mb-10 relative">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col md:flex-row items-end justify-between gap-6"
        >
          <div>
            <h2 className="text-4xl font-display font-bold text-white mb-2 leading-tight">
              {user ? `Welcome back${(user as any).email ? ', ' + (user as any).email.split('@')[0] : ''}` : 'Plan Your Next'}<br />
              <span className="gradient-text">
                {user ? 'Ready to explore?' : 'Intelligent Journey'}
              </span>
            </h2>
            <p className="text-gray-400 max-w-md">
              Travion AI is ready to optimize your travel logistics, budget, and experiences.
            </p>
          </div>
          
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleStartPlanning}
            className="group flex items-center gap-3 gradient-primary hover:opacity-90 text-white px-8 py-4 rounded-xl font-bold shadow-glow transition-all border border-brand-primary/30"
          >
            <div className="bg-white/20 p-1 rounded-full group-hover:rotate-90 transition-transform">
              <Plus size={20} />
            </div>
            Start Planning Session
          </motion.button>
        </motion.div>
      </section>

      {/* Stats Grid */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-10">
        {statsData.map((stat) => (
          <motion.div
            key={stat.title}
            whileHover={{ y: -4 }}
            className="glass-card glass-card-hover p-5 rounded-2xl relative overflow-hidden group cursor-pointer"
            onClick={() => navigate('/trips')}
          >
            <div className={`absolute inset-0 bg-gradient-to-br ${stat.gradient} opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <stat.icon size={56} />
            </div>
            <div className="relative z-10">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-brand-primary/15 rounded-lg text-brand-primary">
                  <stat.icon size={18} />
                </div>
                <h3 className="text-gray-400 text-sm font-medium">{stat.title}</h3>
              </div>
              <span className="text-3xl font-display font-bold text-white tracking-tight">
                {stat.value}
              </span>
            </div>
          </motion.div>
        ))}
      </section>

      {/* Quick Actions */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-10">
        {[
          { icon: Layers, label: 'New Planning Session', desc: 'AI-powered trip creation', action: handleStartPlanning },
          { icon: Zap, label: 'View Updates', desc: 'Weather, prices & alerts', action: () => navigate('/updates') },
          { icon: CreditCard, label: 'Manage Subscription', desc: 'Upgrade for unlimited trips', action: () => navigate('/subscription') },
        ].map((item) => (
          <motion.button
            key={item.label}
            whileHover={{ y: -3 }}
            onClick={item.action}
            className="glass-card glass-card-hover p-5 rounded-xl flex items-center gap-4 text-left group transition-all"
          >
            <div className="p-3 rounded-xl bg-brand-primary/10 text-brand-primary group-hover:bg-brand-primary/20 group-hover:shadow-glow transition-all">
              <item.icon size={22} />
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="text-white font-bold text-sm">{item.label}</h4>
              <p className="text-xs text-gray-500">{item.desc}</p>
            </div>
            <ArrowRight className="w-4 h-4 text-gray-600 group-hover:text-brand-accent transition-colors" />
          </motion.button>
        ))}
      </section>

      {/* Activity Feed */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-display font-bold text-white">Recent Trips</h3>
            {recentTrips.length > 0 && (
              <button onClick={() => navigate('/trips')} className="text-xs text-brand-primary hover:text-brand-primary/80 transition-colors">
                View all →
              </button>
            )}
          </div>

          {recentTrips.length === 0 ? (
            <div className="glass-card p-8 rounded-xl flex flex-col items-center justify-center text-center">
              <Activity className="w-10 h-10 text-brand-primary/40 mb-3" />
              <h4 className="text-gray-300 font-bold mb-1">No trips yet</h4>
              <p className="text-sm text-gray-500 max-w-sm">Start a planning session to see live weather, price, and itinerary alerts here.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {recentTrips.map((trip) => (
                <motion.div
                  key={trip.jobId}
                  whileHover={{ x: 3 }}
                  onClick={() => navigate('/trips')}
                  className="glass-card rounded-xl overflow-hidden flex items-stretch cursor-pointer hover:border-brand-primary/20 border border-white/5 transition-all group"
                >
                  {/* Destination image */}
                  <div className="w-20 flex-shrink-0 relative overflow-hidden bg-brand-primary/10">
                    <img
                      src={`https://source.unsplash.com/80x80/?${encodeURIComponent(trip.destination)},travel,landmark`}
                      alt={trip.destination}
                      className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      loading="lazy"
                    />
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent to-[#0b0f1a]/40" />
                  </div>
                  <div className="flex items-center gap-3 px-4 py-3 flex-1 min-w-0">
                    <MapPin size={14} className="text-brand-primary flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-semibold text-sm truncate">{trip.destination}</p>
                      <p className="text-xs text-gray-500">{trip.startDate} · {daysBetween(trip.startDate, trip.endDate)} days · ₹{trip.budget.toLocaleString('en-IN')}</p>
                    </div>
                    <ArrowRight size={14} className="text-gray-600 group-hover:text-brand-primary transition-colors flex-shrink-0" />
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>

        <div className="glass-card rounded-2xl p-6 flex flex-col">
          <h3 className="text-sm font-display font-bold text-white mb-4">Destinations</h3>
          {recentTrips.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center flex-1">
              <Compass className="w-10 h-10 text-brand-primary/40 mb-3" />
              <h4 className="text-gray-300 font-bold mb-1">Your trips will appear here</h4>
              <p className="text-sm text-gray-500">Plan your first journey to get personalized insights.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {savedTrips.slice(0, 4).map((trip) => (
                <div key={trip.jobId} className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl overflow-hidden bg-brand-primary/10 flex-shrink-0">
                    <img
                      src={`https://source.unsplash.com/40x40/?${encodeURIComponent(trip.destination)},city`}
                      alt={trip.destination}
                      className="w-full h-full object-cover"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      loading="lazy"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium truncate">{trip.destination}</p>
                    <p className="text-xs text-gray-600">{trip.travelStyle} · {trip.travelers} pax</p>
                  </div>
                </div>
              ))}
              {savedTrips.length > 4 && (
                <button onClick={() => navigate('/trips')} className="text-xs text-brand-primary hover:text-brand-primary/80 transition-colors">
                  +{savedTrips.length - 4} more trips →
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Side Slide-in Panel */}
      <AnimatePresence>
        {isPlanningOpen && (
           <div className="fixed inset-0 z-50 flex justify-end">
              <motion.div 
                 initial={{ opacity: 0 }} 
                 animate={{ opacity: 1 }} 
                 exit={{ opacity: 0 }} 
                 onClick={() => setIsPlanningOpen(false)}
                 className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              />
              <PlanningSessionPanel onClose={() => setIsPlanningOpen(false)} />
           </div>
        )}
      </AnimatePresence>

      {/* Auth Modal */}
      <AuthModal
        isOpen={isAuthOpen}
        onClose={() => setIsAuthOpen(false)}
        onSuccess={handleAuthSuccess}
      />
    </div>
  );
};
