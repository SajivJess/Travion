import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as cheerio from 'cheerio';
import * as https from 'https';
import * as crypto from 'crypto';
import { GeoService } from './geo.service';
import { DiscoveryCacheService } from '../supabase/discovery-cache.service';
import {
  STATE_TOURISM_MAP,
  CITY_STATE_MAP,
  ALERT_KEYWORDS,
  assessCrowdImpact,
  type StateTourism,
} from './tourism-data';

// ─── INTERFACES ────────────────────────────────────────────────────────────

export interface TourismAdvisory {
  alert: string;
  type: 'festival' | 'closure' | 'weather' | 'permit' | 'traffic' | 'safety' | 'general';
  crowdImpact: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
  crowdScore: number;           // 0–50 additive score for crowd monitor
  source: string;               // e.g. "keralatourism.org"
  state: string;
  validFrom?: string;           // ISO date if detectable
  validTo?: string;
}

export interface TourismIntelligence {
  state: string;
  stateTourismUrl: string;
  advisories: TourismAdvisory[];
  fetchedAt: string;            // ISO timestamp
  geminiContext: string;        // Pre-formatted text block for Gemini prompt injection
  totalCrowdBoost: number;      // Sum of all advisory crowd scores
}

// ─── SERVICE ───────────────────────────────────────────────────────────────

@Injectable()
export class TourismAdvisoryService {
  private readonly logger = new Logger(TourismAdvisoryService.name);
  private readonly userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Travion/1.0';

  constructor(
    private readonly geoService: GeoService,
    private readonly cacheService: DiscoveryCacheService,
  ) {
    this.logger.log('🏛️ Tourism Advisory Service initialized');
  }

  // ─── MAIN ENTRY ────────────────────────────────────────────────────────

  /**
   * Fetch tourism intelligence for a destination.
   *
   * Pipeline:
   *   1. Resolve destination → state (static map + GeoService fallback)
   *   2. Check cache (Supabase + in-memory, 12h TTL)
   *   3. Scrape state tourism website (homepage + news/alerts pages)
   *   4. Extract advisories via keyword matching
   *   5. Score crowd impact
   *   6. Return structured intelligence + Gemini context string
   */
  async getAdvisories(destination: string): Promise<TourismIntelligence | null> {
    const state = await this.resolveState(destination);
    if (!state) {
      this.logger.warn(`⚠️ Could not map "${destination}" to any Indian state`);
      return null;
    }

    const tourismSite = STATE_TOURISM_MAP[state];
    if (!tourismSite) {
      this.logger.warn(`⚠️ No tourism site configured for state: ${state}`);
      return null;
    }

    // Check cache first (12 hour TTL via discovery_cache type 'advisory')
    const cacheKey = `advisory:${state}`;
    const cached = await this.cacheService.get<TourismIntelligence>('attractions' as any, state, cacheKey);
    if (cached) {
      this.logger.log(`📦 Cache HIT: Tourism advisories for ${tourismSite.name}`);
      return cached;
    }

    // Scrape tourism site
    this.logger.log(`🏛️ Fetching tourism advisories: ${tourismSite.name} (${tourismSite.url})`);
    const advisories = await this.scrapeAdvisories(tourismSite);

    const totalCrowdBoost = advisories.reduce((sum, a) => sum + a.crowdScore, 0);

    const intelligence: TourismIntelligence = {
      state: tourismSite.name,
      stateTourismUrl: tourismSite.url,
      advisories,
      fetchedAt: new Date().toISOString(),
      geminiContext: this.buildGeminiContext(tourismSite.name, advisories),
      totalCrowdBoost,
    };

    // Cache for 12 hours
    await this.cacheService.set('attractions' as any, state, intelligence, cacheKey);
    this.logger.log(`✅ ${advisories.length} advisories fetched for ${tourismSite.name} | Crowd boost: +${totalCrowdBoost}`);

    return intelligence;
  }

  // ─── STATE RESOLUTION ──────────────────────────────────────────────────

  /**
   * Map destination city → state key (lowercase).
   * 1. Static CITY_STATE_MAP lookup
   * 2. GeoService geocode fallback (gets state from Nominatim/Google)
   */
  async resolveState(destination: string): Promise<string | null> {
    const key = destination.toLowerCase().trim();

    // Direct lookup
    if (CITY_STATE_MAP[key]) return CITY_STATE_MAP[key];

    // Check if it IS a state name
    if (STATE_TOURISM_MAP[key]) return key;

    // GeoService fallback — geocode and extract state
    try {
      const geo = await this.geoService.geocode(destination);
      if (geo?.state) {
        const stateKey = geo.state.toLowerCase().trim();
        // Check if geocoded state matches our map
        if (STATE_TOURISM_MAP[stateKey]) return stateKey;
        // Try partial match
        for (const mapKey of Object.keys(STATE_TOURISM_MAP)) {
          if (stateKey.includes(mapKey) || mapKey.includes(stateKey)) return mapKey;
        }
      }
    } catch (err: any) {
      this.logger.warn(`⚠️ Geocode state resolution failed for "${destination}": ${err.message}`);
    }

    return null;
  }

  // ─── SCRAPING ──────────────────────────────────────────────────────────

  /**
   * Scrape the tourism website for advisories, alerts, news, festivals.
   * Fetches the homepage + common sub-paths (/news, /alerts, /events, /advisory).
   */
  private async scrapeAdvisories(site: StateTourism): Promise<TourismAdvisory[]> {
    const allAdvisories: TourismAdvisory[] = [];
    const seenAlerts = new Set<string>();

    // Pages to scrape — homepage + likely sub-pages
    const pagesToScrape = [
      site.url,
      ...(site.altUrls || []),
    ];

    // Add a small set of common advisory/news sub-paths (keep it fast)
    const baseUrl = site.url.replace(/\/+$/, '');
    const subPaths = ['/news', '/events', '/advisory'];
    for (const path of subPaths) {
      pagesToScrape.push(`${baseUrl}${path}`);
    }

    // Scrape all pages in parallel (max 4 concurrent)
    const batchSize = 4;
    for (let i = 0; i < pagesToScrape.length; i += batchSize) {
      const batch = pagesToScrape.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map(url => this.fetchAndParse(url, site.name)),
      );

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          for (const advisory of result.value) {
            const key = advisory.alert.toLowerCase().trim().substring(0, 80);
            if (!seenAlerts.has(key)) {
              seenAlerts.add(key);
              allAdvisories.push(advisory);
            }
          }
        }
      }
    }

    // Sort by crowd impact (highest first)
    allAdvisories.sort((a, b) => b.crowdScore - a.crowdScore);

    // Cap at 15 most impactful
    return allAdvisories.slice(0, 15);
  }

  /**
   * Fetch a single page and extract advisory-like paragraphs.
   */
  private async fetchAndParse(url: string, stateName: string): Promise<TourismAdvisory[]> {
    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent': this.userAgent,
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        timeout: 5000,
        maxRedirects: 2,
        validateStatus: (status) => status < 500,
        httpsAgent: new https.Agent({
          // Allow legacy SSL renegotiation used by many Indian govt tourism sites
          secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT,
          rejectUnauthorized: false,
        }),
      });

      if (response.status >= 400) return [];

      const html = response.data;
      if (typeof html !== 'string' || html.length < 500) return [];

      return this.extractAdvisories(html, url, stateName);
    } catch (err: any) {
      // Don't log for sub-paths that 404 — that's expected
      if (!err.message?.includes('404')) {
        this.logger.debug(`⚠️ Scrape failed for ${url}: ${err.message}`);
      }
      return [];
    }
  }

  /**
   * Parse HTML and extract paragraphs/headlines that contain alert keywords.
   */
  private extractAdvisories(html: string, url: string, stateName: string): TourismAdvisory[] {
    const $ = cheerio.load(html);
    const advisories: TourismAdvisory[] = [];
    const source = new URL(url).hostname;

    // Remove scripts/styles/nav/footer to reduce noise
    $('script, style, nav, footer, header, .menu, .nav, #menu, #nav').remove();

    // Extract text blocks — paragraphs, headings, list items, div text, marquees, tickers
    const selectors = 'p, h1, h2, h3, h4, li, .alert, .notice, .advisory, .news-item, .event, marquee, .ticker, .announcement, blockquote, .card-body, .card-text, .news-title, .event-title';

    $(selectors).each((_, el) => {
      const text = $(el).text().replace(/\s+/g, ' ').trim();
      if (text.length < 15 || text.length > 500) return;

      // Check if text contains any alert keywords
      const matchedKeywords = ALERT_KEYWORDS.filter(kw => text.toLowerCase().includes(kw));
      if (matchedKeywords.length === 0) return;

      const type = this.classifyAlertType(matchedKeywords);
      const impact = assessCrowdImpact(text);

      advisories.push({
        alert: text.substring(0, 250), // cap length
        type,
        crowdImpact: impact.level,
        crowdScore: impact.score,
        source,
        state: stateName,
      });
    });

    return advisories;
  }

  /**
   * Classify the alert type based on matched keywords.
   */
  private classifyAlertType(keywords: string[]): TourismAdvisory['type'] {
    const joined = keywords.join(' ');
    if (/festival|mela|celebration|carnival|utsav/.test(joined)) return 'festival';
    if (/closed|closure|shut|renovation|repair/.test(joined)) return 'closure';
    if (/monsoon|flood|cyclone|storm|rain|snow|landslide/.test(joined)) return 'weather';
    if (/permit|restricted|eco-sensitive|booking required/.test(joined)) return 'permit';
    if (/traffic|road block|diversion|construction/.test(joined)) return 'traffic';
    if (/warning|advisory|alert|caution|bandh|strike/.test(joined)) return 'safety';
    return 'general';
  }

  // ─── GEMINI CONTEXT BUILDER ────────────────────────────────────────────

  /**
   * Build a text block to inject into the Gemini planning prompt.
   * Gives the AI actionable context about local conditions.
   */
  private buildGeminiContext(stateName: string, advisories: TourismAdvisory[]): string {
    if (advisories.length === 0) {
      return `No current tourism advisories for ${stateName}.`;
    }

    const lines = advisories.slice(0, 8).map(a => {
      const impact = a.crowdImpact !== 'LOW' ? ` [Impact: ${a.crowdImpact}]` : '';
      return `- [${a.type.toUpperCase()}] ${a.alert}${impact}`;
    });

    return `== GOVERNMENT TOURISM INTELLIGENCE (${stateName}) ==
Source: Official ${stateName} Tourism Board
${lines.join('\n')}

PLANNING RULES based on advisories:
${advisories.some(a => a.type === 'festival') ? '- Festival detected: Expect higher crowds. Plan early morning visits.' : ''}
${advisories.some(a => a.type === 'closure') ? '- Closure detected: Avoid closed venues. Check alternative attractions.' : ''}
${advisories.some(a => a.type === 'weather') ? '- Weather alert: Prioritize indoor activities on affected days.' : ''}
${advisories.some(a => a.type === 'permit') ? '- Permit required: Notify user about required permits/passes.' : ''}
${advisories.some(a => a.type === 'traffic') ? '- Traffic disruption: Suggest alternative routes or early departures.' : ''}
${advisories.some(a => a.type === 'safety') ? '- Safety advisory: Include in recommendations section.' : ''}`.trim();
  }
}
