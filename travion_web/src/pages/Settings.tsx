import React, { useState } from 'react';
import { Settings as SettingsIcon, Globe, Bell, Shield, Palette, Save } from 'lucide-react';

export const Settings: React.FC = () => {
  const [backendUrl, setBackendUrl] = useState('http://localhost:3000');
  const [notifications, setNotifications] = useState({
    weather: true,
    priceDrops: true,
    crowdAlerts: false,
  });
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    localStorage.setItem('travion_backend_url', backendUrl);
    localStorage.setItem('travion_notifications', JSON.stringify(notifications));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="relative min-h-full max-w-2xl">
      <div className="mb-8">
        <h2 className="text-3xl font-display font-bold text-white">Settings</h2>
        <p className="text-gray-400 mt-1">Configure your Travion experience</p>
      </div>

      <div className="space-y-6">
        {/* Connection Settings */}
        <div className="glass-card rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <Globe className="w-5 h-5 text-brand-primary" />
            <h3 className="text-lg font-display font-bold text-white">Connection</h3>
          </div>
          <div>
            <label className="text-sm text-gray-400 mb-2 block">Backend API URL</label>
            <input
              type="text"
              value={backendUrl}
              onChange={(e) => setBackendUrl(e.target.value)}
              className="w-full bg-dashboard-surface border border-brand-primary/10 rounded-xl p-3 text-white text-sm focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20 outline-none transition-all"
            />
            <p className="text-xs text-gray-500 mt-1">The URL where your Travion backend is running</p>
          </div>
        </div>

        {/* Notification Settings */}
        <div className="glass-card rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <Bell className="w-5 h-5 text-brand-primary" />
            <h3 className="text-lg font-display font-bold text-white">Notifications</h3>
          </div>
          <div className="space-y-3">
            {[
              { key: 'weather' as const, label: 'Weather Alerts', desc: 'Get notified about weather changes at your destination' },
              { key: 'priceDrops' as const, label: 'Price Drop Alerts', desc: 'Receive alerts when flight or hotel prices drop' },
              { key: 'crowdAlerts' as const, label: 'Crowd Alerts', desc: 'Alerts about crowded attractions or events' },
            ].map((setting) => (
              <div key={setting.key} className="flex items-center justify-between p-3 rounded-xl hover:bg-white/5 transition-colors">
                <div>
                  <p className="text-sm text-white font-medium">{setting.label}</p>
                  <p className="text-xs text-gray-500">{setting.desc}</p>
                </div>
                <button
                  onClick={() => setNotifications(prev => ({ ...prev, [setting.key]: !prev[setting.key] }))}
                  className={`w-11 h-6 rounded-full transition-colors relative ${
                    notifications[setting.key] ? 'bg-brand-primary' : 'bg-white/10'
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded-full bg-white absolute top-0.5 transition-all ${
                      notifications[setting.key] ? 'left-5.5' : 'left-0.5'
                    }`}
                    style={{ left: notifications[setting.key] ? '22px' : '2px' }}
                  />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Appearance */}
        <div className="glass-card rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <Palette className="w-5 h-5 text-brand-primary" />
            <h3 className="text-lg font-display font-bold text-white">Appearance</h3>
          </div>
          <div className="flex items-center justify-between p-3 rounded-xl">
            <div>
              <p className="text-sm text-white font-medium">Theme</p>
              <p className="text-xs text-gray-500">Currently using dark theme</p>
            </div>
            <span className="text-xs text-gray-500 bg-white/5 px-3 py-1 rounded-full">Dark (Default)</span>
          </div>
        </div>

        {/* Privacy */}
        <div className="glass-card rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <Shield className="w-5 h-5 text-brand-primary" />
            <h3 className="text-lg font-display font-bold text-white">Privacy & Data</h3>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 rounded-xl">
              <div>
                <p className="text-sm text-white font-medium">Trip data storage</p>
                <p className="text-xs text-gray-500">Trip data is stored locally via Redis cache</p>
              </div>
              <span className="text-xs text-brand-accent bg-brand-accent/10 px-3 py-1 rounded-full">Local</span>
            </div>
          </div>
        </div>

        {/* About */}
        <div className="glass-card rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <SettingsIcon className="w-5 h-5 text-brand-primary" />
            <h3 className="text-lg font-display font-bold text-white">About</h3>
          </div>
          <div className="space-y-1 text-sm text-gray-400">
            <p>Travion AI Travel Planner <span className="text-brand-accent">v2.5</span></p>
            <p>Powered by Google Gemini 2.5 Flash</p>
            <p>Transport data via SerpAPI</p>
          </div>
        </div>

        {/* Save Button */}
        <button
          onClick={handleSave}
          className={`w-full py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 ${
            saved
              ? 'bg-status-success/20 text-status-success border border-status-success/30'
              : 'gradient-primary text-white hover:opacity-90 shadow-glow'
          }`}
        >
          <Save className="w-4 h-4" />
          {saved ? 'Settings Saved!' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
};
