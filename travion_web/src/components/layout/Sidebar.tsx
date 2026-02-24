import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Map, Settings, Layers, Zap, CreditCard, ChevronLeft, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import clsx from 'clsx';

const menuItems = [
  { icon: LayoutDashboard, label: 'Dashboard', path: '/' },
  { icon: Layers, label: 'Planning Sessions', path: '/planning' },
  { icon: Map, label: 'Trips', path: '/trips' },
  { icon: Zap, label: 'Updates', path: '/updates' },
  { icon: CreditCard, label: 'Subscription', path: '/subscription' },
  { icon: Settings, label: 'Settings', path: '/settings' },
];

export const Sidebar: React.FC = () => {
  const [collapsed, setCollapsed] = useState(true);

  return (
    <motion.div 
      animate={{ width: collapsed ? 80 : 260 }}
      className="h-screen bg-dashboard-bg border-r border-brand-primary/10 flex flex-col py-5 z-50 transition-all duration-300 ease-in-out overflow-hidden flex-shrink-0"
    >
      {/* Logo area */}
      <div className="flex items-center px-4 mb-8 min-h-[44px]">
        <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center shadow-glow flex-shrink-0">
          <Map className="text-white w-5 h-5" />
        </div>
        
        <AnimatePresence>
          {!collapsed && (
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              className="ml-3 flex items-center gap-2 overflow-hidden"
            >
              <span className="font-display font-bold text-lg text-white tracking-wider whitespace-nowrap">
                TRAVION
              </span>
              <span className="text-[10px] text-brand-accent bg-brand-accent/10 border border-brand-accent/20 px-1.5 py-0.5 rounded-full uppercase tracking-widest whitespace-nowrap">
                AI Agent
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Collapse toggle */}
      <div className="px-4 mb-4">
        <button 
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center justify-center p-1.5 rounded-lg bg-dashboard-surface/50 border border-brand-primary/10 text-white/40 hover:text-white hover:bg-brand-primary/15 transition-colors"
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>

      <nav className="flex-1 px-4 space-y-1">
        {menuItems.map((item) => (
          <NavLink
            key={item.label}
            to={item.path}
            className={({ isActive }) => clsx(
              "flex items-center p-3 rounded-xl cursor-pointer group transition-all duration-200",
              isActive 
                ? "bg-brand-primary/15 border border-brand-primary/25 text-white shadow-glow" 
                : "hover:bg-brand-primary/8 border border-transparent text-gray-400 hover:text-gray-200"
            )}
          >
            <item.icon className={clsx("w-5 h-5 transition-colors", "group-hover:text-brand-primary")} />
            
            <AnimatePresence>
              {!collapsed && (
                <motion.span
                  initial={{ opacity: 0, width: 0 }}
                  animate={{ opacity: 1, width: 'auto' }}
                  exit={{ opacity: 0, width: 0 }}
                  className="ml-3 text-sm font-medium whitespace-nowrap overflow-hidden"
                >
                  {item.label}
                </motion.span>
              )}
            </AnimatePresence>

            {collapsed && (
              <div className="absolute left-20 bg-dashboard-surface px-2 py-1 rounded-md text-xs text-white opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none border border-brand-primary/15 whitespace-nowrap z-50">
                {item.label}
              </div>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="px-4">
        <div className={clsx(
          "bg-gradient-to-br from-brand-primary/20 to-brand-accent/10 border border-brand-primary/15 rounded-2xl p-4 relative overflow-hidden group",
          collapsed ? "items-center flex flex-col" : ""
        )}>
          <div className="absolute inset-0 bg-brand-primary/5 blur-xl group-hover:bg-brand-primary/10 transition-all" />
          <Zap className="w-5 h-5 text-brand-accent mb-2 relative z-10" />
          {!collapsed && (
            <div className="relative z-10">
              <h4 className="text-white text-sm font-bold">Pro Plan</h4>
              <p className="text-xs text-gray-400 mt-1">Unlock AI Limits</p>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
};
