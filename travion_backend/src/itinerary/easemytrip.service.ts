import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

// ─── TRAIN INTERFACES ──────────────────────────────────────────────────────

/** Station returned by the Solr train autosuggest endpoint. */
export interface EmtTrainStation {
  Code: string;    // "MAS"
  Name: string;    // "Chennai Central"
  Show: string;    // "Chennai Central"
  State: string;   // "Tamil Nadu"
  ID: number;
}

/** A single available class on a train (e.g. SL, 2A, CC). */
export interface EmtTrainClass {
  code: string;       // "SL", "2A", "CC"
  Name: string;       // "Sleeper", "AC 2 Tier", "AC Chair Car"
  TotalPrice: string; // "275"
}

/** Per-class fare with day-wise seat availability. */
export interface EmtTrainClassFare {
  enqClass: string;       // "SL"
  enqClassName: string;   // "Sleeper"
  totalFare: string;      // "275"
  quota: string;          // "GN"
  avlDayList: {
    availablityDate: string;   // "1-3-2026"
    availablityStatus: string; // "AVAILABLE-489" or "RAC-12" or "WL-5"
    currentBkgFlag: string;
    reasonType: string;
  }[];
  UpdationTime: string;   // "47 minutes ago"
}

/** A single train in the search results. */
export interface EmtTrain {
  trainName: string;       // "Mys Shatabdi"
  trainNumber: string;     // "12007"
  fromStnName: string;     // "Chennai Central"
  fromStnCode: string;     // "MAS"
  toStnName: string;       // "Ksr Bengaluru"
  toStnCode: string;       // "SBC"
  departureTime: string;   // "06:00"
  arrivalTime: string;     // "10:30"
  duration: string;        // "04:30"
  distance: string;        // "362"
  avlClasses: EmtTrainClass[];
  TrainClassWiseFare: EmtTrainClassFare[];
  runningMon: string;      // "Y" or "N"
  runningTue: string;
  runningWed: string;
  runningThu: string;
  runningFri: string;
  runningSat: string;
  runningSun: string;
  trainType: { code: string; Name: string }[];
  ArrivalDate: string;     // "01Mar2026"
  departuredate: string;   // "01Mar2026"
}

/** Top-level train search response from _TrainBtwnStationList. */
export interface EmtTrainSearchResult {
  quotaList: { code: string; Name: string }[];
  trainBtwnStnsList: EmtTrain[];
  fastestTrainSrcStn: string;
  fastestTrainDestStn: string;
  fastestTrainDuration: string;
  slowestTrainDuration: string;
  earlierTrainDep: string;
  DepurtureDate: string;
  sourceStation: string;
  DestinationStation: string;
}

// ─── BUS INTERFACES ────────────────────────────────────────────────────────

/**
 * Raw trip data returned by EaseMyTrip's /api/bus/List/ endpoint.
 */
export interface EmtBusTrip {
  AC: boolean;
  ArrivalTime: string;        // "05:50"
  AvailableSeats: string;     // "46"
  busType: string;            // "2+1(46)AC, Seater, Sleeper with Washroom"
  departureTime: string;      // "22:55"
  doj: string;                // "2026-02-25T10:55:00"
  duration: string;           // "06h 55m"
  Travels: string;            // operator name
  id: string;
  routeId: string;
  price: number;              // cheapest fare
  seater: boolean;
  sleeper: boolean;
  nonAC: boolean;
  isVolvo: boolean;
  isCancellable: boolean;
  liveTrackingAvailable: boolean;
  operatorid: string;
  fareDetail: EmtFareDetail[];
  fares: string | null;
  bdPoints: EmtBoardingPoint[];
  dpPoints: EmtDroppingPoint[];
  amount: number;             // total amount
  lstamenities: string[] | null;
  isAmenty: boolean;
  cancelPolicyList: any[] | null;
  status: string;
  totalSeat: number;
  departureDate: string;
  arrivalDate: string;
}

export interface EmtFareDetail {
  baseFare: string;
  totalFare: string | null;
  totalTax: string | null;
}

export interface EmtBoardingPoint {
  bdPoint: string;
  bdLongName: string;
  bdid: string;
  bdlocation: string;
  landmark: string | null;
  time: string;
  contactNumber: string;
}

export interface EmtDroppingPoint {
  dpId: string;
  dpName: string;
  dpTime: string;
}

export interface EmtSearchResult {
  AvailableTrips: EmtBusTrip[];
  TotalTrips: number;
  Source: string;
  sourceId: number;
  Destination: string;
  destinationId: number;
  MinPrice: number;
  MaxPrice: number;
  JourneyDate: string;
  isBusAvailable: boolean;
  AcCount: number;
  NonAcCount: number;
  SleeperCount: number;
  SeaterCount: number;
}

export interface EmtCity {
  id: number;
  name: string;
}

@Injectable()
export class EasemytripService {
  private readonly logger = new Logger(EasemytripService.name);
  private readonly baseUrl = 'https://bus.easemytrip.com';
  private readonly trainSolrUrl = 'https://solr.easemytrip.com/v1/api/auto/GetTrainAutoSuggest';
  private readonly trainSearchUrl = 'https://railways.easemytrip.com/Train/_TrainBtwnStationList';

  // Cache city IDs to avoid repeated lookups (city name → id)
  private cityCache = new Map<string, number>();
  // Cache station codes to avoid repeated Solr lookups (city name → station code)
  private stationCache = new Map<string, string>();

  constructor() {
    this.logger.log('🚌🚆 EaseMyTrip bus + train service initialized');
  }

  /**
   * Look up a city's EaseMyTrip ID by name.
   * Uses /api/search/getsourcecity endpoint.
   */
  async getCityId(cityName: string): Promise<number | null> {
    const key = cityName.toLowerCase().trim();

    // Check cache first
    if (this.cityCache.has(key)) {
      return this.cityCache.get(key)!;
    }

    try {
      const response = await axios.get<EmtCity[]>(
        `${this.baseUrl}/api/search/getsourcecity`,
        {
          params: { id: cityName },
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            Accept: 'application/json',
          },
          timeout: 10000,
        },
      );

      if (Array.isArray(response.data) && response.data.length > 0) {
        const city = response.data[0];
        this.cityCache.set(key, city.id);
        this.logger.debug(`📍 City resolved: ${cityName} → ${city.name} (${city.id})`);
        return city.id;
      }

      this.logger.warn(`⚠️ City not found on EaseMyTrip: "${cityName}"`);
      return null;
    } catch (error: any) {
      this.logger.error(`❌ City lookup failed for "${cityName}": ${error.message}`);
      return null;
    }
  }

  /**
   * Search buses between two cities on a given date.
   *
   * API: GET /api/bus/List/{srcId}%7C{dstId}%7C{dd-mm-yyyy}%7C
   * Returns real-time bus data with prices, operators, seat availability.
   */
  async searchBuses(
    sourceCity: string,
    destinationCity: string,
    date: Date,
  ): Promise<EmtSearchResult | null> {
    // Step 1: Resolve city IDs
    const [srcId, dstId] = await Promise.all([
      this.getCityId(sourceCity),
      this.getCityId(destinationCity),
    ]);

    if (!srcId || !dstId) {
      this.logger.warn(
        `⚠️ Cannot search: missing city ID (src=${srcId}, dst=${dstId})`,
      );
      return null;
    }

    // Step 2: Format date as dd-mm-yyyy
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    const dateStr = `${dd}-${mm}-${yyyy}`;

    // Step 3: Build the pipe-delimited URL
    const listPath = `/api/bus/List/${srcId}%7C${dstId}%7C${dateStr}%7C`;
    const url = `${this.baseUrl}${listPath}`;

    this.logger.log(
      `🔍 EaseMyTrip: ${sourceCity}(${srcId}) → ${destinationCity}(${dstId}) on ${dateStr}`,
    );

    try {
      const response = await axios.get<EmtSearchResult>(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Accept: 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        timeout: 20000,
      });

      const data = response.data;

      if (!data || !data.AvailableTrips || data.AvailableTrips.length === 0) {
        this.logger.warn(
          `⚠️ EaseMyTrip: 0 buses for ${sourceCity} → ${destinationCity} on ${dateStr}`,
        );
        return null;
      }

      this.logger.log(
        `✅ EaseMyTrip: ${data.AvailableTrips.length} buses | ₹${data.MinPrice}–₹${data.MaxPrice}`,
      );
      return data;
    } catch (error: any) {
      this.logger.error(
        `❌ EaseMyTrip search failed: ${error.message}`,
      );
      return null;
    }
  }

  // ─── TRAIN: STATION AUTOSUGGEST ────────────────────────────────────────

  /**
   * Look up a railway station code by city name.
   * Uses Solr autosuggest: GET /v1/api/auto/GetTrainAutoSuggest/{query}
   * Returns the first matching station code (e.g. "MAS", "SBC", "NDLS").
   */
  async getStationCode(cityName: string): Promise<string | null> {
    const key = cityName.toLowerCase().trim();

    if (this.stationCache.has(key)) {
      return this.stationCache.get(key)!;
    }

    try {
      const response = await axios.get<EmtTrainStation[]>(
        `${this.trainSolrUrl}/${encodeURIComponent(cityName)}`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            Accept: 'application/json',
          },
          timeout: 10000,
        },
      );

      if (Array.isArray(response.data) && response.data.length > 0) {
        const station = response.data[0];
        this.stationCache.set(key, station.Code);
        this.logger.debug(
          `🚉 Station resolved: ${cityName} → ${station.Name} (${station.Code})`,
        );
        return station.Code;
      }

      this.logger.warn(`⚠️ No train station found for: "${cityName}"`);
      return null;
    } catch (error: any) {
      this.logger.error(`❌ Station lookup failed for "${cityName}": ${error.message}`);
      return null;
    }
  }

  // ─── TRAIN: SEARCH BETWEEN STATIONS ────────────────────────────────────

  /**
   * Search trains between two cities on a given date.
   *
   * Pipeline:
   *   1. Resolve station codes via Solr autosuggest
   *   2. POST to /Train/_TrainBtwnStationList
   *   3. Returns rich JSON with trains, classes, prices, seat availability
   *
   * @param sourceCity     City name (e.g. "Chennai", "Delhi")
   * @param destinationCity City name (e.g. "Bangalore", "Mumbai")
   * @param date           Travel date
   */
  async searchTrains(
    sourceCity: string,
    destinationCity: string,
    date: Date,
  ): Promise<EmtTrainSearchResult | null> {
    // Step 1: Resolve station codes
    const [fromCode, toCode] = await Promise.all([
      this.getStationCode(sourceCity),
      this.getStationCode(destinationCity),
    ]);

    if (!fromCode || !toCode) {
      this.logger.warn(
        `⚠️ Cannot search trains: missing station code (src=${fromCode}, dst=${toCode})`,
      );
      return null;
    }

    // Step 2: Format date as dd/mm/yyyy (EaseMyTrip railway format)
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    const dateStr = `${dd}/${mm}/${yyyy}`;

    this.logger.log(
      `🔍 EaseMyTrip Train: ${sourceCity}(${fromCode}) → ${destinationCity}(${toCode}) on ${dateStr}`,
    );

    try {
      const response = await axios.post<EmtTrainSearchResult>(
        this.trainSearchUrl,
        {
          fromSec: fromCode,
          toSec: toCode,
          fromdate: dateStr,
          jurneryclass: '',
          selectedTrain: '',
          couponCode: '',
          appliedQuota: 'GN',
        },
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Origin: 'https://railways.easemytrip.com',
            Referer: 'https://railways.easemytrip.com/Train/TrainBetweenStation',
          },
          timeout: 20000,
        },
      );

      const data = response.data;

      if (!data || !data.trainBtwnStnsList || data.trainBtwnStnsList.length === 0) {
        this.logger.warn(
          `⚠️ EaseMyTrip: 0 trains for ${sourceCity} → ${destinationCity} on ${dateStr}`,
        );
        return null;
      }

      this.logger.log(
        `✅ EaseMyTrip: ${data.trainBtwnStnsList.length} trains found | ${fromCode} → ${toCode}`,
      );
      return data;
    } catch (error: any) {
      this.logger.error(
        `❌ EaseMyTrip train search failed: ${error.message}`,
      );
      return null;
    }
  }
}
