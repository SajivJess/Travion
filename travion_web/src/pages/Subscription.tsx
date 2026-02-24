import React from 'react';
import { CreditCard, Check, Zap } from 'lucide-react';
import { motion } from 'framer-motion';

const plans = [
  {
    name: 'Free',
    price: '₹0',
    period: 'forever',
    features: ['3 trips per month', 'Basic AI itinerary', 'Standard discovery', 'Email support'],
    current: true,
  },
  {
    name: 'Pro',
    price: '₹499',
    period: '/month',
    features: ['Unlimited trips', 'Advanced AI optimization', 'Real-time monitoring', 'Priority support', 'Budget AI analysis', 'Crowd prediction'],
    current: false,
    popular: true,
  },
  {
    name: 'Team',
    price: '₹1,499',
    period: '/month',
    features: ['Everything in Pro', 'Team collaboration', 'Shared itineraries', 'Admin dashboard', 'API access', 'Custom branding'],
    current: false,
  },
];

export const Subscription: React.FC = () => {
  return (
    <div className="relative min-h-full">
      <div className="mb-8">
        <h2 className="text-3xl font-display font-bold text-white">Subscription</h2>
        <p className="text-gray-400 mt-1">Manage your plan and billing</p>
      </div>

      {/* Current Plan Card */}
      <div className="glass-card p-6 rounded-2xl mb-8 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-xl bg-brand-primary/15">
            <CreditCard className="w-6 h-6 text-brand-primary" />
          </div>
          <div>
            <h3 className="text-white font-bold">Current Plan: Free</h3>
            <p className="text-sm text-gray-400">3 trips remaining this month</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-24 h-2 bg-white/5 rounded-full overflow-hidden">
            <div className="w-0 h-full bg-brand-primary rounded-full" />
          </div>
          <span className="text-xs text-gray-500">0/3 used</span>
        </div>
      </div>

      {/* Plans Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {plans.map((plan) => (
          <motion.div
            key={plan.name}
            whileHover={{ y: -5 }}
            className={`glass-card rounded-2xl p-6 relative ${
              plan.popular ? 'border-brand-primary/40 ring-1 ring-brand-primary/20 shadow-glow' : ''
            }`}
          >
            {plan.popular && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 gradient-accent text-white text-xs font-bold px-3 py-1 rounded-full flex items-center gap-1 shadow-glow-accent">
                <Zap className="w-3 h-3" /> Most Popular
              </div>
            )}

            <h3 className="text-xl font-display font-bold text-white mb-1">{plan.name}</h3>
            <div className="flex items-baseline gap-1 mb-4">
              <span className="text-3xl font-bold text-white">{plan.price}</span>
              <span className="text-sm text-gray-400">{plan.period}</span>
            </div>

            <ul className="space-y-2 mb-6">
              {plan.features.map((feature) => (
                <li key={feature} className="flex items-center gap-2 text-sm text-gray-300">
                  <Check className="w-4 h-4 text-brand-accent shrink-0" />
                  {feature}
                </li>
              ))}
            </ul>

            <button
              className={`w-full py-3 rounded-xl font-bold transition-all ${
                plan.current
                  ? 'bg-white/5 text-gray-400 border border-white/10 cursor-default'
                  : 'gradient-primary text-white hover:opacity-90 shadow-glow'
              }`}
              disabled={plan.current}
            >
              {plan.current ? 'Current Plan' : 'Upgrade'}
            </button>
          </motion.div>
        ))}
      </div>
    </div>
  );
};
