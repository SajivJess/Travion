import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import {
  EasemytripService,
  EmtBusTrip,
  EmtSearchResult,
  EmtTrain,
  EmtTrainSearchResult,
} from './easemytrip.service';

export interface BusTrainOption {
  departureTime: string;
  arrivalTime: string;
  duration: string;
  price: number;
  operator: string;
  stops: number;
  type: 'bus' | 'train';
  bookingUrl?: string;
  thumbnail?: string;
  fast?: boolean;
  // EaseMyTrip bus-specific enrichments
  busType?: string;          // "AC Sleeper (2+1)"
  availableSeats?: number;
  isAC?: boolean;
  amenities?: string[];
  boardingPoints?: string[];
  droppingPoints?: string[];
  // EaseMyTrip train-specific enrichments
  trainNumber?: string;       // "12007"
  trainName?: string;         // "Mys Shatabdi"
  trainType?: string;         // "Shatabdi", "Rajdhani", "Express"
  distance?: string;          // "362" km
  classes?: { code: string; name: string; price: number }[];
  availability?: string;      // "AVAILABLE-489", "RAC-12", "WL-5"
  runningDays?: string[];     // ["Mon","Tue","Wed",...]
}

export interface TransportResult {
  mode: 'flight' | 'bus' | 'train';
  options: BusTrainOption[];
  cheapest: BusTrainOption | null;
  fastest: BusTrainOption | null;
  recommended: BusTrainOption | null;
  dailyCount: number;
  arrivalTime: string;
  travelDuration: string;
  cheapestPrice?: string;    // e.g. "₹753"
  fastestDuration?: string;  // e.g. "12h 25m"
  source?: string;           // "easemytrip" | "serpapi"
}

@Injectable()
export class TransportService {
  private readonly logger = new Logger(TransportService.name);
  private readonly serpApiKeys: string[];
  private currentKeyIndex = 0;

  constructor(private readonly easemytripService: EasemytripService) {
    this.serpApiKeys = [
      process.env.SERP_API_KEY,
      process.env.SERP_API_KEY_2,
      process.env.SERP_API_KEY_3,
      process.env.SERP_API_KEY_4,
      process.env.SERP_API_KEY_5,
    ].filter(Boolean) as string[];

    if (this.serpApiKeys.length === 0) {
      this.logger.warn('⚠️ No SERP_API_KEY configured – SerpAPI fallback disabled');
    }

    this.logger.log(
      `🚌🚆 TransportService initialized | EaseMyTrip: primary (bus+train) | SerpAPI fallback: ${this.serpApiKeys.length} key(s)`,
    );
  }

  private getNextApiKey(): string {
    const key = this.serpApiKeys[this.currentKeyIndex];
    this.currentKeyIndex = (this.currentKeyIndex + 1) % this.serpApiKeys.length;
    return key;
  }

  // ─── MAIN ENTRY: BUS / TRAIN SEARCH ─────────────────────────────────────

  /**
   * Search bus/train options between two cities.
   *
   * Pipeline:
   *   1. Bus → EaseMyTrip (real-time, rich data)
   *   2. Fallback → SerpAPI Google answer_box
   *   3. Train → EaseMyTrip (real-time, prices, seat availability)
   *   4. Fallback → SerpAPI Google answer_box
   */
  async searchBusTrainOptions(
    source: string,
    destination: string,
    date: Date,
    transportMode: 'bus' | 'train' = 'bus',
  ): Promise<TransportResult | null> {
    // ── Bus: EaseMyTrip primary, SerpAPI fallback ────────────────────────
    if (transportMode === 'bus') {
      this.logger.log(`🔍 Bus search: ${source} → ${destination} [EaseMyTrip primary]`);

      const emtResult = await this.searchBusViaEasemytrip(source, destination, date);
      if (emtResult && emtResult.options.length > 0) {
        return emtResult;
      }

      this.logger.log('🔄 EaseMyTrip returned 0 buses – falling back to SerpAPI');
      return this.searchViaSerpApi(source, destination, date, 'bus');
    }

    // ── Train: EaseMyTrip primary, SerpAPI fallback ──────────────────────
    this.logger.log(`🔍 Train search: ${source} → ${destination} [EaseMyTrip primary]`);

    const emtTrainResult = await this.searchTrainViaEasemytrip(source, destination, date);
    if (emtTrainResult && emtTrainResult.options.length > 0) {
      return emtTrainResult;
    }

    this.logger.log('🔄 EaseMyTrip returned 0 trains – falling back to SerpAPI');
    return this.searchViaSerpApi(source, destination, date, 'train');
  }

  // ─── EASEMYTRIP BUS SEARCH ──────────────────────────────────────────────

  /**
   * Search buses via EaseMyTrip's open API and convert to TransportResult.
   */
  private async searchBusViaEasemytrip(
    source: string,
    destination: string,
    date: Date,
  ): Promise<TransportResult | null> {
    try {
      const emtData = await this.easemytripService.searchBuses(source, destination, date);
      if (!emtData || emtData.AvailableTrips.length === 0) return null;

      return this.convertEmtToTransportResult(emtData, source, destination);
    } catch (error: any) {
      this.logger.error(`❌ EaseMyTrip bus search failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Convert EaseMyTrip response into our standardised TransportResult.
   */
  private convertEmtToTransportResult(
    data: EmtSearchResult,
    source: string,
    destination: string,
  ): TransportResult {
    const trips = data.AvailableTrips;

    // Sort by price ascending, then take top options
    const sorted = [...trips]
      .filter(t => this.emtTripPrice(t) > 0)
      .sort((a, b) => this.emtTripPrice(a) - this.emtTripPrice(b));

    // Build options (cap at 8 for response size)
    const options: BusTrainOption[] = sorted.slice(0, 8).map(trip =>
      this.convertEmtTrip(trip, source, destination),
    );

    // Also include the fastest trip if not already present
    const allByDuration = [...trips].sort(
      (a, b) => this.parseMinutes(a.duration) - this.parseMinutes(b.duration),
    );
    const fastestTrip = allByDuration[0];
    if (fastestTrip && !options.find(o => o.operator === (fastestTrip.Travels || '').trim())) {
      const fastOpt = this.convertEmtTrip(fastestTrip, source, destination);
      fastOpt.fast = true;
      options.push(fastOpt);
    }

    const cheapest = options.length > 0 ? options[0] : null; // already sorted by price
    const fastest =
      options.reduce((min, o) =>
        this.parseMinutes(o.duration) < this.parseMinutes(min.duration) ? o : min,
        options[0],
      ) || null;

    // Recommended: best value = balance of price + speed
    const recommended = this.pickRecommended(options) || cheapest;

    const dailyCount = data.TotalTrips || trips.length;

    this.logger.log(
      `✅ EaseMyTrip: ${dailyCount} buses | cheapest ₹${data.MinPrice} | ${options.length} returned`,
    );

    return {
      mode: 'bus',
      options,
      cheapest,
      fastest,
      recommended,
      dailyCount,
      arrivalTime: recommended?.arrivalTime || fastest?.arrivalTime || 'Unknown',
      travelDuration: recommended?.duration || fastest?.duration || 'Unknown',
      cheapestPrice: `₹${data.MinPrice}`,
      fastestDuration: fastest?.duration,
      source: 'easemytrip',
    };
  }

  /**
   * Convert a single EaseMyTrip trip into BusTrainOption.
   */
  private convertEmtTrip(
    trip: EmtBusTrip,
    source: string,
    destination: string,
  ): BusTrainOption {
    const price = this.emtTripPrice(trip);
    const operator = (trip.Travels || '').trim() || 'Unknown Operator';

    // Build a clean bus type label
    const busType = (trip.busType || '').replace(/\s*,\s*$/, '').trim();

    // Build boarding points list
    const boardingPoints = (trip.bdPoints || [])
      .slice(0, 3)
      .map(bp => bp.bdLongName || bp.bdPoint);

    const droppingPoints = (trip.dpPoints || [])
      .slice(0, 3)
      .map(dp => dp.dpName);

    // Build booking URL: EaseMyTrip bus page
    const src = encodeURIComponent(source.toLowerCase());
    const dst = encodeURIComponent(destination.toLowerCase());
    const bookingUrl = `https://bus.easemytrip.com/home/list?org=${src}&des=${dst}`;

    return {
      departureTime: trip.departureTime || 'N/A',
      arrivalTime: trip.ArrivalTime || 'N/A',
      duration: trip.duration || 'N/A',
      price,
      operator,
      stops: 0, // EaseMyTrip doesn't expose stop count
      type: 'bus',
      bookingUrl,
      fast: false,
      busType: busType || undefined,
      availableSeats: parseInt(trip.AvailableSeats, 10) || undefined,
      isAC: trip.AC ?? undefined,
      amenities: trip.lstamenities || undefined,
      boardingPoints: boardingPoints.length > 0 ? boardingPoints : undefined,
      droppingPoints: droppingPoints.length > 0 ? droppingPoints : undefined,
    };
  }

  /**
   * Extract the numeric fare from an EMT trip.
   * Prefers fareDetail[0].baseFare, falls back to trip.price / trip.amount.
   */
  private emtTripPrice(trip: EmtBusTrip): number {
    if (trip.fareDetail?.length > 0) {
      const base = parseInt(String(trip.fareDetail[0].baseFare), 10);
      if (!isNaN(base) && base > 0) return base;
    }
    if (typeof trip.price === 'number' && trip.price > 0) return trip.price;
    if (typeof trip.amount === 'number' && trip.amount > 0) return trip.amount;
    return 0;
  }

  // ─── EASEMYTRIP TRAIN SEARCH ────────────────────────────────────────────

  /**
   * Search trains via EaseMyTrip's railway API and convert to TransportResult.
   * Returns real-time data: prices per class, seat availability, running days.
   */
  private async searchTrainViaEasemytrip(
    source: string,
    destination: string,
    date: Date,
  ): Promise<TransportResult | null> {
    try {
      const emtData = await this.easemytripService.searchTrains(source, destination, date);
      if (!emtData || emtData.trainBtwnStnsList.length === 0) return null;

      return this.convertEmtTrainToTransportResult(emtData, source, destination);
    } catch (error: any) {
      this.logger.error(`❌ EaseMyTrip train search failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Convert EaseMyTrip train response into our standardised TransportResult.
   */
  private convertEmtTrainToTransportResult(
    data: EmtTrainSearchResult,
    source: string,
    destination: string,
  ): TransportResult {
    const trains = data.trainBtwnStnsList;

    // Sort by cheapest class price ascending
    const sorted = [...trains].sort(
      (a, b) => this.emtTrainCheapestPrice(a) - this.emtTrainCheapestPrice(b),
    );

    // Build options (cap at 10 for response size — trains have rich data)
    const options: BusTrainOption[] = sorted.slice(0, 10).map(train =>
      this.convertEmtTrain(train, source, destination),
    );

    // Include the fastest train if not already present
    const allByDuration = [...trains].sort(
      (a, b) => this.parseMinutes(a.duration) - this.parseMinutes(b.duration),
    );
    const fastestTrain = allByDuration[0];
    if (fastestTrain && !options.find(o => o.trainNumber === fastestTrain.trainNumber)) {
      const fastOpt = this.convertEmtTrain(fastestTrain, source, destination);
      fastOpt.fast = true;
      options.push(fastOpt);
    }

    const cheapest = options.length > 0 ? options[0] : null;
    const fastest =
      options.reduce((min, o) =>
        this.parseMinutes(o.duration) < this.parseMinutes(min.duration) ? o : min,
        options[0],
      ) || null;

    const recommended = this.pickRecommended(options) || cheapest;

    const cheapestPrice = cheapest ? `₹${cheapest.price}` : undefined;
    const dailyCount = trains.length;

    this.logger.log(
      `✅ EaseMyTrip: ${dailyCount} trains | cheapest ${cheapestPrice} | ${options.length} returned`,
    );

    return {
      mode: 'train',
      options,
      cheapest,
      fastest,
      recommended,
      dailyCount,
      arrivalTime: recommended?.arrivalTime || fastest?.arrivalTime || 'Unknown',
      travelDuration: recommended?.duration || fastest?.duration || 'Unknown',
      cheapestPrice,
      fastestDuration: fastest?.duration,
      source: 'easemytrip',
    };
  }

  /**
   * Convert a single EaseMyTrip train into BusTrainOption.
   */
  private convertEmtTrain(
    train: EmtTrain,
    source: string,
    destination: string,
  ): BusTrainOption {
    const cheapestPrice = this.emtTrainCheapestPrice(train);

    // Build classes list with prices
    const classes = (train.avlClasses || []).map(cls => ({
      code: cls.code,
      name: cls.Name,
      price: parseInt(cls.TotalPrice, 10) || 0,
    }));

    // Get availability from TrainClassWiseFare (first class, first day)
    let availability: string | undefined;
    if (train.TrainClassWiseFare?.length > 0) {
      const firstFare = train.TrainClassWiseFare[0];
      if (firstFare.avlDayList?.length > 0) {
        availability = firstFare.avlDayList[0].availablityStatus || undefined;
      }
    }

    // Build running days
    const dayMap: [string, string][] = [
      ['Mon', train.runningMon],
      ['Tue', train.runningTue],
      ['Wed', train.runningWed],
      ['Thu', train.runningThu],
      ['Fri', train.runningFri],
      ['Sat', train.runningSat],
      ['Sun', train.runningSun],
    ];
    const runningDays = dayMap.filter(([, v]) => v === 'Y').map(([d]) => d);

    // Build booking URL
    const bookingUrl = `https://railways.easemytrip.com/Train/TrainBetweenStation?frm=${encodeURIComponent(train.fromStnCode)}&to=${encodeURIComponent(train.toStnCode)}`;

    // Train type label
    const trainType = train.trainType?.map(t => t.Name).join(', ') || undefined;

    return {
      departureTime: train.departureTime || 'N/A',
      arrivalTime: train.arrivalTime || 'N/A',
      duration: train.duration || 'N/A',
      price: cheapestPrice,
      operator: train.trainName || 'Unknown Train',
      stops: 0,
      type: 'train',
      bookingUrl,
      fast: false,
      trainNumber: train.trainNumber,
      trainName: train.trainName,
      trainType,
      distance: train.distance || undefined,
      classes: classes.length > 0 ? classes : undefined,
      availability,
      runningDays: runningDays.length > 0 ? runningDays : undefined,
    };
  }

  /**
   * Get the cheapest class price from a train.
   */
  private emtTrainCheapestPrice(train: EmtTrain): number {
    if (!train.avlClasses || train.avlClasses.length === 0) return 999999;

    let min = Infinity;
    for (const cls of train.avlClasses) {
      const price = parseInt(cls.TotalPrice, 10);
      if (!isNaN(price) && price > 0 && price < min) {
        min = price;
      }
    }
    return min === Infinity ? 999999 : min;
  }

  /**
   * Pick the best-value option: score = 1/price + 1/duration (normalised).
   */
  private pickRecommended(options: BusTrainOption[]): BusTrainOption | null {
    if (options.length === 0) return null;

    let best = options[0];
    let bestScore = -Infinity;

    for (const opt of options) {
      const score = this.scoreOption(opt);
      if (score > bestScore) {
        bestScore = score;
        best = opt;
      }
    }
    return best;
  }

  // ─── SERPAPI FALLBACK (BUS + TRAIN) ─────────────────────────────────────

  /**
   * Search via SerpAPI Google answer_box (fallback for bus; primary for train).
   */
  private async searchViaSerpApi(
    source: string,
    destination: string,
    date: Date,
    transportMode: 'bus' | 'train',
  ): Promise<TransportResult | null> {
    if (this.serpApiKeys.length === 0) {
      this.logger.warn('⚠️ No SerpAPI keys – cannot search');
      return null;
    }

    const query = this.buildSerpQuery(source, destination, transportMode, date);
    this.logger.log(`🔍 SerpAPI ${transportMode}: "${query}"`);

    try {
      const result = await this.fetchSerpAnswerBox(query, transportMode, source, destination);
      if (result) return result;

      // Retry without date
      const fallbackQuery = `${source} to ${destination} ${transportMode} ticket`;
      if (fallbackQuery !== query) {
        this.logger.log(`🔄 SerpAPI retry dateless: "${fallbackQuery}"`);
        return await this.fetchSerpAnswerBox(fallbackQuery, transportMode, source, destination);
      }
      return null;
    } catch (error: any) {
      this.logger.error(`❌ SerpAPI ${transportMode} search failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Build query for Google transport answer_box.
   * Within ~90 days uses dated query; beyond that uses dateless.
   */
  private buildSerpQuery(
    source: string,
    destination: string,
    mode: string,
    date: Date,
  ): string {
    const diffDays = (date.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    if (diffDays >= 0 && diffDays <= 90) {
      const monthNames = [
        'january', 'february', 'march', 'april', 'may', 'june',
        'july', 'august', 'september', 'october', 'november', 'december',
      ];
      return `${source} to ${destination} ${mode} on ${date.getDate()} ${monthNames[date.getMonth()]}`;
    }
    return `${source} to ${destination} ${mode} ticket`;
  }

  /**
   * Fetch and parse Google's transport answer_box from SerpAPI.
   */
  private async fetchSerpAnswerBox(
    query: string,
    transportMode: 'bus' | 'train',
    source: string,
    destination: string,
  ): Promise<TransportResult | null> {
    try {
      const apiKey = this.getNextApiKey();
      const response = await axios.get('https://serpapi.com/search.json', {
        params: { engine: 'google', q: query, hl: 'en', gl: 'in', api_key: apiKey },
        timeout: 15000,
      });

      const answerBox = response.data.answer_box;
      if (!answerBox || answerBox.type !== 'transport_options' || !answerBox.routes?.length) {
        this.logger.warn(`⚠️ No SerpAPI ${transportMode} results for: ${query}`);
        return null;
      }

      return this.parseSerpAnswerBox(answerBox, transportMode, source, destination);
    } catch (error: any) {
      this.logger.error(`❌ SerpAPI request failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Parse Google answer_box into TransportResult.
   */
  private parseSerpAnswerBox(
    answerBox: any,
    transportMode: 'bus' | 'train',
    source: string,
    destination: string,
  ): TransportResult {
    const routes = answerBox.routes;
    this.logger.log(`✅ SerpAPI: ${routes.length} ${transportMode} routes`);

    const options: BusTrainOption[] = routes.map((route: any, idx: number) => {
      const timeParts = this.parseTimeParts(route.time);
      const fare = route.fare ? this.extractPrice(route.fare) : 0;
      return {
        departureTime: timeParts.departure,
        arrivalTime: timeParts.arrival,
        duration: route.duration || 'N/A',
        price: fare,
        operator: route.operator || route.name || route.airline || `${transportMode === 'bus' ? 'Bus' : 'Train'} Option ${idx + 1}`,
        stops: this.parseChanges(route.changes),
        type: transportMode,
        bookingUrl: this.generateBookingUrl(source, destination, transportMode),
        fast: route.fast || false,
      };
    });

    const priced = options.filter(o => o.price > 0);
    const cheapest = priced.length > 0
      ? priced.reduce((min, o) => (o.price < min.price ? o : min), priced[0])
      : options[0];

    const fastest = options.reduce((min, o) =>
      this.parseMinutes(o.duration) < this.parseMinutes(min.duration) ? o : min,
      options[0],
    );

    const recommended = priced.find(o => o.fast) || priced[0] || fastest;

    const dailyCountStr = answerBox.daily_buses || answerBox.daily_trains || '0';
    const dailyCount = parseInt(dailyCountStr, 10) || routes.length;

    return {
      mode: transportMode,
      options: options.slice(0, 6),
      cheapest,
      fastest,
      recommended,
      dailyCount,
      arrivalTime: recommended?.arrivalTime || fastest.arrivalTime || 'Unknown',
      travelDuration: recommended?.duration || fastest.duration || 'Unknown',
      cheapestPrice: answerBox.cheapest,
      fastestDuration: answerBox.fastest,
      source: 'serpapi',
    };
  }

  // ─── FLIGHT SUMMARY (SerpAPI only) ─────────────────────────────────────

  /**
   * Quick flight summary via Google answer_box.
   * (Main flights use FlightService – this is supplementary.)
   */
  async searchFlightSummary(
    source: string,
    destination: string,
    date: Date,
  ): Promise<TransportResult | null> {
    if (this.serpApiKeys.length === 0) return null;

    const query = this.buildSerpQuery(source, destination, 'flight', date);
    this.logger.log(`🔍 Flight summary: "${query}"`);

    try {
      const apiKey = this.getNextApiKey();
      const response = await axios.get('https://serpapi.com/search.json', {
        params: { engine: 'google', q: query, hl: 'en', gl: 'in', api_key: apiKey },
        timeout: 15000,
      });

      const answerBox = response.data.answer_box;
      if (!answerBox || answerBox.type !== 'transport_options' || !answerBox.routes?.length) {
        this.logger.warn(`⚠️ No flight answer_box for: ${query}`);
        return null;
      }

      const routes = answerBox.routes;
      const options: BusTrainOption[] = routes.map((route: any) => {
        const timeParts = this.parseTimeParts(route.time);
        return {
          departureTime: timeParts.departure,
          arrivalTime: timeParts.arrival,
          duration: route.duration || 'N/A',
          price: route.fare ? this.extractPrice(route.fare) : 0,
          operator: route.airline || route.name || 'Unknown',
          stops: route.changes === 'Nonstop' ? 0 : this.parseChanges(route.changes),
          type: 'bus' as const,
          bookingUrl: 'https://www.google.com/travel/flights',
        };
      });

      return {
        mode: 'flight',
        options,
        cheapest: options.filter(o => o.price > 0).sort((a, b) => a.price - b.price)[0] || null,
        fastest: options.sort((a, b) => this.parseMinutes(a.duration) - this.parseMinutes(b.duration))[0] || null,
        recommended: options[0] || null,
        dailyCount: routes.length,
        arrivalTime: options[0]?.arrivalTime || 'Unknown',
        travelDuration: options[0]?.duration || 'Unknown',
        source: 'serpapi',
      };
    } catch (error: any) {
      this.logger.error(`❌ Flight summary search failed: ${error.message}`);
      return null;
    }
  }

  // ─── FATIGUE CALCULATOR ──────────────────────────────────────────────────

  calculateArrivalFatigue(arrivalTime: string): {
    fatigueLevel: 'low' | 'medium' | 'high' | 'extreme';
    compressionFactor: number;
    recommendation: string;
  } {
    const hour = this.extractHour(arrivalTime);

    if (hour < 10) {
      return { fatigueLevel: 'low', compressionFactor: 1.0, recommendation: 'Full day itinerary possible' };
    } else if (hour < 14) {
      return { fatigueLevel: 'medium', compressionFactor: 0.8, recommendation: 'Standard day with minor adjustments' };
    } else if (hour < 18) {
      return { fatigueLevel: 'high', compressionFactor: 0.5, recommendation: 'Half-day itinerary recommended. Remove 2-3 activities.' };
    }
    return { fatigueLevel: 'extreme', compressionFactor: 0.1, recommendation: 'Late arrival. Skip Day 1 activities. Hotel check-in and dinner only.' };
  }

  // ─── HEURISTIC FALLBACK ─────────────────────────────────────────────────

  getTransportCostEstimate(
    mode: 'flight' | 'bus' | 'train',
    distance: number,
  ): { min: number; max: number; avg: number } {
    switch (mode) {
      case 'flight': return { min: distance * 2, max: distance * 8, avg: distance * 4 };
      case 'bus':    return { min: distance * 0.5, max: distance * 1.5, avg: distance * 1 };
      case 'train':  return { min: distance * 0.3, max: distance * 1.2, avg: distance * 0.7 };
      default:       return { min: 0, max: 0, avg: 0 };
    }
  }

  // ─── UTILITY HELPERS ────────────────────────────────────────────────────

  /** "5:35 pm – 6:55 am+1" → { departure, arrival } */
  private parseTimeParts(timeStr: string): { departure: string; arrival: string } {
    if (!timeStr) return { departure: 'N/A', arrival: 'N/A' };
    const parts = timeStr.split(/\s*[–-]\s*/);
    const departure = parts[0]?.trim() || 'N/A';
    const arrival = (parts[1] || 'N/A').replace(/\+\d+\s*(day)?/gi, '').trim();
    return { departure, arrival };
  }

  /** "0 changes" → 0, "Nonstop" → 0, "1 change" → 1 */
  private parseChanges(changesStr: string): number {
    if (!changesStr) return 0;
    if (/nonstop|direct/i.test(changesStr)) return 0;
    const m = changesStr.match(/(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  }

  /** "₹753", "₹463 - ₹1,631" → lowest numeric price */
  private extractPrice(priceStr: string): number {
    if (!priceStr || /get price/i.test(priceStr)) return 0;
    const nums = priceStr.match(/[\d,]+/g);
    if (!nums?.length) return 0;
    const val = parseInt(nums[0].replace(/,/g, ''), 10);
    return isNaN(val) ? 0 : val;
  }

  /** "12h 30m" → 750  minutes */
  parseMinutes(duration: string): number {
    if (!duration) return 999999;
    const h = duration.match(/(\d+)\s*h/i);
    const m = duration.match(/(\d+)\s*m/i);
    return (h ? parseInt(h[1], 10) * 60 : 0) + (m ? parseInt(m[1], 10) : 0);
  }

  /** Score = 1/price + 1/duration (higher = better value) */
  private scoreOption(opt: BusTrainOption): number {
    return 1000 / (opt.price || 1000) + 1000 / (this.parseMinutes(opt.duration) || 600);
  }

  /** "2:30 pm" → 14 */
  private extractHour(timeStr: string): number {
    if (!timeStr) return 12;
    const m = timeStr.match(/(\d{1,2}):?(\d{2})?\s*(am|pm)?/i);
    if (!m) return 12;
    let hour = parseInt(m[1], 10);
    const mer = m[3]?.toLowerCase();
    if (mer === 'pm' && hour !== 12) hour += 12;
    else if (mer === 'am' && hour === 12) hour = 0;
    return hour;
  }

  private generateBookingUrl(source: string, destination: string, mode: 'bus' | 'train'): string {
    const src = encodeURIComponent(source.toLowerCase());
    const dst = encodeURIComponent(destination.toLowerCase());
    if (mode === 'bus') return `https://www.redbus.in/bus-tickets/${src}-to-${dst}`;
    return `https://railways.easemytrip.com/Train/TrainBetweenStation?frm=${src}&to=${dst}`;
  }
}
