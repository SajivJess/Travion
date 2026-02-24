import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, Bell, CloudRain, TrendingUp, AlertTriangle, MapPin, RefreshCw, Thermometer, Wind, Eye, Droplets } from 'lucide-react';
import { useTripStore, type SavedTrip } from '../store/tripStore';
import { useNavigate } from 'react-router-dom';

// ─── Types ────────────────────────────────────────────────────────────────────

interface WeatherInfo {
  temp: number;
  windspeed: number;
  weathercode: number;
  humidity: number;
  visibility: number;
}

interface TripWeather {
  jobId: string;
  destination: string;
  weather: WeatherInfo | null;
  loading: boolean;
  error: boolean;
}

// ─── WMO Weather Code → label + emoji ────────────────────────────────────────

function weatherLabel(code: number): { text: string; emoji: string } {
  if (code === 0) return { text: 'Clear sky', emoji: '☀️' };
  if (code <= 2) return { text: 'Partly cloudy', emoji: '⛅' };
  if (code === 3) return { text: 'Overcast', emoji: '☁️' };
  if (code <= 49) return { text: 'Foggy', emoji: '🌫️' };
  if (code <= 59) return { text: 'Drizzle', emoji: '🌦️' };
  if (code <= 69) return { text: 'Rain', emoji: '🌧️' };
  if (code <= 79) return { text: 'Snow', emoji: '❄️' };
  if (code <= 82) return { text: 'Rain showers', emoji: '🌧️' };
  if (code <= 84) return { text: 'Snow showers', emoji: '🌨️' };
  if (code <= 94) return { text: 'Thunderstorm', emoji: '⛈️' };
  return { text: 'Storm', emoji: '🌩️' };
}

function isAlertWeather(code: number): boolean {
  return code >= 61 || (code >= 45 && code <= 49);
}

// Geocode destination to lat/lon via Open-Meteo geocoding API
async function geocodeDestination(destination: string): Promise<{ lat: number; lon: number } | null> {
  try {
    const city = destination.split(',')[0].trim();
    const res = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (data.results?.length) {
      return { lat: data.results[0].latitude, lon: data.results[0].longitude };
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchWeather(lat: number, lon: number): Promise<WeatherInfo | null> {
  try {
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&hourly=relativehumidity_2m,visibility&forecast_days=1&timezone=auto`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const cw = data.current_weather;
    const humidity = data.hourly?.relativehumidity_2m?.[0] ?? 0;
    const visibility = data.hourly?.visibility?.[0] ?? 10000;
    return {
      temp: Math.round(cw.temperature),
      windspeed: Math.round(cw.windspeed),
      weathercode: cw.weathercode,
      humidity,
      visibility: Math.round(visibility / 1000),
    };
  } catch {
    return null;
  }
}

// ─── Weather Card ─────────────────────────────────────────────────────────────

const WeatherCard: React.FC<{ tw: TripWeather; trip: SavedTrip }> = ({ tw, trip }) => {
  const navigate = useNavigate();

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card rounded-2xl p-5 flex flex-col gap-3"
    >
      <div className="flex items-start justify-between">
        <div>
          <h4 className="text-white font-semibold text-sm flex items-center gap-1.5">
            <MapPin size={13} className="text-brand-primary" />
            {trip.destination}
          </h4>
          <p className="text-xs text-gray-500 mt-0.5">{trip.startDate} → {trip.endDate}</p>
        </div>
        {tw.loading ? (
          <div className="w-8 h-8 rounded-lg bg-white/5 animate-pulse" />
        ) : tw.weather ? (
          <span className="text-2xl">{weatherLabel(tw.weather.weathercode).emoji}</span>
        ) : (
          <span className="text-gray-600 text-xs">N/A</span>
        )}
      </div>

      {tw.loading && (
        <div className="h-4 bg-white/5 rounded animate-pulse w-3/4" />
      )}

      {!tw.loading && tw.weather && (
        <>
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-1.5 text-sm">
              <Thermometer size={14} className="text-orange-400" />
              <span className="text-white font-semibold">{tw.weather.temp}°C</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-gray-400">
              <Wind size={12} className="text-blue-400" />
              {tw.weather.windspeed} km/h
            </div>
            <div className="flex items-center gap-1.5 text-xs text-gray-400">
              <Droplets size={12} className="text-cyan-400" />
              {tw.weather.humidity}%
            </div>
            <div className="flex items-center gap-1.5 text-xs text-gray-400">
              <Eye size={12} className="text-purple-400" />
              {tw.weather.visibility} km
            </div>
          </div>
          <p className="text-xs text-gray-400">{weatherLabel(tw.weather.weathercode).text}</p>
          {isAlertWeather(tw.weather.weathercode) && (
            <div className="flex items-center gap-2 text-xs text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 px-3 py-1.5 rounded-lg">
              <AlertTriangle size={12} />
              Adverse weather — check before travel
            </div>
          )}
        </>
      )}

      {!tw.loading && tw.error && (
        <p className="text-xs text-gray-600">Could not load weather data</p>
      )}

      <button
        onClick={() => navigate('/trips')}
        className="mt-1 text-xs text-brand-primary hover:text-white transition-colors self-start"
      >
        View trip →
      </button>
    </motion.div>
  );
};

// ─── Main Page ────────────────────────────────────────────────────────────────

export const Updates: React.FC = () => {
  const { savedTrips } = useTripStore();
  const [tripWeathers, setTripWeathers] = useState<TripWeather[]>([]);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [refreshing, setRefreshing] = useState(false);

  const loadWeather = async (trips: SavedTrip[]) => {
    if (trips.length === 0) { setTripWeathers([]); return; }
    // Initialise loading state
    setTripWeathers(trips.map((t) => ({ jobId: t.jobId, destination: t.destination, weather: null, loading: true, error: false })));
    // Fetch in parallel
    const results = await Promise.all(
      trips.map(async (t) => {
        const coords = await geocodeDestination(t.destination);
        if (!coords) return { jobId: t.jobId, destination: t.destination, weather: null, loading: false, error: true };
        const weather = await fetchWeather(coords.lat, coords.lon);
        return { jobId: t.jobId, destination: t.destination, weather, loading: false, error: !weather };
      })
    );
    setTripWeathers(results);
    setLastRefresh(new Date());
  };

  useEffect(() => {
    loadWeather(savedTrips);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedTrips.length]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadWeather(savedTrips);
    setRefreshing(false);
  };

  // Derived counts
  const weatherAlerts = tripWeathers.filter((tw) => tw.weather && isAlertWeather(tw.weather.weathercode)).length;
  const hasData = savedTrips.length > 0;

  return (
    <div className="relative min-h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-3xl font-display font-bold text-white">Updates</h2>
          <p className="text-gray-400 mt-1">Real-time alerts for your active trips</p>
        </div>
        {hasData && (
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-2 text-xs text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-2 rounded-lg transition-all disabled:opacity-50"
          >
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
        )}
      </div>

      {/* Category Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {[
          { icon: CloudRain, label: 'Weather', count: hasData ? tripWeathers.filter((tw) => tw.weather !== null).length : 0, color: 'text-blue-400' },
          { icon: TrendingUp, label: 'Price Drops', count: 0, color: 'text-green-400' },
          { icon: AlertTriangle, label: 'Alerts', count: weatherAlerts, color: 'text-yellow-400' },
        ].map((cat) => (
          <div key={cat.label} className="glass-card glass-card-hover p-4 rounded-xl flex items-center gap-3">
            <div className="p-2 rounded-lg bg-white/5">
              <cat.icon className={`w-5 h-5 ${cat.color}`} />
            </div>
            <div className="flex-1">
              <span className="text-sm text-gray-300 font-medium">{cat.label}</span>
            </div>
            <span className={`text-xs bg-brand-primary/10 px-2 py-1 rounded-full ${cat.count > 0 ? 'text-white' : 'text-gray-500'}`}>
              {cat.count}
            </span>
          </div>
        ))}
      </div>

      {/* Last refreshed */}
      {hasData && (
        <p className="text-xs text-gray-600 mb-4">
          Last updated: {lastRefresh.toLocaleTimeString()}
        </p>
      )}

      {/* Trip Weather Cards */}
      {hasData ? (
        <div>
          <h3 className="text-sm font-semibold text-gray-400 mb-4 uppercase tracking-widest">Destination Weather</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <AnimatePresence>
              {tripWeathers.map((tw) => {
                const trip = savedTrips.find((t) => t.jobId === tw.jobId);
                if (!trip) return null;
                return <WeatherCard key={tw.jobId} tw={tw} trip={trip} />;
              })}
            </AnimatePresence>
          </div>
        </div>
      ) : (
        /* Empty State */
        <div className="flex flex-col items-center justify-center py-20">
          <div className="glass-card p-8 rounded-2xl max-w-md w-full text-center">
            <div className="w-16 h-16 rounded-2xl bg-brand-primary/15 flex items-center justify-center mx-auto mb-6">
              <Zap className="w-8 h-8 text-brand-accent" />
            </div>
            <h3 className="text-xl font-display font-bold text-white mb-2">No updates yet</h3>
            <p className="text-gray-400 text-sm mb-4">
              Once you have active trips, you will receive real-time notifications here:
            </p>
            <div className="space-y-2 text-left text-sm text-gray-400">
              <div className="flex items-center gap-2">
                <Bell className="w-4 h-4 text-gray-500" /> Weather changes at your destination
              </div>
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-gray-500" /> Flight &amp; hotel price drops
              </div>
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-gray-500" /> Crowd &amp; safety alerts
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
