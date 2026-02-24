import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';

export interface Airport {
  iata: string;
  name: string;
  city: string;
  region: string;   // e.g. "IN-KL"
  country: string;  // e.g. "IN"
  lat: number;
  lng: number;
  keywords: string;
  type: string;
  scheduled: boolean;
}

/**
 * AirportService — In-memory airport database loaded from airports.json (OurAirports).
 * 
 * Provides multi-strategy IATA resolution:
 *  1. Direct IATA code pass-through
 *  2. Exact city/name match
 *  3. Country → capital/hub airport
 *  4. Region/state → nearest major airport
 *  5. Keyword search (Wikipedia keywords in the dataset)
 *  6. Fuzzy substring matching
 *  7. Geo-distance to nearest airport (when lat/lng available)
 */
@Injectable()
export class AirportService implements OnModuleInit {
  private readonly logger = new Logger(AirportService.name);
  private airports: Airport[] = [];

  // Fast lookup indices
  private byIata = new Map<string, Airport>();
  private byCity = new Map<string, Airport[]>();        // lowercase city → airports
  private byCountry = new Map<string, Airport[]>();     // ISO country → airports
  private byRegion = new Map<string, Airport[]>();      // ISO region → airports

  // Indian state name → ISO region code
  private readonly indianStateMap: Record<string, string> = {
    'kerala': 'IN-KL', 'kerela': 'IN-KL',
    'karnataka': 'IN-KA', 'tamil nadu': 'IN-TN', 'tamilnadu': 'IN-TN',
    'andhra pradesh': 'IN-AP', 'telangana': 'IN-TG',
    'maharashtra': 'IN-MH', 'west bengal': 'IN-WB',
    'rajasthan': 'IN-RJ', 'uttar pradesh': 'IN-UP',
    'gujarat': 'IN-GJ', 'madhya pradesh': 'IN-MP',
    'odisha': 'IN-OR', 'orissa': 'IN-OR',
    'punjab': 'IN-PB', 'assam': 'IN-AS',
    'jharkhand': 'IN-JH', 'chhattisgarh': 'IN-CT',
    'uttarakhand': 'IN-UT', 'himachal pradesh': 'IN-HP',
    'jammu and kashmir': 'IN-JK', 'jammu & kashmir': 'IN-JK',
    'goa': 'IN-GA', 'sikkim': 'IN-SK',
    'meghalaya': 'IN-ML', 'manipur': 'IN-MN',
    'mizoram': 'IN-MZ', 'nagaland': 'IN-NL',
    'tripura': 'IN-TR', 'arunachal pradesh': 'IN-AR',
    'ladakh': 'IN-LA', 'bihar': 'IN-BR',
    'haryana': 'IN-HR',
    'andaman': 'IN-AN', 'andaman and nicobar': 'IN-AN',
    'pondicherry': 'IN-PY', 'puducherry': 'IN-PY',
  };

  // Country name → ISO code (common ones)
  private readonly countryMap: Record<string, string> = {
    'india': 'IN', 'united states': 'US', 'usa': 'US',
    'united kingdom': 'GB', 'uk': 'GB', 'thailand': 'TH',
    'japan': 'JP', 'australia': 'AU', 'canada': 'CA',
    'france': 'FR', 'germany': 'DE', 'italy': 'IT',
    'spain': 'ES', 'netherlands': 'NL', 'switzerland': 'CH',
    'turkey': 'TR', 'south korea': 'KR', 'china': 'CN',
    'indonesia': 'ID', 'vietnam': 'VN', 'malaysia': 'MY',
    'philippines': 'PH', 'sri lanka': 'LK', 'nepal': 'NP',
    'bangladesh': 'BD', 'uae': 'AE', 'united arab emirates': 'AE',
    'saudi arabia': 'SA', 'qatar': 'QA', 'oman': 'OM',
    'egypt': 'EG', 'kenya': 'KE', 'south africa': 'ZA',
    'new zealand': 'NZ', 'mexico': 'MX', 'brazil': 'BR',
    'singapore': 'SG', 'maldives': 'MV', 'portugal': 'PT',
    'greece': 'GR', 'ireland': 'IE', 'russia': 'RU',
    'sweden': 'SE', 'norway': 'NO', 'denmark': 'DK',
    'finland': 'FI', 'austria': 'AT', 'belgium': 'BE',
    'czech republic': 'CZ', 'czechia': 'CZ', 'poland': 'PL',
    'hungary': 'HU', 'romania': 'RO', 'morocco': 'MA',
    'tanzania': 'TZ', 'nigeria': 'NG', 'ghana': 'GH',
    'ethiopia': 'ET', 'colombia': 'CO', 'argentina': 'AR',
    'chile': 'CL', 'peru': 'PE', 'cuba': 'CU',
    'cambodia': 'KH', 'myanmar': 'MM', 'laos': 'LA',
    'pakistan': 'PK', 'iran': 'IR', 'iraq': 'IQ',
    'jordan': 'JO', 'lebanon': 'LB', 'israel': 'IL',
    'taiwan': 'TW', 'mongolia': 'MN', 'fiji': 'FJ',
    'mauritius': 'MU', 'seychelles': 'SC',
  };

  // Tourist destinations / places without airports → nearest IATA code
  private readonly touristMap: Record<string, string> = {
    // Kerala
    'munnar': 'COK', 'thekkady': 'COK', 'alleppey': 'COK', 'alappuzha': 'COK',
    'kumarakom': 'COK', 'fort kochi': 'COK', 'ernakulam': 'COK',
    'kovalam': 'TRV', 'varkala': 'TRV', 'poovar': 'TRV', 'kollam': 'TRV',
    'wayanad': 'CCJ', 'bekal': 'CNN', 'kasaragod': 'CNN',
    'thrissur': 'COK', 'palakkad': 'COK', 'guruvayur': 'COK',
    // Rajasthan
    'pushkar': 'JAI', 'ranthambore': 'JAI', 'mount abu': 'UDR',
    'jaisalmer': 'JSA', 'bikaner': 'JDH',
    // Himachal / Uttarakhand
    'manali': 'KUU', 'shimla': 'SLV', 'dharamshala': 'DHM', 'mcleodganj': 'DHM',
    'rishikesh': 'DED', 'haridwar': 'DED', 'mussoorie': 'DED',
    'nainital': 'PGH', 'jim corbett': 'PGH', 'auli': 'DED',
    // Northeast India
    'darjeeling': 'IXB', 'siliguri': 'IXB', 'gangtok': 'IXB',
    'kaziranga': 'JRH', 'shillong': 'SHL', 'tawang': 'IXB',
    'cherrapunji': 'SHL', 'meghalaya': 'SHL',
    // Tamil Nadu
    'ooty': 'CJB', 'kodaikanal': 'IXM', 'mahabalipuram': 'MAA',
    'pondicherry': 'MAA', 'puducherry': 'MAA', 'rameswaram': 'IXM',
    // Karnataka
    'coorg': 'MYQ', 'hampi': 'BLR', 'mysore': 'MYQ', 'mysuru': 'MYQ',
    // Goa
    'north goa': 'GOI', 'south goa': 'GOI', 'panjim': 'GOI', 'panaji': 'GOI',
    // J&K / Ladakh
    'leh': 'IXL', 'ladakh': 'IXL', 'kashmir': 'SXR', 'pahalgam': 'SXR', 'gulmarg': 'SXR',
    // Andaman
    'andaman': 'IXZ', 'port blair': 'IXZ', 'havelock': 'IXZ', 'neil island': 'IXZ',
    // International tourist destinations
    'pattaya': 'BKK', 'chiang mai': 'CNX', 'krabi': 'KBV', 'koh samui': 'USM',
    'ubud': 'DPS', 'nusa dua': 'DPS', 'seminyak': 'DPS', 'kuta': 'DPS',
    'siem reap': 'REP', 'ha long bay': 'HAN', 'hoi an': 'DAD', 'da nang': 'DAD',
    'langkawi': 'LGK', 'penang': 'PEN', 'cameron highlands': 'KUL',
    'santorini': 'JTR', 'mykonos': 'JMK', 'crete': 'HER', 'rhodes': 'RHO',
    'amalfi': 'NAP', 'positano': 'NAP', 'cinque terre': 'GOA', 'tuscany': 'FLR',
    'interlaken': 'BRN', 'zermatt': 'ZRH', 'lucerne': 'ZRH',
    'machu picchu': 'CUZ', 'cusco': 'CUZ', 'galapagos': 'GPS',
    'niagara falls': 'BUF', 'yellowstone': 'WYS', 'grand canyon': 'FLG',
    'cancun': 'CUN', 'tulum': 'CUN', 'playa del carmen': 'CUN',
    'kyoto': 'KIX', 'osaka': 'KIX', 'mount fuji': 'FSZ', 'hokkaido': 'CTS',
    'queenstown': 'ZQN', 'rotorua': 'ROT', 'milford sound': 'ZQN',
    'cape town': 'CPT', 'kruger park': 'MQP', 'victoria falls': 'VFA',
    'zanzibar': 'ZNZ', 'serengeti': 'JRO', 'masai mara': 'NBO',
  };

  onModuleInit() {
    this.loadAirports();
  }

  private loadAirports() {
    try {
      // Try multiple paths (handles both dev src/ and compiled dist/)
      const candidates = [
        path.join(__dirname, '..', 'data', 'airports.json'),
        path.join(__dirname, '..', '..', 'src', 'data', 'airports.json'),
        path.join(process.cwd(), 'src', 'data', 'airports.json'),
      ];
      let jsonPath = '';
      for (const p of candidates) {
        if (fs.existsSync(p)) { jsonPath = p; break; }
      }
      if (!jsonPath) {
        throw new Error(`airports.json not found. Tried: ${candidates.join(', ')}`);
      }
      const raw = fs.readFileSync(jsonPath, 'utf8');
      this.airports = JSON.parse(raw) as Airport[];

      // Build indices
      for (const ap of this.airports) {
        this.byIata.set(ap.iata, ap);

        const cityKey = ap.city.toLowerCase();
        if (cityKey) {
          if (!this.byCity.has(cityKey)) this.byCity.set(cityKey, []);
          this.byCity.get(cityKey)!.push(ap);
        }

        if (!this.byCountry.has(ap.country)) this.byCountry.set(ap.country, []);
        this.byCountry.get(ap.country)!.push(ap);

        if (!this.byRegion.has(ap.region)) this.byRegion.set(ap.region, []);
        this.byRegion.get(ap.region)!.push(ap);
      }

      this.logger.log(
        `✈️ Airport database loaded: ${this.airports.length} airports, ` +
        `${this.byCity.size} cities, ${this.byCountry.size} countries, ${this.byRegion.size} regions`
      );
    } catch (err) {
      this.logger.error(`Failed to load airport database: ${err.message}`);
    }
  }

  // Well-known hub airports — used to break ties when multiple large airports exist in same region
  private readonly hubPriority: Record<string, number> = {
    // Global mega-hubs
    'JFK': 100, 'LHR': 100, 'DXB': 100, 'SIN': 100, 'HND': 99, 'CDG': 99,
    'FRA': 98, 'AMS': 98, 'ICN': 98, 'PEK': 98, 'HKG': 97, 'SYD': 97,
    'BKK': 97, 'NRT': 96, 'LAX': 96, 'ORD': 95, 'ATL': 95,
    // Indian major hubs
    'DEL': 95, 'BOM': 94, 'BLR': 93, 'MAA': 92, 'HYD': 91, 'CCU': 90,
    'COK': 89, 'GOI': 88, 'PNQ': 87, 'AMD': 86, 'JAI': 86, 'TRV': 85,
    'CCJ': 84, 'CNN': 83,
    // SE Asia / Oceania
    'DPS': 90, 'KUL': 92, 'MNL': 90, 'CGK': 91, 'MEL': 91, 'AKL': 88,
    'MLE': 95, 'CMB': 88, 'KTM': 85, 'DAC': 84, 'HKT': 86, 'CNX': 82,
    // Middle East
    'AUH': 92, 'DOH': 92, 'RUH': 88, 'MCT': 85,
    // Europe
    'FCO': 90, 'MAD': 90, 'BCN': 89, 'IST': 91, 'ZRH': 88, 'MUC': 88,
  };

  /**
   * Pick the "best" airport from a list — prefers scheduled large airports,
   * then uses hub-priority for tie-breaking.
   */
  private pickBest(airports: Airport[]): Airport | null {
    if (!airports || airports.length === 0) return null;

    const typeScore = (t: string) => {
      if (t === 'large_airport') return 4;
      if (t === 'medium_airport') return 3;
      if (t === 'small_airport') return 2;
      return 1;
    };

    return [...airports].sort((a, b) => {
      // Scheduled first
      if (a.scheduled !== b.scheduled) return a.scheduled ? -1 : 1;
      // Then by type
      const typeDiff = typeScore(b.type) - typeScore(a.type);
      if (typeDiff !== 0) return typeDiff;
      // Then by hub priority
      const hubA = this.hubPriority[a.iata] || 0;
      const hubB = this.hubPriority[b.iata] || 0;
      return hubB - hubA;
    })[0];
  }

  /**
   * Search airports by keyword field. Returns the best match (prefers large/scheduled).
   */
  private findByKeyword(query: string): Airport | null {
    const matches: Airport[] = [];
    for (const ap of this.airports) {
      if (!ap.keywords) continue;
      const kw = ap.keywords.toLowerCase();
      // Match: query appears as a distinct keyword segment
      if (kw.includes(query)) {
        matches.push(ap);
      }
    }
    return this.pickBest(matches);
  }

  /**
   * Resolve any location string to an IATA code.
   * 
   * Strategies (in order):
   *  1. Already an IATA code → pass through
   *  2. Exact city match
   *  3. Indian state → largest airport in that region
   *  4. Country name → largest airport in that country
   *  5. Comma-separated parts ("Kochi, Kerala")
   *  6. Individual word matching ("North Goa" → goa)
   *  7. Keywords in airport dataset
   *  8. Fuzzy substring (city names containing or contained in query)
   */
  resolveIATA(location: string): { iata: string; airport?: Airport; method: string } {
    const trimmed = location.trim();
    if (!trimmed) return { iata: trimmed, method: 'empty' };

    // 1. Already IATA code — but check if it's also a country/state name first
    if (/^[A-Z]{3}$/.test(trimmed)) {
      // Avoid false positives: 'USA', 'UAE', etc. are country names, not airports
      const lowerCheck = trimmed.toLowerCase();
      if (this.countryMap[lowerCheck]) {
        const countryCode = this.countryMap[lowerCheck];
        const countryAirports = this.byCountry.get(countryCode);
        if (countryAirports) {
          const best = this.pickBest(countryAirports);
          if (best) return { iata: best.iata, airport: best, method: `country→${countryCode}` };
        }
      }
      const ap = this.byIata.get(trimmed);
      return { iata: trimmed, airport: ap || undefined, method: 'iata-direct' };
    }

    const lower = trimmed.toLowerCase();

    // 2. Tourist destination / place without airport → nearest airport
    const touristIata = this.touristMap[lower];
    if (touristIata) {
      const ap = this.byIata.get(touristIata);
      return { iata: touristIata, airport: ap || undefined, method: 'tourist-map' };
    }

    // 3. Exact city match — but verify quality (prefer large/scheduled over small)
    const cityMatch = this.byCity.get(lower);
    if (cityMatch) {
      const best = this.pickBest(cityMatch);
      if (best && (best.scheduled || best.type === 'large_airport' || best.type === 'medium_airport')) {
        return { iata: best.iata, airport: best, method: 'city-exact' };
      }
      // If city only has small/unscheduled airports, try keyword match first (step 7)
      // e.g. "bali" as city = BLC small_airport, but DPS has "Bali" in keywords
      const kwMatch = this.findByKeyword(lower);
      if (kwMatch && (kwMatch.scheduled || kwMatch.type === 'large_airport')) {
        return { iata: kwMatch.iata, airport: kwMatch, method: 'keyword-over-city' };
      }
      // Fall back to small airport match
      if (best) return { iata: best.iata, airport: best, method: 'city-exact' };
    }

    // 3. Indian state lookup
    const stateRegion = this.indianStateMap[lower];
    if (stateRegion) {
      const regionAirports = this.byRegion.get(stateRegion);
      if (regionAirports) {
        const best = this.pickBest(regionAirports);
        if (best) return { iata: best.iata, airport: best, method: `state→${stateRegion}` };
      }
    }

    // 4. Country name lookup
    const countryCode = this.countryMap[lower];
    if (countryCode) {
      const countryAirports = this.byCountry.get(countryCode);
      if (countryAirports) {
        const best = this.pickBest(countryAirports);
        if (best) return { iata: best.iata, airport: best, method: `country→${countryCode}` };
      }
    }

    // 5. Comma-separated parts (e.g. "Munnar, Kerala") — only if there's actually a comma
    if (lower.includes(',')) {
      const parts = lower.split(',').map(p => p.trim()).filter(Boolean);
      for (const part of parts) {
        // Avoid recursion: only resolve if part differs from original
        if (part !== lower) {
          const r = this.resolveIATA(part);
          if (r.airport) return { ...r, method: `comma-part(${part})` };
        }
      }
    }

    // 6. Individual word matching (e.g. "North Goa" → "goa")
    const words = lower.split(/[\s,]+/).filter(w => w.length > 2);
    for (const word of words) {
      const cm = this.byCity.get(word);
      if (cm) {
        const best = this.pickBest(cm);
        if (best) return { iata: best.iata, airport: best, method: `word(${word})` };
      }
      // Also check state map
      if (this.indianStateMap[word]) {
        const regionAirports = this.byRegion.get(this.indianStateMap[word]);
        if (regionAirports) {
          const best = this.pickBest(regionAirports);
          if (best) return { iata: best.iata, airport: best, method: `word-state(${word})` };
        }
      }
    }

    // 7. Keyword search in airport data
    const kwAirport = this.findByKeyword(lower);
    if (kwAirport) {
      return { iata: kwAirport.iata, airport: kwAirport, method: 'keyword' };
    }

    // 8. Fuzzy: city names containing query or vice versa
    const fuzzyMatches: Airport[] = [];
    for (const [city, aps] of this.byCity.entries()) {
      if (city.includes(lower) || lower.includes(city)) {
        fuzzyMatches.push(...aps);
      }
    }
    if (fuzzyMatches.length > 0) {
      const best = this.pickBest(fuzzyMatches);
      if (best) return { iata: best.iata, airport: best, method: 'fuzzy-city' };
    }

    // 9. Airport name contains query
    const nameMatches = this.airports.filter(a =>
      a.name.toLowerCase().includes(lower)
    );
    if (nameMatches.length > 0) {
      const best = this.pickBest(nameMatches);
      if (best) return { iata: best.iata, airport: best, method: 'name-match' };
    }

    // No match — return raw string
    this.logger.warn(`⚠️ Could not resolve IATA for "${trimmed}", passing raw`);
    return { iata: trimmed, method: 'unresolved' };
  }

  /**
   * Get airport details by IATA code
   */
  getByIata(iata: string): Airport | undefined {
    return this.byIata.get(iata.toUpperCase());
  }

  /**
   * Find nearest airport to given coordinates
   */
  findNearest(lat: number, lng: number, country?: string): Airport | null {
    const candidates = country
      ? (this.byCountry.get(country) || this.airports)
      : this.airports;

    // Only consider scheduled airports
    const scheduled = candidates.filter(a => a.scheduled);
    if (scheduled.length === 0) return this.pickBest(candidates);

    let nearest: Airport | null = null;
    let minDist = Infinity;

    for (const ap of scheduled) {
      const dlat = ap.lat - lat;
      const dlng = ap.lng - lng;
      const dist = dlat * dlat + dlng * dlng; // squared distance is fine for comparison
      if (dist < minDist) {
        minDist = dist;
        nearest = ap;
      }
    }
    return nearest;
  }

  /**
   * Search airports by query (for autocomplete)
   */
  search(query: string, limit = 10): Airport[] {
    const lower = query.toLowerCase();
    const results: Array<{ airport: Airport; score: number }> = [];

    for (const ap of this.airports) {
      let score = 0;
      if (ap.iata.toLowerCase() === lower) score = 100;
      else if (ap.city.toLowerCase() === lower) score = 90;
      else if (ap.city.toLowerCase().startsWith(lower)) score = 80;
      else if (ap.name.toLowerCase().includes(lower)) score = 70;
      else if (ap.city.toLowerCase().includes(lower)) score = 60;
      else if (ap.keywords.toLowerCase().includes(lower)) score = 50;
      else continue;

      // Boost scheduled large airports
      if (ap.scheduled) score += 5;
      if (ap.type === 'large_airport') score += 3;

      results.push({ airport: ap, score });
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(r => r.airport);
  }
}
