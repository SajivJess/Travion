import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { WeatherService } from './weather.service';
import { GeoService } from './geo.service';

// ─── Tool Definitions (Gemini Function Calling schema) ────────────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, any>;
}

export interface ToolCallRequest {
  name: string;
  args: Record<string, any>;
}

export interface ToolCallResult {
  tool: string;
  args: Record<string, any>;
  result: any;
  error?: string;
  durationMs: number;
}

/**
 * AgentToolsService — Tool registry for the agent-loop processor.
 *
 * Each tool is:
 *   - Declared as a Gemini function-call schema
 *   - Implemented as an executable method
 *
 * Tools available to the agent:
 *   1. get_weather           — Open-Meteo forecast
 *   2. search_indoor_venues  — SerpAPI "indoor activities near X"
 *   3. get_hotel_check       — Basic hotel availability proxy via SerpAPI
 *   4. calculate_eta         — Google Maps Directions API
 *   5. get_crowd_level       — Open-source busyness estimation (SerpAPI popular_times)
 *   6. get_flight_status     — AviationStack route check
 */
@Injectable()
export class AgentToolsService {
  private readonly logger = new Logger(AgentToolsService.name);

  constructor(
    private readonly weatherService: WeatherService,
    private readonly geoService: GeoService,
  ) {}

  // ─── Tool Schema Declarations ─────────────────────────────────────────────

  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'get_weather',
        description: 'Get weather forecast for a destination between given dates. Use when weather conditions affect the itinerary.',
        parameters: {
          type: 'object',
          properties: {
            destination: { type: 'string', description: 'City/place name' },
            startDate: { type: 'string', description: 'YYYY-MM-DD' },
            endDate: { type: 'string', description: 'YYYY-MM-DD' },
          },
          required: ['destination', 'startDate', 'endDate'],
        },
      },
      {
        name: 'search_indoor_venues',
        description: 'Find indoor activity venues near a destination. Use when outdoor activities must be replaced due to rain/heat.',
        parameters: {
          type: 'object',
          properties: {
            destination: { type: 'string', description: 'City/area name' },
            category: { type: 'string', description: 'museum|mall|temple|restaurant|cinema|spa|aquarium|gallery' },
            count: { type: 'number', description: 'Number of results (default 3, max 5)' },
          },
          required: ['destination'],
        },
      },
      {
        name: 'calculate_eta',
        description: 'Calculate current travel ETA between two locations using Google Maps. Use to detect delays.',
        parameters: {
          type: 'object',
          properties: {
            origin: { type: 'string', description: 'Origin address or place name' },
            destination: { type: 'string', description: 'Destination address or place name' },
            mode: { type: 'string', description: 'driving|walking|transit (default: driving)' },
          },
          required: ['origin', 'destination'],
        },
      },
      {
        name: 'get_crowd_level',
        description: 'Estimate current crowd level at a tourist attraction. Use before recommending visit times.',
        parameters: {
          type: 'object',
          properties: {
            place: { type: 'string', description: 'Attraction name' },
            destination: { type: 'string', description: 'City name' },
            visitDate: { type: 'string', description: 'YYYY-MM-DD (optional, defaults to today)' },
          },
          required: ['place', 'destination'],
        },
      },
      {
        name: 'get_hotel_check',
        description: 'Check if hotels are available near a destination for given dates. Use when replanning requires accommodation changes.',
        parameters: {
          type: 'object',
          properties: {
            destination: { type: 'string', description: 'City name' },
            checkIn: { type: 'string', description: 'YYYY-MM-DD' },
            checkOut: { type: 'string', description: 'YYYY-MM-DD' },
            budget: { type: 'number', description: 'Per night budget in INR (optional)' },
          },
          required: ['destination', 'checkIn', 'checkOut'],
        },
      },
      {
        name: 'get_flight_status',
        description: 'Check real-time flight status between two airports. Use when flight delay affects itinerary Day 1.',
        parameters: {
          type: 'object',
          properties: {
            depIata: { type: 'string', description: 'Departure airport IATA code (e.g. DEL)' },
            arrIata: { type: 'string', description: 'Arrival airport IATA code (e.g. BOM)' },
            date: { type: 'string', description: 'YYYY-MM-DD' },
          },
          required: ['depIata', 'arrIata', 'date'],
        },
      },
    ];
  }

  // ─── Tool Dispatch ────────────────────────────────────────────────────────

  async executeTool(call: ToolCallRequest): Promise<ToolCallResult> {
    const start = Date.now();
    const { name, args } = call;
    this.logger.log(`🔧 Tool call: ${name}(${JSON.stringify(args)})`);

    try {
      let result: any;
      switch (name) {
        case 'get_weather':
          result = await this.toolGetWeather(args);
          break;
        case 'search_indoor_venues':
          result = await this.toolSearchIndoorVenues(args);
          break;
        case 'calculate_eta':
          result = await this.toolCalculateEta(args);
          break;
        case 'get_crowd_level':
          result = await this.toolGetCrowdLevel(args);
          break;
        case 'get_hotel_check':
          result = await this.toolGetHotelCheck(args);
          break;
        case 'get_flight_status':
          result = await this.toolGetFlightStatus(args);
          break;
        default:
          throw new Error(`Unknown tool: ${name}`);
      }

      const durationMs = Date.now() - start;
      this.logger.log(`✅ Tool ${name} completed in ${durationMs}ms`);
      return { tool: name, args, result, durationMs };
    } catch (err: any) {
      const durationMs = Date.now() - start;
      this.logger.warn(`⚠️ Tool ${name} failed in ${durationMs}ms: ${err.message}`);
      return { tool: name, args, result: null, error: err.message, durationMs };
    }
  }

  // ─── Tool Implementations ─────────────────────────────────────────────────

  private async toolGetWeather(args: any) {
    const geo = await this.geoService.geocode(args.destination);
    if (!geo?.lat || !geo?.lng) return { error: 'Could not geocode destination' };

    const forecast = await this.weatherService.getForecast(
      geo.lat, geo.lng, args.destination, args.startDate, args.endDate,
    );

    return {
      destination: args.destination,
      days: forecast.days.map(d => ({
        date: d.date,
        condition: d.condition,
        tempMin: d.tempMin,
        tempMax: d.tempMax,
        rainChance: d.rainChance,
        windSpeed: d.windSpeed,
        badWeather: d.rainChance > 60 || ['Thunderstorm', 'Heavy Rain', 'Snow'].includes(d.condition),
      })),
      alerts: forecast.alerts,
    };
  }

  private async toolSearchIndoorVenues(args: any) {
    const serpKey = process.env.SERP_API_KEY;
    if (!serpKey) {
      // Fallback: return static category suggestions
      const cat = args.category || 'museum';
      return {
        source: 'static_fallback',
        venues: [
          { name: `City ${cat}`, type: cat, description: `Popular indoor ${cat} in ${args.destination}` },
          { name: `Heritage ${cat}`, type: cat, description: `Well-rated alternative indoor activity` },
        ],
      };
    }

    const query = `indoor ${args.category || 'activities'} in ${args.destination}`;
    const res = await axios.get('https://serpapi.com/search', {
      params: { engine: 'google', q: query, api_key: serpKey, num: args.count || 3 },
      timeout: 10_000,
    });

    const organic = res.data?.organic_results || [];
    return {
      source: 'serpapi',
      venues: organic.slice(0, args.count || 3).map((r: any) => ({
        name: r.title,
        snippet: r.snippet,
        link: r.link,
      })),
    };
  }

  private async toolCalculateEta(args: any) {
    const mapsKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!mapsKey) {
      // Fallback: rough estimate via straight-line distance
      const originGeo = await this.geoService.geocode(args.origin);
      const destGeo = await this.geoService.geocode(args.destination);
      if (originGeo && destGeo) {
        const distKm = this.haversineKm(originGeo.lat, originGeo.lng, destGeo.lat, destGeo.lng);
        const estimatedMins = Math.round((distKm / 30) * 60); // 30 km/h urban avg
        return { source: 'estimate', distanceKm: Math.round(distKm), durationMinutes: estimatedMins, mode: 'driving' };
      }
      return { error: 'Google Maps key not set and geocoding failed' };
    }

    const mode = args.mode || 'driving';
    const res = await axios.get('https://maps.googleapis.com/maps/api/directions/json', {
      params: {
        origin: args.origin,
        destination: args.destination,
        mode,
        departure_time: 'now',
        key: mapsKey,
      },
      timeout: 8_000,
    });

    const route = res.data?.routes?.[0]?.legs?.[0];
    if (!route) return { error: 'No route found' };

    return {
      source: 'google_maps',
      distanceKm: Math.round(route.distance.value / 1000),
      durationMinutes: Math.round(route.duration.value / 60),
      durationInTrafficMinutes: route.duration_in_traffic
        ? Math.round(route.duration_in_traffic.value / 60)
        : Math.round(route.duration.value / 60),
      mode,
    };
  }

  private async toolGetCrowdLevel(args: any) {
    const serpKey = process.env.SERP_API_KEY;
    if (!serpKey) {
      return {
        source: 'static_estimate',
        place: args.place,
        crowdLevel: 'moderate',
        bestTime: 'Early morning (8–10 AM) or late afternoon (4–6 PM)',
        tip: 'Weekday mornings typically less crowded than weekends',
      };
    }

    const query = `${args.place} ${args.destination} crowd busy times`;
    const res = await axios.get('https://serpapi.com/search', {
      params: { engine: 'google', q: query, api_key: serpKey, num: 3 },
      timeout: 10_000,
    });

    const answer = res.data?.answer_box?.answer || res.data?.answer_box?.snippet || '';
    const snippet = res.data?.organic_results?.[0]?.snippet || '';

    return {
      source: 'serpapi',
      place: args.place,
      crowdInfo: answer || snippet || 'No crowd data available',
      tip: 'Visit early morning or on weekdays for shorter waits',
    };
  }

  private async toolGetHotelCheck(args: any) {
    const serpKey = process.env.SERP_API_KEY;
    if (!serpKey) {
      return {
        source: 'static_estimate',
        destination: args.destination,
        availability: 'likely',
        message: 'Hotels generally available — check booking.com for real-time rates',
        estimatedRateINR: args.budget || 3000,
      };
    }

    const query = `hotels in ${args.destination} ${args.checkIn} to ${args.checkOut}`;
    const res = await axios.get('https://serpapi.com/search', {
      params: { engine: 'google_hotels', q: query, api_key: serpKey, check_in_date: args.checkIn, check_out_date: args.checkOut },
      timeout: 10_000,
    }).catch(() => null);

    const hotels = res?.data?.properties?.slice(0, 3) || [];
    if (hotels.length === 0) {
      return { source: 'serpapi', destination: args.destination, availability: 'unknown', hotels: [] };
    }

    return {
      source: 'serpapi',
      availability: 'available',
      hotels: hotels.map((h: any) => ({
        name: h.name,
        rating: h.overall_rating,
        priceINR: h.rate_per_night?.extracted_lowest,
        link: h.link,
      })),
    };
  }

  private async toolGetFlightStatus(args: any) {
    const aviationKey = process.env.AVIATION_STACK_API_KEY || process.env.AVIATIONSTACK_API_KEY;
    if (!aviationKey) {
      return { source: 'none', message: 'AviationStack key not configured — check flight manually' };
    }

    const res = await axios.get('http://api.aviationstack.com/v1/flights', {
      params: {
        access_key: aviationKey,
        dep_iata: args.depIata,
        arr_iata: args.arrIata,
        flight_date: args.date,
        limit: 5,
      },
      timeout: 10_000,
    }).catch(() => null);

    const flights = res?.data?.data || [];
    if (flights.length === 0) {
      return { source: 'aviationstack', flights: [], message: 'No flights found for this route/date' };
    }

    return {
      source: 'aviationstack',
      flights: flights.map((f: any) => ({
        flightIata: f.flight?.iata,
        status: f.flight_status,
        delayDep: f.departure?.delay,
        delayArr: f.arrival?.delay,
        scheduledDep: f.departure?.scheduled,
        estimatedArr: f.arrival?.estimated,
      })),
    };
  }

  // ─── Haversine distance ───────────────────────────────────────────────────

  private haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}
