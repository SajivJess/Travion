import { Injectable, Logger } from '@nestjs/common';
import { supabase } from './client';

/**
 * Supabase Discovery Cache
 * 
 * Caches SerpAPI / Geocoding / Weather results to avoid redundant API calls.
 * Cache TTL: Hotels/Attractions/Restaurants = 24h, Weather = 6h, Geocoding = 7 days.
 */

export interface CachedDiscovery {
  id?: string;
  destination: string;
  type: 'hotels' | 'attractions' | 'restaurants' | 'weather' | 'geocode';
  query_hash: string;
  data: any;
  created_at?: string;
  expires_at: string;
}

@Injectable()
export class DiscoveryCacheService {
  private readonly logger = new Logger(DiscoveryCacheService.name);

  // In-memory LRU for hot data (avoids Supabase round-trip for recent queries)
  private memCache = new Map<string, { data: any; expiresAt: number }>();
  private readonly MEM_CACHE_MAX = 200;

  // TTLs in milliseconds
  private readonly TTL = {
    hotels: 24 * 60 * 60 * 1000,       // 24 hours
    attractions: 24 * 60 * 60 * 1000,  // 24 hours
    restaurants: 24 * 60 * 60 * 1000,  // 24 hours
    weather: 6 * 60 * 60 * 1000,       // 6 hours
    geocode: 7 * 24 * 60 * 60 * 1000,  // 7 days
  };

  /**
   * Generate a deterministic hash for cache key
   */
  private hashKey(type: string, destination: string, extra: string = ''): string {
    const input = `${type}:${destination.toLowerCase().trim()}:${extra}`.replace(/\s+/g, '_');
    // Simple FNV-1a hash (fast, no crypto needed)
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = (hash * 0x01000193) >>> 0;
    }
    return hash.toString(16);
  }

  /**
   * Check in-memory cache first, then Supabase
   */
  async get<T>(type: CachedDiscovery['type'], destination: string, extra: string = ''): Promise<T | null> {
    const key = this.hashKey(type, destination, extra);

    // 1. In-memory cache
    const mem = this.memCache.get(key);
    if (mem && mem.expiresAt > Date.now()) {
      this.logger.debug(`📦 Memory cache HIT: ${type}/${destination}`);
      return mem.data as T;
    }
    if (mem) this.memCache.delete(key); // expired

    // 2. Supabase cache
    if (!supabase) return null;

    try {
      const { data, error } = await supabase
        .from('discovery_cache')
        .select('data, expires_at')
        .eq('query_hash', key)
        .eq('type', type)
        .single();

      if (error || !data) return null;

      // Check expiry
      if (new Date(data.expires_at).getTime() < Date.now()) {
        // Expired - delete asynchronously
        supabase.from('discovery_cache').delete().eq('query_hash', key).then(() => {});
        return null;
      }

      this.logger.log(`💾 Supabase cache HIT: ${type}/${destination}`);

      // Populate memory cache
      this.setMemCache(key, data.data, new Date(data.expires_at).getTime());
      return data.data as T;
    } catch (err) {
      this.logger.warn(`Cache read failed: ${err.message}`);
      return null;
    }
  }

  /**
   * Store in both memory and Supabase
   */
  async set(type: CachedDiscovery['type'], destination: string, data: any, extra: string = ''): Promise<void> {
    const key = this.hashKey(type, destination, extra);
    const ttl = this.TTL[type] || this.TTL.attractions;
    const expiresAt = new Date(Date.now() + ttl);

    // 1. Memory cache (always)
    this.setMemCache(key, data, expiresAt.getTime());

    // 2. Supabase (fire-and-forget)
    if (!supabase) return;

    try {
      await supabase.from('discovery_cache').upsert({
        query_hash: key,
        destination: destination.toLowerCase().trim(),
        type,
        data,
        expires_at: expiresAt.toISOString(),
        created_at: new Date().toISOString(),
      }, {
        onConflict: 'query_hash',
      });
      this.logger.debug(`💾 Cached ${type}/${destination} → Supabase (TTL: ${ttl / 3600000}h)`);
    } catch (err) {
      this.logger.warn(`Cache write failed: ${err.message}`);
      // Not critical - memory cache still works
    }
  }

  /**
   * Invalidate cache for a destination
   */
  async invalidate(destination: string, type?: CachedDiscovery['type']): Promise<void> {
    // Clear memory cache entries
    for (const [key] of this.memCache) {
      if (key.includes(destination.toLowerCase())) {
        this.memCache.delete(key);
      }
    }

    if (!supabase) return;

    try {
      let query = supabase
        .from('discovery_cache')
        .delete()
        .eq('destination', destination.toLowerCase().trim());

      if (type) query = query.eq('type', type);
      await query;
    } catch (err) {
      this.logger.warn(`Cache invalidation failed: ${err.message}`);
    }
  }

  /**
   * Clean up expired entries (run periodically)
   */
  async cleanExpired(): Promise<number> {
    // Memory cache
    let cleaned = 0;
    for (const [key, val] of this.memCache) {
      if (val.expiresAt < Date.now()) {
        this.memCache.delete(key);
        cleaned++;
      }
    }

    // Supabase
    if (supabase) {
      try {
        const { count } = await supabase
          .from('discovery_cache')
          .delete()
          .lt('expires_at', new Date().toISOString())
          .select('*', { count: 'exact', head: true });
        cleaned += count || 0;
      } catch (err) {
        this.logger.warn(`Cache cleanup failed: ${err.message}`);
      }
    }

    if (cleaned > 0) this.logger.log(`🧹 Cleaned ${cleaned} expired cache entries`);
    return cleaned;
  }

  private setMemCache(key: string, data: any, expiresAt: number): void {
    // Evict oldest if over limit
    if (this.memCache.size >= this.MEM_CACHE_MAX) {
      const oldest = this.memCache.keys().next().value;
      if (oldest) this.memCache.delete(oldest);
    }
    this.memCache.set(key, { data, expiresAt });
  }
}
