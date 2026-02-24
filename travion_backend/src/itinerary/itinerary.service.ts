import { Injectable, InternalServerErrorException, BadRequestException } from "@nestjs/common";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { CreateItineraryDto } from "./dto/create-itinerary.dto";
import { Itinerary, DayScheduleWarning } from "./itinerary.interface";
import { FlightService } from "./flight.service";
import { SerpService, DiscoveredHotel, DiscoveredAttraction, DiscoveredRestaurant } from "./serp.service";
import { WeatherService, WeatherForecast, WeatherDay } from "./weather.service";
import { GeoService, GeocodedPlace } from "./geo.service";
import { TransportService } from "./transport.service";
import { ImageService } from "./image.service";
import { TourismAdvisoryService } from "./tourism-advisory.service";
import { TourismPoiService } from "./tourism-poi.service";

interface ReplanDayInput {
  itinerary: Itinerary;
  dayIndex: number;
  destination: string;
  travelStyle: string;
}

@Injectable()
export class ItineraryService {
  private readonly geminiKeys: string[];
  private geminiKeyIndex: number = 0;
  private genAI: GoogleGenerativeAI;
  private model: any;
  private readonly googleMapsApiKey: string;

  constructor(
    private flightService: FlightService,
    private serpService: SerpService,
    private weatherService: WeatherService,
    private geoService: GeoService,
    private transportService: TransportService,
    private imageService: ImageService,
    private tourismAdvisoryService: TourismAdvisoryService,
    private tourismPoiService: TourismPoiService,
  ) {
    // Load all Gemini keys for rotation
    this.geminiKeys = [
      process.env.GEMINI_API_KEY,
      process.env.GEMINI_API_KEY_2,
      process.env.GEMINI_API_KEY_3,
    ].filter(Boolean) as string[];

    if (this.geminiKeys.length === 0) throw new Error("No GEMINI_API_KEY configured");
    console.log(`🧠 Gemini initialized with ${this.geminiKeys.length} API keys`);

    this.genAI = new GoogleGenerativeAI(this.geminiKeys[0]);
    this.model = this.genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    
    this.googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY || "";
    if (!this.googleMapsApiKey) {
      console.error("⚠️ WARNING: GOOGLE_MAPS_API_KEY is not set in .env file!");
    }
  }

  /**
   * Rotate to next Gemini API key on rate limit (429) or quota errors
   */
  private rotateGeminiKey(): void {
    this.geminiKeyIndex = (this.geminiKeyIndex + 1) % this.geminiKeys.length;
    console.log(`🔄 Rotated to Gemini key #${this.geminiKeyIndex + 1}`);
    this.genAI = new GoogleGenerativeAI(this.geminiKeys[this.geminiKeyIndex]);
    this.model = this.genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
  }

  /**
   * Call Gemini with automatic key rotation on rate limit.
   */
  private async callGemini(contents: any[], generationConfig: any, maxRetries = 3): Promise<any> {
    let lastError: any;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const res = await this.model.generateContent({ contents, generationConfig });
        return res;
      } catch (error: any) {
        lastError = error;
        const status = error?.status || error?.response?.status || error?.code;
        const msg = error?.message || '';
        const isRateLimit = status === 429 || msg.includes('429') || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED');
        
        if (isRateLimit && attempt < maxRetries - 1) {
          console.warn(`⚠️ Gemini key #${this.geminiKeyIndex + 1} rate limited, rotating...`);
          this.rotateGeminiKey();
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); // backoff
          continue;
        }
      }
    }

    throw lastError;
  }

  // Convert "HH:MM" (24h) to "HH:MM AM/PM"
  private toAmPm(time: string): string {
    const [hStr, mStr] = time.split(":");
    let h = parseInt(hStr, 10);
    const m = parseInt(mStr, 10);
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12;
    if (h === 0) h = 12;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} ${ampm}`;
  }

  private calculateDays(startISO: string, endISO: string): number {
    const start = new Date(startISO);
    const end = new Date(endISO);
    const ms = end.getTime() - start.getTime();
    const days = Math.floor(ms / (1000 * 60 * 60 * 24)) + 1;
    return Math.max(days, 1);
  }

  /**
   * Attempts to repair a truncated JSON string returned by Gemini when
   * the response was cut off due to token limits.
   * Strategy: find the last complete "day" object and close the structure.
   */
  private repairTruncatedJson(text: string): any | null {
    try {
      // Find the last fully-closed day block: ends with a }  followed by optional whitespace then , or ]
      // Walk backwards to find the last "}" that closes a day entry
      let depth = 0;
      let lastDayEnd = -1;
      let inString = false;
      let escape = false;

      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (escape) { escape = false; continue; }
        if (ch === '\\' && inString) { escape = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (ch === '{' || ch === '[') depth++;
        else if (ch === '}' || ch === ']') {
          depth--;
          if (depth === 1) lastDayEnd = i; // depth 1 = one level inside the root object
        }
      }

      if (lastDayEnd === -1) return null;

      // Slice up to the last complete day, close the days array and root object
      const truncated = text.substring(0, lastDayEnd + 1);
      // Close days array + root object + minimal required fields
      const patched = truncated + '\n  ]\n}';

      try {
        return JSON.parse(patched);
      } catch {
        // More aggressive: close all open arrays/objects
        let repatch = truncated;
        let d2 = 0;
        let inStr2 = false;
        let esc2 = false;
        const opens: string[] = [];
        for (const ch of repatch) {
          if (esc2) { esc2 = false; continue; }
          if (ch === '\\' && inStr2) { esc2 = true; continue; }
          if (ch === '"') { inStr2 = !inStr2; continue; }
          if (inStr2) continue;
          if (ch === '{') opens.push('}');
          else if (ch === '[') opens.push(']');
          else if (ch === '}' || ch === ']') opens.pop();
        }
        repatch += opens.reverse().join('');
        return JSON.parse(repatch);
      }
    } catch {
      return null;
    }
  }

  // Check if source and destination are in different countries
  private async areDifferentCountries(source: string, destination: string): Promise<boolean> {
    try {
      if (!this.googleMapsApiKey) return false;

      const getCountry = async (place: string): Promise<string | null> => {
        const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(place)}&key=${this.googleMapsApiKey}`;
        const response = await fetch(url);
        const data = (await response.json()) as any;
        
        if (data.results?.[0]) {
          const types = data.results[0].types || [];
          const country = types.includes('country') ? data.results[0].formatted_address : 
                         data.results[0].address_components?.find((c: any) => c.types.includes('country'))?.short_name;
          return country;
        }
        return null;
      };

      const sourceCountry = await getCountry(source);
      const destCountry = await getCountry(destination);

      return sourceCountry && destCountry && sourceCountry !== destCountry;
    } catch (error) {
      console.warn('Error checking countries:', error);
      return false;
    }
  }

  // Estimate transport cost using AI knowledge (works for Train, Bus, or Flight)
  private async estimateTransportCostAI(
    source: string,
    destination: string,
    travellers: number,
    mode: 'Train' | 'Bus' | 'Flight',
    travelStyle: string,
  ): Promise<{ totalCost: number; travelTimeDays: number; transportType: string; costPerPerson: number }> {
    try {
      const classDesc = mode === 'Flight'
        ? (travelStyle === 'Luxury' ? 'Business Class' : travelStyle === 'Comfort' ? 'Premium Economy' : 'Economy')
        : (travelStyle === 'Luxury' ? 'AC First Class/Sleeper' : travelStyle === 'Comfort' ? 'AC 2-Tier/AC' : 'Sleeper/Non-AC');

      const prompt = `You are a travel cost expert with knowledge of ${mode} prices and routes in India and worldwide. 

From: ${source}
To: ${destination}
Mode: ${mode}
Travellers: ${travellers}
Class/Type: ${classDesc}

Provide realistic cost estimate in JSON format:
{
  "costPerPerson": number (in INR for ONE-WAY trip),
  "travelTimeHours": number (realistic travel time in hours),
  "notes": "Brief description of typical ${mode} route"
}

Base this on your knowledge of real ${mode} fares and routes. For flights, consider typical airline prices for this route.

Respond ONLY with valid JSON, no markdown.`;

      const result = await this.callGemini(
        [{ role: 'user', parts: [{ text: prompt }] }],
        {
          temperature: 0.1,
          maxOutputTokens: 300,
        }
      );

      const content = result.response.text() || '{}';
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : '{}');
      
      const costPerPerson = parsed.costPerPerson || 1000;
      const totalCost = costPerPerson * travellers * 2; // Round trip
      const travelTimeHours = parsed.travelTimeHours || 12;
      const travelTimeDays = Math.ceil(travelTimeHours / 12) * 0.5; // Convert to days
      
      console.log(`🚂 ${mode} cost estimate: ₹${totalCost} for ${travellers} people (round trip)`);
      
      return {
        totalCost,
        travelTimeDays,
        transportType: mode,
        costPerPerson,
      };
    } catch (error) {
      console.error(`❌ Error estimating ${mode} cost:`, error);
      console.error(`Error message:`, error?.message);
      console.error(`Error stack:`, error?.stack);
      
      // Include actual error details in the response
      const errorMsg = error?.message || 'Unknown error';
      throw new InternalServerErrorException(
        `AI could not estimate ${mode} cost for ${source} → ${destination}. Error: ${errorMsg}`
      );
    }
  }

  // Backward-compat wrapper
  private async estimateTrainOrBusCost(
    source: string, destination: string, travellers: number,
    mode: 'Train' | 'Bus', travelStyle: string,
  ): Promise<{ totalCost: number; travelTimeDays: number; transportType: string; costPerPerson: number; arrivalTime?: string; duration?: string; operator?: string; transportOptions?: any[] }> {
    // Use real SerpAPI data for bus/train transport
    const startDate = new Date();
    const transportMode = mode.toLowerCase() as 'bus' | 'train';
    
    const transportResult = await this.transportService.searchBusTrainOptions(
      source,
      destination,
      startDate,
      transportMode,
    );

    if (transportResult && transportResult.recommended) {
      const option = transportResult.recommended;
      const totalCost = option.price * travellers;
      const travelTimeHours = this.transportService.parseMinutes(option.duration) / 60;
      
      return {
        totalCost,
        travelTimeDays: travelTimeHours > 12 ? 1 : 0,
        transportType: mode,
        costPerPerson: option.price,
        arrivalTime: option.arrivalTime,
        duration: option.duration,
        operator: option.operator,
        transportOptions: transportResult.options.slice(0, 3),
      };
    }

    // Fallback to AI estimation if SerpAPI fails
    try {
      const fallback = await this.estimateTransportCostAI(source, destination, travellers, mode, travelStyle);
      return { ...fallback, arrivalTime: undefined };
    } catch (aiError) {
      // Last resort: hardcoded heuristic so the pipeline doesn't die
      console.warn(`⚠️ ${mode} AI estimate also failed, using heuristic fallback`);
      const heuristicPerPerson = mode === 'Bus' ? 1500 : 2500; // rough INR cost per person
      return {
        totalCost: heuristicPerPerson * travellers * 2,
        travelTimeDays: mode === 'Bus' ? 1 : 0.5,
        transportType: `${mode} (estimated)`,
        costPerPerson: heuristicPerPerson,
        arrivalTime: undefined,
      };
    }
  }

  // Estimate transport cost and time using AI-powered flight search
  private async estimateTransportCostAndTime(
    source: string,
    destination: string,
    startDate: string,
    endDate: string,
    travellers: number,
    travelStyle: string,
    budget: number,
    transportMode?: string,
  ): Promise<{ cost: number; travelTimeDays: number; transportType: string; costPerPerson: number; flights?: any[]; arrivalTime?: string }> {
    try {
      const preferredMode = transportMode || 'Flight';
      console.log(`🚂 Calculating ${preferredMode} cost from ${source} to ${destination}...`);
      
      // If user prefers Train or Bus, use AI to estimate that specific transport mode
      if (preferredMode === 'Train' || preferredMode === 'Bus') {
        const aiEstimate = await this.estimateTrainOrBusCost(
          source,
          destination,
          travellers,
          preferredMode,
          travelStyle
        );
        
        return {
          cost: aiEstimate.totalCost,
          travelTimeDays: aiEstimate.travelTimeDays,
          transportType: aiEstimate.transportType,
          costPerPerson: aiEstimate.costPerPerson,
          arrivalTime: aiEstimate.arrivalTime, // From SerpAPI bus/train data
        };
      }
      
      const isDifferentCountries = await this.areDifferentCountries(source, destination);
      
      if (!isDifferentCountries) {
        // Same country - use flight search
        const flightSearch = await this.flightService.searchFlights(
          source,
          destination,
          startDate,
          endDate,
          travellers,
          budget,
          travelStyle
        );

        const minFlightPerPerson = 3500; // realistic floor for domestic round-trip
        let totalCost = flightSearch.totalCost;
        if (totalCost < minFlightPerPerson * travellers) {
          totalCost = minFlightPerPerson * travellers;
        }

        // For domestic travel, use AI flight search results
        return {
          cost: totalCost,
          travelTimeDays: flightSearch.travelTimeDays,
          transportType: 'Flight (Domestic)',
          costPerPerson: totalCost / travellers,
          flights: flightSearch.flights,
          arrivalTime: flightSearch.arrivalTime, // From SerpAPI flight data
        };
      }

      // Different countries - search for international flights
      const flightSearch = await this.flightService.searchFlights(
        source,
        destination,
        startDate,
        endDate,
        travellers,
        budget,
        travelStyle
      );

      if (!flightSearch.flights || flightSearch.flights.length === 0) {
        throw new Error(`Unable to find international flights from ${source} to ${destination}`);
      }

      const minIntlPerPerson = 12000; // realistic floor for international round-trip ex-India
      let totalIntlCost = flightSearch.totalCost;
      if (totalIntlCost < minIntlPerPerson * travellers) {
        totalIntlCost = minIntlPerPerson * travellers;
      }

      return {
        cost: totalIntlCost,
        travelTimeDays: flightSearch.travelTimeDays,
        transportType: 'Flight (International)',
        costPerPerson: totalIntlCost / travellers,
        flights: flightSearch.flights,
      };
    } catch (error) {
      console.error('❌ Transport estimation failed:', error);
      console.log('🔄 Falling back to AI-based transport estimate...');

      // Fallback: use AI to estimate instead of crashing the pipeline
      try {
        const aiEstimate = await this.estimateTransportCostAI(
          source, destination, travellers, 'Flight', travelStyle,
        );
        return {
          cost: aiEstimate.totalCost,
          travelTimeDays: aiEstimate.travelTimeDays,
          transportType: `Flight (AI estimate)`,
          costPerPerson: aiEstimate.costPerPerson,
        };
      } catch (aiErr) {
        console.error('❌ AI fallback also failed:', aiErr);
        // Last resort: rough heuristic so the pipeline doesn't die
        const roughPerPerson = 5000;
        return {
          cost: roughPerPerson * travellers,
          travelTimeDays: 0,
          transportType: 'Flight (estimated)',
          costPerPerson: roughPerPerson,
          arrivalTime: undefined,
        };
      }
    }
  }

  // Generate AI-powered warnings
  private async generateAIWarnings(
    source: string,
    destination: string,
    days: number,
    budget: number,
    travellers: number,
    travelStyle: string,
    transportCost: number,
  ): Promise<string[]> {
    try {
      const remainingBudget = budget - transportCost;
      const budgetPerDay = Math.floor(remainingBudget / (days * travellers));

      const prompt = `You are a travel planning expert. Generate realistic warnings for a trip with these details:
- Source: ${source}
- Destination: ${destination}
- Trip Duration: ${days} days
- Total Budget: ₹${budget}
- Transport Cost: ₹${transportCost}
- Remaining Budget: ₹${remainingBudget}
- Budget Per Person Per Day: ₹${budgetPerDay}
- Travel Style: ${travelStyle}
- Number of Travellers: ${travellers}

Generate 3-5 specific, realistic warnings based on this data. MUST consider ALL of these categories:

1. **BUDGET RISKS**: Is the budget sufficient for ${destination}? Cost of living? Hidden expenses?
2. **TIME OVERLOAD**: Is ${days} days enough for ${destination}? Risk of rushed schedule?
3. **WEATHER & SEASONALITY**: Current/upcoming weather patterns? Monsoon? Extreme heat/cold? Best season?
4. **PERMITS & SAFETY**: 
   - Inner Line Permits (for Arunachal, Nagaland, Mizoram, etc.)
   - Protected Area Permits (for border areas, restricted zones)
   - Entry fees or advance bookings required?
   - Safety advisories for the region?
   - Travel insurance recommendations?
5. **CULTURAL RESTRICTIONS**:
   - Dress codes (temples, mosques, religious sites)?
   - Photography restrictions?
   - Local customs to respect?
   - Religious holidays affecting operations?
   - Alcohol/food restrictions in certain areas?

Format as JSON array with objects having "title" and "description" keys.
Be specific to ${destination} - not generic advice.

Respond ONLY with valid JSON array, no markdown.`;

      const result = await this.callGemini(
        [{ role: 'user', parts: [{ text: prompt }] }],
        {
          temperature: 0.7,
          maxOutputTokens: 800,
        }
      );

      const content = result.response.text() || '[]';
      const jsonMatch = content.match(/\\[.*\\]/s);
      
      try {
        const warnings = JSON.parse(jsonMatch ? jsonMatch[0] : content);
        return warnings.map((w: any) => `${w.title}: ${w.description}`);
      } catch {
        return [content];
      }
    } catch (error) {
      console.warn('Error generating AI warnings:', error);
      return [];
    }
  }

  private async validateDestinationIsValid(destination: string): Promise<{ valid: boolean; formatted?: string; reason?: string }> {
    try {
      if (!this.googleMapsApiKey) {
        console.log(`Warning: No Google Maps API key; skipping validation`);
        return { valid: true };
      }

      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(destination)}&key=${this.googleMapsApiKey}`;
      const response = await fetch(url);
      const data = (await response.json()) as { results?: Array<{ types?: string[]; formatted_address?: string; geometry?: { location: { lat: number; lng: number } } }> };
      const results = data.results ?? [];

      if (results.length === 0) {
        return { valid: false, reason: "NOT_FOUND" };
      }

      // Only accept country, state (admin level 1), and city (locality)
      const allowedTypes = new Set(["country", "administrative_area_level_1", "locality", "postal_town"]);
      const validResult = results.find(r => {
        const types = r.types || [];
        const isPolitical = types.includes("political");
        const isAllowed = types.some(t => allowedTypes.has(t));
        return isPolitical && isAllowed;
      });

      if (!validResult) {
        return { valid: false, reason: "NOT_A_CITY_STATE_OR_COUNTRY" };
      }

      console.log(`[OK] Validated destination: ${validResult.formatted_address}`);
      return { valid: true, formatted: validResult.formatted_address };
    } catch (error) {
      console.error("Validation error:", (error as Error).message);
      return { valid: false, reason: "VALIDATION_ERROR" };
    }
  }

  private async validateDestinationWithGoogleMaps(destination: string): Promise<{ valid: boolean; city?: string; state?: string; country?: string; lat?: number; lng?: number }> {
    try {
      // Use GeoService which has Nominatim fallback
      const geoResult = await this.geoService.geocode(destination);
      
      if (geoResult && geoResult.lat !== 0 && geoResult.lng !== 0) {
        const locationType = !geoResult.city ? (geoResult.state ? 'STATE/REGION' : 'COUNTRY') : 'CITY';
        console.log(`✅ Valid ${locationType}: ${geoResult.city ? geoResult.city + ', ' : ''}${geoResult.state ? geoResult.state + ', ' : ''}${geoResult.country || 'Unknown'}`);
        console.log(`📍 Coordinates: ${geoResult.lat}, ${geoResult.lng}`);
        
        return {
          valid: true,
          city: geoResult.city,
          state: geoResult.state,
          country: geoResult.country,
          lat: geoResult.lat,
          lng: geoResult.lng,
        };
      }

      // If geocoding failed entirely, still allow Gemini to plan
      console.warn(`⚠️ Could not geocode "${destination}" — proceeding with Gemini-based itinerary`);
      return { valid: true };
    } catch (error) {
      console.error("Error validating destination:", (error as Error).message);
      return { valid: true }; // Allow to proceed
    }
  }

  private async getDistanceAndTime(
    origin: { lat: number; lng: number }, 
    destination: { lat: number; lng: number },
    originName?: string,
    destName?: string
  ): Promise<{ distanceKm: number; timeMinutes: number }> {
    try {
      // Calculate straight-line distance using Haversine formula
      const earthRadiusKm = 6371;
      const dLat = (destination.lat - origin.lat) * Math.PI / 180;
      const dLon = (destination.lng - origin.lng) * Math.PI / 180;
      
      const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(origin.lat * Math.PI / 180) * Math.cos(destination.lat * Math.PI / 180) *
                Math.sin(dLon/2) * Math.sin(dLon/2);
      
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      const straightLineDistanceKm = earthRadiusKm * c;
      
      // Apply road distance factor (roads are typically 1.2-1.5x straight line distance)
      const roadFactor = 1.3;
      const roadDistanceKm = Math.round(straightLineDistanceKm * roadFactor);
      
      // Estimate time based on distance (average urban speed ~30 km/h)
      let timeMinutes: number;
      if (roadDistanceKm <= 2) {
        timeMinutes = Math.round(roadDistanceKm * 4); // 15 km/h in city traffic
      } else if (roadDistanceKm <= 10) {
        timeMinutes = Math.round(roadDistanceKm * 2.5); // 24 km/h
      } else {
        timeMinutes = Math.round(roadDistanceKm * 2); // 30 km/h on highways
      }
      
      console.log(`✅ Distance calculated (Haversine): ${originName || 'origin'} → ${destName || 'destination'} = ${roadDistanceKm}km, ${timeMinutes}min`);
      
      return {
        distanceKm: roadDistanceKm,
        timeMinutes: Math.max(timeMinutes, 5), // Minimum 5 minutes
      };
    } catch (error) {
      console.error("❌ Error calculating distance:", (error as Error).message);
      return { distanceKm: 5, timeMinutes: 15 }; // Default fallback
    }
  }

  private async getCoordinatesForPlace(placeName: string, destination: string): Promise<{ lat: number; lng: number } | null> {
    try {
      if (!this.googleMapsApiKey) {
        console.warn(`⚠️ No Google Maps API key - using basic coordinate lookup for "${placeName}" in ${destination}`);
        return null;
      }

      const query = `${placeName}, ${destination}`;
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${this.googleMapsApiKey}`;
      
      console.log(`🔍 Looking up coordinates for: "${placeName}" in ${destination}`);
      
      const response = await fetch(url);
      const data = (await response.json()) as any;

      if (data.results && data.results.length > 0) {
        const result = data.results[0];
        const lat = result.geometry.location.lat;
        const lng = result.geometry.location.lng;
        console.log(`✅ Found coordinates: ${placeName} = (${lat}, ${lng})`);
        return { lat, lng };
      }
      console.warn(`⚠️ No coordinates found for: ${placeName}`);
      return null;
    } catch (error) {
      console.error(`❌ Error looking up coordinates for "${placeName}":`, (error as Error).message);
      return null;
    }
  }

  // Attempt to repair common JSON formatting issues from AI output
  private sanitizeToStrictJSON(raw: string): string {
    try {
      let text = raw.trim();
      // Remove Markdown code fences or backticks if present
      text = text.replace(/^```json\n|^```\n|```$/g, '');
      text = text.replace(/```/g, '');

      // Keep only the outermost JSON object content
      const firstBrace = text.indexOf('{');
      const lastBrace = text.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        text = text.substring(firstBrace, lastBrace + 1);
      }

      // Quote unquoted property names: { key: value } -> { "key": value }
      text = text.replace(/([\{\,]\s*)([A-Za-z0-9_]+)\s*:/g, '$1"$2":');

      // Remove trailing commas before object/array close
      text = text.replace(/,\s*(\}|\])/g, '$1');

      // Ensure string values for known string fields are quoted
      const stringKeys = [
        'time','name','description','duration','category','transportMode',
        'date','theme','hotelName','address','notes','destination','travelStyle',
        'breakfast','lunch','dinner','snacks'
      ];
      for (const key of stringKeys) {
        const re = new RegExp(`("${key}"\s*:\s*)([^"\n\r\],}]+)`, 'g');
        text = text.replace(re, (m, p1, p2) => {
          const val = p2.trim();
          if (val.startsWith('"')) return m; // already quoted
          return `${p1}"${val}"`;
        });
      }

      // Replace smart quotes with plain quotes
      text = text.replace(/[“”]/g, '"');
      text = text.replace(/[‘’]/g, "'");

      return text;
    } catch {
      return raw;
    }
  }

  private buildPrompt(
    dto: CreateItineraryDto,
    availableDaysForActivities: number,
    transportData: { cost: number; travelTimeDays: number; transportType: string; costPerPerson: number; arrivalTime?: string },
    locationInfo: { city?: string; state?: string; country?: string },
    discoveredData?: {
      hotels: DiscoveredHotel[];
      attractions: DiscoveredAttraction[];
      restaurants: DiscoveredRestaurant[];
      weather: WeatherForecast;
      clusters: Array<Array<{ name: string; lat: number; lng: number }>>;
    },
    arrivalTime?: string,
    arrivalFatigue?: { fatigueLevel: string; compressionFactor: number; recommendation: string } | null,
    tourismIntel?: any,
    officialPoiResult?: any,
  ): string {
    const days = this.calculateDays(dto.startDate, dto.endDate);
    const remainingBudget = dto.budget - transportData.cost;
    const budgetPerDay = Math.round(remainingBudget / days);
    const budgetPerPersonPerDay = Math.round(remainingBudget / (days * dto.travellers));
    const fullLocation = `${locationInfo.city ? locationInfo.city + ', ' : ''}${locationInfo.state ? locationInfo.state + ', ' : ''}${locationInfo.country || dto.destination}`;
    const nightlifeCategory = dto.includeNightlife ? "/nightlife" : "";
    const nightlifeRule = dto.includeNightlife
      ? `\n5b. **NIGHTLIFE PRIORITY (user enabled)**:\n   - Include 1-2 famous nightlife spots on MOST days (8:00 PM - 1:00 AM) when realistic\n   - Use ONLY well-known, popular venues in ${dto.destination}: famous rooftop bars, beach clubs, night markets, live music venues, breweries, pubs, clubs\n   - Examples: Marina Bay Sands SkyBar (Singapore), Tomorrowland (Belgium), Hakkasan (Dubai), Colaba Social (Mumbai)\n   - Provide REAL venue names with actual addresses - no generic "Local Night Club"\n   - Include realistic entry fees, cover charges, and minimum spends\n   - Ensure safe transport back to hotel (Uber/taxi cost in budget)\n   - Mark these with category "nightlife" and time after 8 PM\n   - Consider day's energy level - heavy sightseeing day = lighter nightlife or skip`
      : "";

    // Build real data sections if discovered data is available
    const hotelsSection = discoveredData?.hotels?.length
      ? `\n== REAL HOTELS (from live search - USE THESE, do NOT invent hotels) ==\n${discoveredData.hotels.map((h, i) => `${i + 1}. ${h.name} | Rating: ${h.rating}/5 (${h.reviews} reviews) | ₹${h.pricePerNight}/night | ${h.category} | ${h.location}${h.gpsCoordinates ? ` | GPS: ${h.gpsCoordinates.lat},${h.gpsCoordinates.lng}` : ''}`).join('\n')}\n`
      : '';

    const attractionsSection = discoveredData?.attractions?.length
      ? `\n== REAL ATTRACTIONS (from live search - USE THESE, do NOT invent places) ==\n${discoveredData.attractions.map((a, i) => `${i + 1}. ${a.name} | ${a.category} | Rating: ${a.rating}/5 (${a.reviews} reviews) | ${a.address}${a.openingHours ? ` | Hours: ${a.openingHours}` : ''}${a.entryFee ? ` | Entry: ₹${a.entryFee}` : ' | Free entry'}${a.gpsCoordinates ? ` | GPS: ${a.gpsCoordinates.lat},${a.gpsCoordinates.lng}` : ''}`).join('\n')}\n`
      : '';

    const restaurantsSection = discoveredData?.restaurants?.length
      ? `\n== REAL RESTAURANTS (from live search - USE THESE, do NOT invent restaurants) ==\n${discoveredData.restaurants.map((r, i) => `${i + 1}. ${r.name} | ${r.cuisine} | Rating: ${r.rating}/5 (${r.reviews} reviews) | Price: ${r.priceLevel} | ${r.address}${r.gpsCoordinates ? ` | GPS: ${r.gpsCoordinates.lat},${r.gpsCoordinates.lng}` : ''}`).join('\n')}\n`
      : '';

    const weatherSection = discoveredData?.weather?.days?.length
      ? `\n== REAL WEATHER FORECAST (from live API - plan accordingly) ==\n${discoveredData.weather.days.map(w => `${w.date}: ${w.condition} (${w.conditionDetail}) | ${w.tempMin}-${w.tempMax}°C | Rain: ${w.rainChance}% (${w.rainMm}mm) | Wind: ${w.windSpeed}m/s | Sunrise: ${w.sunrise} | Sunset: ${w.sunset}`).join('\n')}${discoveredData.weather.alerts?.length ? `\n⚠️ ALERTS:\n${discoveredData.weather.alerts.map(a => `- ${a.event} (${a.severity}): ${a.description}`).join('\n')}` : ''}\n`
      : '';

    const clusterSection = discoveredData?.clusters?.length
      ? `\n== GEOGRAPHIC CLUSTERS (group nearby attractions per day) ==\n${discoveredData.clusters.map((c, i) => `Cluster ${i + 1}: ${c.map(p => p.name).join(', ')}`).join('\n')}\n`
      : '';

    // Tourism Intelligence sections
    const tourismAdvisorySection = tourismIntel?.geminiContext
      ? `\n${tourismIntel.geminiContext}\n`
      : '';

    const officialPoiSection = officialPoiResult?.geminiContext
      ? `\n${officialPoiResult.geminiContext}\n`
      : '';

    const hasRealData = hotelsSection || attractionsSection || restaurantsSection;

    return `You are an expert travel PLANNER. Create a ${days}-day itinerary for ${fullLocation}.

YOUR ROLE: You are a SCHEDULER and DECISION MAKER only. All places, hotels, restaurants, and weather data below come from REAL live API searches. Your job is to:
1. SELECT the best options from the provided real data
2. SCHEDULE them optimally across ${days} days
3. ALLOCATE budget wisely
4. ADAPT to weather conditions
5. FOLLOW government tourism advisories and guidelines (road closures, festivals, permits, safety alerts)
${hasRealData ? '6. USE ONLY the places listed below - do NOT invent or hallucinate any place names' : '6. Use ONLY real, famous, verifiable places you are certain exist'}
${officialPoiSection ? '7. PRIORITIZE official tourism board POIs over random Google Places results' : ''}

CRITICAL - VALID JSON ONLY:
- Use double quotes for ALL strings and property names
- NO apostrophes or single quotes in any text
- NO special characters that need escaping
- Keep descriptions simple and short
- All numbers without quotes
${tourismAdvisorySection}${officialPoiSection}${hotelsSection}${attractionsSection}${restaurantsSection}${weatherSection}${clusterSection}
REQUIRED JSON STRUCTURE:
{
  "tripSummary": {"destination": "${dto.destination}", "duration": ${days}, "totalBudget": ${dto.budget}, "travelStyle": "${dto.travelStyle}"},
  "days": [
    {
      "day": 1,
      "date": "26 Jan 2026",
      "theme": "Arrival Day",
      "activities": [
        {
          "time": "09:00 AM",
          "name": "Place Name from the real attractions list above",
          "description": "Brief description",
          "estimatedCost": 100,
          "duration": "2h",
          "category": "sightseeing",
          "distance_km": 0,
          "travel_time_min": 0,
          "latitude": 0.0,
          "longitude": 0.0
        }
      ],
      "meals": {
        "breakfast": "Restaurant Name - Dish Name - Rs200",
        "lunch": "Restaurant Name - Dish Name - Rs300",
        "dinner": "Restaurant Name - Dish Name - Rs350",
        "snacks": "Cafe Name - Snack Name - Rs100"
      },
      "totalCost": 3000
    }
  ],
  "budgetBreakdown": {"accommodation": 15000, "food": 8000, "activities": 4000, "transport": 2000, "miscellaneous": 1000},
  "hotelStays": [{"hotelName": "Hotel Name from real hotels list above", "checkInDate": "2026-01-26", "checkOutDate": "2026-01-31", "costPerNight": 3000, "address": "Hotel Address", "rating": 4}],
  "transportPlan": {"mode": "${transportData.transportType}", "estCost": ${transportData.cost}, "notes": "Travel details"},
  "recommendations": ["Tip 1", "Tip 2", "Tip 3"],
  "helplines": ["Police 100", "Ambulance 108"],
  "guideContacts": [],
  "optimization": {}
}

PLANNING RULES:

**TRAVELER PROFILE**:
- Average Age: ${dto.averageAge || 'Not specified'}
- ${dto.averageAge && dto.averageAge < 12 ? 'CHILDREN: Focus on parks, playgrounds, interactive museums, aquariums. Shorter visits (1h), frequent breaks.' : dto.averageAge && dto.averageAge < 18 ? 'TEENAGERS: Adventure parks, malls, beaches, cafes, tech museums. Mix fun and culture.' : dto.averageAge && dto.averageAge < 30 ? 'YOUNG ADULTS: Fast-paced, Instagram-worthy spots, adventure, food tours, nightlife if enabled.' : dto.averageAge && dto.averageAge < 50 ? 'ADULTS: Cultural sites, museums, heritage, quality restaurants. Moderate pace.' : dto.averageAge && dto.averageAge >= 50 ? 'SENIORS: Peaceful temples, gardens, parks, heritage. Slow pace, avoid strenuous activities.' : 'Plan for general adult audience with balanced activities.'}
- Diet: ${dto.mealPreference || 'No restrictions'}${dto.mealPreference === 'Vegetarian' || dto.mealPreference === 'Vegan' ? ' - ONLY use vegetarian/vegan restaurants from the list above' : ''}
${nightlifeRule}

**SCHEDULING RULES**:

1. SELECTION: Pick from the REAL data lists above. Hotels → pick best match for budget/style. Attractions → spread across days by geographic cluster. Restaurants → assign to nearby activity zones.

2. ZERO REPETITION: Every activity, restaurant, and hotel name must be unique across ALL ${days} days. No place appears twice.

3. 4-6 ACTIVITIES PER DAY: Only major attractions (temples, museums, monuments, parks, beaches, shopping, adventures). Meals go ONLY in meals section.

4. TIME-OF-DAY RULES:
   - Sunrise activities (beaches, viewpoints): 5:30-7:00 AM
   - Temples/monuments: 7:00-10:00 AM (before crowds)
   - Outdoor: Morning or late afternoon
   - Indoor (malls, museums): 12:00-4:00 PM (avoid heat)
   - Sunset activities: 5:00-7:00 PM
   - Evening markets/shopping: 7:00-9:00 PM

5. GEOGRAPHIC CLUSTERING: Group nearby attractions on same day. Use cluster data if provided above. Minimize daily travel distance.

6. WEATHER ADAPTATION: If weather forecast shows rain on a day, schedule indoor activities. If extreme heat, avoid midday outdoor. Use sunrise/sunset times from weather data.

7. REALISTIC DURATIONS: Temple 1-2h, Beach 2-3h, Museum 2-3h, Fort/Palace 2-3h, Mall 1.5-2h, Park 1-1.5h, Viewpoint 1h.

8. ROUTE ORDER: Activities listed in travel sequence. Each distance_km refers to distance from PREVIOUS activity. Include latitude/longitude from the GPS data provided above.

9. COST ACCURACY — estimatedCost = entry_fee + local_transport_to_reach_from_previous_activity.
   - NEVER use 0 unless the activity has free entry AND is reachable by foot (distance_km < 0.5).
   - Auto/Rickshaw fares: ₹60-120 for 1-3km, ₹120-250 for 3-7km, ₹250-400 for 7-15km
   - Taxi/Cab fares: ₹100-180 for 1-3km, ₹200-400 for 3-8km, ₹400-700 for 8-20km
   - Metro/Bus: ₹20-50 per trip
   - Free-entry attraction (museum/park/beach) reached by taxi: use taxi fare as estimatedCost (never 0)
   - ALWAYS check the attractions list entry fees and add transport on top.

**DAY 1 ARRIVAL**:
${arrivalTime ? `
ARRIVAL TIME: ${arrivalTime}
FATIGUE LEVEL: ${arrivalFatigue?.fatigueLevel || 'low'}
COMPRESSION FACTOR: ${arrivalFatigue?.compressionFactor || 1.0}x

🚨 DAY 1 PLANNING RULES:
${arrivalFatigue?.fatigueLevel === 'extreme' ? 
  `⚠️ EXTREME FATIGUE (arrival after 6PM):
  - NO activities on Day 1
  - Show only: Hotel check-in at ${arrivalTime}, dinner at 8:30 PM
  - Day 1 should have breakfast, travel, check-in, dinner, and sleep
  - Start fresh activities from Day 2 morning` : 
arrivalFatigue?.fatigueLevel === 'high' ? 
  `⚠️ HIGH FATIGUE (arrival 2-6 PM):
  - Maximum 2 light activities (park walk, beach sunset, local market)
  - Each activity: 1 hour maximum
  - Add rest block after arrival: 1 hour
  - Early dinner (7 PM), early sleep
  - Activities start only after ${arrivalTime} + 1h transfer + 1h rest = around 4-5 PM` : 
arrivalFatigue?.fatigueLevel === 'medium' ? 
  `⚠️ MEDIUM FATIGUE (arrival 10 AM-2 PM):
  - Reduce Day 1 to 3-4 activities (remove 1-2 compared to other days)
  - Keep activities light and nearby
  - Add 30 min rest after lunch
  - Activities start after ${arrivalTime} + 30 min transfer = around 11 AM-2:30 PM` : 
  `✅ LOW FATIGUE (arrival before 10 AM):
  - Full day possible (5-6 activities)
  - Activities can start from 9:30 AM onwards
  - Normal schedule`
}

Add 30 min for airport/station transfer. Budget check-in time: 30 minutes.` : 'Assume arrival at 8-9 AM, start activities at 9:30 AM. Full day itinerary possible.'}

${dto.specificPlaces ? `MUST VISIT: ${dto.specificPlaces} - Schedule at optimal times` : ''}
${dto.foodPreferences ? `FOOD PREFERENCE: ${dto.foodPreferences}` : ''}

**BUDGET**:
- Total: Rs${dto.budget} for ${dto.travellers} travelers
- Transport: Rs${transportData.cost} (already allocated for ${transportData.transportType})
- Remaining: Rs${remainingBudget} for accommodation + food + activities + misc
- Per Day: Rs${budgetPerDay} for all ${dto.travellers} travelers
- Style: ${dto.travelStyle}
- ALL costs = total for group (not per person)

**MEALS (MANDATORY - ALL 3 EVERY DAY)**:
- Use restaurants from the REAL RESTAURANTS list above
- Format: "Restaurant Name - Dish Name - Rs[TotalCost for ${dto.travellers} people]"
- Breakfast: near hotel (within 5km), before first activity
- Lunch: near midday activity zone (within 5-10km)
- Dinner: near hotel or last activity (within 5km)
- Each restaurant used ONLY ONCE across all days

**HOTELS**:
- Use hotels from the REAL HOTELS list above
- Pick hotel centrally located relative to most activity clusters
- Include real address, rating, and cost per night from the data

TRANSPORT MODES between activities: Walk (<=1km), Auto (1-5km), Taxi (5-15km), Metro/Car (>15km)

Return ONLY valid JSON. No markdown. No explanations.`;
  }

  /**
   * Generate itinerary with pre-fetched discovery data.
   * 
   * Used by the TripPlanningProcessor to avoid duplicating API calls.
   * Accepts transport, geocode, and discovery data that were already fetched,
   * then builds the prompt, calls Gemini, and post-processes.
   */
  async generateWithData(
    dto: CreateItineraryDto,
    prefetched: {
      transportData: { cost: number; travelTimeDays: number; transportType: string; costPerPerson: number; flights?: any[]; arrivalTime?: string };
      validation: { valid: boolean; city?: string; state?: string; country?: string; lat?: number; lng?: number };
      hotels: any[];
      attractions: any[];
      restaurants: any[];
      weather: any;
      clusters: Array<Array<{ name: string; lat: number; lng: number }>>;
    },
  ): Promise<Itinerary> {
    const { transportData, validation, hotels, attractions, restaurants, weather, clusters } = prefetched;
    const duration = this.calculateDays(dto.startDate, dto.endDate);
    const availableDaysForActivities = Math.max(duration - transportData.travelTimeDays, 1);
    const remainingBudget = dto.budget - transportData.cost;

    // Calculate arrival fatigue if transport includes arrival time
    let arrivalFatigue: { fatigueLevel: string; compressionFactor: number; recommendation: string } | null = null;
    const arrivalTime = transportData.arrivalTime || dto.arrivalTime;
    
    if (arrivalTime) {
      arrivalFatigue = this.transportService.calculateArrivalFatigue(arrivalTime);
      console.log(`🕐 Arrival Analysis: ${arrivalTime} → Fatigue: ${arrivalFatigue.fatigueLevel} (${arrivalFatigue.compressionFactor}x compression)`);
    }

    console.log(`\n[PIPELINE] Generating itinerary for ${dto.destination} with pre-fetched data`);
    console.log(`   Duration: ${duration} days | Budget: ₹${dto.budget} | Transport: ₹${transportData.cost}`);
    console.log(`   Discovery data: ${hotels.length} hotels, ${attractions.length} attractions, ${restaurants.length} restaurants`);

    // Fetch tourism intelligence + images in parallel (non-blocking)
    const [tourismIntel, officialPoiResult, imageResult] = await Promise.all([
      this.tourismAdvisoryService.getAdvisories(dto.destination).catch(() => null),
      this.tourismPoiService.getOfficialPois(dto.destination).catch(() => null),
      this.imageService.getImages(
        dto.destination,
        attractions.map((a: any) => a.name).slice(0, 8),
        hotels.map((h: any) => h.name).slice(0, 5),
        restaurants.map((r: any) => r.name).slice(0, 4),
      ).catch(() => null),
    ]);

    return this._geminiPlanAndPostProcess(
      dto, duration, availableDaysForActivities, remainingBudget, transportData, validation, 
      { hotels, attractions, restaurants, weather, clusters },
      arrivalTime,
      arrivalFatigue,
      tourismIntel,
      officialPoiResult,
      imageResult,
    );
  }


  async generate(dto: CreateItineraryDto): Promise<Itinerary> {
    try {
      console.log(`\n[START] Generating Itinerary for ${dto.destination}`);
      console.log(`Duration: ${this.calculateDays(dto.startDate, dto.endDate)} days | Budget: Rs${dto.budget}`);
      
      // Calculate transport costs and time using AI flight search
      const duration = this.calculateDays(dto.startDate, dto.endDate);
      const transportData = await this.estimateTransportCostAndTime(
        dto.source,
        dto.destination,
        dto.startDate,
        dto.endDate,
        dto.travellers,
        dto.travelStyle,
        dto.budget,
        dto.transportMode, // Pass the transport mode from DTO
      );
      
      console.log(`Transport: ${transportData.transportType} | Cost: ₹${transportData.cost} | Travel Time: ${transportData.travelTimeDays} days`);
      
      // Available days for actual activities (after travel days)
      const availableDaysForActivities = Math.max(duration - transportData.travelTimeDays, 1);
      const remainingBudget = dto.budget - transportData.cost;
      
      // Validate destination exists using Google Maps
      const validation = await this.validateDestinationWithGoogleMaps(dto.destination);
      if (!validation.valid) {
        throw new BadRequestException(
          `Destination "${dto.destination}" not found. Please check the spelling or try a different destination name.`
        );
      }
      
      console.log(`✅ Destination validated. Starting discovery pipeline...`);

      // ========== DISCOVERY PIPELINE (parallel API calls) ==========
      const discoveryStart = Date.now();

      // Step 1: Geocode destination for weather lookup
      const destGeo = await this.geoService.geocode(dto.destination);
      const destLat = destGeo?.lat || validation.lat || 0;
      const destLng = destGeo?.lng || validation.lng || 0;

      console.log(`📍 Geocoded ${dto.destination}: ${destLat}, ${destLng}`);

      // Step 2: Parallel discovery - SerpAPI (hotels, attractions, restaurants) + Weather + Tourism intelligence
      const [hotels, attractions, restaurants, weather, tourismIntel, officialPoiResult] = await Promise.all([
        this.serpService.discoverHotels(
          dto.destination,
          dto.startDate,
          dto.endDate,
          dto.travelStyle,
          dto.travellers,
        ).catch(err => {
          console.warn(`⚠️ Hotel discovery failed: ${err.message}`);
          return [] as any[];
        }),
        this.serpService.discoverAttractions(dto.destination).catch(err => {
          console.warn(`⚠️ Attraction discovery failed: ${err.message}`);
          return [] as any[];
        }),
        this.serpService.discoverRestaurants(
          dto.destination,
          dto.mealPreference,
          dto.travelStyle,
        ).catch(err => {
          console.warn(`⚠️ Restaurant discovery failed: ${err.message}`);
          return [] as any[];
        }),
        this.weatherService.getForecast(
          destLat,
          destLng,
          dto.destination,
          dto.startDate,
          dto.endDate,
        ).catch(err => {
          console.warn(`⚠️ Weather forecast failed: ${err.message}`);
          return { destination: dto.destination, lat: destLat, lng: destLng, days: [], alerts: [] };
        }),
        this.tourismAdvisoryService.getAdvisories(dto.destination).catch(err => {
          console.warn(`⚠️ Tourism advisory fetch failed: ${err.message}`);
          return null;
        }),
        this.tourismPoiService.getOfficialPois(dto.destination).catch(err => {
          console.warn(`⚠️ Tourism POI fetch failed: ${err.message}`);
          return null;
        }),
      ]);

      const discoveryTime = ((Date.now() - discoveryStart) / 1000).toFixed(1);
      console.log(`🔍 Discovery pipeline completed in ${discoveryTime}s`);
      console.log(`   Hotels: ${hotels.length} | Attractions: ${attractions.length} | Restaurants: ${restaurants.length} | Weather days: ${weather.days?.length || 0}`);
      if (tourismIntel) console.log(`   🏛️ Tourism advisories: ${tourismIntel.advisories?.length || 0} | POIs: ${officialPoiResult?.pois?.length || 0}`);

      // Step 3: Cluster attractions by geographic proximity (for day-wise grouping)
      const attractionsWithCoords = attractions
        .filter((a: any) => a.gpsCoordinates?.lat && a.gpsCoordinates?.lng)
        .map((a: any) => ({ name: a.name, lat: a.gpsCoordinates.lat, lng: a.gpsCoordinates.lng }));

      let clusters: Array<Array<{ name: string; lat: number; lng: number }>> = [];
      if (attractionsWithCoords.length > 3) {
        clusters = await this.geoService.clusterByProximity(attractionsWithCoords, 10).catch(err => {
          console.warn(`⚠️ Clustering failed: ${err.message}`);
          return [];
        });
        console.log(`📊 Grouped ${attractionsWithCoords.length} attractions into ${clusters.length} geographic clusters`);
      }

      // Step 4: Fetch high-res images (parallel, non-blocking for failed items)
      console.log(`🖼️  Starting image fetch for ${dto.destination}...`);
      const imageResult = await this.imageService.getImages(
        dto.destination,
        attractions.map((a: any) => a.name).slice(0, 8),
        hotels.map((h: any) => h.name).slice(0, 5),
        restaurants.map((r: any) => r.name).slice(0, 4),
      ).catch(err => {
        console.warn(`⚠️ Image fetch failed: ${err.message}`);
        return null;
      });
      if (imageResult) {
        console.log(`🖼️  Images: dest=${imageResult.destination ? 1 : 0} | attractions=${imageResult.attractions.size} | hotels=${imageResult.hotels.size} | restaurants=${imageResult.restaurants.size}`);
      }

      // Calculate arrival fatigue if transport includes arrival time
      let arrivalFatigue: { fatigueLevel: string; compressionFactor: number; recommendation: string } | null = null;
      const arrivalTime = transportData.arrivalTime || dto.arrivalTime;
      
      if (arrivalTime) {
        arrivalFatigue = this.transportService.calculateArrivalFatigue(arrivalTime);
        console.log(`🕐 Arrival Analysis: ${arrivalTime} → Fatigue: ${arrivalFatigue.fatigueLevel} (${arrivalFatigue.compressionFactor}x compression)`);
      }

      return await this._geminiPlanAndPostProcess(
        dto,
        duration,
        availableDaysForActivities,
        remainingBudget,
        transportData,
        validation,
        { hotels, attractions, restaurants, weather, clusters },
        arrivalTime,
        arrivalFatigue,
        tourismIntel,
        officialPoiResult,
        imageResult,
      );
    } catch (e) {
      const errorMsg = e.message || "Unknown error";
      console.error("[ERROR] Generation failed:", errorMsg);
      
      // Pass through BadRequestException (validation errors)
      if (e instanceof BadRequestException) {
        throw e;
      }
      
      // Check for JSON parsing errors
      if (errorMsg.includes("JSON") || errorMsg.includes("Unexpected token")) {
        throw new InternalServerErrorException(`Failed to parse AI response - destination may not be valid.`);
      }
      
      throw new InternalServerErrorException(`Failed to generate itinerary: ${errorMsg}`);
    }
  }


  public async _geminiPlanAndPostProcess(
    dto: CreateItineraryDto,
    duration: number,
    availableDaysForActivities: number,
    remainingBudget: number,
    transportData: any,
    validation: any,
    discoveredData: {
      hotels: any[];
      attractions: any[];
      restaurants: any[];
      weather: any;
      clusters: Array<Array<{ name: string; lat: number; lng: number }>>;
    },
    arrivalTime?: string,
    arrivalFatigue?: { fatigueLevel: string; compressionFactor: number; recommendation: string } | null,
    tourismIntel?: any,
    officialPoiResult?: any,
    imageResult?: any,
  ): Promise<Itinerary> {
    const { hotels, attractions, restaurants, weather, clusters } = discoveredData;
    try {
        // Build prompt with REAL discovered data + tourism intelligence + images
      const prompt = this.buildPrompt(
        dto,
        availableDaysForActivities,
        transportData,
        validation,
        {
          hotels,
          attractions,
          restaurants,
          weather,
          clusters,
        },
        arrivalTime,
        arrivalFatigue,
        tourismIntel,
        officialPoiResult,
      );
      
      const systemPrompt = `You are a professional travel PLANNER and SCHEDULER. You are given REAL data from live API searches (hotels, restaurants, attractions, weather). Your job is to ORGANIZE and SCHEDULE this real data into an optimal itinerary. Return ONLY valid JSON.

CRITICAL JSON RULES:
- All property names in double quotes
- All string values in double quotes only
- NO single quotes, apostrophes, or special quotes in text (use plain text)
- Escape any double quotes within strings with backslash
- No unquoted property names
- No trailing commas
- Use simple English words - avoid special characters

PLANNING RULES:
1. USE the real places/hotels/restaurants provided in the prompt data
2. DO NOT invent or hallucinate new place names
3. Plan realistic travel times and budgets
4. Each day needs 4-6 different unique activities from the provided list
5. No repeated places across all days
6. Adapt schedule to weather forecast when provided

RESPONSE FORMAT: Pure JSON object starting with { and ending with }. No markdown, no code blocks, no explanations.`;
      
      console.log(`Calling Gemini...`);
      const startTime = Date.now();
      
      let res;
      try {
        res = await this.callGemini(
          [{ role: 'user', parts: [{ text: `${systemPrompt}\n  \n  ${prompt}` }] }],
          {
            temperature: 0.1,
            maxOutputTokens: 65536,
            responseMimeType: "application/json",
          }
        );
      } catch (geminiError) {
        console.error('[ERROR] Gemini API call failed:', geminiError.message);
        console.error('[ERROR] Gemini error details:', JSON.stringify(geminiError, null, 2));
        throw new InternalServerErrorException(`Gemini API error: ${geminiError.message}`);
      }
      
      const aiTime = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`⚡ AI Generation Time: ${aiTime}s`);

      const text = res.response.text() ?? "";
      if (!text) {
        console.error('[ERROR] Empty response from Gemini');
        throw new Error("Empty response from Gemini");
      }
      
      console.log(`📄 Response length: ${text.length} characters`);
      console.log(`Parsing JSON response...`);
      
      let itinerary: any;
      try {
        itinerary = JSON.parse(text);
      } catch (parseError) {
        console.warn('[WARN] JSON Parse Failed (attempting repair):', parseError.message);
        // Attempt to recover truncated JSON by finding the last complete day object
        const repaired = this.repairTruncatedJson(text);
        if (repaired) {
          console.warn('[WARN] JSON repaired — some days may be missing');
          itinerary = repaired;
        } else {
          console.error('[ERROR] JSON repair failed. Response length:', text.length);
          throw new InternalServerErrorException('Failed to parse AI response - response was truncated. Try reducing the trip duration or budget.');
        }
      }

      // If AI only provided days in a nested structure, extract it
      if (!itinerary.days && itinerary.itinerary?.days) {
        itinerary = itinerary.itinerary;
      }

      // Enforce correct trip summary
      itinerary.tripSummary = {
        destination: itinerary.tripSummary?.destination ?? dto.destination,
        duration,
        totalBudget: itinerary.tripSummary?.totalBudget ?? dto.budget,
        travelStyle: itinerary.tripSummary?.travelStyle ?? dto.travelStyle,
        source: dto.source,
        transportType: transportData.transportType,
        transportCost: transportData.cost,
        transportMode: dto.transportMode || 'Flight',
        travelTimeDays: transportData.travelTimeDays,
      };

      if (itinerary.days && itinerary.days.length > 0) {
        const firstDay = itinerary.days[0];
        const lastDay = itinerary.days[itinerary.days.length - 1];
        const mode = dto.transportMode || 'Flight';

        if (transportData.flights?.length) {
          const arrivalFlight = transportData.flights[0];
          firstDay.transportInfo = {
            type: 'arrival',
            mode: transportData.transportType,
            details: `${arrivalFlight.airline} ${arrivalFlight.flightNumber}`,
            arrival: arrivalFlight.arrival,
            duration: arrivalFlight.duration,
            cost: arrivalFlight.price,
          };
          lastDay.transportInfo = {
            type: 'departure',
            mode: transportData.transportType,
            details: `Return ${arrivalFlight.airline}`,
            departure: arrivalFlight.departure,
            duration: arrivalFlight.duration,
            cost: arrivalFlight.price,
          };
        } else {
          firstDay.transportInfo = {
            type: 'arrival',
            mode,
            details: `${dto.source} to ${dto.destination}`,
            cost: transportData.costPerPerson,
          };
          lastDay.transportInfo = {
            type: 'departure',
            mode,
            details: `${dto.destination} to ${dto.source}`,
            cost: transportData.costPerPerson,
          };
        }
      }

      // Add flight information if available
      if (transportData.flights && transportData.flights.length > 0) {
        itinerary.flightRecommendations = {
          source: dto.source,
          destination: dto.destination,
          totalCost: transportData.cost,
          costPerPerson: transportData.costPerPerson,
          travelers: dto.travellers,
          options: transportData.flights.map((flight: any) => ({
            airline: flight.airline,
            flightNumber: flight.flightNumber,
            departure: flight.departure,
            arrival: flight.arrival,
            duration: flight.duration,
            stops: flight.stops,
            layover: flight.layover,
            price: flight.price,
            class: flight.class,
            aircraft: flight.aircraft || 'N/A',
          })),
          recommendedOption: transportData.flights[0], // Best value flight
        };
      }

      // Validate days array exists and has correct length
      if (!Array.isArray(itinerary.days) || itinerary.days.length === 0) {
        console.error(`Invalid structure. Full response: ${text}`);
        throw new InternalServerErrorException("Invalid AI response: missing or empty days array");
      }

      if (itinerary.days.length !== duration) {
        console.warn(`AI returned ${itinerary.days.length} days, expected ${duration}. Adjusting...`);
        if (itinerary.days.length < duration) {
          console.error(`ERROR: AI only provided ${itinerary.days.length} days but we need ${duration} days`);
          throw new InternalServerErrorException(
            `AI generated incomplete itinerary: only ${itinerary.days.length} of ${duration} days provided`
          );
        }
        itinerary.days = itinerary.days.slice(0, duration);
      }

      // Validate and populate each day
      const startDate = new Date(dto.startDate);
      const globalActivityNames = new Set<string>(); // Track all activity names across all days
      for (let index = 0; index < itinerary.days.length; index++) {
        const day = itinerary.days[index];
        const dayDate = new Date(startDate);
        dayDate.setDate(dayDate.getDate() + index);
        
        day.day = index + 1;
        day.date = day.date || dayDate.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
        day.theme = day.theme || `Day ${index + 1} in ${dto.destination}`;
        
        // Validate meals - must be provided by AI
        if (!day.meals || typeof day.meals !== "object") {
          throw new InternalServerErrorException(`Day ${index + 1}: missing meals data.`);
        }
        if (!day.meals.breakfast || !day.meals.lunch || !day.meals.dinner) {
          throw new InternalServerErrorException(`Day ${index + 1}: incomplete meals. All three meals (breakfast, lunch, dinner) must be provided.`);
        }
        
        // Validate that meal names look realistic (not generic placeholders)
        const mealsArray = [day.meals.breakfast, day.meals.lunch, day.meals.dinner];
        for (const meal of mealsArray) {
          if (meal.toLowerCase().includes('local') || meal.toLowerCase().includes('generic') || meal.toLowerCase() === 'restaurant') {
            console.warn(`⚠️ Day ${index + 1}: Meal "${meal}" looks like a placeholder. Should be a real restaurant name.`);
          }
        }
        
        day.meals = {
          breakfast: day.meals.breakfast,
          lunch: day.meals.lunch,
          dinner: day.meals.dinner,
        };

        // Ensure all activities have required fields
        if (!Array.isArray(day.activities)) {
          throw new InternalServerErrorException(`Day ${index + 1}: activities is not an array`);
        }

        if (day.activities.length > 0) {
          const filtered: any[] = [];
          for (let actIdx = 0; actIdx < day.activities.length; actIdx++) {
            const activity = day.activities[actIdx];

            // Validate activity name is real (warn about suspicious names)
            const activityName = activity.name || activity.activity || "";
            
            // Check for generic/suspicious place names
            const suspiciousPatterns = [
              'local market', 'local restaurant', 'local cafe', 'local shop', 'local spot', 'local eatery', 'local food',
              'city market', 'street food', 'beach restaurant',
              /^(a |the )?[a-z]+ (restaurant|cafe|shop|stall|market|spot)$/i,
              'generic', 'somewhere', 'place', 'thing',
            ];
            
            let isSuspicious = false;
            const lowerName = activityName.toLowerCase().trim();
            
            if (!activityName.trim() || activityName === 'Local Activity') {
              isSuspicious = true;
              console.error(`❌ Day ${index + 1}, Activity ${actIdx + 1}: "${activityName}" - EMPTY or generic name. Must be REAL famous place!`);
            } else {
              for (const pattern of suspiciousPatterns) {
                if (typeof pattern === 'string' ? lowerName.includes(pattern) : pattern.test(lowerName)) {
                  isSuspicious = true;
                  break;
                }
              }
              if (isSuspicious) {
                console.warn(`⚠️ Day ${index + 1}, Activity ${actIdx + 1}: "${activityName}" - GENERIC NAME DETECTED! Must use real famous place (e.g., "Kanyakumari Beach") or specific area name (e.g., "Local restaurant near Vivekananda Rock"). NEVER use generic terms like "local market", "local cafe", "local restaurant" unless you have NO other option.`);
              }
            }

            // Check for duplicate activity names globally
            const normName = activityName.toLowerCase().trim();
            if (globalActivityNames.has(normName)) {
              console.warn(`🚫 REMOVED duplicate place on Day ${index + 1}: "${activityName}" (already used on earlier day)`);
              continue; // Skip this activity - don't add to filtered list
            }
            globalActivityNames.add(normName);

            const distKm = Math.max(Math.round(activity.distance_km || 0), 0);
            const tMode = (activity.transportMode || 'Taxi').toLowerCase();
            let estimatedCost = Math.max(Math.round(activity.estimatedCost || 0), 0);

            // If Gemini returned 0 but there IS a transport leg, inject a realistic fare
            if (estimatedCost === 0 && distKm > 0.5) {
              if (tMode.includes('walk')) {
                estimatedCost = 0; // walking is free
              } else if (tMode.includes('metro') || tMode.includes('bus')) {
                estimatedCost = distKm <= 5 ? 30 : 50;
              } else if (tMode.includes('auto') || tMode.includes('rickshaw')) {
                estimatedCost = distKm <= 3 ? 90 : distKm <= 7 ? 180 : 300;
              } else {
                // Taxi / Cab
                estimatedCost = distKm <= 3 ? 150 : distKm <= 8 ? 300 : distKm <= 15 ? 500 : 700;
              }
            }

            filtered.push({
              time: activity.time || "09:00 AM",
              name: activity.name || activity.activity || "Local Activity",
              description: activity.description || "Explore and discover",
              estimatedCost,
              duration: activity.duration || "1h",
              category: activity.category || "sightseeing",
              distance_km: distKm,
              travel_time_min: Math.max(Math.round(activity.travel_time_min || 0), 0),
              transportMode: activity.transportMode || "Taxi",
              latitude: activity.latitude || null,
              longitude: activity.longitude || null,
            });
          }

          day.activities = filtered;
          
          // Skip coordinate lookup to save time - use Haversine with estimated coords if needed
          console.log(`\n  ⚡ Skipping coordinate lookup for speed - using distance estimates`);

          // Calculate day total
          day.totalCost = day.activities.reduce((sum, a) => sum + (a.estimatedCost || 0), 0);

          // Skip distance computation to save generation time - use AI-provided estimates
          console.log(`⚡ Skipping distance computation for speed - using AI estimates`);
          for (let i = 1; i < day.activities.length; i++) {
            const curr = day.activities[i];
            // Set default transport mode if not provided
            if (!curr.transportMode) {
              const dist = curr.distance_km || 5;
              if (dist <= 1) curr.transportMode = "Walk";
              else if (dist <= 5) curr.transportMode = "Auto";
              else if (dist <= 15) curr.transportMode = "Taxi";
              else curr.transportMode = "Taxi/Car";
            }
          }
        }
      }

      // Validate and normalize budget breakdown - MUST be provided by AI
      let totalBudget = Number(itinerary.tripSummary.totalBudget ?? dto.budget);
      if (!itinerary.budgetBreakdown || typeof itinerary.budgetBreakdown !== "object") {
        throw new InternalServerErrorException(`Missing budgetBreakdown. AI must provide real budget allocation.`);
      }
      
      const current = itinerary.budgetBreakdown;
      // Ensure all keys exist (null/undefined check — 0 is a valid value)
      const budgetKeys = ['accommodation', 'food', 'activities', 'transport', 'miscellaneous'] as const;
      for (const k of budgetKeys) {
        if (current[k] == null) current[k] = 0;
        current[k] = Number(current[k]) || 0;
      }
      // If all are zero, fall back to a proportional split from total budget
      const allZero = budgetKeys.every(k => current[k] === 0);
      if (allZero) {
        const tb = Number(itinerary.tripSummary?.totalBudget ?? dto.budget) || 10000;
        current.accommodation = Math.round(tb * 0.40);
        current.food          = Math.round(tb * 0.20);
        current.activities    = Math.round(tb * 0.15);
        current.transport     = Math.round(tb * 0.20);
        current.miscellaneous = Math.round(tb * 0.05);
      }

      // Validate budget breakdown sums to total
      const breakdownSum = current.accommodation + current.food + current.activities + current.transport + current.miscellaneous;
      if (breakdownSum === 0) {
        throw new InternalServerErrorException(`budgetBreakdown has zero total. Must have real, positive values.`);
      }

      // Normalize to match total budget
      if (breakdownSum !== totalBudget) {
        const ratio = totalBudget / breakdownSum;
        itinerary.budgetBreakdown = {
          accommodation: Math.round(current.accommodation * ratio),
          food: Math.round(current.food * ratio),
          activities: Math.round(current.activities * ratio),
          transport: Math.round(current.transport * ratio),
          miscellaneous: Math.round(current.miscellaneous * ratio),
        };
      }

      // Guarantee transport bucket at least matches real transport cost, then rebalance others
      const bd = itinerary.budgetBreakdown;
      const transportNeeded = Math.max(transportData.cost, bd.transport || 0);
      if (transportNeeded > totalBudget) {
        console.warn(`⚠️ Transport cost (₹${transportNeeded}) exceeds total budget (₹${totalBudget}). Auto-adjusting budget to accommodate.`);
        const originalBudget = totalBudget;
        const minActivityBudget = Math.round(transportNeeded * 0.3);
        const adjustedBudget = transportNeeded + minActivityBudget;
        itinerary.tripSummary.totalBudget = adjustedBudget;
        totalBudget = adjustedBudget;
        if (!itinerary.warnings) itinerary.warnings = [];
        itinerary.warnings.unshift(`Budget increased from ₹${originalBudget} to ₹${adjustedBudget} to cover ${transportData.transportType} costs (₹${transportNeeded})`);

        const remaining = adjustedBudget - transportNeeded;
        itinerary.budgetBreakdown = {
          accommodation: Math.round(remaining * 0.40),
          food: Math.round(remaining * 0.30),
          activities: Math.round(remaining * 0.20),
          transport: transportNeeded,
          miscellaneous: Math.round(remaining * 0.10),
        };
      } else if (bd.transport < transportNeeded) {
        const pool = (bd.accommodation || 0) + (bd.food || 0) + (bd.activities || 0) + (bd.miscellaneous || 0);
        const remaining = totalBudget - transportNeeded;

        if (pool <= 0 || remaining <= 0) {
          throw new BadRequestException(
            `Budget distribution invalid: cannot allocate transport ₹${transportNeeded} within total ₹${totalBudget}.`
          );
        }

        const accShare = (bd.accommodation || 0) / pool;
        const foodShare = (bd.food || 0) / pool;
        const actShare = (bd.activities || 0) / pool;
        const miscShare = (bd.miscellaneous || 0) / pool;

        itinerary.budgetBreakdown = {
          accommodation: Math.max(1, Math.round(remaining * accShare)),
          food: Math.max(1, Math.round(remaining * foodShare)),
          activities: Math.max(1, Math.round(remaining * actShare)),
          transport: transportNeeded,
          miscellaneous: Math.max(1, Math.round(remaining * miscShare)),
        };
        const breakdownValues: number[] = Object.values(itinerary.budgetBreakdown).map((v: any) => Number(v ?? 0));
        const newSum: number = breakdownValues.reduce((s: number, v: number) => s + v, 0);
        if (newSum !== totalBudget) {
          const diff: number = Number(totalBudget) - Number(newSum);
          itinerary.budgetBreakdown.transport = Number(itinerary.budgetBreakdown.transport) + diff; // adjust tiny rounding diff into transport bucket
        }
        console.log(`💰 Adjusted budget breakdown to cover real transport cost ₹${transportNeeded}.`);
      }

      // Validate hotel stays - MUST be provided by AI
      if (!Array.isArray(itinerary.hotelStays) || itinerary.hotelStays.length === 0) {
        throw new InternalServerErrorException(
          `hotelStays must be provided. AI must list at least one real hotel/accommodation for the destination.`
        );
      }

      itinerary.hotelStays = itinerary.hotelStays.map((hotel, idx) => {
        if (!hotel.hotelName) throw new InternalServerErrorException(`Hotel ${idx + 1}: missing hotelName`);
        if (!hotel.checkInDate) throw new InternalServerErrorException(`Hotel ${idx + 1}: missing checkInDate`);
        if (!hotel.checkOutDate) throw new InternalServerErrorException(`Hotel ${idx + 1}: missing checkOutDate`);
        if (hotel.costPerNight === undefined || hotel.costPerNight === null) {
          throw new InternalServerErrorException(`Hotel ${idx + 1} (${hotel.hotelName}): missing costPerNight`);
        }
        
        return hotel;
      });

      // Validate transport plan - MUST be provided by AI
      if (!itinerary.transportPlan || typeof itinerary.transportPlan !== "object") {
        throw new InternalServerErrorException(
          `transportPlan must be provided with real transportation options for the destination.`
        );
      }

      // Ensure arrays exist and contain real values
      if (!Array.isArray(itinerary.recommendations) || itinerary.recommendations.length === 0) {
        throw new InternalServerErrorException(
          `recommendations must be provided. AI should include at least 3 real recommendations for the destination.`
        );
      }

      if (!Array.isArray(itinerary.helplines) || itinerary.helplines.length === 0) {
        throw new InternalServerErrorException(
          `helplines must be provided. AI should include real emergency/tourist helplines for the destination.`
        );
      }

      itinerary.optimization = itinerary.optimization || {};

      console.log(`[DONE] Generated: ${duration} days | Rs${totalBudget} | ${itinerary.hotelStays.length} hotels`);
      
      // Generate AI-powered realistic warnings
      console.log(`Generating AI warnings...`);
      const aiWarnings = await this.generateAIWarnings(
        dto.source,
        dto.destination,
        availableDaysForActivities,
        remainingBudget,
        dto.travellers,
        dto.travelStyle,
        transportData.cost,
      );
      
      // Add warnings to itinerary if not already present
      if (aiWarnings.length > 0) {
        itinerary.warnings = [...(itinerary.warnings || []), ...aiWarnings];
        console.log(`Added ${aiWarnings.length} AI-generated warnings`);
      }

      // Attach images if available
      if (imageResult) {
        itinerary.images = this.imageService.serializeResult(imageResult);
        console.log(`📸 Attached ${Object.keys(itinerary.images.attractions).length} attraction images, ${Object.keys(itinerary.images.hotels).length} hotel images`);
      }

      // Attach tourism advisories if available
      if (tourismIntel?.advisories && tourismIntel.advisories.length > 0) {
        itinerary.tourismAdvisories = tourismIntel.advisories.map((a: any) => ({
          alert: a.alert,
          type: a.type,
          crowdImpact: a.crowdImpact,
        }));
        console.log(`🏛️ Attached ${itinerary.tourismAdvisories.length} tourism advisories`);
      }

      // Attach official POIs if available
      if (officialPoiResult?.pois && officialPoiResult.pois.length > 0) {
        itinerary.officialPois = officialPoiResult.pois.map((p: any) => ({
          name: p.name,
          category: p.category,
          lat: p.lat,
          lng: p.lng,
        }));
        console.log(`🗺️ Attached ${itinerary.officialPois.length} official tourism POIs`);
      }

      // Attach weather forecast so the frontend can display it
      if (discoveredData?.weather?.days?.length) {
        (itinerary as any).weatherForecast = discoveredData.weather.days;
        console.log(`🌤️ Attached ${discoveredData.weather.days.length}-day weather forecast`);
      }

      return itinerary as Itinerary;
    } catch (e) {
      const errorMsg = e.message || "Unknown error";
      console.error("[ERROR] Generation failed:", errorMsg);
      
      if (e instanceof BadRequestException) {
        throw e;
      }
      
      if (errorMsg.includes("JSON") || errorMsg.includes("Unexpected token")) {
        throw new InternalServerErrorException(`Failed to parse AI response - destination may not be valid.`);
      }
      
      throw new InternalServerErrorException(`Failed to generate itinerary: ${errorMsg}`);
    }
  }

  async replanDay(input: ReplanDayInput): Promise<any> {
    const { itinerary, dayIndex, destination } = input;
    const targetDay = itinerary.days[dayIndex];

    const activitiesList = targetDay.activities
      .map((a, i) => `${i + 1}. ${a.time} - ${a.name} - Rs${a.estimatedCost}`)
      .join("\n");

    const prompt = `You are a travel route optimization expert. For Day ${targetDay.day} in ${destination}, reorder these activities to minimize travel time and optimize the geographic flow:

${activitiesList}

Return ONLY JSON: {"activities": [reordered array with same structure]}`;

    try {
      const res = await this.callGemini(
        [{ role: 'user', parts: [{ text: `Optimize activity sequence for minimal travel. Return JSON.\n\n${prompt}` }] }],
        {
          temperature: 0.3,
          maxOutputTokens: 4096,
          responseMimeType: "application/json",
        }
      );

      const text = res.response.text() ?? "";
      const result = JSON.parse(text);
      const activities = result.activities || targetDay.activities;
      const totalCost = activities.reduce((s, a) => s + (a.estimatedCost || 0), 0);

      return {
        day: targetDay.day,
        date: targetDay.date,
        theme: targetDay.theme,
        activities,
        totalCost,
        meals: targetDay.meals,
      };
    } catch (e) {
      console.error("Replan failed:", e);
      return targetDay;
    }
  }

  /**
   * Validate budget using GPT-4 knowledge of travel costs from historical data
   * Analyzes budget based on destination-specific costs and trip duration
   */
  async validateBudgetWithAI(request: {
    source: string;
    destination: string;
    travellers: number;
    budget: number;
    transportMode: string;
    startDate: string;
    endDate: string;
    travelStyle: string;
  }): Promise<{ isValid: boolean; message?: string; suggestedBudget?: number; transportCost?: number }> {
    const { source, destination, travellers, budget, transportMode, startDate, endDate, travelStyle } = request;
    
    try {
      const days = this.calculateDays(startDate, endDate);
      const budgetPerPerson = budget / travellers;
      const budgetPerDay = budget / days;
      
      const prompt = `You are an expert travel budget analyst with comprehensive knowledge of global travel costs, destination-specific pricing, and seasonal variations. Analyze this trip budget:

**TRIP DETAILS:**
- Source: ${source}
- Destination: ${destination} (Focus on ${destination}-specific costs)
- Transport Mode: ${transportMode}
- Number of Travellers: ${travellers} people
- Trip Duration: ${days} days
- User's Total Budget: ₹${budget}
- Budget Per Person: ₹${budgetPerPerson}
- Budget Per Day: ₹${budgetPerDay}
- Travel Style: ${travelStyle}

**ANALYZE BASED ON ${destination.toUpperCase()}:**

1. **Transport Costs for ${destination}:**
   - ${transportMode} from ${source} to ${destination} (round trip for ${travellers} people)
   - Consider distance, route availability, and typical ${transportMode} fares
   - Include both outbound and return journey

2. **${destination} Accommodation Costs:**
   - ${travelStyle} level hotels/stays in ${destination}
   - Per night rates for ${travellers} people
   - Total for ${days - 1} nights (if multi-day trip)

3. **${destination} Daily Expenses:**
   - Food costs in ${destination} (${travelStyle} dining level)
   - Local transport within ${destination}
   - Entry fees for attractions in ${destination}
   - Shopping and miscellaneous

4. **${days}-Day Itinerary Feasibility:**
   - Is ${days} days appropriate for ${destination}?
   - Can key attractions in ${destination} be covered in ${days} days?
   - Budget sufficiency per day for activities

**PROVIDE REALISTIC ANALYSIS:**
Return JSON with destination-specific and duration-based validation:
{
 "isValid": boolean (true if ₹${budget} is sufficient for ${days} days in ${destination}),
  "message": "Specific explanation mentioning ${destination} costs and ${days}-day budget breakdown",
  "suggestedBudget": number (realistic total budget for ${days} days in ${destination} for ${travellers} people in INR),
  "transportCost": number (${transportMode} cost from ${source} to ${destination} round trip for ${travellers} people in INR),
  "perDayBudget": number (recommended budget per day in ${destination} for ${travellers} people),
  "breakdown": {
    "transport": number (total ${transportMode} cost),
    "accommodation": number (${days-1} nights in ${destination}),
    "food": number (${days} days of meals in ${destination}),
    "activities": number (sightseeing in ${destination} for ${days} days),
    "miscellaneous": number (local transport, shopping in ${destination})
  }
}

**IMPORTANT:** Base ALL costs on real-world prices for **${destination}** specifically. Consider ${destination}'s cost of living, tourist season pricing, and typical ${days}-day trip expenses.`;

      const systemPrompt = `You are a travel budget expert. Analyze budgets based on DESTINATION-SPECIFIC costs and trip DURATION. Provide realistic assessments for ${destination} over ${days} days.`;
      
      const response = await this.callGemini(
        [{ role: 'user', parts: [{ text: `${systemPrompt}\n\n${prompt}` }] }],
        {
          temperature: 0.2,
          maxOutputTokens: 1000,
          responseMimeType: "application/json",
        }
      );

      const content = response.response.text() || '{}';
      const result = JSON.parse(content);
      
      const validationStatus = result.isValid ? '✅ SUFFICIENT' : '⚠️ INSUFFICIENT';
      console.log(`\n💰 Budget Validation for ${destination} (${days} days):`);
      console.log(`   User Budget: ₹${budget} | Status: ${validationStatus}`);
      console.log(`   Suggested: ₹${result.suggestedBudget} | Per Day: ₹${result.perDayBudget || budgetPerDay}`);
      console.log(`   ${transportMode} Cost: ₹${result.transportCost}\n`);
      
      return {
        isValid: result.isValid ?? true,
        message: result.message || `Budget analysis for ${days}-day trip to ${destination}`,
        suggestedBudget: result.suggestedBudget,
        transportCost: result.transportCost,
      };
    } catch (error) {
      console.error('Error validating budget with AI:', error);
      throw new InternalServerErrorException('Budget validation failed via AI.');
    }
  }
}
