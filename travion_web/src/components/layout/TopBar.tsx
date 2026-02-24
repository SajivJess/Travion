import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Bell, Search, User, LogOut, ChevronDown } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';

const routeTitles: Record<string, string> = {
  '/': 'Dashboard',
  '/planning': 'Planning Sessions',
  '/trips': 'My Trips',
  '/updates': 'Updates',
  '/subscription': 'Subscription',
  '/settings': 'Settings',
};

export const TopBar: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const pageTitle = routeTitles[location.pathname] || 'Travion';
  const { user, signOut } = useAuthStore();
  const [showUserMenu, setShowUserMenu] = useState(false);

  const displayName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'User';
  const avatarUrl = user?.user_metadata?.avatar_url as string | undefined;

  return (
    <header className="sticky top-0 h-16 bg-dashboard-bg/95 backdrop-blur-md border-b border-brand-primary/10 flex items-center justify-between px-6 z-30 flex-shrink-0">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-display font-bold text-white tracking-wide">
          {pageTitle}
        </h1>
      </div>

      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate('/updates')}
          className="relative p-2 rounded-lg hover:bg-brand-primary/10 transition-colors group"
          title="Search"
        >
          <Search className="w-5 h-5 text-gray-400 group-hover:text-brand-primary transition-colors" />
        </button>

        <button
          onClick={() => navigate('/updates')}
          className="relative p-2 rounded-lg hover:bg-brand-primary/10 transition-colors group"
          title="Notifications"
        >
          <Bell className="w-5 h-5 text-gray-400 group-hover:text-brand-accent transition-colors" />
        </button>

        {/* User menu */}
        <div className="relative">
          <button
            onClick={() => user ? setShowUserMenu(!showUserMenu) : navigate('/settings')}
            className="flex items-center gap-2.5 pl-4 border-l border-brand-primary/10 hover:bg-brand-primary/10 p-1.5 rounded-lg transition-colors"
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="w-8 h-8 rounded-full border border-brand-primary/20" />
            ) : (
              <div className="w-8 h-8 rounded-full border border-brand-primary/20 bg-gradient-to-br from-brand-primary/20 to-brand-accent/10 flex items-center justify-center">
                <User className="w-4 h-4 text-gray-300" />
              </div>
            )}
            {user && (
              <>
                <span className="text-sm text-gray-300 font-medium hidden md:block max-w-[120px] truncate">
                  {displayName}
                </span>
                <ChevronDown size={14} className="text-gray-500" />
              </>
            )}
          </button>

          {/* Dropdown */}
          {showUserMenu && user && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowUserMenu(false)} />
              <div className="absolute right-0 top-12 w-52 glass-card rounded-xl py-2 z-50 shadow-xl">
                <div className="px-4 py-2 border-b border-white/5">
                  <p className="text-sm text-white font-medium truncate">{displayName}</p>
                  <p className="text-xs text-gray-500 truncate">{user.email}</p>
                </div>
                <button
                  onClick={() => { setShowUserMenu(false); navigate('/settings'); }}
                  className="w-full text-left px-4 py-2.5 text-sm text-gray-300 hover:text-white hover:bg-white/5 transition-colors flex items-center gap-2.5"
                >
                  <User size={14} /> Profile & Settings
                </button>
                <button
                  onClick={async () => { setShowUserMenu(false); await signOut(); }}
                  className="w-full text-left px-4 py-2.5 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/5 transition-colors flex items-center gap-2.5"
                >
                  <LogOut size={14} /> Sign Out
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
};
