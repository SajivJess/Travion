import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Layers, Clock, MapPin, ArrowRight } from 'lucide-react';
import { PlanningSessionPanel } from '../components/planning/PlanningSessionPanel';
import { usePlanningStore } from '../store/planningStore';

export const Planning: React.FC = () => {
  const [isPlanningOpen, setIsPlanningOpen] = useState(false);
  const { currentStep, reset } = usePlanningStore();

  const handleNewSession = () => {
    reset();
    setIsPlanningOpen(true);
  };

  return (
    <div className="relative min-h-full">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-3xl font-display font-bold text-white">Planning Sessions</h2>
          <p className="text-gray-400 mt-1">Create and manage your trip planning sessions</p>
        </div>
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={handleNewSession}
          className="flex items-center gap-2 gradient-primary hover:opacity-90 text-white px-6 py-3 rounded-xl font-bold shadow-glow transition-all"
        >
          <Plus size={18} />
          New Session
        </motion.button>
      </div>

      {/* Empty State */}
      <div className="flex flex-col items-center justify-center py-24">
        <div className="glass-card p-8 rounded-2xl max-w-md w-full text-center">
          <div className="w-16 h-16 rounded-2xl bg-brand-primary/15 flex items-center justify-center mx-auto mb-6">
            <Layers className="w-8 h-8 text-brand-primary" />
          </div>
          <h3 className="text-xl font-display font-bold text-white mb-2">No planning sessions yet</h3>
          <p className="text-gray-400 text-sm mb-6">
            Start a new planning session to begin creating your AI-powered travel itinerary.
          </p>

          <div className="space-y-3 text-left mb-8">
            {[
              { icon: MapPin, text: 'Choose source & destination cities' },
              { icon: Clock, text: 'Select travel dates and preferences' },
              { icon: ArrowRight, text: 'AI generates your optimized itinerary' },
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-3 text-sm text-gray-300">
                <div className="p-1.5 rounded-lg bg-white/5">
                  <item.icon className="w-4 h-4 text-brand-accent" />
                </div>
                {item.text}
              </div>
            ))}
          </div>

          <button
            onClick={handleNewSession}
            className="w-full gradient-primary text-white font-bold py-3 rounded-xl hover:opacity-90 transition-all flex items-center justify-center gap-2 shadow-glow"
          >
            <Plus size={18} /> Start Planning
          </button>
        </div>
      </div>

      {/* Side Slide-in Panel */}
      <AnimatePresence>
        {(isPlanningOpen || currentStep === 'generating') && (
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
    </div>
  );
};
