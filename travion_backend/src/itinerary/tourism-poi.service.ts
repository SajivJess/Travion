import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as cheerio from 'cheerio';
import * as https from 'https';
import * as crypto from 'crypto';
import { GeoService } from './geo.service';
import { DiscoveryCacheService } from '../supabase/discovery-cache.service';
import { TourismAdvisoryService } from './tourism-advisory.service';
import {
  STATE_TOURISM_MAP,
  POI_SECTION_KEYWORDS,
  classifyPoiCategory,
} from './tourism-data';

// ─── INTERFACES ────────────────────────────────────────────────────────────

export interface OfficialPoi {
  name: string;
  district?: string;
  category: string;             // Heritage, Beach, Nature, Religious, etc.
  description?: string;
  state: string;
  source: string;               // hostname of tourism site
  // Coordinates added after geocoding
  lat?: number;
  lng?: number;
  formattedAddress?: string;
}

export interface TourismPoiResult {
  state: string;
  pois: OfficialPoi[];
  geocodedCount: number;        // How many got coordinates
  fetchedAt: string;
  /** Pre-formatted text for Gemini prompt — official POI list */
  geminiContext: string;
}

// ─── SERVICE ───────────────────────────────────────────────────────────────

@Injectable()
export class TourismPoiService {
  private readonly logger = new Logger(TourismPoiService.name);
  private readonly userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Travion/1.0';

  constructor(
    private readonly geoService: GeoService,
    private readonly cacheService: DiscoveryCacheService,
    private readonly advisoryService: TourismAdvisoryService,
  ) {
    this.logger.log('🏛️ Tourism POI Service initialized');
  }

  // ─── MAIN ENTRY ────────────────────────────────────────────────────────

  /**
   * Fetch official tourist spots for a destination from its state tourism website.
   *
   * Pipeline:
   *   1. Resolve destination → state
   *   2. Check cache (24h TTL)
   *   3. Scrape tourism site for POI listings (places to visit, destinations pages)
   *   4. Geocode each POI to get lat/lng
   *   5. Return structured result + Gemini context
   *
   * These official POIs become SEED data — the discovery pipeline will
   * prefer these over random Google Places results.
   */
  async getOfficialPois(destination: string): Promise<TourismPoiResult | null> {
    const state = await this.advisoryService.resolveState(destination);
    if (!state) {
      this.logger.warn(`⚠️ Could not map "${destination}" to any Indian state for POI fetch`);
      return null;
    }

    const tourismSite = STATE_TOURISM_MAP[state];
    if (!tourismSite) return null;

    // Check cache (24h via discovery_cache)
    const cacheKey = `poi:${state}:${destination.toLowerCase()}`;
    const cached = await this.cacheService.get<TourismPoiResult>('attractions', state, cacheKey);
    if (cached) {
      this.logger.log(`📦 Cache HIT: Official POIs for ${destination} (${tourismSite.name})`);
      return cached;
    }

    this.logger.log(`🏛️ Scraping official POIs: ${tourismSite.name} → ${destination}`);

    // Scrape tourism site for POI names
    const rawPois = await this.scrapePois(tourismSite, destination);

    if (rawPois.length === 0) {
      this.logger.warn(`⚠️ No official POIs found for ${destination} on ${tourismSite.name}`);
      // Still cache the empty result to avoid re-scraping
      const emptyResult: TourismPoiResult = {
        state: tourismSite.name,
        pois: [],
        geocodedCount: 0,
        fetchedAt: new Date().toISOString(),
        geminiContext: '',
      };
      await this.cacheService.set('attractions', state, emptyResult, cacheKey);
      return emptyResult;
    }

    // Geocode POIs to get lat/lng (batch, max 15 at a time)
    const geocoded = await this.geocodePois(rawPois, destination);
    const geocodedCount = geocoded.filter(p => p.lat && p.lng).length;

    const result: TourismPoiResult = {
      state: tourismSite.name,
      pois: geocoded,
      geocodedCount,
      fetchedAt: new Date().toISOString(),
      geminiContext: this.buildGeminiContext(tourismSite.name, geocoded, destination),
    };

    // Cache for 24 hours
    await this.cacheService.set('attractions', state, result, cacheKey);
    this.logger.log(`✅ ${geocoded.length} official POIs (${geocodedCount} geocoded) for ${destination}`);

    return result;
  }

  // ─── SCRAPING ──────────────────────────────────────────────────────────

  /**
   * Scrape the tourism website for place names.
   * Tries: homepage links, destination pages, /places-to-visit, /destinations
   */
  private async scrapePois(
    site: { name: string; url: string },
    destination: string,
  ): Promise<OfficialPoi[]> {
    const allPois: OfficialPoi[] = [];
    const seenNames = new Set<string>();
    const source = new URL(site.url).hostname;
    const baseUrl = site.url.replace(/\/+$/, '');

    // Pages likely to have POI listings
    const destLower = destination.toLowerCase().replace(/\s+/g, '-');
    const pagesToScrape = [
      site.url,
      `${baseUrl}/destinations`,
      `${baseUrl}/places-to-visit`,
      `${baseUrl}/places`,
      `${baseUrl}/tourist-places`,
      `${baseUrl}/attractions`,
      `${baseUrl}/top-destinations`,
      `${baseUrl}/${destLower}`,
      `${baseUrl}/destination/${destLower}`,
      `${baseUrl}/places-to-visit-in-${destLower}`,
    ];

    // Scrape in parallel batches
    const batchSize = 4;
    for (let i = 0; i < pagesToScrape.length; i += batchSize) {
      const batch = pagesToScrape.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map(url => this.fetchAndExtractPois(url, site.name, source)),
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          for (const poi of result.value) {
            const key = poi.name.toLowerCase().trim();
            if (!seenNames.has(key) && key.length > 2) {
              seenNames.add(key);
              allPois.push(poi);
            }
          }
        }
      }
    }

    // Cap at 30 POIs per destination
    return allPois.slice(0, 30);
  }

  /**
   * Fetch a single page and extract POI-like items.
   */
  private async fetchAndExtractPois(
    url: string,
    stateName: string,
    source: string,
  ): Promise<OfficialPoi[]> {
    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent': this.userAgent,
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        timeout: 12000,
        maxRedirects: 3,
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

      return this.extractPois(html, stateName, source);
    } catch {
      return [];
    }
  }

  /**
   * Parse HTML and extract place names from structured content.
   * Looks for: cards, list items, headings near POI section keywords,
   * destination links, image captions in tourism-style layouts.
   */
  private extractPois(html: string, stateName: string, source: string): OfficialPoi[] {
    const $ = cheerio.load(html);
    const pois: OfficialPoi[] = [];

    // Remove noise
    $('script, style, nav, footer, header, .menu, .nav, #menu, #nav, form, iframe').remove();

    // Strategy 1: Look for destination/attraction cards (common in tourism sites)
    const cardSelectors = [
      '.destination-card', '.place-card', '.attraction-card', '.tour-card',
      '.card', '.item', '.destination-item', '.place-item',
      '.grid-item', '.col-item', '.tourism-card',
    ];

    for (const selector of cardSelectors) {
      $(selector).each((_, el) => {
        const title = $(el).find('h2, h3, h4, h5, .title, .name, .card-title, .heading').first().text().trim();
        const desc = $(el).find('p, .description, .card-text, .excerpt, .summary').first().text().trim();

        if (title && title.length > 2 && title.length < 80 && this.isValidPoiName(title)) {
          pois.push({
            name: this.cleanPoiName(title),
            category: classifyPoiCategory(title + ' ' + desc),
            description: desc ? desc.substring(0, 200) : undefined,
            state: stateName,
            source,
          });
        }
      });
    }

    // Strategy 2: Find sections with POI keywords, then extract nearby list items / headings
    $('h1, h2, h3, h4, h5').each((_, heading) => {
      const headingText = $(heading).text().toLowerCase().trim();
      const isPOISection = POI_SECTION_KEYWORDS.some(kw => headingText.includes(kw));

      if (isPOISection) {
        // Get the next sibling elements (list, grid, or paragraphs after this heading)
        const nextElements = $(heading).nextAll().slice(0, 10);
        nextElements.each((_, el) => {
          // Extract from list items
          if ($(el).is('ul, ol')) {
            $(el).find('li').each((_, li) => {
              const text = $(li).text().trim().split('\n')[0].trim();
              if (text.length > 2 && text.length < 80 && this.isValidPoiName(text)) {
                pois.push({
                  name: this.cleanPoiName(text),
                  category: classifyPoiCategory(text),
                  state: stateName,
                  source,
                });
              }
            });
          }
          // Extract from linked items
          $(el).find('a').each((_, a) => {
            const linkText = $(a).text().trim();
            if (linkText.length > 2 && linkText.length < 80 && this.isValidPoiName(linkText)) {
              pois.push({
                name: this.cleanPoiName(linkText),
                category: classifyPoiCategory(linkText),
                state: stateName,
                source,
              });
            }
          });
        });
      }
    });

    // Strategy 3: Find links that look like destination pages  
    $('a[href*="destination"], a[href*="place"], a[href*="attraction"], a[href*="visit"]').each((_, a) => {
      const text = $(a).text().trim();
      if (text.length > 2 && text.length < 80 && this.isValidPoiName(text)) {
        pois.push({
          name: this.cleanPoiName(text),
          category: classifyPoiCategory(text),
          state: stateName,
          source,
        });
      }
    });

    return pois;
  }

  /**
   * Filter out non-place text (navigation items, generic labels, etc.)
   */
  private isValidPoiName(name: string): boolean {
    const lower = name.toLowerCase();
    // Reject navigation/UI text
    const rejectPatterns = [
      /^home$/i, /^about$/i, /^contact$/i, /^login$/i, /^register$/i,
      /^read more$/i, /^view more$/i, /^click here$/i, /^see all$/i,
      /^back$/i, /^next$/i, /^previous$/i, /^menu$/i, /^search$/i,
      /^book now$/i, /^plan your trip$/i, /^enquiry$/i, /^feedback$/i,
      /^privacy policy$/i, /^terms$/i, /^sitemap$/i, /^gallery$/i,
      /^how to reach$/i, /^where to stay$/i, /^getting there$/i,
      /^\d+$/, /^[+\-*/=]/, // numbers only, operators
    ];

    if (rejectPatterns.some(p => p.test(lower))) return false;
    if (lower.length < 3) return false;
    // Must have at least one letter
    if (!/[a-zA-Z]/.test(name)) return false;
    // Reject if too many special characters
    const specialCount = (name.match(/[^a-zA-Z0-9\s\-'.(),&]/g) || []).length;
    if (specialCount > 3) return false;
    return true;
  }

  /**
   * Clean up POI name — remove trailing punctuation, excess whitespace, numbering.
   */
  private cleanPoiName(name: string): string {
    return name
      .replace(/^\d+[\.\)\-\s]+/, '')  // Remove leading numbers "1. ", "12) "
      .replace(/\s+/g, ' ')
      .replace(/[,;:]+$/, '')
      .trim();
  }

  // ─── GEOCODING ─────────────────────────────────────────────────────────

  /**
   * Geocode all POIs using GeoService (Google Maps → Nominatim fallback).
   * Adds lat/lng/formattedAddress to each POI.
   */
  private async geocodePois(pois: OfficialPoi[], destination: string): Promise<OfficialPoi[]> {
    const toGeocode = pois.slice(0, 20); // Cap geocoding calls

    // Build geocode requests
    const placeNames = toGeocode.map(p => p.name);
    const geoResults = await this.geoService.geocodeBatch(placeNames, destination);

    // Merge coordinates back
    for (const poi of toGeocode) {
      const geo = geoResults.get(poi.name);
      if (geo) {
        poi.lat = geo.lat;
        poi.lng = geo.lng;
        poi.formattedAddress = geo.formattedAddress;
      }
    }

    return toGeocode;
  }

  // ─── GEMINI CONTEXT ────────────────────────────────────────────────────

  /**
   * Build text block for Gemini prompt injection.
   * Lists official POIs so the AI uses verified attractions.
   */
  private buildGeminiContext(stateName: string, pois: OfficialPoi[], destination: string): string {
    if (pois.length === 0) return '';

    const poiLines = pois.slice(0, 15).map((p, i) => {
      const coords = p.lat && p.lng ? ` | GPS: ${p.lat.toFixed(4)},${p.lng.toFixed(4)}` : '';
      const desc = p.description ? ` — ${p.description.substring(0, 80)}` : '';
      return `${i + 1}. ${p.name} [${p.category}]${desc}${coords}`;
    });

    return `== OFFICIAL TOURISM POIs (${stateName} Tourism Board) ==
Source: ${stateName} State Tourism Website — verified attractions for ${destination}
PRIORITY: Use these official spots FIRST, then supplement with Google Places data.
${poiLines.join('\n')}`;
  }
}
