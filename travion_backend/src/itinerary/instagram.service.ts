import { Injectable, Logger } from '@nestjs/common';
import { supabase } from '../supabase/client';

// ─── Normalised Instagram post ────────────────────────────────────────────────

export interface InstagramPost {
  id: string;
  shortCode: string;
  url: string;
  displayUrl: string;   // thumbnail / cover image
  videoUrl?: string | null;
  caption: string;
  likesCount: number;
  commentsCount: number;
  timestamp: string;    // ISO-8601
  hashtags: string[];
  isVideo: boolean;
}

export interface SocialFeedResult {
  posts: InstagramPost[];
  crowdScore: number;   // 0–100
  crowdLabel: 'Very Quiet' | 'Quiet' | 'Moderate' | 'Busy' | 'Very Busy' | 'No Data';
  hashtags: string[];
  cachedAt: string;
  fromCache: boolean;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class InstagramService {
  private readonly logger = new Logger(InstagramService.name);

  /** Primary Apify API token */
  private readonly APIFY_TOKEN = 'apify_api_LkyXntFAGeFO34QV9ImoUwCEBSbPEg22OU50';

  /** apify/instagram-hashtag-scraper actor ID */
  private readonly ACTOR_ID = 'reGe1ST3OBgYZSsZJ';

  /** TTL for Supabase cache (hours) */
  private readonly CACHE_TTL_HOURS = 6;

  /** In-process memory cache — avoids Supabase round-trip for warm destinations */
  private readonly memCache = new Map<string, { result: SocialFeedResult; expiresAt: number }>();
  private readonly MEM_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours (match Supabase TTL)

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Returns a cached feed or triggers a fresh Apify scrape.
   * @param destination  Trip destination, e.g. "Munnar"
   * @param pois         Optional POI names to derive extra hashtags from
   */
  async getOrFetchFeed(
    destination: string,
    pois: string[] = [],
  ): Promise<SocialFeedResult> {
    const hashtags = this.generateHashtags(destination, pois);
    const cacheKey = `ig_${destination.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;

    // ── 1. In-memory cache (fastest — no I/O) ───────────────────────────────
    const mem = this.memCache.get(cacheKey);
    if (mem && mem.expiresAt > Date.now()) {
      this.logger.log(`📸 Instagram memory cache HIT for "${destination}"`);
      return { ...mem.result, fromCache: true };
    }
    if (mem) this.memCache.delete(cacheKey); // stale

    // ── 2. Supabase cache ────────────────────────────────────────────────────
    if (supabase) {
      try {
        const { data } = await supabase
          .from('instagram_cache')
          .select('posts, crowd_score, crowd_label, created_at')
          .eq('cache_key', cacheKey)
          .gt('expires_at', new Date().toISOString())
          .single();

        if (data) {
          this.logger.log(`📸 Instagram Supabase cache HIT for "${destination}"`);
          const result: SocialFeedResult = {
            posts: data.posts ?? [],
            crowdScore: data.crowd_score ?? 0,
            crowdLabel: data.crowd_label ?? 'No Data',
            hashtags,
            cachedAt: data.created_at,
            fromCache: true,
          };
          // Promote to memory cache
          this.memCache.set(cacheKey, { result, expiresAt: Date.now() + this.MEM_TTL_MS });
          return result;
        }
      } catch {
        /* cache miss – proceed to scrape */
      }
    }

    // ── 3. Fresh scrape ──────────────────────────────────────────────────────
    this.logger.log(`📸 Scraping Instagram hashtags: ${hashtags.slice(0, 4).join(', ')}`);
    const posts = await this.scrapeApify(hashtags.slice(0, 5));
    const { score, label } = this.computeCrowdScore(posts);

    const freshResult: SocialFeedResult = {
      posts,
      crowdScore: score,
      crowdLabel: label as SocialFeedResult['crowdLabel'],
      hashtags,
      cachedAt: new Date().toISOString(),
      fromCache: false,
    };

    // ── Populate memory cache immediately ────────────────────────────────────
    if (posts.length > 0) {
      this.memCache.set(cacheKey, { result: freshResult, expiresAt: Date.now() + this.MEM_TTL_MS });
    }

    // ── Persist to Supabase ──────────────────────────────────────────────────
    if (supabase && posts.length > 0) {
      try {
        const expiresAt = new Date(
          Date.now() + this.CACHE_TTL_HOURS * 60 * 60 * 1000,
        ).toISOString();

        await supabase.from('instagram_cache').upsert(
          {
            cache_key: cacheKey,
            posts,
            crowd_score: score,
            crowd_label: label,
            expires_at: expiresAt,
            created_at: new Date().toISOString(),
          },
          { onConflict: 'cache_key' },
        );
      } catch (e) {
        this.logger.warn(`Cache write failed: ${e.message}`);
      }
    }

    return freshResult;
  }

  // ─── Hashtag Generation ──────────────────────────────────────────────────────

  generateHashtags(destination: string, pois: string[] = []): string[] {
    const cleaned = destination
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .trim();
    const slug = cleaned.replace(/\s+/g, '');
    const words = cleaned.split(/\s+/).filter((w) => w.length > 2);

    // Tourism-specific tags only — avoid generic social tags that pull lifestyle content
    const tags = new Set<string>([
      `${slug}tourism`,
      `${slug}sightseeing`,
      `${slug}heritage`,
      `${slug}travel`,
      `visit${slug}`,
      `explore${slug}`,
      `${slug}attractions`,
      `incredible${slug}`,
      `${slug}monuments`,
      `${slug}india`,
    ]);

    // Add word-level tourism tags for multi-word destinations (e.g. "New Delhi")
    for (const word of words) {
      if (word !== slug) tags.add(`${word}tourism`);
    }

    // POI-specific tags (highly relevant to tourism)
    for (const poi of pois.slice(0, 4)) {
      const p = poi.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (p.length > 3) {
        tags.add(p);
        tags.add(`visit${p}`);
      }
    }

    return Array.from(tags).slice(0, 10);
  }

  // ─── SocialCrowdScore ────────────────────────────────────────────────────────

  private computeCrowdScore(
    posts: InstagramPost[],
  ): { score: number; label: string } {
    if (!posts.length) return { score: 0, label: 'No Data' };

    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    let recencyScore = 0;
    let totalLikes = 0;

    for (const post of posts) {
      const ageDays = (now - new Date(post.timestamp).getTime()) / dayMs;
      totalLikes += post.likesCount || 0;

      // Recency weight: higher for more recent posts
      if (ageDays < 1)       recencyScore += 10;
      else if (ageDays < 3)  recencyScore += 7;
      else if (ageDays < 7)  recencyScore += 4;
      else                   recencyScore += 1;
    }

    const avgLikes    = totalLikes / posts.length;
    const volumeScore = Math.min(posts.length * 4, 40);       // max 40 pts
    const likeScore   = Math.min(avgLikes / 150, 30);         // max 30 pts
    const recScore    = Math.min(recencyScore / posts.length * 3, 30); // max 30 pts

    const score = Math.min(100, Math.round(volumeScore + likeScore + recScore));

    let label: string;
    if      (score <  15) label = 'Very Quiet';
    else if (score <  35) label = 'Quiet';
    else if (score <  55) label = 'Moderate';
    else if (score <  75) label = 'Busy';
    else                  label = 'Very Busy';

    return { score, label };
  }

  // ─── Apify Scraper ───────────────────────────────────────────────────────────

  private async scrapeApify(hashtags: string[]): Promise<InstagramPost[]> {
    try {
      // run-sync-get-dataset-items: runs actor, waits, returns items directly
      const url =
        `https://api.apify.com/v2/acts/${this.ACTOR_ID}` +
        `/run-sync-get-dataset-items` +
        `?token=${this.APIFY_TOKEN}&timeout=90&memory=256&maxItems=30`;

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hashtags,
          resultsLimit: 25,
          proxy: { useApifyProxy: true },
        }),
        signal: AbortSignal.timeout(95_000),
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        this.logger.warn(`Apify responded ${res.status}: ${txt.slice(0, 200)}`);
        return [];
      }

      const raw = await res.json();
      const items: any[] = Array.isArray(raw) ? raw : [];
      if (!items.length) return [];

      return items
        .map((item) => this.normalizePost(item))
        .filter((p): p is InstagramPost => p !== null)
        .slice(0, 25);
    } catch (e) {
      this.logger.error(`Instagram scrape error: ${(e as Error).message}`);
      return [];
    }
  }

  // ─── Normalise raw Apify item ────────────────────────────────────────────────

  private normalizePost(item: any): InstagramPost | null {
    if (!item) return null;
    const shortCode = item.shortCode || item.shortcode || '';
    const id = item.id || shortCode;
    if (!id) return null;

    // Timestamp can come as ISO string or Unix epoch
    let timestamp: string;
    if (item.timestamp) {
      timestamp = item.timestamp;
    } else if (item.taken_at_timestamp) {
      timestamp = new Date(item.taken_at_timestamp * 1000).toISOString();
    } else {
      timestamp = new Date().toISOString();
    }

    return {
      id,
      shortCode,
      url:
        item.url ||
        (shortCode ? `https://www.instagram.com/p/${shortCode}/` : ''),
      displayUrl:
        item.displayUrl ||
        item.thumbnailUrl ||
        item.previewUrl ||
        item.thumbnail_src ||
        item.display_url ||
        '',
      videoUrl:
        item.videoUrl ||
        item.videoVersions?.[0]?.url ||
        item.video_url ||
        null,
      caption: ((item.caption || item.description || '') as string).slice(0, 220),
      likesCount: item.likesCount ?? item.likes_count ?? item.edge_media_preview_like?.count ?? 0,
      commentsCount:
        item.commentsCount ?? item.comment_count ?? item.edge_media_to_comment?.count ?? 0,
      timestamp,
      hashtags: Array.isArray(item.hashtags) ? item.hashtags : [],
      isVideo: item.type === 'Video' || item.isVideo === true || item.is_video === true,
    };
  }
}
