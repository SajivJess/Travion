import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { DiscoveryCacheService } from '../supabase/discovery-cache.service';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PoiVideo {
  placeName: string;
  videoId: string;
  videoUrl: string;
  videoTitle: string;
  thumbnail: string;
  channel: string;
  durationLabel: string;   // e.g. "6 min"
  durationSecs: number;
  views: number;
  publishedLabel: string;  // e.g. "8 months ago"
  publishedAgoDays: number;
  score: number;           // 0–100 composite
}

export interface PoiVideosResult {
  videos: PoiVideo[];
  fromCache: boolean;
  cachedAt: string;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class YoutubeDiscoveryService {
  private readonly logger = new Logger(YoutubeDiscoveryService.name);

  private readonly serpApiKeys: string[];
  private keyIndex = 0;

  constructor(private readonly cache: DiscoveryCacheService) {
    this.serpApiKeys = [
      process.env.SERP_API_KEY,
      process.env.SERP_API_KEY_2,
      process.env.SERP_API_KEY_3,
      process.env.SERP_API_KEY_4,
      process.env.SERP_API_KEY_5,
    ].filter(Boolean) as string[];
  }

  private nextKey(): string | null {
    if (!this.serpApiKeys.length) return null;
    const k = this.serpApiKeys[this.keyIndex % this.serpApiKeys.length];
    this.keyIndex++;
    return k;
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Returns the best YouTube video for each requested POI.
   * Cached 24 h per (destination + poi list).
   */
  async getPoiVideos(destination: string, pois: string[]): Promise<PoiVideosResult> {
    if (!pois.length) return { videos: [], fromCache: false, cachedAt: new Date().toISOString() };

    const cacheExtra = pois.slice(0, 8).map(p => p.toLowerCase()).sort().join('|');

    // ── Try cache ────────────────────────────────────────────────────────────
    const cached = await this.cache.get<PoiVideo[]>('attractions', destination, `yt:${cacheExtra}`);
    if (cached) {
      this.logger.log(`🎬 YouTube cache HIT for "${destination}" (${pois.length} POIs)`);
      return { videos: cached, fromCache: true, cachedAt: new Date().toISOString() };
    }

    // ── Fresh search — one SerpAPI call per POI, capped at 5 ─────────────────
    this.logger.log(`🎬 Searching YouTube for ${pois.length} POIs in "${destination}"`);
    const limit = Math.min(pois.length, 5);
    const tasks = pois.slice(0, limit).map(poi => this.bestVideoForPoi(poi, destination));
    const settled = await Promise.allSettled(tasks);

    const videos: PoiVideo[] = settled
      .map((r) => (r.status === 'fulfilled' ? r.value : null))
      .filter((v): v is PoiVideo => v !== null);

    // ── Cache result ─────────────────────────────────────────────────────────
    if (videos.length > 0) {
      await this.cache.set('attractions', destination, videos, `yt:${cacheExtra}`);
    }

    return { videos, fromCache: false, cachedAt: new Date().toISOString() };
  }

  // ─── Per-POI search ──────────────────────────────────────────────────────────

  private async bestVideoForPoi(poi: string, destination: string): Promise<PoiVideo | null> {
    const key = this.nextKey();
    if (!key) return null;

    const query = `${poi} ${destination} travel guide`;

    let results: any[] = [];
    try {
      const res = await axios.get('https://serpapi.com/search.json', {
        params: {
          engine: 'youtube',
          search_query: query,
          api_key: key,
        },
        timeout: 8000,
      });
      results = (res.data?.video_results as any[]) || [];
    } catch (e: any) {
      this.logger.warn(`YouTube search failed for "${poi}": ${e.message}`);
      return null;
    }

    if (!results.length) return null;

    // ── Normalise ─────────────────────────────────────────────────────────────
    const now = Date.now();
    const candidates = results
      .slice(0, 15)
      .map((v) => this.normalise(v, poi, destination, now))
      .filter((v): v is NormalisedVideo => v !== null);

    // ── Filter ────────────────────────────────────────────────────────────────
    const filtered = candidates.filter(
      (v) =>
        v.durationSecs > 0 &&
        v.durationSecs <= 600 &&        // ≤ 10 min
        v.views >= 10_000 &&             // ≥ 10k views
        v.publishedAgoDays <= 730,       // uploaded within last 2 years
    );

    // Fall back to less strict if nothing passes (min 5k views, ≤ 15 min)
    const pool = filtered.length > 0 ? filtered : candidates.filter(
      (v) => v.durationSecs <= 900 && v.views >= 5_000 && v.publishedAgoDays <= 1095,
    );

    if (!pool.length) return null;

    // ── Score & rank ──────────────────────────────────────────────────────────
    const maxViews = Math.max(...pool.map(v => v.views));
    const best = pool
      .map((v) => ({
        ...v,
        score: this.computeScore(v, poi, maxViews),
      }))
      .sort((a, b) => b.score - a.score)[0];

    return {
      placeName: poi,
      videoId: best.videoId,
      videoUrl: `https://www.youtube.com/watch?v=${best.videoId}`,
      videoTitle: best.title,
      thumbnail: best.thumbnail,
      channel: best.channel,
      durationLabel: this.formatDuration(best.durationSecs),
      durationSecs: best.durationSecs,
      views: best.views,
      publishedLabel: best.publishedLabel,
      publishedAgoDays: best.publishedAgoDays,
      score: Math.round(best.score),
    };
  }

  // ─── Score formula ────────────────────────────────────────────────────────

  private computeScore(
    v: NormalisedVideo,
    poi: string,
    maxViews: number,
  ): number {
    // views 0–40
    const viewScore = maxViews > 0 ? (v.views / maxViews) * 40 : 0;

    // recency 0–30 (within 3 months = full, linear decay to 2 years)
    const recency = Math.max(0, 1 - v.publishedAgoDays / 730);
    const recencyScore = recency * 30;

    // duration fit 0–20 (sweet spot 3–8 min)
    const mins = v.durationSecs / 60;
    let durationScore = 0;
    if (mins >= 3 && mins <= 8) durationScore = 20;
    else if (mins >= 2 && mins < 3) durationScore = 14;
    else if (mins > 8 && mins <= 10) durationScore = 14;
    else if (mins > 0 && mins < 2) durationScore = 8;
    else durationScore = 4; // 10–15 mins

    // title match 0–10
    const poiWords = poi.toLowerCase().split(/\s+/);
    const title = v.title.toLowerCase();
    const matchCount = poiWords.filter(w => title.includes(w)).length;
    const titleScore = (matchCount / Math.max(poiWords.length, 1)) * 10;

    return viewScore + recencyScore + durationScore + titleScore;
  }

  // ─── Normaliser ───────────────────────────────────────────────────────────

  private normalise(raw: any, poi: string, destination: string, nowMs: number): NormalisedVideo | null {
    if (!raw) return null;

    // Video ID — extract from link or use id field
    let videoId: string = raw.id || '';
    if (!videoId && raw.link) {
      const m = (raw.link as string).match(/[?&]v=([^&]+)/);
      if (m) videoId = m[1];
    }
    if (!videoId) return null;

    const title: string = raw.title || '';
    const thumbnail: string =
      raw.thumbnail?.static ||
      raw.thumbnail?.rich ||
      raw.thumbnail ||
      `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
    const channel: string = raw.channel?.name || raw.channel || 'Unknown';

    // Duration: "10:24" or "1:04:12" — convert to seconds
    const durationRaw: string = raw.length || raw.duration || '';
    const durationSecs = this.parseDuration(durationRaw);

    // Views: number or string like "1.2M views"
    const views = this.parseViews(raw.views ?? 0);

    // Published: "3 months ago", "1 year ago", etc.
    const publishedLabel: string = raw.published_date || raw.publishedDate || '';
    const publishedAgoDays = this.parseDateLabel(publishedLabel, nowMs);

    return { videoId, title, thumbnail, channel, durationSecs, views, publishedLabel, publishedAgoDays };
  }

  // ─── Parsers ──────────────────────────────────────────────────────────────

  private parseDuration(label: string): number {
    if (!label) return 0;
    const parts = label.split(':').map(Number);
    if (parts.some(isNaN)) return 0;
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return 0;
  }

  private parseViews(raw: any): number {
    if (typeof raw === 'number') return raw;
    if (!raw) return 0;
    const s = String(raw).replace(/,/g, '').toLowerCase();
    if (s.includes('m')) return Math.round(parseFloat(s) * 1_000_000);
    if (s.includes('k')) return Math.round(parseFloat(s) * 1_000);
    const n = parseInt(s, 10);
    return isNaN(n) ? 0 : n;
  }

  private parseDateLabel(label: string, nowMs: number): number {
    if (!label) return 999;
    const lower = label.toLowerCase();
    const numMatch = lower.match(/(\d+)/);
    const n = numMatch ? parseInt(numMatch[1], 10) : 1;
    if (lower.includes('hour') || lower.includes('minute')) return 1;
    if (lower.includes('day')) return n;
    if (lower.includes('week')) return n * 7;
    if (lower.includes('month')) return n * 30;
    if (lower.includes('year')) return n * 365;
    return 999;
  }

  private formatDuration(secs: number): string {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return s > 0 ? `${m}m ${s}s` : `${m} min`;
  }
}

// ─── Internal only ────────────────────────────────────────────────────────────

interface NormalisedVideo {
  videoId: string;
  title: string;
  thumbnail: string;
  channel: string;
  durationSecs: number;
  views: number;
  publishedLabel: string;
  publishedAgoDays: number;
}
