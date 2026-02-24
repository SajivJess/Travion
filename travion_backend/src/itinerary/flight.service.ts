import { Injectable, Logger } from '@nestjs/common';
import { FlightOption, FlightInfo } from './itinerary.interface';
import { AirportService } from './airport.service';
import axios from 'axios';

/**
 * FlightService — Uses SerpAPI Google Flights engine + AirportService (8,900+ airports)
 * 
 * Searches real Google Flights data via SerpAPI with 5-key rotation.
 * Airport/city/state/country resolution is handled by AirportService
 * which loads the full OurAirports database (~8,965 airports with IATA codes).
 */
@Injectable()
export class FlightService {
  private readonly logger = new Logger(FlightService.name);
  private readonly apiKeys: string[];
  private currentKeyIndex: number = 0;

  constructor(private readonly airportService: AirportService) {
    // Reuse the same SerpAPI keys as the discovery service
    this.apiKeys = [
      process.env.SERP_API_KEY,
      process.env.SERP_API_KEY_2,
      process.env.SERP_API_KEY_3,
      process.env.SERP_API_KEY_4,
      process.env.SERP_API_KEY_5,
    ].filter(Boolean) as string[];

    if (this.apiKeys.length === 0) {
      this.logger.error('❌ No SERP_API_KEY configured! Flight search will not work.');
    } else {
      this.logger.log(`✈️ FlightService initialized with ${this.apiKeys.length} SerpAPI key(s) (Google Flights)`);
    }
  }

  private getApiKey(): string {
    return this.apiKeys[this.currentKeyIndex % this.apiKeys.length];
  }

  private rotateKey(): void {
    this.currentKeyIndex = (this.currentKeyIndex + 1) % this.apiKeys.length;
    this.logger.log(`🔄 Rotated to SerpAPI key #${this.currentKeyIndex + 1} (flights)`);
  }

  /**
   * Resolve a location string to an IATA code using the full airport database.
   */
  private resolveLocation(location: string): string {
    const result = this.airportService.resolveIATA(location);
    if (result.airport) {
      this.logger.log(`📍 Resolved "${location}" → ${result.iata} (${result.airport.name}, ${result.airport.city}) [${result.method}]`);
    }
    return result.iata;
  }

  /**
   * Format date to YYYY-MM-DD
   */
  private formatDate(dateStr: string): string {
    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return dateStr;
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    } catch {
      return dateStr;
    }
  }

  /**
   * SerpAPI request with key rotation on 429/401
   */
  private async serpFlightRequest(params: Record<string, any>, retries = 3): Promise<any> {
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const response = await axios.get('https://serpapi.com/search.json', {
          params: {
            ...params,
            engine: 'google_flights',
            api_key: this.getApiKey(),
          },
          timeout: 20000,
        });
        return response.data;
      } catch (error: any) {
        const status = error.response?.status;
        if (status === 429 || status === 401) {
          console.warn(`⚠️ SerpAPI key ${this.currentKeyIndex + 1} exhausted (flights), rotating...`);
          this.rotateKey();
        } else if (attempt === retries - 1) {
          console.error(`❌ SerpAPI Google Flights failed after ${retries} attempts:`, error.message);
          throw error;
        }
        // Wait before retry
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
    return null;
  }

  /**
   * Parse a Google Flights result into our FlightOption format
   */
  private parseGoogleFlight(flight: any, isReturn = false): FlightOption {
    // flight has: departure_airport, arrival_airport, flights[], total_duration, price, type, airline_logo, etc.
    const segments = flight.flights || [];
    const firstSeg = segments[0] || {};
    const lastSeg = segments[segments.length - 1] || firstSeg;

    return {
      airline: firstSeg.airline || flight.airline || 'Unknown',
      flightNumber: firstSeg.flight_number || '',
      departureTime: firstSeg.departure_airport?.time || '',
      arrivalTime: lastSeg.arrival_airport?.time || '',
      duration: flight.total_duration || 0,      // minutes
      stops: Math.max(0, segments.length - 1),
      cost: flight.price || 0,                    // per person in search currency
      bookingUrl: flight.booking_url || flight.link || this.generateFlightBookingUrl(firstSeg.airline, flight.departure_airport?.id, flight.arrival_airport?.id),
      airlineLogo: flight.airline_logo || firstSeg.airline_logo,
    };
  }

  /**
   * Main search method — uses SerpAPI Google Flights
   */
  async searchFlights(
    source: string,
    destination: string,
    departureDate: string,
    returnDate: string,
    travelers: number,
    budget: number,
    travelStyle: string,
  ): Promise<{ flights: FlightOption[]; totalCost: number; travelTimeDays: number; arrivalTime?: string }> {
    const departureId = this.resolveLocation(source);
    const arrivalId = this.resolveLocation(destination);
    const outDate = this.formatDate(departureDate);
    const retDate = this.formatDate(returnDate);

    console.log(`✈️ Google Flights search: ${source} (${departureId}) → ${destination} (${arrivalId})`);
    console.log(`   Dates: ${outDate} → ${retDate} | ${travelers} traveler(s)`);

    try {
      // Search outbound flights via SerpAPI Google Flights engine
      const data = await this.serpFlightRequest({
        departure_id: departureId,
        arrival_id: arrivalId,
        outbound_date: outDate,
        return_date: retDate,
        currency: 'INR',
        hl: 'en',
        gl: 'in',
        type: '1',       // 1 = round trip, 2 = one way
        adults: travelers,
      });

      if (!data) {
        throw new Error('SerpAPI returned empty response');
      }

      // Google Flights returns best_flights and other_flights
      const bestFlights = data.best_flights || [];
      const otherFlights = data.other_flights || [];
      const allFlights = [...bestFlights, ...otherFlights];

      if (allFlights.length === 0) {
        // Check if there's a price_insights or error
        if (data.price_insights) {
          console.log(`💡 Google Flights price insight: lowest ₹${data.price_insights.lowest_price}`);
        }
        console.warn(`⚠️ No flights found for ${departureId} → ${arrivalId}`);
        throw new Error(`No flights available for ${source} → ${destination} on ${outDate}`);
      }

      // Parse the flights into our format
      const flights: FlightOption[] = allFlights
        .slice(0, 6)
        .map((f: any) => this.parseGoogleFlight(f));

      // Use the prices from Google Flights directly (already per-person for round trip)
      const prices = flights.map(f => f.cost).filter(p => p > 0);
      const cheapestPrice = prices.length > 0 ? Math.min(...prices) : flights[0]?.cost || 0;
      const totalCost = cheapestPrice * travelers;

      // Calculate travel time (>6 hours flight → 1 travel day)
      const avgDuration = flights[0]?.duration || 0;
      const travelTimeDays = avgDuration > 360 ? 1 : 0;

      console.log(`✅ Google Flights: ${flights.length} options found`);
      console.log(`📊 Cheapest: ₹${cheapestPrice}/person | Total: ₹${totalCost} for ${travelers} traveler(s)`);

      // Log price insights if available
      if (data.price_insights) {
        const pi = data.price_insights;
        console.log(`💡 Price insights: lowest ₹${pi.lowest_price}, typical ₹${pi.typical_price_range?.join('-')}, level: ${pi.price_level}`);
      }

      // Return arrival time of the first/cheapest flight for Day 1 planning
      const arrivalTime = flights[0]?.arrivalTime || '';
      if (arrivalTime) {
        console.log(`🕐 Flight arrival time: ${arrivalTime} (for Day 1 planning)`);
      }

      return { flights, totalCost, travelTimeDays, arrivalTime };
    } catch (error: any) {
      console.error(`❌ Google Flights search failed: ${error.message}`);
      
      // Try one-way search as fallback (some routes don't have round-trip combos)
      try {
        console.log(`🔄 Retrying as one-way search...`);
        return await this.searchOneWayFlights(departureId, arrivalId, outDate, retDate, travelers);
      } catch (oneWayError) {
        console.error(`❌ One-way search also failed: ${oneWayError.message}`);
        throw new Error(`Flight search failed for ${source} → ${destination}: ${error.message}`);
      }
    }
  }

  /**
   * Fallback: search one-way outbound + return separately
   */
  private async searchOneWayFlights(
    departureId: string,
    arrivalId: string,
    outDate: string,
    retDate: string,
    travelers: number,
  ): Promise<{ flights: FlightOption[]; totalCost: number; travelTimeDays: number; arrivalTime?: string }> {
    // Outbound one-way
    const outbound = await this.serpFlightRequest({
      departure_id: departureId,
      arrival_id: arrivalId,
      outbound_date: outDate,
      currency: 'INR',
      hl: 'en',
      gl: 'in',
      type: '2',  // one-way
      adults: travelers,
    });

    const outFlights = [...(outbound?.best_flights || []), ...(outbound?.other_flights || [])];
    if (outFlights.length === 0) {
      throw new Error('No one-way flights found either');
    }

    const flights = outFlights.slice(0, 4).map((f: any) => this.parseGoogleFlight(f));
    
    // For one-way, double the price as approximate round-trip cost
    const prices = flights.map(f => f.cost).filter(p => p > 0);
    const cheapestOneWay = prices.length > 0 ? Math.min(...prices) : 0;
    const cheapestRoundTrip = cheapestOneWay * 2;
    const totalCost = cheapestRoundTrip * travelers;
    const travelTimeDays = (flights[0]?.duration || 0) > 360 ? 1 : 0;

    // Adjust costs to round-trip estimate
    flights.forEach(f => f.cost = f.cost * 2);

    console.log(`✅ One-way flights found, estimated round-trip: ₹${cheapestRoundTrip}/person`);
    
    const arrivalTime = flights[0]?.arrivalTime || '';
    return { flights, totalCost, travelTimeDays, arrivalTime };
  }

  /**
   * Generate booking URL for popular flight booking platforms
   */
  private generateFlightBookingUrl(airline?: string, departureId?: string, arrivalId?: string): string {
    // Generate direct booking links based on airline preference
    if (airline?.toLowerCase().includes('indigo')) {
      return 'https://www.goindigo.in/';
    } else if (airline?.toLowerCase().includes('air india')) {
      return 'https://www.airindia.in/';
    } else if (airline?.toLowerCase().includes('spicejet')) {
      return 'https://www.spicejet.com/';
    } else if (airline?.toLowerCase().includes('vistara')) {
      return 'https://www.airvistara.com/';
    }
    
    // Default to MakeMyTrip flight search
    if (departureId && arrivalId) {
      return `https://www.makemytrip.com/flight/search?from=${departureId}&to=${arrivalId}`;
    }
    
    // Fallback to Google Flights
    return 'https://www.google.com/travel/flights';
  }
}

