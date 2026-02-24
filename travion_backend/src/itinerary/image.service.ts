import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { DiscoveryCacheService } from '../supabase/discovery-cache.service';

// ─── INTERFACES ────────────────────────────────────────────────────────────

export interface PlaceImage {
  place: string;
  query: string;
  imageUrl: string;          // Original (high-res) URL
  thumbnailUrl?: string;     // Thumbnail URL
  title?: string;
  source?: string;           // Domain where image was found
  fetchedAt: string;
}

export interface ImageBatchResult {
  destination?: PlaceImage;
  attractions: Map<string, PlaceImage>;
  hotels: Map<string, PlaceImage>;
  restaurants: Map<string, PlaceImage>;
}

// ─── SERVICE ───────────────────────────────────────────────────────────────

/**
 * Travel Image Service — fetches high-resolution destination, activity,
 * hotel and restaurant images via SerpAPI google_images engine.
 *
 * Pipeline:
 *   getImages(destination, attractions, hotels, restaurants)
 *   → parallel SerpAPI calls (capped to avoid rate limits)
 *   → 7-day cache in DiscoveryCacheService
 *   → returns ImageBatchResult
 *
 * The frontend uses these for:
 *   - Destination hero banner
 *   - Activity / attraction cards
 *   - Hotel stay cards
 *   - Cluster day-preview thumbnails
 *   - Weather replan modal header
 */
@Injectable()
export class ImageService {
  private readonly logger = new Logger(ImageService.name);

  /** SerpAPI key rotation */
  private readonly serpKeys: string[];
  private keyIndex = 0;

  /** TTL: 7 days (images change rarely) */
  private readonly IMAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

  constructor(private readonly cacheService: DiscoveryCacheService) {
    this.serpKeys = [
      process.env.SERP_API_KEY,
      process.env.SERP_API_KEY_2,
      process.env.SERP_API_KEY_3,
      process.env.SERP_API_KEY_4,
      process.env.SERP_API_KEY_5,
    ].filter(Boolean) as string[];

    if (this.serpKeys.length === 0) {
      this.logger.error('❌ No SERP_API_KEY configured — image fetch will be unavailable');
    } else {
      this.logger.log(`🖼️  Image Service initialized (${this.serpKeys.length} SerpAPI keys)`);
    }
  }

  private nextKey(): string {
    const key = this.serpKeys[this.keyIndex];
    this.keyIndex = (this.keyIndex + 1) % this.serpKeys.length;
    return key;
  }

  // ─── PUBLIC API ────────────────────────────────────────────────────────

  /**
   * Batch fetch images for destination + up to N attractions/hotels/restaurants.
   *
   * Limits per category (to stay within SerpAPI quota):
   *   - 1 destination hero
   *   - 8 attractions  (most important for day-cards)
   *   - 5 hotels
   *   - 4 restaurants
   *
   * All requests run in parallel (Promise.allSettled) with per-item caching.
   */
  async getImages(
    destination: string,
    attractionNames: string[] = [],
    hotelNames: string[] = [],
    restaurantNames: string[] = [],
  ): Promise<ImageBatchResult> {
    const result: ImageBatchResult = {
      attractions: new Map(),
      hotels: new Map(),
      restaurants: new Map(),
    };

    if (this.serpKeys.length === 0) return result;

    // Slice to limits
    const topAttractions = attractionNames.slice(0, 8);
    const topHotels = hotelNames.slice(0, 5);
    const topRestaurants = restaurantNames.slice(0, 4);

    // Build all fetch tasks
    const tasks: Array<Promise<void>> = [];

    // Destination hero
    tasks.push(
      this.fetchImage(`${destination} travel photography landscape`, destination, 'destination')
        .then(img => { if (img) result.destination = img; }),
    );

    // Attractions
    for (const name of topAttractions) {
      tasks.push(
        this.fetchImage(`${name} ${destination} tourist attraction`, name, 'attraction')
          .then(img => { if (img) result.attractions.set(name, img); }),
      );
    }

    // Hotels
    for (const name of topHotels) {
      tasks.push(
        this.fetchImage(`${name} hotel ${destination}`, name, 'hotel')
          .then(img => { if (img) result.hotels.set(name, img); }),
      );
    }

    // Restaurants
    for (const name of topRestaurants) {
      tasks.push(
        this.fetchImage(`${name} restaurant ${destination} food`, name, 'restaurant')
          .then(img => { if (img) result.restaurants.set(name, img); }),
      );
    }

    await Promise.allSettled(tasks);
    const total = (result.destination ? 1 : 0) + result.attractions.size + result.hotels.size + result.restaurants.size;
    this.logger.log(`🖼️  Fetched ${total} images for ${destination}`);
    return result;
  }

  /**
   * Fetch a single image for a named place. Checks cache first.
   *
   * @param query  - Search query string sent to google_images
   * @param place  - Place label used as cache key
   * @param kind   - Category tag (destination/attraction/hotel/restaurant)
   */
  async fetchImage(query: string, place: string, kind: string): Promise<PlaceImage | null> {
    const cacheKey = `img:${kind}:${place.toLowerCase().trim()}`;

    // Check cache first (7-day TTL stored under 'attractions' type with img: prefix)
    const cached = await this.cacheService.get<PlaceImage>('attractions', place, cacheKey);
    if (cached) {
      this.logger.debug(`📦 Image cache HIT: ${kind}/${place}`);
      return cached;
    }

    if (this.serpKeys.length === 0) return null;

    try {
      const response = await axios.get('https://serpapi.com/search', {
        params: {
          engine: 'google_images',
          q: query,
          api_key: this.nextKey(),
          num: 5,            // Fetch 5, pick the best
          safe: 'active',
          hl: 'en',
          gl: 'in',          // India region for better travel photo relevance
        },
        timeout: 10000,
      });

      const imagesRaw: any[] = response.data?.images_results || [];

      // Pick the best image: prefer landscape-format, skip tiny thumbnails
      const best = this.pickBestImage(imagesRaw, place);
      if (!best) return null;

      const img: PlaceImage = {
        place,
        query,
        imageUrl: best.original,
        thumbnailUrl: best.thumbnail,
        title: best.title || query,
        source: best.source || '',
        fetchedAt: new Date().toISOString(),
      };

      // Cache for 7 days
      await this.cacheService.set('attractions', place, img, cacheKey);
      return img;
    } catch (err) {
      const msg = (err as Error).message || String(err);
      this.logger.warn(`⚠️ Image fetch failed for "${place}": ${msg}`);
      return null;
    }
  }

  // ─── HELPERS ───────────────────────────────────────────────────────────

  /**
   * Select the best image from a list:
   *   - Must have a valid HTTPS `original` URL that ends in an image extension
   *   - Prefer images that don't come from Wikipedia/commons (often low-res)
   *   - Prefer images where title/snippet contains the place name
   */
  private pickBestImage(images: any[], place: string): any | null {
    const lower = place.toLowerCase();

    // Must have original URL pointing to an image
    const valid = images.filter(img => {
      const url: string = img.original || '';
      return (
        url.startsWith('http') &&
        /\.(jpg|jpeg|png|webp)(\?|$)/i.test(url)
      );
    });

    if (valid.length === 0) return null;

    // Score each image
    const scored = valid.map(img => {
      let score = 0;
      const title: string = (img.title || '').toLowerCase();
      const src: string = (img.source || '').toLowerCase();
      const url: string = (img.original || '').toLowerCase();

      // Boost if title mentions the place
      if (title.includes(lower)) score += 3;
      // Boost for known travel sources
      if (/tripadvisor|booking|makemytrip|expedia|holidays|tourism|travel/.test(src)) score += 2;
      // Penalise Wikipedia/commons
      if (/wikipedia|wikimedia|commons/.test(url)) score -= 1;
      // Prefer jpg over webp (better compatibility)
      if (url.includes('.jpg') || url.includes('.jpeg')) score += 1;

      return { img, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored[0]?.img || null;
  }

  /**
   * Convert ImageBatchResult maps to plain objects for JSON serialization.
   */
  serializeResult(result: ImageBatchResult): {
    destination?: PlaceImage;
    attractions: Record<string, PlaceImage>;
    hotels: Record<string, PlaceImage>;
    restaurants: Record<string, PlaceImage>;
  } {
    return {
      destination: result.destination,
      attractions: Object.fromEntries(result.attractions),
      hotels: Object.fromEntries(result.hotels),
      restaurants: Object.fromEntries(result.restaurants),
    };
  }
}
