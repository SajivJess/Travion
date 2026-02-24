import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Heart, MessageCircle, Play, ExternalLink, RefreshCw, Instagram } from 'lucide-react';

const BACKEND_URL = 'http://localhost:3000';

// ─── Types ────────────────────────────────────────────────────────────────────

interface InstagramPost {
  id: string;
  shortCode: string;
  url: string;
  displayUrl: string;
  videoUrl?: string | null;
  caption: string;
  likesCount: number;
  commentsCount: number;
  timestamp: string;
  isVideo: boolean;
}

interface SocialFeedResult {
  posts: InstagramPost[];
  crowdScore: number;
  crowdLabel: string;
  hashtags: string[];
  cachedAt: string;
  fromCache: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3_600_000);
  const d = Math.floor(h / 24);
  if (d > 30) return `${Math.floor(d / 30)}mo ago`;
  if (d > 0)  return `${d}d ago`;
  if (h > 0)  return `${h}h ago`;
  return 'just now';
}

function truncate(text: string, max = 80): string {
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

const SCORE_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  'Very Busy':  { bg: 'bg-red-500/20',    text: 'text-red-400',    dot: 'bg-red-400'    },
  'Busy':       { bg: 'bg-orange-500/20', text: 'text-orange-400', dot: 'bg-orange-400' },
  'Moderate':   { bg: 'bg-yellow-500/20', text: 'text-yellow-400', dot: 'bg-yellow-400' },
  'Quiet':      { bg: 'bg-emerald-500/20',text: 'text-emerald-400',dot: 'bg-emerald-400'},
  'Very Quiet': { bg: 'bg-blue-500/20',   text: 'text-blue-400',   dot: 'bg-blue-400'   },
  'No Data':    { bg: 'bg-white/5',        text: 'text-gray-500',   dot: 'bg-gray-500'   },
};

// ─── Score Badge ──────────────────────────────────────────────────────────────

const CrowdScoreBadge: React.FC<{ score: number; label: string }> = ({ score, label }) => {
  const c = SCORE_COLORS[label] || SCORE_COLORS['No Data'];
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl ${c.bg}`}>
      <span className={`w-2 h-2 rounded-full ${c.dot} animate-pulse`} />
      <div className="flex items-baseline gap-1.5">
        <span className={`text-base font-bold ${c.text}`}>{score}</span>
        <span className={`text-xs font-semibold ${c.text}`}>{label}</span>
      </div>
      {/* Mini gauge */}
      <div className="h-1.5 w-20 bg-white/10 rounded-full overflow-hidden ml-1">
        <div
          className={`h-full rounded-full transition-all duration-700 ${c.dot}`}
          style={{ width: `${score}%` }}
        />
      </div>
    </div>
  );
};

// ─── Reel Card ────────────────────────────────────────────────────────────────

const ReelCard: React.FC<{ post: InstagramPost; index: number }> = ({ post, index }) => (
  <motion.a
    href={post.url}
    target="_blank"
    rel="noopener noreferrer"
    initial={{ opacity: 0, y: 12 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay: index * 0.04 }}
    className="group block rounded-xl overflow-hidden bg-white/5 border border-white/8 hover:border-brand-primary/30 hover:bg-white/8 transition-all cursor-pointer"
  >
    {/* Thumbnail */}
    <div className="relative aspect-square bg-white/5 overflow-hidden">
      {post.displayUrl ? (
        <img
          src={post.displayUrl}
          alt={post.caption || 'Instagram post'}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          loading="lazy"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <Instagram size={24} className="text-gray-600" />
        </div>
      )}

      {/* Video badge */}
      {post.isVideo && (
        <div className="absolute top-2 right-2 p-1 rounded-full bg-black/60">
          <Play size={10} className="text-white fill-white" />
        </div>
      )}

      {/* Open icon on hover */}
      <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
        <ExternalLink size={18} className="text-white" />
      </div>
    </div>

    {/* Meta */}
    <div className="p-2.5">
      {post.caption && (
        <p className="text-xs text-gray-400 leading-relaxed mb-1.5">
          {truncate(post.caption)}
        </p>
      )}
      <div className="flex items-center justify-between text-xs text-gray-600">
        <div className="flex items-center gap-2.5">
          <span className="flex items-center gap-0.5">
            <Heart size={10} className="text-pink-500/70" />
            {post.likesCount > 0 ? post.likesCount.toLocaleString('en-IN') : '—'}
          </span>
          {post.commentsCount > 0 && (
            <span className="flex items-center gap-0.5">
              <MessageCircle size={10} />
              {post.commentsCount.toLocaleString('en-IN')}
            </span>
          )}
        </div>
        <span>{timeAgo(post.timestamp)}</span>
      </div>
    </div>
  </motion.a>
);

// ─── Skeleton ─────────────────────────────────────────────────────────────────

const SkeletonCard = () => (
  <div className="rounded-xl overflow-hidden bg-white/5 border border-white/5 animate-pulse">
    <div className="aspect-square bg-white/8" />
    <div className="p-2.5 space-y-1.5">
      <div className="h-2.5 bg-white/8 rounded w-5/6" />
      <div className="h-2 bg-white/5 rounded w-3/4" />
    </div>
  </div>
);

// ─── Main Component ───────────────────────────────────────────────────────────

interface LiveDestinationFeedProps {
  destination: string;
  token?: string;
  /** Optional POI names to enrich hashtag set */
  pois?: string[];
}

const LiveDestinationFeed: React.FC<LiveDestinationFeedProps> = ({
  destination,
  token,
  pois = [],
}) => {
  const [feed, setFeed] = useState<SocialFeedResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchFeed = async () => {
    if (!destination) return;
    setLoading(true);
    setError(null);
    try {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const poisParam = pois.slice(0, 5).join(',');
      const url =
        `${BACKEND_URL}/api/itinerary/social-feed/` +
        `${encodeURIComponent(destination)}` +
        (poisParam ? `?pois=${encodeURIComponent(poisParam)}` : '');

      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: SocialFeedResult = await res.json();
      setFeed(data);
    } catch (e: any) {
      setError(e.message || 'Failed to load feed');
    } finally {
      setLoading(false);
    }
  };

  // Fetch on mount (lazy — user has to be on the Vibe tab to trigger)
  useEffect(() => {
    fetchFeed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destination]);

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <div className="h-7 w-40 bg-white/8 rounded-xl animate-pulse" />
          <div className="h-7 w-32 bg-white/5 rounded-xl animate-pulse ml-auto" />
        </div>
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 9 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-3xl mb-3">📡</p>
        <p className="text-sm text-gray-400 font-medium">Could not load live feed</p>
        <p className="text-xs text-gray-600 mt-1">{error}</p>
        <button
          onClick={fetchFeed}
          className="mt-4 flex items-center gap-1.5 text-xs text-brand-primary hover:text-brand-primary/80 transition-colors"
        >
          <RefreshCw size={12} /> Retry
        </button>
      </div>
    );
  }

  // ── Empty ─────────────────────────────────────────────────────────────────
  if (!feed || feed.posts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-4xl mb-3">📸</p>
        <p className="text-sm text-gray-400 font-medium">No recent posts found</p>
        <p className="text-xs text-gray-600 mt-1 max-w-xs">
          Instagram activity for <span className="text-white">{destination}</span> is low right now.
        </p>
        <button
          onClick={fetchFeed}
          className="mt-4 flex items-center gap-1.5 text-xs text-brand-primary hover:text-brand-primary/80 transition-colors"
        >
          <RefreshCw size={12} /> Refresh
        </button>
      </div>
    );
  }

  // ── Feed ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">

      {/* Header row */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Instagram size={14} className="text-pink-400" />
            Live Destination Vibe
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Real-time social activity from Instagram
          </p>
        </div>
        <CrowdScoreBadge score={feed.crowdScore} label={feed.crowdLabel} />
      </div>

      {/* Hashtags */}
      <div className="flex flex-wrap gap-1.5">
        {feed.hashtags.slice(0, 8).map((tag) => (
          <span key={tag} className="text-xs text-brand-primary/70 bg-brand-primary/10 px-2 py-0.5 rounded-full">
            #{tag}
          </span>
        ))}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-3 gap-2">
        {feed.posts.map((post, i) => (
          <ReelCard key={post.id} post={post} index={i} />
        ))}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-1">
        <p className="text-xs text-gray-600">
          {feed.fromCache ? '📦 Cached' : '🔴 Live'} ·{' '}
          {feed.posts.length} posts · Updated {timeAgo(feed.cachedAt)}
        </p>
        <button
          onClick={fetchFeed}
          className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-400 transition-colors"
        >
          <RefreshCw size={10} /> Refresh
        </button>
      </div>

    </div>
  );
};

export default LiveDestinationFeed;
